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
  /** Set once the removable bestpvp.hu entry has been offered. */
  seededSuggestedServer: boolean;
  /** Set once the PvP options.txt baseline has been written. */
  appliedPvpDefaults: boolean;
  closeOnLaunch: boolean;
  extraJvmArgs: string;
  account: MinecraftAccount | null;
}

const DEFAULTS: Settings = {
  memoryMb: 4096,
  enabledMods: [],
  knownMods: [],
  seededSuggestedServer: false,
  appliedPvpDefaults: false,
  closeOnLaunch: false,
  extraJvmArgs: '',
  account: null,
};

let cache: Settings | null = null;

export function readSettings(): Settings {
  if (cache) return cache;

  const file = dirs().settingsFile;

  try {
    cache = { ...DEFAULTS, ...parseJson<Partial<Settings>>(fs.readFileSync(file, 'utf8')) };
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
export function publicSettings(): Omit<Settings, 'account'> & {
  account: { uuid: string; username: string } | null;
} {
  const settings = readSettings();
  const { account, ...rest } = settings;

  return {
    ...rest,
    account: account ? { uuid: account.uuid, username: account.username } : null,
  };
}
