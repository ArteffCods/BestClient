import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { log } from './logger';
import { downloadFile, fetchJson } from './net';
import { dirs, exists } from './paths';

/**
 * The resource packs and the shader the client ships with.
 *
 * They are pinned to exact Modrinth versions and fetched from there rather than bundled
 * in the installer. Three reasons, in order: the installer stays a hundred megabytes
 * instead of growing with every pack, the download is checked against a hash written here
 * so a swapped file is caught, and a shader like Complementary is redistributed by its
 * author on Modrinth rather than by us - linking to it is the arrangement its licence
 * expects.
 *
 * The version ids are fixed on purpose. A pack that updates itself under the player would
 * change how the game looks between launches, and a PvP pack is muscle memory.
 */

export interface ContentEntry {
  slug: string;
  name: string;
  /** Modrinth version id - pinned, never resolved to "newest". */
  versionId: string;
  fileName: string;
  sha1: string;
}

/**
 * Load order, lowest priority first - the same order Minecraft writes into options.txt,
 * where a later entry wins over an earlier one.
 */
export const RESOURCE_PACKS: ContentEntry[] = [
  {
    slug: 'classic-glint',
    name: 'Classic Glint',
    versionId: 'Xikh9SJk',
    fileName: 'Classic Glint.zip',
    sha1: '6e8d7dec967a26c7a43174a2d6dd8ad240fe6172',
  },
  {
    slug: 'low-fire-pack',
    name: 'Low Fire',
    versionId: 'RP4ozzMC',
    fileName: 'Low Fire.zip',
    sha1: '0f8e2e5f6eb9f1e2fe35da7a7a0a355760998021',
  },
  {
    slug: 'low-shield-pack',
    name: 'Low Shield',
    versionId: '4LeYKTYX',
    fileName: 'Low Shield.zip',
    sha1: '4b843b57dd0883fae0cdfece453ad359e1088d68',
  },
  {
    slug: 'short-swords-pack',
    name: 'Short Swords',
    versionId: 'gmCGV0CM',
    fileName: 'Short Swords.zip',
    sha1: 'cc2362ce3974d946c398660d5ea96ad891dc4da5',
  },
  {
    slug: 'teeny-totem-pop',
    name: 'Teeny Totem Pop',
    versionId: 'kIV3n698',
    fileName: 'Teeny Totem Pop.zip',
    sha1: '6e442f6bb2f5198ce7077c90bd4233bdb17e9b5c',
  },
];

export const SHADER: ContentEntry = {
  slug: 'complementary-reimagined',
  name: 'Complementary Reimagined',
  versionId: 'yCCduG44',
  fileName: 'ComplementaryReimagined_r5.8.1.zip',
  sha1: '5a021081f0178ed91dd911194071465ab0a4348b',
};

/** The value options.txt wants: a JSON array, vanilla first, then each pack by file. */
export function resourcePackList(): string {
  return JSON.stringify(['vanilla', ...RESOURCE_PACKS.map((pack) => `file/${pack.fileName}`)]);
}

interface ModrinthVersion {
  files?: { url: string; filename: string; primary?: boolean; hashes?: { sha1?: string } }[];
}

/**
 * Downloads anything that is missing or does not match its hash.
 *
 * A pack the player deleted on purpose comes back, which is the point: these are what the
 * client looks like. A pack they edited is replaced, because the hash no longer matches
 * and there is no way to tell an edit from a swap.
 */
export async function ensureContent(): Promise<void> {
  const instance = dirs().instance;

  await install(RESOURCE_PACKS, path.join(instance, 'resourcepacks'));
  await install([SHADER], path.join(instance, 'shaderpacks'));
}

async function install(entries: readonly ContentEntry[], folder: string): Promise<void> {
  await fs.promises.mkdir(folder, { recursive: true });

  for (const entry of entries) {
    const dest = path.join(folder, entry.fileName);

    // The hash is checked here rather than inside the download, so a pack that is already
    // correct costs one read and no network call at all - which is every launch after the
    // first one.
    if (await matches(dest, entry.sha1)) {
      continue;
    }

    try {
      const version = await fetchJson<ModrinthVersion>(
        `https://api.modrinth.com/v2/version/${entry.versionId}`,
      );

      const file = version.files?.find((candidate) => candidate.primary) ?? version.files?.[0];

      if (!file?.url) {
        log.warn(`Modrinth gave no file for ${entry.name}; skipping it.`);
        continue;
      }

      await downloadFile({ url: file.url, dest, sha1: entry.sha1 });
      log.info(`Installed ${entry.name}.`);
    } catch (error) {
      // A pack that will not download must never stop a launch - the game runs without it.
      log.warn(`Could not install ${entry.name}.`, error);
    }
  }
}

async function matches(file: string, sha1: string): Promise<boolean> {
  try {
    const hash = crypto.createHash('sha1');
    hash.update(await fs.promises.readFile(file));
    return hash.digest('hex') === sha1;
  } catch {
    return false;
  }
}

/**
 * Iris keeps the selected shader in `config/iris.properties`.
 *
 * `enableShaders` is deliberately left off: the shader is selected and ready, but a PvP
 * client that turns it on by itself would cost frames the player never asked to spend.
 * One line in the shader menu, or in this file, switches it on.
 */
export async function applyShaderDefaults(force: boolean): Promise<boolean> {
  const file = path.join(dirs().instance, 'config', 'iris.properties');
  await fs.promises.mkdir(path.dirname(file), { recursive: true });

  const existed = await exists(file);
  const current = new Map<string, string>();

  if (existed) {
    const raw = await fs.promises.readFile(file, 'utf8');

    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim() || line.startsWith('#')) continue;

      const separator = line.indexOf('=');
      if (separator === -1) continue;

      current.set(line.slice(0, separator), line.slice(separator + 1));
    }
  }

  const defaults: Record<string, string> = {
    shaderPack: SHADER.fileName,
    enableShaders: 'false',
    maxShadowRenderDistance: '32',
    colorSpace: 'SRGB',
  };

  let changed = !existed;

  for (const [key, value] of Object.entries(defaults)) {
    if (!force && current.has(key)) continue;
    if (current.get(key) === value) continue;

    current.set(key, value);
    changed = true;
  }

  if (changed) {
    const body = [...current.entries()].map(([key, value]) => `${key}=${value}`).join('\n');
    await fs.promises.writeFile(file, `${body}\n`, 'utf8');
    log.info(`iris.properties updated (shader: ${SHADER.fileName}).`);
  }

  return changed;
}
