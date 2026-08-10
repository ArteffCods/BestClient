import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import { PROFILES } from './profiles';

export interface Dirs {
  root: string;
  versions: string;
  libraries: string;
  assets: string;
  assetIndexes: string;
  assetObjects: string;
  natives: string;
  /** The game directory: mods, config, options.txt, servers.dat, saves, screenshots. */
  instance: string;
  mods: string;
  java: string;
  logs: string;
  /** Launcher settings + the cached Minecraft session. */
  settingsFile: string;
}

let cached: Dirs | null = null;

/**
 * Which profile's game directory `dirs()` points at.
 *
 * It is a plain module variable rather than a read of the settings file, because the
 * settings store itself needs `dirs()` to find that file - asking it here would be a
 * circle. Whoever loads or changes the settings sets this instead.
 */
let profileFolder = '1.21.11';

export function setProfileFolder(folder: string): void {
  if (folder === profileFolder) return;

  profileFolder = folder;
  // The instance and mods paths just changed; everything else is shared.
  cached = null;
}

export function dirs(): Dirs {
  if (cached) return cached;

  const root = path.join(app.getPath('appData'), '.bestclient');
  const assets = path.join(root, 'assets');
  const instance = path.join(root, 'instances', profileFolder);

  cached = {
    root,
    versions: path.join(root, 'versions'),
    libraries: path.join(root, 'libraries'),
    assets,
    assetIndexes: path.join(assets, 'indexes'),
    assetObjects: path.join(assets, 'objects'),
    natives: path.join(root, 'natives'),
    instance,
    mods: path.join(instance, 'mods'),
    java: path.join(root, 'java'),
    logs: path.join(root, 'logs'),
    settingsFile: path.join(root, 'launcher.json'),
  };

  return cached;
}

/** Returns the game directories it cleared out, for the caller to log. */
export async function ensureDirs(): Promise<string[]> {
  await migrateSingleInstance();
  const pruned = await pruneOrphanInstances();

  const d = dirs();
  const targets = [
    d.root,
    d.versions,
    d.libraries,
    d.assetIndexes,
    d.assetObjects,
    d.natives,
    d.instance,
    d.mods,
    d.java,
    d.logs,
  ];

  await Promise.all(targets.map((dir) => fs.promises.mkdir(dir, { recursive: true })));

  return pruned;
}

/**
 * Moves an older installation into the 1.21.11 profile.
 *
 * Two shapes came before this one: a single `<root>/instance` from the version with no
 * profiles at all, and `<root>/instances/fight` from the short-lived Fight/Survival split.
 * Both were a 1.21.11 game directory, so both become the 1.21.11 profile. Leaving either
 * behind would read to the player as the launcher having lost their worlds.
 */
async function migrateSingleInstance(): Promise<void> {
  const root = path.join(app.getPath('appData'), '.bestclient');
  const target = path.join(root, 'instances', '1.21.11');

  if (await exists(target)) return;

  for (const old of [path.join(root, 'instances', 'fight'), path.join(root, 'instance')]) {
    if (!(await exists(old))) continue;

    try {
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.rename(old, target);
      return;
    } catch {
      // A locked file leaves the old folder in place; the profile simply starts empty
      // rather than the launcher refusing to run.
    }
  }
}

/** Everything in a game directory the launcher can simply download again. */
const REPLACEABLE = [
  'mods',
  'resourcepacks',
  'shaderpacks',
  'config',
  'defaultconfigs',
  'logs',
  'crash-reports',
  '.mixin.out',
  '.bestclient-managed.json',
  'options.txt',
  'servers.dat',
];

/** If any of these still holds something, the folder is the player's, not ours. */
const IRREPLACEABLE = ['saves', 'screenshots', 'resourcepacks-custom'];

/**
 * Clears out game directories that no longer belong to any version.
 *
 * A short-lived release shipped Fight and Survival profiles; anyone who opened Survival
 * has a couple of gigabytes sitting in a folder nothing will ever launch again. Leaving
 * that behind is the launcher quietly costing disk space forever, so it is cleaned up on
 * every start.
 *
 * What is removed is only ever what can be downloaded again - mods, packs, config. Worlds
 * and screenshots are never touched, and a folder that still has any are left alone: a
 * world saved on 26.1.2 cannot be opened on 1.21.11, so moving it somewhere would be worse
 * than useless, and deleting it is not the launcher's call to make.
 */
async function pruneOrphanInstances(): Promise<string[]> {
  const instances = path.join(app.getPath('appData'), '.bestclient', 'instances');
  const known = new Set(Object.keys(PROFILES));
  const cleared: string[] = [];

  let entries: fs.Dirent[];

  try {
    entries = await fs.promises.readdir(instances, { withFileTypes: true });
  } catch {
    return cleared;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || known.has(entry.name)) continue;

    const folder = path.join(instances, entry.name);

    for (const name of REPLACEABLE) {
      await fs.promises.rm(path.join(folder, name), { recursive: true, force: true }).catch(() => {
        // A file in use is left where it is and picked up on the next start.
      });
    }

    if (await hasPlayerContent(folder)) {
      cleared.push(`${entry.name} (worlds kept)`);
      continue;
    }

    await fs.promises.rm(folder, { recursive: true, force: true }).catch(() => {});
    cleared.push(entry.name);
  }

  return cleared;
}

async function hasPlayerContent(folder: string): Promise<boolean> {
  for (const name of IRREPLACEABLE) {
    try {
      if ((await fs.promises.readdir(path.join(folder, name))).length > 0) return true;
    } catch {
      // Absent, which is the normal case.
    }
  }

  return false;
}

/** Resolves a file bundled with the launcher itself (works both packed and unpacked). */
export function resourceFile(...segments: string[]): string {
  return path.join(app.getAppPath(), 'resources', ...segments);
}

/** Resolves a resource file next to the installed app, useful for local secrets. */
export function externalResourceFile(...segments: string[]): string {
  return path.join(process.resourcesPath, 'resources', ...segments);
}

/**
 * JSON.parse that tolerates a UTF-8 byte order mark.
 *
 * Notepad and PowerShell's `Set-Content -Encoding utf8` both prepend a BOM, and
 * `JSON.parse` rejects the resulting string. Every JSON file the launcher reads can be
 * hand-edited, so none of them may blow up over an invisible leading character.
 */
export function parseJson<T>(raw: string): T {
  return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw) as T;
}

export async function exists(target: string): Promise<boolean> {
  try {
    await fs.promises.access(target);
    return true;
  } catch {
    return false;
  }
}
