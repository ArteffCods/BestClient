import { app, BrowserWindow, net as electronNet, protocol, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { BRAND } from './core/brand';
import { log } from './core/logger';
import { resourceFile } from './core/paths';
import { registerIpc } from './ipc';

const isDev = process.env.BESTCLIENT_DEV === '1';
const DEV_URL = 'http://127.0.0.1:4571';
const APP_ORIGIN = 'app://bestclient';

/** Root of the exported Next.js renderer. */
const rendererRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'out')
  : path.join(app.getAppPath(), 'out');

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

    return electronNet.fetch(pathToFileURL(resolved).toString());
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 940,
    minHeight: 620,
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
