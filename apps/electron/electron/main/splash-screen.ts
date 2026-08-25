import { BrowserWindow } from 'electron'

/**
 * Self-contained startup surface. It deliberately has useful initial state in
 * the HTML itself: main-process IPC cannot arrive until the preload and DOM are
 * ready, so a zero-width bar here created a second, avoidable waiting phase.
 */
export const SPLASH_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="color-scheme" content="dark">
  <title>Meeting Intelligence</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f1626;
      color: #e8eef8;
      height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      -webkit-app-region: drag;
      user-select: none;
    }
    .logo { font-size: 22px; font-weight: 600; margin-bottom: 24px; color: #fff; text-align: center; max-width: 300px; }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(255, 255, 255, 0.12);
      border-top-color: #4f9cff;
      border-radius: 50%;
      animation: spin 900ms linear infinite;
      margin-bottom: 20px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .progress-container {
      width: 220px;
      height: 4px;
      background: rgba(255, 255, 255, 0.12);
      border-radius: 2px;
      margin: 0 0 16px;
      overflow: hidden;
    }
    .progress-bar {
      height: 100%;
      background: #4f9cff;
      border-radius: 2px;
      transition: width 220ms cubic-bezier(0.22, 1, 0.36, 1);
      width: 6%;
    }
    .status { font-size: 13px; color: #aebbd0; text-align: center; max-width: 280px; min-height: 20px; }
    .cancel-btn {
      -webkit-app-region: no-drag;
      margin-top: 24px;
      padding: 8px 20px;
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #b7c3d6;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      transition: background-color 180ms ease, border-color 180ms ease, color 180ms ease;
    }
    .cancel-btn:hover { background: rgba(255, 255, 255, 0.06); border-color: rgba(255, 255, 255, 0.34); color: #fff; }
    .cancel-btn:focus-visible { outline: 2px solid #7db5ff; outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) {
      .spinner { animation: none; border-color: rgba(255, 255, 255, 0.2); border-top-color: #4f9cff; }
      .progress-bar, .cancel-btn { transition: none; }
    }
  </style>
</head>
<body>
  <div class="logo">Meeting Intelligence</div>
  <div class="spinner" aria-hidden="true"></div>
  <div class="progress-container" role="progressbar" aria-label="Application startup" aria-valuemin="0" aria-valuemax="100" aria-valuenow="6">
    <div class="progress-bar" id="progress"></div>
  </div>
  <div class="status" id="status" aria-live="polite">Starting application…</div>
  <button class="cancel-btn" id="cancelBtn">Cancel</button>
  <script>
    const statusEl = document.getElementById('status');
    const progressEl = document.getElementById('progress');
    const progressContainer = document.querySelector('.progress-container');
    const cancelBtn = document.getElementById('cancelBtn');
    window.electronAPI?.onSplashStatus?.((status, progress) => {
      statusEl.textContent = status;
      if (progress !== undefined) {
        const boundedProgress = Math.max(0, Math.min(100, progress));
        progressEl.style.width = boundedProgress + '%';
        progressContainer?.setAttribute('aria-valuenow', String(Math.round(boundedProgress)));
      }
    });
    cancelBtn.addEventListener('click', () => { window.electronAPI?.quitApp?.(); });
  </script>
</body>
</html>`

/**
 * Load and paint the splash while hidden, then reveal the completed first
 * frame. This trades an empty grey native window for a few milliseconds of no
 * window and guarantees that the progress rail is present on frame one.
 */
export async function createSplashWindow(preloadPath: string): Promise<BrowserWindow> {
  const startedAt = performance.now()
  const splash = new BrowserWindow({
    width: 340,
    height: 280,
    frame: false,
    transparent: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: '#0f1626',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  try {
    await splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(SPLASH_HTML))
    // loadURL resolves at load completion, which is earlier than a guaranteed
    // composed frame. Two animation frames ensure the HTML has actually painted
    // while hidden before the main process evaluates/initializes heavy modules.
    await splash.webContents.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
    )
  } catch (error) {
    // An inline data URL should not fail, but still reveal the brand-matched
    // native background so startup never remains invisibly stuck.
    console.error('[Splash] Failed to load splash content:', error)
  }

  if (!splash.isDestroyed()) splash.show()
  console.log(`[Splash] First rendered frame ready in ${Math.round(performance.now() - startedAt)}ms`)
  return splash
}
