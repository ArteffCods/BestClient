import { app, BrowserWindow, ipcMain, shell } from 'electron';
import type { ChildProcess } from 'node:child_process';
import os from 'node:os';

import { authConfigStatus, currentAccount, loginWithDeviceCode, logout, saveAuthClientId } from './core/auth';
import { BRAND, LOCKED_SERVER, TARGET } from './core/brand';
import { installClient } from './core/install';
import { launchGame } from './core/launch';
import { log } from './core/logger';
import { loadPack, reconcileSelection } from './core/modpack';
import { applyPvpDefaults } from './core/options';
import { dirs } from './core/paths';
import { ensureLockedServer, readServerList } from './core/servers';
import {
  listAccounts,
  publicSettings,
  readSettings,
  setActiveAccount,
  upsertAccount,
  writeSettings,
  type Settings,
} from './core/store';
import { CHANNELS, type AccountList, type AppInfo, type PublicSettings } from './shared';

const toPublic = (account: { uuid: string; username: string }) => ({
  uuid: account.uuid,
  username: account.username,
});

function accountList(): AccountList {
  return {
    accounts: listAccounts().map(toPublic),
    activeUuid: readSettings().activeUuid,
  };
}

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
      cpuCount: os.cpus().length,
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
    const pack = await loadPack();

    writeSettings(reconcileSelection(pack, settings.enabledMods, settings.knownMods));

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
  ipcMain.handle(CHANNELS.serversList, async () => {
    // Normalize the list on read too, so a delisted server (bestpvp.hu) disappears as
    // soon as the launcher opens, not only after the next Play.
    await ensureLockedServer();
    return readServerList();
  });

  ipcMain.handle(CHANNELS.authCurrent, async () => {
    const account = await currentAccount();
    return account ? toPublic(account) : null;
  });

  ipcMain.handle(CHANNELS.authList, (): AccountList => accountList());

  ipcMain.handle(CHANNELS.authSelect, async (_event, uuid: string) => {
    setActiveAccount(uuid);
    // Refresh on switch so the chosen account is launch-ready right away.
    const account = await currentAccount();
    return account ? toPublic(account) : null;
  });

  ipcMain.handle(CHANNELS.authConfigGet, () => authConfigStatus());

  ipcMain.handle(CHANNELS.authConfigSet, async (_event, clientId: string) => {
    return saveAuthClientId(clientId);
  });

  ipcMain.handle(CHANNELS.authLogin, async () => {
    loginCancelled = false;

    const account = await loginWithDeviceCode(
      (prompt) => send(CHANNELS.onDeviceCode, prompt),
      () => loginCancelled,
    );

    upsertAccount(account);
    log.info(`Signed in as ${account.username}`);

    return toPublic(account);
  });

  ipcMain.handle(CHANNELS.authCancel, () => {
    loginCancelled = true;
  });

  ipcMain.handle(CHANNELS.authLogout, (_event, uuid?: string) => {
    logout(uuid);
    return accountList();
  });

  ipcMain.handle(CHANNELS.repair, async () => {
    const install = await installClient(
      (progress) => send(CHANNELS.onInstallProgress, progress),
      { repair: true },
    );

    return { unavailableMods: install.unavailableMods, dependencies: install.dependencies };
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
      throw new Error('The game is already running.');
    }

    const account = await currentAccount();

    if (!account) {
      throw new Error('Sign in with your Microsoft account first.');
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

    return { unavailableMods: install.unavailableMods, dependencies: install.dependencies };
  });
}
