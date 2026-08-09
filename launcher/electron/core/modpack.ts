import fs from 'node:fs';
import path from 'node:path';

import { log } from './logger';
import { downloadFile, fetchJson, type ProgressFn } from './net';
import { dirs, exists, resourceFile } from './paths';

const MODRINTH = 'https://api.modrinth.com/v2';
const MANAGED_MANIFEST = '.bestclient-managed.json';

export type ModCategory = 'core' | 'performance' | 'pvp' | 'library' | 'risky';

export interface PackMod {
  slug: string;
  name: string;
  category: ModCategory;
  /** Locked mods cannot be turned off - the client does not work without them. */
  locked: boolean;
  defaultEnabled: boolean;
  note: string;
}

export interface Pack {
  minecraft: string;
  loader: string;
  loaderVersion: string;
  mods: PackMod[];
}

export interface ResolvedMod extends PackMod {
  versionNumber: string;
  fileName: string;
  url: string;
  sha1?: string;
  size?: number;
}

interface ModrinthFile {
  hashes: { sha1?: string };
  url: string;
  filename: string;
  primary: boolean;
  size: number;
}

interface ModrinthVersion {
  version_number: string;
  date_published: string;
  files: ModrinthFile[];
}

let packCache: Pack | null = null;

export async function loadPack(): Promise<Pack> {
  if (packCache) return packCache;

  const file = resourceFile('bestclient-pack.json');
  packCache = JSON.parse(await fs.promises.readFile(file, 'utf8')) as Pack;

  return packCache;
}

/** {@returns the slugs enabled by default, including every locked mod} */
export async function defaultEnabledSlugs(): Promise<string[]> {
  const pack = await loadPack();
  return pack.mods.filter((mod) => mod.locked || mod.defaultEnabled).map((mod) => mod.slug);
}

export interface ResolveResult {
  mods: ResolvedMod[];
  /** Slugs that have no build for the target Minecraft version. */
  unavailable: string[];
}

/** Asks Modrinth for the newest Fabric build of each enabled mod. */
export async function resolveMods(pack: Pack, enabled: readonly string[]): Promise<ResolveResult> {
  const wanted = pack.mods.filter((mod) => mod.locked || enabled.includes(mod.slug));
  const mods: ResolvedMod[] = [];
  const unavailable: string[] = [];

  for (const mod of wanted) {
    const query =
      `${MODRINTH}/project/${encodeURIComponent(mod.slug)}/version` +
      `?loaders=${encodeURIComponent(JSON.stringify([pack.loader]))}` +
      `&game_versions=${encodeURIComponent(JSON.stringify([pack.minecraft]))}`;

    try {
      const versions = await fetchJson<ModrinthVersion[]>(query);
      const version = versions[0];
      const file = version?.files.find((candidate) => candidate.primary) ?? version?.files[0];

      if (!version || !file) {
        unavailable.push(mod.slug);
        log.warn(`No ${pack.minecraft} build published for ${mod.slug}.`);
        continue;
      }

      mods.push({
        ...mod,
        versionNumber: version.version_number,
        fileName: file.filename,
        url: file.url,
        sha1: file.hashes.sha1,
        size: file.size,
      });
    } catch (error) {
      unavailable.push(mod.slug);
      log.warn(`Could not resolve ${mod.slug} from Modrinth.`, error);
    }
  }

  return { mods, unavailable };
}

/**
 * Makes `instance/mods` match {@code mods} exactly: downloads what is missing and deletes
 * the jars the launcher installed earlier but that are no longer selected. Jars the player
 * dropped in by hand are never touched.
 */
export async function syncMods(mods: readonly ResolvedMod[], onProgress?: ProgressFn): Promise<void> {
  const modsDir = dirs().mods;
  await fs.promises.mkdir(modsDir, { recursive: true });

  const manifestPath = path.join(modsDir, MANAGED_MANIFEST);
  const previous = await readManifest(manifestPath);
  const next: Record<string, string> = {};

  let done = 0;
  let bytes = 0;

  for (const mod of mods) {
    onProgress?.({ done, total: mods.length, bytes, label: `Mod: ${mod.name}` });

    await downloadFile(
      {
        url: mod.url,
        dest: path.join(modsDir, mod.fileName),
        sha1: mod.sha1,
        size: mod.size,
      },
      (delta) => {
        bytes += delta;
      },
    );

    next[mod.slug] = mod.fileName;
    done++;
    onProgress?.({ done, total: mods.length, bytes, label: `Mod: ${mod.name}` });
  }

  const keep = new Set(Object.values(next));

  for (const [slug, fileName] of Object.entries(previous)) {
    if (keep.has(fileName)) continue;

    const stale = path.join(modsDir, fileName);

    if (await exists(stale)) {
      await fs.promises.rm(stale, { force: true });
      log.info(`Removed stale managed mod ${slug} (${fileName}).`);
    }
  }

  await fs.promises.writeFile(manifestPath, JSON.stringify(next, null, 2), 'utf8');
}

async function readManifest(file: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}
