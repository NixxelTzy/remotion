/* ============================================ */
/* AFTER MOTION - Backend Server                */
/* Express + Puppeteer + FFmpeg                 */
/* ============================================ */

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;

// Temp directory for renders
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// ---------- MIDDLEWARE ----------
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// ---------- RENDER API ----------
app.post('/api/render', async (req, res) => {
    const { html, width, height, fps, duration } = req.body;

    if (!html) return res.status(400).json({ error: 'HTML content is required' });

    const w = parseInt(width)  || 1920;
    const h = parseInt(height) || 1080;
    const f = parseInt(fps)    || 30;
    const d = parseInt(duration) || 5;
    const totalFrames = f * d;
    const jobId = uuidv4();

    console.log(`[${jobId}] Render job started: ${w}x${h}, ${f}fps, ${d}s (${totalFrames} frames)`);

    try {
        // Dynamic import puppeteer
        let browser;
        try {
            const puppeteer = require('puppeteer');
            browser = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-software-rasterizer',
                ],
            });
        } catch (e) {
            // Try puppeteer-core for Vercel-like environments
            try {
                const chromium = require('@sparticuz/chromium');
                const puppeteer = require('puppeteer-core');
                browser = await puppeteer.launch({
                    args: chromium.args,
                    defaultViewport: chromium.defaultViewport,
                    executablePath: await chromium.executablePath(),
                    headless: chromium.headless,
                });
            } catch (e2) {
                return res.status(500).json({ error: 'Browser engine not available' });
            }
        }

        const page = await browser.newPage();

        // Set viewport to target resolution
        await page.setViewport({ width: w, height: h });

        // Load HTML content
        await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

        // Wait a bit for any animations/JS to settle
        await page.evaluate(() => new Promise(r => setTimeout(r, 500)));

        // Set up FFmpeg to pipe frames directly
        const ffmpegPath = findFfmpeg();
        if (!ffmpegPath) {
            await browser.close();
            return res.status(500).json({ error: 'FFmpeg not found. Install FFmpeg on your system.' });
        }

        const { spawn } = require('child_process');
        const outputPath = path.join(TEMP_DIR, `${jobId}.mp4`);

        const ffmpegArgs = [
            '-y',
            '-f', 'image2pipe',
            '-framerate', String(f),
            '-i', '-',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-crf', '18',
            '-pix_fmt', 'yuv420p',
            '-r', String(f),
            '-s', `${w}x${h}`,
            outputPath,
        ];

        const ffmpeg = spawn(ffmpegPath, ffmpegArgs);
        let ffmpegError = '';

        ffmpeg.stderr.on('data', (data) => {
            ffmpegError += data.toString();
        });

        // Capture each frame with error handling
        for (let i = 0; i < totalFrames; i++) {
            try {
                const screenshot = await page.screenshot({
                    type: 'png',
                    fullPage: false,
                    captureBeyondViewport: false,
                });

                // Write frame to FFmpeg stdin
                const canWrite = ffmpeg.stdin.write(screenshot);
                if (!canWrite) {
                    await new Promise(resolve => ffmpeg.stdin.once('drain', resolve));
                }

                // Progress logging
                if (i % Math.max(1, Math.floor(totalFrames / 20)) === 0 || i === totalFrames - 1) {
                    const pct = ((i + 1) / totalFrames * 100).toFixed(0);
                    console.log(`[${jobId}] Frame ${i + 1}/${totalFrames} (${pct}%)`);
                }
            } catch (frameErr) {
                console.error(`[${jobId}] Frame ${i + 1} error:`, frameErr.message);
                // Draw a blank frame instead of crashing
                await page.evaluate(() => {
                    document.body.innerHTML = '<div style="background:#000;width:100%;height:100%"></div>';
                });
                const screenshot = await page.screenshot({ type: 'png' });
                ffmpeg.stdin.write(screenshot);
            }
        }

        // Close stdin and wait for FFmpeg to finish
        ffmpeg.stdin.end();

        await new Promise((resolve, reject) => {
            ffmpeg.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`FFmpeg exited with code ${code}: ${ffmpegError.slice(-200)}`));
            });
            ffmpeg.on('error', reject);
        });

        await browser.close();

        // Check output exists
        if (!fs.existsSync(outputPath)) {
            throw new Error('Output file not created by FFmpeg');
        }

        const stat = fs.statSync(outputPath);
        console.log(`[${jobId}] Render complete: ${(stat.size / 1024 / 1024).toFixed(1)} MB`);

        // Send the video file
        res.download(outputPath, `after-motion_${w}x${h}_${f}fps_${d}s.mp4`, (err) => {
            if (err) {
                console.error(`[${jobId}] Download error:`, err.message);
            }
            // Cleanup temp file after download
            fs.unlink(outputPath, () => {});
        });

    } catch (err) {
        console.error(`[${jobId}] Render error:`, err.message);
        // Cleanup
        const outputPath = path.join(TEMP_DIR, `${jobId}.mp4`);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

        res.status(500).json({ error: err.message });
    }
});

// ---------- HEALTH CHECK ----------
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
    });
});

// ---------- FIND FFMPEG ----------
function findFfmpeg() {
    const { execSync } = require('child_process');
    const candidates = [
        'ffmpeg',
        'ffmpeg.exe',
        path.join(__dirname, 'node_modules', '.bin', 'ffmpeg'),
        path.join(__dirname, 'node_modules', '.bin', 'ffmpeg.exe'),
        'C:\\ffmpeg\\bin\\ffmpeg.exe',
        '/usr/bin/ffmpeg',
        '/usr/local/bin/ffmpeg',
    ];
    for (const cmd of candidates) {
        try {
            execSync(`"${cmd}" -version`, { stdio: 'ignore', timeout: 2000 });
            return cmd;
        } catch (e) { /* try next */ }
    }
    return null;
}

// ---------- CLEANUP TEMP FILES ----------
// Clean files older than 30 minutes
setInterval(() => {
    try {
        const files = fs.readdirSync(TEMP_DIR);
        const now = Date.now();
        for (const file of files) {
            const fp = path.join(TEMP_DIR, file);
            const stat = fs.statSync(fp);
            if (now - stat.mtimeMs > 30 * 60 * 1000) {
                fs.unlinkSync(fp);
                console.log('Cleaned temp file:', file);
            }
        }
    } catch (e) { /* ignore */ }
}, 5 * 60 * 1000);

// ---------- START ----------
app.listen(PORT, () => {
    console.log(`\n  After Motion Backend`);
    console.log(`  ─────────────────`);
    console.log(`  Server  : http://localhost:${PORT}`);
    console.log(`  Render  : POST /api/render`);
    console.log(`  Health  : GET /api/health`);
    console.log(`  FFmpeg  : ${findFfmpeg() || 'NOT FOUND'}`);
    console.log(`\n  Open http://localhost:${PORT} in your browser\n`);
});

