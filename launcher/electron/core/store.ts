import fs from 'node:fs';

import { log } from './logger';
import { dirs, parseJson } from './paths';

export interface MinecraftAccount {
  /** Minecraft profile UUID without dashes, as the game expects it. */
  uuid: string;
  username: string;
  accessToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  /** Microsoft refresh token, used to renew the session without a new device-code login. */
  refreshToken: string;
}

export interface Settings {
  /** Megabytes handed to the JVM via -Xmx. */
  memoryMb: number;
  /** Slugs of the optional mods the player turned on. */
  enabledMods: string[];
  /**
   * Every slug the player has already been offered. Anything in the pack but not here is
   * new since the last run, so its `defaultEnabled` recommendation gets applied — that is
   * how an updated pack can add a mod without silently skipping existing installs, while
   * still respecting a mod the player deliberately switched off.
   */
  knownMods: string[];
  /** Set once the PvP options.txt baseline has been written. */
  appliedPvpDefaults: boolean;
  closeOnLaunch: boolean;
  extraJvmArgs: string;
  /** Every signed-in account, in the order they were added. Tokens live here. */
  accounts: MinecraftAccount[];
  /** UUID of the account launches and the profile use; null when none is signed in. */
  activeUuid: string | null;
}

const DEFAULTS: Settings = {
  memoryMb: 4096,
  enabledMods: [],
  knownMods: [],
  appliedPvpDefaults: false,
  closeOnLaunch: false,
  extraJvmArgs: '',
  accounts: [],
  activeUuid: null,
};

/** The pre-multi-account shape, kept only so old launcher.json files still migrate. */
interface LegacySettings extends Partial<Settings> {
  account?: MinecraftAccount | null;
}

let cache: Settings | null = null;

export function readSettings(): Settings {
  if (cache) return cache;

  const file = dirs().settingsFile;

  try {
    const parsed = parseJson<LegacySettings>(fs.readFileSync(file, 'utf8'));
    cache = migrate({ ...DEFAULTS, ...parsed }, parsed);
    return cache;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Falling back to defaults silently would look like the launcher lost the
      // player's account and mod selection. Keep the file so it can be recovered.
      const backup = `${file}.invalid-${Date.now()}`;

      try {
        fs.renameSync(file, backup);
        log.warn(`launcher.json was unreadable, kept a copy at ${backup}.`, error);
      } catch {
        log.error('launcher.json is unreadable and could not be backed up.', error);
      }
    }
  }

  cache = { ...DEFAULTS };
  return cache;
}

/** Folds a single legacy `account` into the accounts list on first load. */
function migrate(settings: Settings, legacy: LegacySettings): Settings {
  if (legacy.account && settings.accounts.length === 0) {
    settings.accounts = [legacy.account];
    settings.activeUuid = legacy.account.uuid;
  }

  // Guard against an activeUuid that points at an account that is no longer present.
  if (!settings.accounts.some((account) => account.uuid === settings.activeUuid)) {
    settings.activeUuid = settings.accounts[0]?.uuid ?? null;
  }

  return settings;
}

export function listAccounts(): MinecraftAccount[] {
  return readSettings().accounts;
}

export function activeAccount(): MinecraftAccount | null {
  const settings = readSettings();
  return settings.accounts.find((account) => account.uuid === settings.activeUuid) ?? null;
}

/** Adds a freshly signed-in account (or refreshes its identity) and makes it active. */
export function upsertAccount(account: MinecraftAccount): void {
  const others = readSettings().accounts.filter((existing) => existing.uuid !== account.uuid);
  writeSettings({ accounts: [...others, account], activeUuid: account.uuid });
}

/** Replaces an account's tokens in place without changing which one is active. */
export function updateAccountTokens(account: MinecraftAccount): void {
  const accounts = readSettings().accounts.map((existing) =>
    existing.uuid === account.uuid ? account : existing,
  );
  writeSettings({ accounts });
}

export function removeAccount(uuid: string): void {
  const settings = readSettings();
  const accounts = settings.accounts.filter((account) => account.uuid !== uuid);
  const activeUuid = settings.activeUuid === uuid ? (accounts[0]?.uuid ?? null) : settings.activeUuid;

  writeSettings({ accounts, activeUuid });
}

export function setActiveAccount(uuid: string): MinecraftAccount | null {
  const found = readSettings().accounts.find((account) => account.uuid === uuid);
  if (found) writeSettings({ activeUuid: uuid });

  return found ?? null;
}

export function writeSettings(patch: Partial<Settings>): Settings {
  const next = { ...readSettings(), ...patch };
  cache = next;

  try {
    fs.mkdirSync(dirs().root, { recursive: true });
    fs.writeFileSync(dirs().settingsFile, JSON.stringify(next, null, 2), 'utf8');
  } catch (error) {
    log.error('Could not persist launcher settings.', error);
  }

  return next;
}

/** Everything the renderer is allowed to see - never the tokens. */
export function publicSettings(): Omit<Settings, 'accounts' | 'activeUuid'> & {
  account: { uuid: string; username: string } | null;
} {
  const { accounts: _accounts, activeUuid: _activeUuid, ...rest } = readSettings();
  const active = activeAccount();

  return {
    ...rest,
    account: active ? { uuid: active.uuid, username: active.username } : null,
  };
}
