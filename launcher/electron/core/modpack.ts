import fs from 'node:fs';
import path from 'node:path';

import { log } from './logger';
import { downloadFile, fetchJson, mapLimit, type ProgressFn, type VerifyMode } from './net';
import { dirs, exists, parseJson, resourceFile } from './paths';

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
  iconUrl?: string;
  note: string;
  /**
   * Pin this mod to an exact Modrinth version_number instead of taking the newest build.
   * Used to hold a mod on a specific stable release (e.g. Sodium one release back).
   */
  pinnedVersion?: string;
}

export interface Pack {
  minecraft: string;
  loader: string;
  loaderVersion: string;
  mods: PackMod[];
}

export interface ResolvedMod extends PackMod {
  projectId: string;
  versionNumber: string;
  fileName: string;
  url: string;
  sha1?: string;
  size?: number;
  /** True when the mod was pulled in to satisfy another mod's requirement. */
  viaDependency: boolean;
}

interface ModrinthFile {
  hashes: { sha1?: string };
  url: string;
  filename: string;
  primary: boolean;
  size: number;
}

interface ModrinthDependency {
  project_id: string | null;
  version_id: string | null;
  dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded';
}

interface ModrinthVersion {
  project_id: string;
  version_number: string;
  date_published: string;
  files: ModrinthFile[];
  dependencies: ModrinthDependency[];
}

interface ModrinthProject {
  slug: string;
  title: string;
  icon_url: string | null;
}

let packCache: Pack | null = null;

export async function loadPack(): Promise<Pack> {
  if (packCache) return packCache;

  const file = resourceFile('bestclient-pack.json');
  packCache = parseJson<Pack>(await fs.promises.readFile(file, 'utf8'));

  return packCache;
}

export interface Reconciled {
  enabledMods: string[];
  knownMods: string[];
}

/**
 * Folds the current pack into the stored selection.
 *
 * A mod the player has never been offered adopts its `defaultEnabled` recommendation, so
 * shipping a new pack actually reaches existing installs. A mod already in `knownMods`
 * keeps whatever the player chose. Slugs that left the pack are dropped.
 */
export function reconcileSelection(pack: Pack, enabled: readonly string[], known: readonly string[]): Reconciled {
  const enabledSet = new Set(enabled);
  const knownSet = new Set(known);

  for (const mod of pack.mods) {
    if (knownSet.has(mod.slug)) continue;

    if (mod.locked || mod.defaultEnabled) {
      enabledSet.add(mod.slug);
    }

    knownSet.add(mod.slug);
  }

  const inPack = new Set(pack.mods.map((mod) => mod.slug));

  return {
    enabledMods: [...enabledSet].filter((slug) => inPack.has(slug)),
    knownMods: [...knownSet].filter((slug) => inPack.has(slug)),
  };
}

export interface ResolveResult {
  mods: ResolvedMod[];
  /** Slugs that have no build for the target Minecraft version. */
  unavailable: string[];
  /** Names of the libraries pulled in automatically to satisfy requirements. */
  dependencies: string[];
}

const MAX_DEPENDENCY_DEPTH = 6;

function versionQuery(slugOrId: string, pack: Pack): string {
  return (
    `${MODRINTH}/project/${encodeURIComponent(slugOrId)}/version` +
    `?loaders=${encodeURIComponent(JSON.stringify([pack.loader]))}` +
    `&game_versions=${encodeURIComponent(JSON.stringify([pack.minecraft]))}`
  );
}

function primaryFile(version: ModrinthVersion): ModrinthFile | undefined {
  return version.files.find((candidate) => candidate.primary) ?? version.files[0];
}

/**
 * Asks Modrinth for the newest Fabric build of each enabled mod.
 *
 * The lookups run in parallel: this is ~18 independent round trips, and doing them one
 * after another added several seconds to every launch. Six lanes keeps the launcher well
 * inside Modrinth's 300 requests/minute budget.
 */
export async function resolveMods(pack: Pack, enabled: readonly string[]): Promise<ResolveResult> {
  const wanted = pack.mods.filter((mod) => mod.locked || enabled.includes(mod.slug));

  const settled = await mapLimit(wanted, 6, async (mod) => {
    try {
      const versions = await fetchJson<ModrinthVersion[]>(versionQuery(mod.slug, pack));

      // Honour an exact pin when set; otherwise take the newest build for the version.
      const version = mod.pinnedVersion
        ? versions.find((candidate) => candidate.version_number === mod.pinnedVersion) ?? versions[0]
        : versions[0];

      if (mod.pinnedVersion && version?.version_number !== mod.pinnedVersion) {
        log.warn(`Pinned version ${mod.pinnedVersion} of ${mod.slug} not found; used the newest instead.`);
      }

      const file = version ? primaryFile(version) : undefined;

      if (!version || !file) {
        log.warn(`No ${pack.minecraft} build published for ${mod.slug}.`);
        return null;
      }

      return { mod, version, file };
    } catch (error) {
      log.warn(`Could not resolve ${mod.slug} from Modrinth.`, error);
      return null;
    }
  });

  const mods: ResolvedMod[] = [];
  const unavailable: string[] = [];
  const dependencies: string[] = [];
  const seenProjects = new Set<string>();

  interface Pending {
    projectId: string | null;
    versionId: string | null;
    requiredBy: string;
  }

  let queue: Pending[] = [];

  const enqueueRequirements = (version: ModrinthVersion, requiredBy: string): void => {
    for (const dependency of version.dependencies ?? []) {
      // `optional` is a suggestion, `embedded` already ships inside the jar and
      // `incompatible` must never be installed. Only `required` blocks startup.
      if (dependency.dependency_type !== 'required') continue;
      queue.push({ projectId: dependency.project_id, versionId: dependency.version_id, requiredBy });
    }
  };

  settled.forEach((entry, index) => {
    if (!entry) {
      unavailable.push(wanted[index]!.slug);
      return;
    }

    seenProjects.add(entry.version.project_id);
    mods.push({
      ...entry.mod,
      projectId: entry.version.project_id,
      versionNumber: entry.version.version_number,
      fileName: entry.file.filename,
      url: entry.file.url,
      sha1: entry.file.hashes.sha1,
      size: entry.file.size,
      viaDependency: false,
    });

    enqueueRequirements(entry.version, entry.mod.name);
  });

  // Walk the requirement graph. Fabric refuses to start when a hard dependency is
  // missing, so a pack that only lists the mods the player chose is not installable.
  for (let depth = 0; depth < MAX_DEPENDENCY_DEPTH && queue.length > 0; depth++) {
    const batch = queue.filter(
      (entry) => entry.projectId === null || !seenProjects.has(entry.projectId),
    );
    queue = [];

    const resolved = await mapLimit(batch, 6, async (entry) => {
      try {
        const version = entry.versionId
          ? await fetchJson<ModrinthVersion>(`${MODRINTH}/version/${encodeURIComponent(entry.versionId)}`)
          : entry.projectId
            ? (await fetchJson<ModrinthVersion[]>(versionQuery(entry.projectId, pack)))[0]
            : undefined;

        if (!version) return null;

        const file = primaryFile(version);
        if (!file) return null;

        const project = await fetchJson<ModrinthProject>(
          `${MODRINTH}/project/${encodeURIComponent(version.project_id)}`,
        );

        return { entry, version, file, project };
      } catch (error) {
        log.warn(`Could not resolve a dependency of ${entry.requiredBy}.`, error);
        return null;
      }
    });

    for (const item of resolved) {
      if (!item) continue;
      if (seenProjects.has(item.version.project_id)) continue;

      seenProjects.add(item.version.project_id);
      dependencies.push(item.project.title);

      mods.push({
        slug: item.project.slug,
        name: item.project.title,
        category: 'library',
        locked: true,
        defaultEnabled: true,
        iconUrl: item.project.icon_url ?? undefined,
        note: `Installed automatically, required by ${item.entry.requiredBy}.`,
        projectId: item.version.project_id,
        versionNumber: item.version.version_number,
        fileName: item.file.filename,
        url: item.file.url,
        sha1: item.file.hashes.sha1,
        size: item.file.size,
        viaDependency: true,
      });

      enqueueRequirements(item.version, item.project.title);
    }
  }

  if (queue.length > 0) {
    log.warn(`Dependency graph deeper than ${MAX_DEPENDENCY_DEPTH} levels; stopped early.`);
  }

  return { mods, unavailable, dependencies };
}

/**
 * Makes `instance/mods` match {@code mods} exactly: downloads what is missing and deletes
 * the jars the launcher installed earlier but that are no longer selected. Jars the player
 * dropped in by hand are never touched.
 */
export async function syncMods(
  mods: readonly ResolvedMod[],
  onProgress?: ProgressFn,
  verify: VerifyMode = 'size',
): Promise<void> {
  const modsDir = dirs().mods;
  await fs.promises.mkdir(modsDir, { recursive: true });

  const manifestPath = path.join(modsDir, MANAGED_MANIFEST);
  const previous = await readManifest(manifestPath);
  const next: Record<string, string> = {};

  let done = 0;
  let bytes = 0;

  await mapLimit(mods, 6, async (mod) => {
    await downloadFile(
      {
        url: mod.url,
        dest: path.join(modsDir, mod.fileName),
        sha1: mod.sha1,
        size: mod.size,
        verify,
      },
      (delta) => {
        bytes += delta;
      },
    );

    // Keyed by project id rather than slug: dependency entries get their slug from a
    // separate lookup and two projects could in principle collide on it.
    next[mod.projectId] = mod.fileName;
    done++;
    onProgress?.({ done, total: mods.length, bytes, label: `Mod: ${mod.name}` });
  });

  const keep = new Set(Object.values(next));

  for (const [id, fileName] of Object.entries(previous)) {
    if (keep.has(fileName)) continue;

    const stale = path.join(modsDir, fileName);

    if (await exists(stale)) {
      await fs.promises.rm(stale, { force: true });
      log.info(`Removed stale managed mod ${id} (${fileName}).`);
    }
  }

  await fs.promises.writeFile(manifestPath, JSON.stringify(next, null, 2), 'utf8');
}

async function readManifest(file: string): Promise<Record<string, string>> {
  try {
    return parseJson<Record<string, string>>(await fs.promises.readFile(file, 'utf8'));
  } catch {
    return {};
  }
}
