import React, { useState, useRef, useEffect } from 'react';
import { Upload, Settings, Download, Video, AlertCircle, FileCode, CheckCircle2, Cpu, Zap } from 'lucide-react';

export default function AfterMotionApp() {
  const [htmlFile, setHtmlFile] = useState(null);
  const [fileContent, setFileContent] = useState('');

  const [resolution, setResolution] = useState('4k'); // '2k' or '4k'
  const [fps, setFps] = useState(60);
  const [duration, setDuration] = useState(10); // 10 to 120 seconds
  const [hwAccel, setHwAccel] = useState(true);

  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderComplete, setRenderComplete] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [captureFps, setCaptureFps] = useState(null); // actual achieved capture rate

  const [videoUrl, setVideoUrl] = useState(null);
  const [error, setError] = useState(null);

  const previewIframeRef = useRef(null);
  const canvasRef = useRef(null);
  const muxerLoaded = useRef(false);
  const cancelRef = useRef(false);
  const lastCaptureErrorRef = useRef(null); // NEW: remembers the real reason a capture failed

  useEffect(() => {
    const loadMuxer = () => {
      if (document.querySelector(`script[src="https://unpkg.com/webm-muxer/build/webm-muxer.js"]`)) {
        muxerLoaded.current = true;
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/webm-muxer/build/webm-muxer.js';
      script.async = true;
      script.onload = () => { muxerLoaded.current = true; };
      document.head.appendChild(script);
    };
    loadMuxer();
  }, []);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.type !== 'text/html' && !file.name.endsWith('.html')) {
        setError('Tolong unggah file dengan format HTML yang valid.');
        setHtmlFile(null);
        return;
      }

      setError(null);
      setHtmlFile(file);

      const reader = new FileReader();
      reader.onload = (e) => {
        const originalHtml = e.target.result;
        const injectionScript = `
          <!-- INJECTED BY AFTER MOTION FOR TRUE CAPTURE -->
          <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
          <script>
            let busy = false;
            
            const notifyReady = () => {
              if (typeof html2canvas !== 'undefined') {
                window.parent.postMessage({ type: 'BRIDGE_READY' }, '*');
                return true;
              }
              return false;
            };

            if (!notifyReady()) {
               const checkInterval = setInterval(() => {
                  if (notifyReady()) clearInterval(checkInterval);
               }, 100);
            }

            window.addEventListener('message', async (event) => {
              if (event.data && event.data.type === 'PING') {
                if (typeof html2canvas !== 'undefined') {
                  window.parent.postMessage({ type: 'PONG' }, '*');
                }
                return;
              }
              if (event.data && event.data.type === 'CAPTURE_NOW') {
                if (busy) {
                  window.parent.postMessage({ type: 'CAPTURE_BUSY', reqId: event.data.reqId }, '*');
                  return;
                }
                if (typeof html2canvas === 'undefined') {
                  window.parent.postMessage({ type: 'CAPTURE_FAIL', reqId: event.data.reqId, error: 'html2canvas not loaded yet' }, '*');
                  return;
                }
                busy = true;
                try {
                  const bg = window.getComputedStyle(document.body).backgroundColor;
                  if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') {
                    document.body.style.backgroundColor = '#ffffff';
                  }
                  const scale = event.data.scale || 2;
                  // NOTE: allowTaint is intentionally OFF. allowTaint:true lets
                  // html2canvas draw cross-origin images without CORS, but doing
                  // so taints the canvas -- and a tainted canvas throws a
                  // SecurityError the moment you call toDataURL(). That was the
                  // root cause of "Gagal menangkap frame pertama": any external
                  // image/font without CORS headers silently killed every
                  // capture, including the very first frame.
                  const canvas = await html2canvas(document.body, {
                    useCORS: true,
                    allowTaint: false,
                    scale,
                    logging: false
                  });
                  window.parent.postMessage({
                    type: 'CAPTURE_SUCCESS',
                    reqId: event.data.reqId,
                    data: canvas.toDataURL('image/jpeg', 0.92)
                  }, '*');
                } catch (err) {
                  console.error('[AfterMotion capture error]', err);
                  window.parent.postMessage({ type: 'CAPTURE_FAIL', reqId: event.data.reqId, error: (err && err.message) || String(err) }, '*');
                } finally {
                  busy = false;
                }
              }
            });
          </script>
        `;

        const processedHtml = originalHtml.includes('</body>')
          ? originalHtml.replace('</body>', `${injectionScript}</body>`)
          : originalHtml + injectionScript;

        setFileContent(processedHtml);
        setRenderComplete(false);
        setVideoUrl(null);
        setRenderProgress(0);
        setCaptureFps(null);
        lastCaptureErrorRef.current = null;
        setStatusMessage('File siap dirender.');
      };
      reader.readAsText(file);
    }
  };

  const handleDurationChange = (e) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val)) setDuration(Math.max(10, Math.min(120, val)));
  };

  const requestFrame = (scale, timeoutMs) => {
    return new Promise((resolve) => {
      const reqId = Math.random().toString(36).slice(2);
      let settled = false;
      const handler = (e) => {
        if (!e.data || e.data.reqId !== reqId) return;
        if (e.data.type === 'CAPTURE_SUCCESS') {
          settled = true;
          window.removeEventListener('message', handler);
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = e.data.data;
        } else if (e.data.type === 'CAPTURE_FAIL') {
          console.error('Frame capture failed:', e.data.error);
          lastCaptureErrorRef.current = e.data.error || 'Unknown capture error';
          settled = true;
          window.removeEventListener('message', handler);
          resolve(null);
        } else if (e.data.type === 'CAPTURE_BUSY') {
          lastCaptureErrorRef.current = 'Capture bridge sedang sibuk (frame sebelumnya belum selesai)';
          settled = true;
          window.removeEventListener('message', handler);
          resolve(null);
        }
      };
      window.addEventListener('message', handler);
      previewIframeRef.current.contentWindow.postMessage({ type: 'CAPTURE_NOW', reqId, scale }, '*');
      setTimeout(() => {
        if (!settled) {
          lastCaptureErrorRef.current = 'Timeout menunggu balasan dari iframe (HTML mungkin terlalu berat atau tab tidak aktif)';
          window.removeEventListener('message', handler);
          resolve(null);
        }
      }, timeoutMs);
    });
  };

  const waitForBridge = () => new Promise((resolve, reject) => {
    let done = false;
    const handler = (e) => {
      if (e.data && (e.data.type === 'BRIDGE_READY' || e.data.type === 'PONG')) {
        done = true;
        window.removeEventListener('message', handler);
        resolve();
      }
    };
    window.addEventListener('message', handler);
    
    if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
      previewIframeRef.current.contentWindow.postMessage({ type: 'PING' }, '*');
    }
    
    const pingInterval = setInterval(() => {
      if (!done && previewIframeRef.current && previewIframeRef.current.contentWindow) {
        previewIframeRef.current.contentWindow.postMessage({ type: 'PING' }, '*');
      }
    }, 500);

    setTimeout(() => {
      clearInterval(pingInterval);
      if (!done) {
        window.removeEventListener('message', handler);
        reject(new Error('HTML tidak merespons. Pastikan file tidak memblokir script eksternal (CSP).'));
      }
    }, 8000);
  });

  const cancelRender = () => {
    cancelRef.current = true;
  };

  const startRender = async () => {
    if (!htmlFile || !fileContent) {
      setError('Harap unggah file HTML terlebih dahulu.');
      return;
    }
    if (!muxerLoaded.current || !window.WebMMuxer) {
      setError('Engine rendering masih memuat, coba lagi dalam beberapa detik.');
      return;
    }
    if (!('VideoEncoder' in window)) {
      setError('Browser Anda tidak mendukung VideoEncoder API. Gunakan Chrome, Edge, atau Brave versi terbaru di desktop.');
      return;
    }

    cancelRef.current = false;
    setIsRendering(true);
    setRenderProgress(0);
    setRenderComplete(false);
    setVideoUrl(null);
    setError(null);
    setCaptureFps(null);
    lastCaptureErrorRef.current = null;

    try {
      setStatusMessage('Menunggu bridge capture siap di dalam HTML...');
      await waitForBridge();

      const width = resolution === '4k' ? 3840 : 2560;
      const height = resolution === '4k' ? 1920 : 1280;

      const canvas = canvasRef.current;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const iframeEl = previewIframeRef.current;
      const iframeCssWidth = iframeEl.clientWidth || 1280;
      const captureScale = Math.min(3, Math.max(1, width / iframeCssWidth));

      setStatusMessage('Menyiapkan encoder video (VP9)...');

      const encoderConfig = {
        codec: 'vp09.00.10.08',
        width,
        height,
        bitrate: resolution === '4k' ? 24_000_000 : 12_000_000,
        framerate: fps,
        hardwareAcceleration: hwAccel ? 'prefer-hardware' : 'prefer-software',
        latencyMode: 'quality'
      };

      const support = await window.VideoEncoder.isConfigSupported(encoderConfig);
      if (!support.supported) {
        encoderConfig.hardwareAcceleration = 'prefer-software';
      }

      const muxer = new window.WebMMuxer.Muxer({
        target: new window.WebMMuxer.ArrayBufferTarget(),
        video: { codec: 'V_VP9', width, height, frameRate: fps }
      });

      let encodeError = null;
      const encoder = new window.VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => { encodeError = e; }
      });
      encoder.configure(encoderConfig);

      const totalFrames = Math.round(duration * fps);
      const frameDurationUs = 1_000_000 / fps;

      let lastFrameImg = null;
      let framesCapturedLive = 0;
      let framesHeld = 0;

      setStatusMessage('Merekam HTML secara live (real-time, sesuai animasi asli)...');

      const wallStart = performance.now();

      for (let i = 0; i < totalFrames; i++) {
        if (cancelRef.current) throw new Error('Render dibatalkan oleh pengguna.');
        if (encodeError) throw encodeError;

        const targetElapsedMs = (i / fps) * 1000;
        const now = performance.now() - wallStart;
        if (targetElapsedMs > now) {
          await new Promise((r) => setTimeout(r, targetElapsedMs - now));
        }

        const perFrameBudgetMs = Math.max(20, (1000 / fps) * 2);
        const img = await requestFrame(captureScale, perFrameBudgetMs);
        if (img) {
          lastFrameImg = img;
          framesCapturedLive++;
        } else {
          framesHeld++;
        }

        if (!lastFrameImg) {
          // Give the very first frame a few generous attempts before giving up --
          // html2canvas can be slow to warm up (fonts/layout) on its first run.
          let first = null;
          for (let attempt = 0; attempt < 3 && !first; attempt++) {
            first = await requestFrame(captureScale, 10000);
          }
          if (!first) {
            const reason = lastCaptureErrorRef.current
              ? ` Detail: ${lastCaptureErrorRef.current}`
              : '';
            throw new Error(`Gagal menangkap frame pertama dari HTML.${reason}`);
          }
          lastFrameImg = first;
          framesCapturedLive++;
        }

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, width, height);

        const imgAspect = lastFrameImg.width / lastFrameImg.height;
        const canvasAspect = width / height;
        let drawWidth, drawHeight, drawX, drawY;
        
        if (imgAspect > canvasAspect) {
          drawWidth = width;
          drawHeight = width / imgAspect;
          drawX = 0;
          drawY = (height - drawHeight) / 2;
        } else {
          drawHeight = height;
          drawWidth = height * imgAspect;
          drawX = (width - drawWidth) / 2;
          drawY = 0;
        }
        ctx.drawImage(lastFrameImg, drawX, drawY, drawWidth, drawHeight);

        const frame = new window.VideoFrame(canvas, { timestamp: i * frameDurationUs });
        encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
        frame.close();

        if (i % 5 === 0 || i === totalFrames - 1) {
          const percent = Math.min(99, Math.round((i / totalFrames) * 100));
          setRenderProgress(percent);
          setStatusMessage(`Merekam frame ${i + 1} / ${totalFrames}...`);
          const elapsedS = (performance.now() - wallStart) / 1000;
          const liveRate = framesCapturedLive / Math.max(elapsedS, 0.001);
          setCaptureFps(Math.round(liveRate * 10) / 10);
        }
      }

      setStatusMessage('Menyelesaikan encoding & muxing video...');
      await encoder.flush();
      if (encodeError) throw encodeError;
      muxer.finalize();

      const blob = new Blob([muxer.target.buffer], { type: 'video/webm' });
      const url = URL.createObjectURL(blob);

      setVideoUrl(url);
      setRenderComplete(true);
      setRenderProgress(100);
      const heldPct = Math.round((framesHeld / totalFrames) * 100);
      setStatusMessage(
        heldPct > 15
          ? `Selesai. ${heldPct}% frame memakai hold (HTML/resolusi berat untuk device ini) — turunkan FPS atau resolusi untuk hasil lebih presisi.`
          : 'Video berhasil dibuat — merekam langsung dari HTML asli.'
      );
    } catch (err) {
      console.error(err);
      setError(`Gagal melakukan render: ${err.message}`);
      setStatusMessage('');
    } finally {
      setIsRendering(false);
    }
  };

  const handleDownload = () => {
    if (videoUrl) {
      const a = document.createElement('a');
      a.href = videoUrl;
      a.download = `AfterMotion_${htmlFile?.name?.replace('.html', '') || 'output'}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-indigo-500/30">
      <canvas ref={canvasRef} className="hidden" />

      <nav className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-indigo-500 to-violet-700 p-2 rounded-lg shadow-[0_0_15px_rgba(79,70,229,0.4)]">
              <Video className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
              After Motion
            </span>
          </div>
          <div className="text-sm font-medium text-slate-400 flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-full border border-slate-700/50">
            <Cpu className="w-4 h-4 text-indigo-400" />
            <span>{hwAccel ? 'Hardware Accelerated' : 'Software Encoding'}</span>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 bg-red-950/40 border border-red-500/50 rounded-xl p-4 flex items-start gap-3 text-red-200 shadow-[0_0_20px_rgba(239,68,68,0.1)]">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-400" />
            <div className="flex flex-col">
              <span className="font-semibold text-red-300">Terjadi Kesalahan</span>
              <p className="text-sm mt-1">{error}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4 space-y-6">
            
            {}
            <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xl overflow-hidden group hover:border-slate-700 transition-colors">
              <div className="p-5 border-b border-slate-800 bg-slate-800/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileCode className="w-5 h-5 text-indigo-400" />
                  <h2 className="font-semibold text-lg">Input Source</h2>
                </div>
              </div>
              <div className="p-6">
                <label className="block w-full cursor-pointer">
                  <input
                    type="file"
                    accept=".html"
                    onChange={handleFileChange}
                    className="hidden"
                    disabled={isRendering}
                  />
                  <div className={`
                    border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center transition-all duration-300
                    ${htmlFile ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-slate-700 hover:border-indigo-500 hover:bg-slate-800/50'}
                    ${isRendering ? 'opacity-50 cursor-not-allowed' : ''}
                  `}>
                    {htmlFile ? (
                      <>
                        <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-3" />
                        <span className="font-medium text-emerald-200 truncate w-full px-4">{htmlFile.name}</span>
                        <span className="text-xs text-emerald-400/70 mt-1">Siap direkam live</span>
                      </>
                    ) : (
                      <>
                        <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-4 group-hover:bg-indigo-500/20 group-hover:text-indigo-400 transition-colors">
                          <Upload className="w-6 h-6" />
                        </div>
                        <span className="font-medium text-slate-300">Unggah File HTML</span>
                        <span className="text-sm text-slate-500 mt-1">Hanya menerima format .html</span>
                      </>
                    )}
                  </div>
                </label>
              </div>
            </div>

            {}
            <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xl overflow-hidden">
              <div className="p-5 border-b border-slate-800 bg-slate-800/30 flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-400" />
                <h2 className="font-semibold text-lg">Render Settings</h2>
              </div>
              <div className="p-6 space-y-6">
                <div className="space-y-3">
                  <label className="text-sm font-medium text-slate-300">Resolusi (18:9 Landscape)</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setResolution('2k')}
                      disabled={isRendering}
                      className={`py-2 px-4 rounded-lg font-medium transition-all ${
                        resolution === '2k'
                          ? 'bg-indigo-600 text-white shadow-[0_0_15px_rgba(79,70,229,0.3)] ring-2 ring-indigo-500 ring-offset-2 ring-offset-slate-900'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      } ${isRendering ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      2K
                      <div className="text-[10px] opacity-70 font-normal">2560 × 1280</div>
                    </button>
                    <button
                      onClick={() => setResolution('4k')}
                      disabled={isRendering}
                      className={`py-2 px-4 rounded-lg font-medium transition-all ${
                        resolution === '4k'
                          ? 'bg-indigo-600 text-white shadow-[0_0_15px_rgba(79,70,229,0.3)] ring-2 ring-indigo-500 ring-offset-2 ring-offset-slate-900'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      } ${isRendering ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      4K
                      <div className="text-[10px] opacity-70 font-normal">3840 × 1920</div>
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-medium text-slate-300">Framerate</label>
                  <div className="grid grid-cols-3 gap-3">
                    {[24, 30, 60].map((f) => (
                      <button
                        key={f}
                        onClick={() => setFps(f)}
                        disabled={isRendering}
                        className={`py-2 px-3 rounded-lg font-medium transition-all ${
                          fps === f
                            ? 'bg-indigo-600 text-white ring-2 ring-indigo-500 ring-offset-2 ring-offset-slate-900'
                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                        } ${isRendering ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {f} FPS
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    FPS lebih tinggi + 4K butuh capture lebih cepat. Turunkan FPS jika HTML berat.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium text-slate-300">Durasi (Detik)</label>
                    <span className="text-xs font-mono bg-slate-800 text-indigo-300 px-2 py-1 rounded-md border border-slate-700">
                      {duration}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="120"
                    value={duration}
                    onChange={handleDurationChange}
                    disabled={isRendering}
                    className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                  <div className="flex justify-between text-xs text-slate-500 font-mono">
                    <span>10</span>
                    <span>65</span>
                    <span>120</span>
                  </div>
                </div>

                {}
                <div className="flex items-center justify-between bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-400" />
                    <span className="text-sm font-medium text-slate-300">Hardware Acceleration</span>
                  </div>
                  <button
                    onClick={() => setHwAccel(!hwAccel)}
                    disabled={isRendering}
                    className={`w-11 h-6 rounded-full relative transition-colors ${hwAccel ? 'bg-indigo-600' : 'bg-slate-700'} ${isRendering ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${hwAccel ? 'translate-x-5' : ''}`} />
                  </button>
                </div>

                <div className="pt-2 space-y-3">
                  <button
                    onClick={startRender}
                    disabled={!htmlFile || isRendering}
                    className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all relative overflow-hidden
                      ${!htmlFile
                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        : isRendering
                          ? 'bg-indigo-900 text-indigo-300 cursor-wait'
                          : 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-500 hover:to-violet-500 hover:shadow-[0_0_30px_rgba(99,102,241,0.4)]'
                      }
                    `}
                  >
                    {isRendering ? (
                      <>
                        <div
                          className="absolute inset-y-0 left-0 bg-indigo-500/40 transition-all duration-200 ease-linear"
                          style={{ width: `${renderProgress}%` }}
                        />
                        <span className="relative z-10">Merekam... {renderProgress}%</span>
                      </>
                    ) : (
                      <span>Mulai Render</span>
                    )}
                  </button>
                  {isRendering && (
                    <button
                      onClick={cancelRender}
                      className="w-full py-2 rounded-lg text-sm font-medium text-slate-400 border border-slate-700 hover:bg-slate-800 transition-colors"
                    >
                      Batalkan
                    </button>
                  )}
                  {statusMessage && (
                    <p className="text-xs text-center text-slate-500">{statusMessage}</p>
                  )}
                  {isRendering && captureFps !== null && (
                    <p className="text-[11px] text-center text-slate-600 font-mono">
                      Live capture rate: ~{captureFps} fps (target {fps} fps)
                    </p>
                  )}
                </div>
              </div>
            </div>

            {}
            {renderComplete && videoUrl && (
              <div className="bg-slate-900 rounded-2xl border border-emerald-500/30 shadow-xl p-6 space-y-4">
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="font-semibold">Render Selesai</span>
                </div>
                <video src={videoUrl} controls className="w-full rounded-lg border border-slate-800" />
                <button
                  onClick={handleDownload}
                  className="w-full py-3 rounded-xl font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center gap-2 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Unduh Video (.webm)
                </button>
              </div>
            )}
          </div>

          {}
          <div className="lg:col-span-8">
            <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xl overflow-hidden h-full flex flex-col">
              <div className="p-5 border-b border-slate-800 bg-slate-800/30 flex items-center justify-between">
                <h2 className="font-semibold text-lg">Live Preview</h2>
                <span className="text-xs text-slate-500">Ini yang direkam apa adanya</span>
              </div>
              <div className="flex-1 p-4 bg-slate-950">
                {fileContent ? (
                  <iframe
                    ref={previewIframeRef}
                    srcDoc={fileContent}
                    title="preview"
                    sandbox="allow-scripts allow-same-origin"
                    className="w-full h-full min-h-[500px] rounded-lg border border-slate-800 bg-white"
                  />
                ) : (
                  <div className="w-full h-full min-h-[500px] rounded-lg border border-dashed border-slate-800 flex items-center justify-center text-slate-600">
                    Unggah file HTML untuk melihat preview
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
