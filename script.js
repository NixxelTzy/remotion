/* ============================================ */
/* AFTER MOTION - Frontend Client (Backend API) */
/* ============================================ */

// ---------- CONFIG ----------
// Change this to your backend URL (e.g. http://localhost:3000 or Vercel URL)
const API_BASE = window.location.origin;

// ---------- DOM REFS ----------
const htmlEditor        = document.getElementById('htmlEditor');
const previewFrame      = document.getElementById('previewFrame');
const previewOverlay    = document.getElementById('previewOverlay');
const previewStatus     = document.getElementById('previewStatus');
const renderBtn         = document.getElementById('renderBtn');
const loadSampleBtn     = document.getElementById('loadSampleBtn');
const clearBtn          = document.getElementById('clearBtn');
const resolutionSelect  = document.getElementById('resolution');
const fpsSelect         = document.getElementById('fps');
const durationInput     = document.getElementById('duration');
const progressArea      = document.getElementById('progressArea');
const progressFill      = document.getElementById('progressFill');
const progressText      = document.getElementById('progressText');
const downloadLink      = document.getElementById('downloadLink');
const downloadArea      = document.getElementById('downloadArea');

// ---------- STATE ----------
let isRendering = false;
let abortController = null;

// ---------- SAMPLE HTML ----------
const SAMPLE_HTML = `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
    color: white;
    font-family: 'Segoe UI', sans-serif;
    overflow: hidden;
  }
  h1 {
    font-size: 4rem;
    background: linear-gradient(90deg, #f093fb, #f5576c, #4facfe);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: float 3s ease-in-out infinite;
  }
  p {
    font-size: 1.2rem;
    color: #aaa;
    margin-top: 1rem;
    animation: fadeIn 2s ease;
  }
  .box {
    width: 80px; height: 80px;
    background: #f5576c;
    border-radius: 20px;
    margin-top: 2rem;
    animation: spin 2s linear infinite, colorShift 4s ease-in-out infinite;
  }
  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-20px); }
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @keyframes colorShift {
    0%, 100% { background: #f5576c; }
    33% { background: #4facfe; }
    66% { background: #43e97b; }
  }
</style>
</head>
<body>
  <h1>After Motion</h1>
  <p>HTML + CSS + JS &rarr; Video</p>
  <div class="box"></div>
  <script>
    const counter = document.createElement('p');
    counter.style.marginTop = '1rem';
    counter.style.fontSize = '1.5rem';
    counter.style.fontWeight = 'bold';
    document.body.appendChild(counter);
    let count = 0;
    setInterval(() => {
      counter.textContent = 'Frame: ' + (++count);
    }, 100);
  <\/script>
</body>
</html>`;

// ---------- INIT ----------
function init() {
    htmlEditor.value = SAMPLE_HTML;
    updatePreview();
    setupEventListeners();
}

// ---------- PREVIEW ----------
function updatePreview() {
    const html = htmlEditor.value;
    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    previewFrame.src = url;
    previewOverlay.classList.add('hidden');
    setStatus('Preview Updated', 'var(--accent)');
}

// ---------- STATUS ----------
function setStatus(text, color) {
    previewStatus.textContent = text;
    previewStatus.style.borderColor = color;
    previewStatus.style.color = color;
}

// ---------- EVENT LISTENERS ----------
function setupEventListeners() {
    let previewTimeout;
    htmlEditor.addEventListener('input', () => {
        setStatus('Modified', 'var(--warning)');
        clearTimeout(previewTimeout);
        previewTimeout = setTimeout(updatePreview, 800);
    });

    renderBtn.addEventListener('click', startRender);
    loadSampleBtn.addEventListener('click', () => {
        htmlEditor.value = SAMPLE_HTML;
        updatePreview();
    });
    clearBtn.addEventListener('click', () => {
        htmlEditor.value = '';
        updatePreview();
    });

    durationInput.addEventListener('change', () => {
        let val = parseInt(durationInput.value);
        if (isNaN(val) || val < 1)  durationInput.value = 1;
        if (val > 120)              durationInput.value = 120;
    });
}

// ---------- RENDER ----------
async function startRender() {
    if (isRendering) return;

    const html = htmlEditor.value.trim();
    if (!html) {
        alert('Please enter HTML content first.');
        return;
    }

    const [width, height] = resolutionSelect.value.split('x').map(Number);
    const fps = parseInt(fpsSelect.value);
    const duration = parseInt(durationInput.value);

    // UI setup
    isRendering = true;
    downloadArea.classList.add('hidden');
    renderBtn.disabled = true;
    progressArea.classList.remove('hidden');
    progressFill.style.width = '0%';
    progressText.textContent = 'Sending to server...';
    setStatus('Rendering…', 'var(--warning)');

    try {
        // Send render request
        const response = await fetch(`${API_BASE}/api/render`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html, width, height, fps, duration }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(err.error || `Server error (${response.status})`);
        }

        // Get blob from response
        const blob = await response.blob();
        const filename = `after-motion_${width}x${height}_${fps}fps_${duration}s.mp4`;

        // Setup download
        const url = URL.createObjectURL(blob);
        downloadLink.href = url;
        downloadLink.download = filename;
        downloadArea.classList.remove('hidden');

        // Success
        progressFill.style.width = '100%';
        progressText.textContent = `✓ Video ready — ${(blob.size / (1024 * 1024)).toFixed(1)} MB`;
        setStatus('Render Complete ✓', 'var(--success)');

    } catch (err) {
        console.error('Render error:', err);
        setStatus('Error', 'var(--danger)');
        progressText.textContent = `✗ ${err.message}`;
        alert(`Render failed: ${err.message}`);
    } finally {
        isRendering = false;
        renderBtn.disabled = false;
    }
}

// ---------- BOOT ----------
document.addEventListener('DOMContentLoaded', init);

