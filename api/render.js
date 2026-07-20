/* ============================================ */
/* AFTER MOTION - Vercel Serverless Render API  */
/* ============================================ */

const path = require('path');
const fs   = require('fs');
const { v4: uuidv4 } = require('uuid');

module.exports = async (req, res) => {
    // Only POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { html, width, height, fps, duration } = req.body;

    if (!html) {
        return res.status(400).json({ error: 'HTML content is required' });
    }

    const w = parseInt(width)  || 1920;
    const h = parseInt(height) || 1080;
    const f = parseInt(fps)    || 30;
    const d = parseInt(duration) || 5;
    const totalFrames = f * d;
    const jobId = uuidv4();

    console.log(`[${jobId}] Render: ${w}x${h}, ${f}fps, ${d}s (${totalFrames} frames)`);

    // Temp directory
    const TEMP_DIR = '/tmp/after-motion';
    if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    let browser;

    try {
        // ---- Launch Puppeteer (Chromium) ----
        try {
            const chromium = require('@sparticuz/chromium');
            const puppeteer = require('puppeteer-core');
            browser = await puppeteer.launch({
                args: [
                    ...chromium.args,
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                ],
                defaultViewport: { width: w, height: h },
                executablePath: await chromium.executablePath(),
                headless: chromium.headless,
            });
        } catch (e) {
            // Fallback: try regular puppeteer
            const puppeteer = require('puppeteer');
            browser = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                ],
            });
        }

        const page = await browser.newPage();
        await page.setViewport({ width: w, height: h });

        // Load HTML
        await page.setContent(html, {
            waitUntil: 'networkidle0',
            timeout: 30000,
        });

        // Wait for animations to settle
        await page.evaluate(() => new Promise(r => setTimeout(r, 500)));

        // ---- Find FFmpeg ----
        const ffmpegPath = findFfmpeg();
        if (!ffmpegPath) {
            await browser.close();
            return res.status(500).json({ error: 'FFmpeg not found on server' });
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
            '-crf', '20',
            '-pix_fmt', 'yuv420p',
            '-r', String(f),
            '-s', `${w}x${h}`,
            outputPath,
        ];

        // Spawn FFmpeg
        const ffmpeg = spawn(ffmpegPath, ffmpegArgs);

        let ffmpegErr = '';
        ffmpeg.stderr.on('data', d => { ffmpegErr += d.toString(); });

        // Capture frames
        for (let i = 0; i < totalFrames; i++) {
            let screenshot;
            try {
                screenshot = await page.screenshot({
                    type: 'png',
                    fullPage: false,
                    captureBeyondViewport: false,
                });
            } catch (e) {
                // Fallback: black frame
                await page.evaluate(() => {
                    document.body.innerHTML = '<div style="width:100%;height:100%;background:#000"></div>';
                });
                screenshot = await page.screenshot({ type: 'png' });
            }

            const canWrite = ffmpeg.stdin.write(screenshot);
            if (!canWrite) {
                await new Promise(resolve => ffmpeg.stdin.once('drain', resolve));
            }

            if (i % 10 === 0 || i === totalFrames - 1) {
                console.log(`[${jobId}] Frame ${i + 1}/${totalFrames}`);
            }
        }

        // Close FFmpeg stdin & wait
        ffmpeg.stdin.end();

        await new Promise((resolve, reject) => {
            ffmpeg.on('close', code => {
                if (code === 0) resolve();
                else reject(new Error(`FFmpeg exited ${code}: ${ffmpegErr.slice(-300)}`));
            });
            ffmpeg.on('error', reject);
        });

        await browser.close();

        // Check output
        if (!fs.existsSync(outputPath)) {
            throw new Error('Output file not created');
        }

        const stat = fs.statSync(outputPath);
        console.log(`[${jobId}] Done: ${(stat.size / 1024 / 1024).toFixed(1)} MB`);

        // Read and send
        const fileBuffer = fs.readFileSync(outputPath);
        const filename = `after-motion_${w}x${h}_${f}fps_${d}s.mp4`;

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', fileBuffer.length);
        res.send(fileBuffer);

        // Cleanup
        fs.unlink(outputPath, () => {});

    } catch (err) {
        console.error(`[${jobId}] Error:`, err.message);
        if (browser) await browser.close().catch(() => {});
        res.status(500).json({ error: err.message });
    }
};

// ---------- FIND FFMPEG ----------
function findFfmpeg() {
    const { execSync } = require('child_process');
    const candidates = [
        'ffmpeg',
        '/usr/bin/ffmpeg',
        '/usr/local/bin/ffmpeg',
        '/opt/homebrew/bin/ffmpeg',
    ];
    for (const cmd of candidates) {
        try {
            execSync(`"${cmd}" -version`, { stdio: 'ignore', timeout: 2000 });
            return cmd;
        } catch (e) { /* next */ }
    }
    return null;
}

