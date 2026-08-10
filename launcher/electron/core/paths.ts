import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

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
let profileFolder = 'fight';

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

export async function ensureDirs(): Promise<void> {
  await migrateSingleInstance();

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
}

/**
 * Moves a pre-profile installation into the Fight profile.
 *
 * Before profiles there was one game directory, `<root>/instance`. Leaving it behind would
 * read to the player as the launcher having lost their saves, screenshots and settings, so
 * it becomes the Fight instance - which is exactly what it was.
 */
async function migrateSingleInstance(): Promise<void> {
  const root = path.join(app.getPath('appData'), '.bestclient');
  const old = path.join(root, 'instance');
  const target = path.join(root, 'instances', 'fight');

  if (!(await exists(old)) || (await exists(target))) return;

  try {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.rename(old, target);
  } catch {
    // A locked file leaves the old folder in place; the profile simply starts empty
    // rather than the launcher refusing to run.
  }
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
