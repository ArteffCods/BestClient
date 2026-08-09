import fs from 'node:fs';

import { log } from './logger';
import { dirs } from './paths';

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
  seededSuggestedServer: false,
  appliedPvpDefaults: false,
  closeOnLaunch: false,
  extraJvmArgs: '',
  account: null,
};

let cache: Settings | null = null;

export function readSettings(): Settings {
  if (cache) return cache;

  try {
    const raw = fs.readFileSync(dirs().settingsFile, 'utf8');
    cache = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    cache = { ...DEFAULTS };
  }

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
