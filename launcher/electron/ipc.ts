import { app, BrowserWindow, ipcMain, shell } from 'electron';
import type { ChildProcess } from 'node:child_process';

import { currentAccount, loginWithDeviceCode, logout } from './core/auth';
import { BRAND, LOCKED_SERVER, TARGET } from './core/brand';
import { installClient } from './core/install';
import { launchGame } from './core/launch';
import { log } from './core/logger';
import { defaultEnabledSlugs, loadPack } from './core/modpack';
import { applyPvpDefaults } from './core/options';
import { dirs } from './core/paths';
import { readServerList } from './core/servers';
import { publicSettings, readSettings, writeSettings, type Settings } from './core/store';
import { CHANNELS, type AppInfo, type PublicSettings } from './shared';

let loginCancelled = false;
let gameProcess: ChildProcess | null = null;

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const send = (channel: string, payload: unknown): void => {
    getWindow()?.webContents.send(channel, payload);
  };

  ipcMain.handle(CHANNELS.appInfo, (): AppInfo => {
    return {
      version: app.getVersion(),
      brand: { name: BRAND.name, primary: BRAND.primary, secondary: BRAND.secondary },
      target: {
        minecraft: TARGET.minecraft,
        fabricLoader: TARGET.fabricLoader,
        javaMajor: TARGET.javaMajor,
      },
      lockedServer: { name: LOCKED_SERVER.name, address: LOCKED_SERVER.address },
    };
  });

  ipcMain.handle(CHANNELS.windowMinimize, () => {
    getWindow()?.minimize();
  });

  ipcMain.handle(CHANNELS.windowClose, () => {
    getWindow()?.close();
  });

  ipcMain.handle(CHANNELS.settingsGet, async () => {
    const settings = readSettings();

    // First run: start from the pack's recommended selection.
    if (settings.enabledMods.length === 0) {
      writeSettings({ enabledMods: await defaultEnabledSlugs() });
    }

    return publicSettings();
  });

  ipcMain.handle(CHANNELS.settingsSet, (_event, patch: Partial<PublicSettings>) => {
    const allowed: Partial<Settings> = {};

    if (typeof patch.memoryMb === 'number') {
      allowed.memoryMb = Math.min(16384, Math.max(1024, Math.round(patch.memoryMb)));
    }

    if (Array.isArray(patch.enabledMods)) {
      allowed.enabledMods = patch.enabledMods.filter((slug): slug is string => typeof slug === 'string');
    }

    if (typeof patch.closeOnLaunch === 'boolean') {
      allowed.closeOnLaunch = patch.closeOnLaunch;
    }

    if (typeof patch.extraJvmArgs === 'string') {
      allowed.extraJvmArgs = patch.extraJvmArgs.slice(0, 512);
    }

    writeSettings(allowed);
    return publicSettings();
  });

  ipcMain.handle(CHANNELS.packGet, () => loadPack());
  ipcMain.handle(CHANNELS.serversList, () => readServerList());

  ipcMain.handle(CHANNELS.authCurrent, async () => {
    const account = await currentAccount();
    return account ? { uuid: account.uuid, username: account.username } : null;
  });

  ipcMain.handle(CHANNELS.authLogin, async () => {
    loginCancelled = false;

    const account = await loginWithDeviceCode(
      (prompt) => send(CHANNELS.onDeviceCode, prompt),
      () => loginCancelled,
    );

    writeSettings({ account });
    log.info(`Signed in as ${account.username}`);

    return { uuid: account.uuid, username: account.username };
  });

  ipcMain.handle(CHANNELS.authCancel, () => {
    loginCancelled = true;
  });

  ipcMain.handle(CHANNELS.authLogout, () => {
    logout();
  });

  ipcMain.handle(CHANNELS.optionsReset, () => applyPvpDefaults(true));

  ipcMain.handle(CHANNELS.openInstanceFolder, async () => {
    await shell.openPath(dirs().instance);
  });

  ipcMain.handle(CHANNELS.openExternal, async (_event, url: string) => {
    // Only ever hand https links to the OS browser.
    if (!/^https:\/\//i.test(url)) {
      throw new Error(`Refusing to open a non-https URL: ${url}`);
    }

    await shell.openExternal(url);
  });

  ipcMain.handle(CHANNELS.play, async (_event, quickConnect: string | null) => {
    if (gameProcess && gameProcess.exitCode === null) {
      throw new Error('A játék már fut.');
    }

    const account = await currentAccount();

    if (!account) {
      throw new Error('Előbb jelentkezz be a Microsoft-fiókoddal.');
    }

    const install = await installClient((progress) => send(CHANNELS.onInstallProgress, progress));
    const settings = readSettings();

    const handle = await launchGame(
      install,
      account,
      {
        memoryMb: settings.memoryMb,
        extraJvmArgs: settings.extraJvmArgs,
        quickConnect,
      },
      (line) => send(CHANNELS.onGameLog, line),
      (code) => {
        gameProcess = null;
        send(CHANNELS.onGameExit, code);
        getWindow()?.show();
      },
    );

    gameProcess = handle.process;

    if (settings.closeOnLaunch) {
      getWindow()?.hide();
    }

    return { unavailableMods: install.unavailableMods };
  });
}
