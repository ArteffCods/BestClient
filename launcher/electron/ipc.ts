import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { ChildProcess } from 'node:child_process';

import { authConfigStatus, currentAccount, loginWithDeviceCode, logout, saveAuthClientId } from './core/auth';
import { BRAND, TARGET } from './core/brand';
import { gpuModel, resolveNvidiaOptimize } from './core/gpu';
import { installClient } from './core/install';
import { launchGame } from './core/launch';
import { log } from './core/logger';
import { clearCache, clearLogs } from './core/maintenance';
import { getChangelog } from './core/changelog';
import { deleteMod, listInventory, setModEnabled } from './core/inventory';
import {
  checkModUpdates,
  importModFiles,
  installFromModrinth,
  listInstalledMods,
  listModVersions,
  planModUpdates,
  removeInstalledMod,
  searchModsPage,
  verifyModsAreFromModrinth,
} from './core/market';
import { presenceIdle, presencePlaying, setDiscordEnabled, startDiscord } from './core/discord';
import { checkJvmFlags, detectForeignLauncher } from './core/hardening';
import { defaultJvmFlags, splitFlags } from './core/jvmFlags';
import { isProfileId, PROFILE_ORDER, PROFILES, profile } from './core/profiles';
import { loadPack, applyNvidiaOptimization, readManagedManifest, reconcileSelection, updateManagedToNewest } from './core/modpack';
import { getNews } from './core/news';
import { getPartnerServers } from './core/serverPing';
import { applyPvpDefaults } from './core/options';
import { dirs } from './core/paths';
import { ensureLockedServer, readServerList } from './core/servers';
import {
  CHECK_INTERVAL_MS,
  checkForUpdate,
  currentUpdateState,
  installUpdate,
  onUpdateState,
} from './core/updater';
import {
  listAccounts,
  publicSettings,
  readSettings,
  setActiveAccount,
  upsertAccount,
  writeSettings,
  type Settings,
} from './core/store';
import {
  CHANNELS,
  type AccountList,
  type AppInfo,
  type ProfileList,
  type PublicSettings,
  type UpdateAllResult,
} from './shared';

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

/** How long the launcher stays visible after a successful launch before stepping aside. */
const LAUNCH_LINGER_MS = 4000;

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const send = (channel: string, payload: unknown): void => {
    getWindow()?.webContents.send(channel, payload);
  };

  const restoreWindow = (): void => {
    const win = getWindow();
    if (!win) return;

    if (win.isMinimized()) win.restore();
    win.show();
  };

  ipcMain.handle(CHANNELS.appInfo, async (): Promise<AppInfo> => {
    return {
      version: app.getVersion(),
      brand: { name: BRAND.name, primary: BRAND.primary, secondary: BRAND.secondary },
      // The selected version, not a constant: the profile is the Minecraft version.
      target: {
        minecraft: readSettings().activeProfile,
        fabricLoader: TARGET.fabricLoader,
        javaMajor: profile(readSettings().activeProfile).javaMajor,
      },
      gpuModel: await gpuModel(),
      defaultJvmFlags: defaultJvmFlags(),
    };
  });

  ipcMain.handle(CHANNELS.windowMinimize, () => {
    getWindow()?.minimize();
  });

  ipcMain.handle(CHANNELS.windowClose, () => {
    getWindow()?.close();
  });

  ipcMain.handle(CHANNELS.settingsGet, async () => {
    // First-run resolution: the NVIDIA-optimization default follows the GPU (NVIDIA on,
    // AMD and Intel off), and this is the one moment everyone passes through on the way
    // to the settings panel, so it is always defined before the switch is drawn.
    await resolveNvidiaOptimize();

    const settings = readSettings();
    const pack = await loadPack();

    writeSettings(reconcileSelection(pack, settings.enabledMods, settings.knownMods));

    return publicSettings();
  });

  ipcMain.handle(CHANNELS.settingsSet, async (_event, patch: Partial<PublicSettings>) => {
    const allowed: Partial<Settings> = {};

    if (typeof patch.memoryMb === 'number') {
      allowed.memoryMb = Math.min(16384, Math.max(1024, Math.round(patch.memoryMb)));
    }

    if (Array.isArray(patch.enabledMods)) {
      allowed.enabledMods = patch.enabledMods.filter((slug): slug is string => typeof slug === 'string');
    }

    if (Array.isArray(patch.removedMods)) {
      allowed.removedMods = patch.removedMods.filter((slug): slug is string => typeof slug === 'string');
    }

    if (patch.pinnedVersions && typeof patch.pinnedVersions === 'object') {
      const pins: Record<string, string> = {};

      for (const [slug, version] of Object.entries(patch.pinnedVersions)) {
        if (typeof slug === 'string' && typeof version === 'string' && version) {
          pins[slug.slice(0, 128)] = version.slice(0, 64);
        }
      }

      allowed.pinnedVersions = pins;
    }

    if (patch.launchBehaviour === 'stay' || patch.launchBehaviour === 'minimise' || patch.launchBehaviour === 'hide') {
      allowed.launchBehaviour = patch.launchBehaviour;
    }

    let nvidiaChange: boolean | undefined;

    if (typeof patch.nvidiaOptimize === 'boolean') {
      allowed.nvidiaOptimize = patch.nvidiaOptimize;
      nvidiaChange = patch.nvidiaOptimize;
    }

    if (typeof patch.jvmFlags === 'string') {
      // Long enough for the full default set plus a player's own additions, short enough
      // that the field can never be used to stuff the settings file.
      const trimmed = patch.jvmFlags.slice(0, 4096);
      const { rejected } = checkJvmFlags(splitFlags(trimmed));

      // Refused here rather than silently dropped at launch, so the box says why. The
      // launch path filters again anyway - the settings file can be edited by hand.
      if (rejected.length > 0) {
        throw new Error(
          `${rejected.map((entry) => entry.flag).join(', ')} cannot be used: ` +
            `${rejected[0]!.why}. A flag that loads code into the game would let a cheat ` +
            'client in behind the mod check.',
        );
      }

      allowed.jvmFlags = trimmed;
    }

    if (typeof patch.discordRpc === 'boolean') {
      allowed.discordRpc = patch.discordRpc;
      // Presence connects or clears itself immediately - a switch that only took effect
      // on the next start would look broken.
      setDiscordEnabled(patch.discordRpc);

      if (patch.discordRpc) {
        presenceIdle();
      }
    }

    writeSettings(allowed);

    // The NVIDIA-optimization switch works on the mods folder right away, not on the
    // next launch: flipping it on downloads Nvidium now, flipping it off removes it.
    if (nvidiaChange !== undefined) {
      try {
        await applyNvidiaOptimization(nvidiaChange);
      } catch (error) {
        // The choice is already saved; the next launch installs Nvidium anyway, so a
        // failed download here only means the immediate apply is delayed.
        log.warn('Could not apply the NVIDIA-optimization switch right away.', error);
      }
    }

    return publicSettings();
  });

  ipcMain.handle(CHANNELS.packGet, () => loadPack());

  ipcMain.handle(CHANNELS.profilesGet, (): ProfileList => ({
    active: readSettings().activeProfile,
    profiles: PROFILE_ORDER.map((id) => ({ id, image: PROFILES[id].image })),
  }));

  ipcMain.handle(CHANNELS.profileSet, (_event, id: unknown): ProfileList['active'] => {
    if (gameProcess && gameProcess.exitCode === null) {
      throw new Error('Close the game before switching version.');
    }

    if (!isProfileId(id)) {
      throw new Error('Unknown version.');
    }

    // writeSettings repoints every game-directory path at the new version.
    writeSettings({ activeProfile: id });

    return id;
  });
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

    return {
      unavailableMods: install.unavailableMods,
      dependencies: install.dependencies,
      repairs: install.repairs,
      conflicts: install.conflicts,
    };
  });

  ipcMain.handle(CHANNELS.optionsReset, async () => applyPvpDefaults(await loadPack(), true));

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

  ipcMain.handle(CHANNELS.storeSearch, async (_event, query: string, page = 0, index = 'relevance') => {
    const pack = await loadPack();

    // Hide everything already in the pack - the store is for extra mods. The filter runs
    // inside the search so a page is still filled to its full size afterwards.
    return searchModsPage({
      query: String(query ?? ''),
      minecraft: pack.minecraft,
      loader: pack.loader,
      index: String(index ?? 'relevance'),
      page: Number(page) || 0,
      exclude: new Set(pack.mods.map((mod) => mod.slug)),
    });
  });

  ipcMain.handle(CHANNELS.storeInstall, async (_event, slug: string, versionId?: string) => {
    const pack = await loadPack();
    const result = await installFromModrinth(
      slug,
      pack.minecraft,
      pack.loader,
      typeof versionId === 'string' && versionId ? versionId : undefined,
    );
    return { slug, ...result };
  });

  ipcMain.handle(CHANNELS.storeVersions, async (_event, slug: string) => {
    const pack = await loadPack();
    return listModVersions(String(slug), pack.minecraft, pack.loader);
  });

  ipcMain.handle(CHANNELS.storeRemove, async (_event, slug: string) => {
    await removeInstalledMod(slug);
    return listInstalledMods();
  });

  ipcMain.handle(CHANNELS.storeInstalled, () => listInstalledMods());

  ipcMain.handle(CHANNELS.modsImport, async (_event, paths: string[]) => {
    if (!Array.isArray(paths) || paths.some((entry) => typeof entry !== 'string')) {
      throw new Error('Expected a list of file paths.');
    }

    return importModFiles(paths);
  });

  ipcMain.handle(CHANNELS.modsBrowse, async () => {
    // Native "browse" path alongside drag-and-drop: a standard Windows file picker.
    const win = getWindow();
    const options: Electron.OpenDialogOptions = {
      title: 'Add mods',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Fabric mods', extensions: ['jar'] }],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return { imported: [], skipped: [] };
    }

    return importModFiles(result.filePaths);
  });

  ipcMain.handle(CHANNELS.modsVerify, () => verifyModsAreFromModrinth());

  ipcMain.handle(CHANNELS.modsInventory, () => listInventory());

  ipcMain.handle(CHANNELS.modsSetEnabled, async (_event, id: string, next: boolean) => {
    await setModEnabled(String(id), Boolean(next));
    return listInventory();
  });

  ipcMain.handle(CHANNELS.modsDelete, async (_event, id: string) => {
    await deleteMod(String(id));
    return listInventory();
  });

  ipcMain.handle(CHANNELS.modsUpdates, async () => {
    const pack = await loadPack();
    const inventory = await listInventory();

    return checkModUpdates(
      pack.minecraft,
      pack.loader,
      inventory
        .filter((row) => row.slug && row.source !== 'client')
        .map((row) => row.slug!),
    );
  });

  ipcMain.handle(CHANNELS.modsUpdate, async (_event, slug: string) => {
    const project = String(slug);

    if (!project) {
      throw new Error('Expected a mod slug.');
    }

    // A pack mod updates through the managed manifest so the next install agrees with
    // the jar on disk; a store mod goes through the store's own installer. Either way
    // the newest build lands in the mods folder right now.
    const managed = await readManagedManifest();

    if (Object.values(managed).some((entry) => entry.slug === project)) {
      await updateManagedToNewest(project, await loadPack());
    } else {
      const pack = await loadPack();
      await installFromModrinth(project, pack.minecraft, pack.loader);
    }

    return listInventory();
  });

  /**
   * Moves every mod it safely can to its newest build, in one go.
   *
   * The plan is worked out first, against the builds that would actually be installed, so
   * a mod whose new build clashes with something else in the set stays where it is and is
   * named rather than quietly breaking the game.
   */
  ipcMain.handle(CHANNELS.modsUpdateAll, async (): Promise<UpdateAllResult> => {
    const pack = await loadPack();
    const inventory = await listInventory();

    const managed = await readManagedManifest();
    const managedSlugs = new Set(Object.values(managed).map((entry) => entry.slug));

    const rows = inventory.filter((row) => row.slug && row.source !== 'client');
    const current: Record<string, string> = {};

    for (const row of rows) {
      if (row.slug && row.version) current[row.slug] = row.version;
    }

    const plan = await planModUpdates(
      pack.minecraft,
      pack.loader,
      rows.map((row) => row.slug!),
      current,
    );

    const updated: string[] = [];
    const failed: { slug: string; reason: string }[] = [];

    // One at a time: these write into the same mods folder and the same manifest, and a
    // race there would leave the folder disagreeing with what the launcher thinks is in it.
    for (const entry of plan.updates) {
      try {
        if (managedSlugs.has(entry.slug)) {
          await updateManagedToNewest(entry.slug, pack);
        } else {
          await installFromModrinth(entry.slug, pack.minecraft, pack.loader);
        }

        updated.push(entry.slug);
      } catch (error) {
        failed.push({
          slug: entry.slug,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { updated, skipped: plan.skipped, failed, mods: await listInventory() };
  });

  ipcMain.handle(CHANNELS.newsGet, () => getNews());

  ipcMain.handle(CHANNELS.partnersGet, () => getPartnerServers());

  ipcMain.handle(CHANNELS.changelogGet, () => getChangelog());

  // Updates: the state is pushed as it changes, and also readable on demand so a reload
  // of the renderer never loses a download that is already finished.
  onUpdateState((next) => send(CHANNELS.onUpdateState, next));
  ipcMain.handle(CHANNELS.updateState, () => currentUpdateState());
  ipcMain.handle(CHANNELS.updateCheck, () => checkForUpdate());
  ipcMain.handle(CHANNELS.updateInstall, () => installUpdate());

  ipcMain.handle(CHANNELS.maintenanceClearCache, () => clearCache());
  ipcMain.handle(CHANNELS.maintenanceClearLogs, () => clearLogs());

  void checkForUpdate();
  setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS).unref();

  // Discord presence. Silently stays off when the player switched it off, when Discord
  // is not running, or when no application id was configured.
  startDiscord(readSettings().discordRpc);
  presenceIdle();

  ipcMain.handle(CHANNELS.play, async (_event, quickConnect: string | null) => {
    if (gameProcess && gameProcess.exitCode === null) {
      throw new Error('The game is already running.');
    }

    const account = await currentAccount();

    if (!account) {
      throw new Error('Sign in with your Microsoft account first.');
    }

    // Only Modrinth-published mods may launch: a jar the API does not know (dropped in
    // by hand) is a cheat risk and stops the client here, before anything is downloaded.
    // Known injectors are stopped with their own message, even when Modrinth would
    // vouch for the file.
    // A second launcher aimed at this game folder is how the mod check gets skipped
    // entirely: the launcher that runs the check is not the one starting the game. It
    // cannot be prevented from here, but it will not pass unnoticed.
    const foreign = await detectForeignLauncher();

    if (foreign.length > 0) {
      throw new Error(
        `Another launcher has been pointed at the game folder (${foreign.join(', ')}). ` +
          'Starting the game from it skips the mod check entirely. Delete those files, ' +
          'or point that launcher somewhere else, and try again.',
      );
    }

    const integrity = await verifyModsAreFromModrinth();

    if (integrity.flagged.length > 0) {
      throw new Error(
        `${integrity.flagged.join(', ')} ${integrity.flagged.length === 1 ? 'looks' : 'look'} like ` +
          'a hacked client or injector. Delete ' +
          `${integrity.flagged.length === 1 ? 'it' : 'them'} from the mods folder ` +
          'before launching.',
      );
    }

    if (integrity.unknown.length > 0) {
      throw new Error(
        `The game will not start: ${integrity.unknown.join(', ')} ${integrity.unknown.length === 1 ? 'is' : 'are'} ` +
          'not from Modrinth. Move them out of the mods folder or reinstall them from the store.',
      );
    }

    const install = await installClient((progress) => send(CHANNELS.onInstallProgress, progress));
    const settings = readSettings();

    const handle = await launchGame(
      install,
      account,
      {
        memoryMb: settings.memoryMb,
        jvmFlags: settings.jvmFlags,
        quickConnect,
      },
      (line) => send(CHANNELS.onGameLog, line),
      (code) => {
        gameProcess = null;
        presenceIdle();
        restoreWindow();
        send(CHANNELS.onGameExit, code);
      },
    );

    gameProcess = handle.process;
    presencePlaying(quickConnect ?? null);

    // Move the launcher out of the way so the game can own the cursor. A visible
    // Electron window under the fullscreen game keeps input focus, and Windows then
    // clamps the invisible mouse to that window's bounds - the player ends up locked
    // inside an invisible box.
    //
    // Not immediately, though: the progress bar has just reached 100% and vanishing at
    // that exact moment reads as a crash. The launcher stays up long enough to show that
    // it finished, then steps aside.
    const started = gameProcess;

    setTimeout(() => {
      // The player may have closed the game again inside the delay.
      if (gameProcess !== started) return;

      switch (readSettings().launchBehaviour) {
        case 'hide':
          getWindow()?.hide();
          break;
        case 'minimise':
          getWindow()?.minimize();
          break;
        default:
          // stay: the launcher keeps its window exactly as it is.
          break;
      }
    }, LAUNCH_LINGER_MS);

    return {
      unavailableMods: install.unavailableMods,
      dependencies: install.dependencies,
      repairs: install.repairs,
      conflicts: install.conflicts,
    };
  });

  ipcMain.handle(CHANNELS.stop, () => {
    // Closing the game from the launcher: kill the process. The 'exit' handler set up in
    // play() resets gameProcess and notifies the renderer, so nothing to clean up here.
    if (gameProcess && gameProcess.exitCode === null) {
      gameProcess.kill();
      log.info('Stopped the game at the user request.');
    }
  });
}
