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

export function dirs(): Dirs {
  if (cached) return cached;

  const root = path.join(app.getPath('appData'), '.bestclient');
  const assets = path.join(root, 'assets');
  const instance = path.join(root, 'instance');

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

/** Resolves a file bundled with the launcher itself (works both packed and unpacked). */
export function resourceFile(...segments: string[]): string {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'resources')
    : path.join(app.getAppPath(), 'resources');

  return path.join(base, ...segments);
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
