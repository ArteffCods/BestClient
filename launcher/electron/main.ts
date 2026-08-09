import { app, BrowserWindow, net as electronNet, protocol, shell } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { BRAND } from './core/brand';
import { log } from './core/logger';
import { resourceFile } from './core/paths';
import { registerIpc } from './ipc';

const isDev = process.env.BESTCLIENT_DEV === '1';
const DEV_URL = 'http://127.0.0.1:4571';
const APP_ORIGIN = 'app://bestclient';

// Prefer the discrete GPU and skip first-run overhead so the window paints sooner.
app.commandLine.appendSwitch('force-high-performance-gpu');
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');

// Give the launcher itself above-normal priority so it opens snappily under load. The
// game later takes high priority; the launcher stays a notch below it.
try {
  os.setPriority(process.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL);
} catch {
  // Non-fatal: priority is a best-effort hint.
}

/** Root of the exported Next.js renderer. */
const rendererRoot = path.join(app.getAppPath(), 'out');

let mainWindow: BrowserWindow | null = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

// A second instance should just focus the window we already have.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(bootstrap).catch((error) => {
    log.error('Startup failed.', error);
    app.quit();
  });
}

async function bootstrap(): Promise<void> {
  if (!isDev) {
    registerAppProtocol();
  }

  registerIpc(() => mainWindow);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

/**
 * Content Security Policy for the packaged renderer.
 *
 * The Play screen embeds artwork and HTML snippets that come from a remote feed, so the
 * window is locked down at the browser level as well as at the sanitizer: no remote
 * scripts, no frames, no plugins, no form posts, and no base-tag rewriting. Images may
 * come from https (mod icons, news art) and data: (server favicons); `unsafe-inline` is
 * unavoidable for a static Next export and for React's inline styles.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function registerAppProtocol(): void {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    let relative = decodeURIComponent(url.pathname);

    // `output: 'export'` with trailingSlash writes every route as <route>/index.html.
    if (relative.endsWith('/')) {
      relative += 'index.html';
    } else if (!path.extname(relative)) {
      relative += '/index.html';
    }

    const target = path.join(rendererRoot, relative);
    const resolved = path.resolve(target);

    // Never serve anything outside the exported renderer.
    if (!resolved.startsWith(path.resolve(rendererRoot))) {
      return new Response('Forbidden', { status: 403 });
    }

    const response = await electronNet.fetch(pathToFileURL(resolved).toString());
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    headers.set('X-Content-Type-Options', 'nosniff');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    // Low enough that the responsive breakpoints are actually reachable: below 1040px
    // the changelog rail folds away and the layout keeps working.
    minWidth: 820,
    minHeight: 560,
    show: false,
    frame: false,
    backgroundColor: '#0d0910',
    title: BRAND.name,
    // Taskbar and Alt+Tab icon while running unpackaged. The packaged build takes its
    // icon from the executable, which electron-builder stamps from the same file.
    icon: resourceFile('icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Anything that tries to open a new window goes to the system browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? DEV_URL : APP_ORIGIN;

    if (!url.startsWith(allowed)) {
      event.preventDefault();
      if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

  void mainWindow.loadURL(isDev ? DEV_URL : `${APP_ORIGIN}/`);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
