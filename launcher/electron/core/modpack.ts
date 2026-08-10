import fs from 'node:fs';
import path from 'node:path';

import { log } from './logger';
import { downloadFile, fetchJson, mapLimit, type ProgressFn, type VerifyMode } from './net';
import { dirs, exists, parseJson, resourceFile } from './paths';
import { profile } from './profiles';
import { readSettings } from './store';

const MODRINTH = 'https://api.modrinth.com/v2';
/** Maps Modrinth project id -> the jar the launcher installed for it. */
export const MANAGED_MANIFEST = '.bestclient-managed.json';

/**
 * The mod behind the Settings' "NVIDIA optimization" switch. It only joins the pack
 * while the switch is on - the installer adds it to the enabled set, and when it is off
 * it drops out again. It is hidden from the Mods list because the switch is the only
 * way to control it. (Reflex had no 1.21.11 build, so Nvidium is the whole switch.)
 */
export const NVIDIA_MODS = ['nvidium'] as const;

/** What the launcher remembers about each jar it installed itself. */
export interface ManagedEntry {
  fileName: string;
  slug: string;
  version: string;
}

/** The jars the launcher manages, so anything else in the folder is a player's own file. */
export async function readManagedManifest(): Promise<Record<string, ManagedEntry>> {
  return readManifest(path.join(dirs().mods, MANAGED_MANIFEST));
}

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

/**
 * A resource pack or shader the profile ships with, pinned to an exact Modrinth version.
 *
 * Pinned rather than resolved to newest on purpose: a pack that changed itself between
 * launches would change how the game looks, and for a PvP pack that is muscle memory.
 */
export interface PackContent {
  slug: string;
  name: string;
  versionId: string;
  fileName: string;
  sha1: string;
}

export interface Pack {
  minecraft: string;
  loader: string;
  loaderVersion: string;
  mods: PackMod[];
  /** Load order, lowest priority first - the order options.txt wants. */
  resourcePacks?: PackContent[];
  shaders?: PackContent[];
  /** The shader selected in Iris, by file name. */
  selectedShader?: string;
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

/** Keyed by pack file: both profiles' packs stay loaded once they have been read. */
const packCache = new Map<string, Pack>();

export async function loadPack(): Promise<Pack> {
  const file = profile(readSettings().activeProfile).packFile;
  const cached = packCache.get(file);

  if (cached) return cached;

  const parsed = parseJson<Pack>(await fs.promises.readFile(resourceFile(file), 'utf8'));
  packCache.set(file, parsed);

  return parsed;
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

/** Modrinth does not promise an order, so "newest" is imposed rather than assumed. */
function newestFirst(versions: ModrinthVersion[]): ModrinthVersion[] {
  return [...versions].sort(
    (a, b) => Date.parse(b.date_published ?? '') - Date.parse(a.date_published ?? ''),
  );
}

/**
 * Asks Modrinth for the newest Fabric build of each enabled mod.
 *
 * The lookups run in parallel: this is ~18 independent round trips, and doing them one
 * after another added several seconds to every launch. Six lanes keeps the launcher well
 * inside Modrinth's 300 requests/minute budget.
 */
export async function resolveMods(
  pack: Pack,
  enabled: readonly string[],
  /** Player-chosen version numbers, keyed by slug. Overrides the pack's own pin. */
  pins: Readonly<Record<string, string>> = {},
): Promise<ResolveResult> {
  const wanted = pack.mods.filter((mod) => mod.locked || enabled.includes(mod.slug));

  const settled = await mapLimit(wanted, 6, async (mod) => {
    try {
      const versions = newestFirst(await fetchJson<ModrinthVersion[]>(versionQuery(mod.slug, pack)));
      const pin = pins[mod.slug] ?? mod.pinnedVersion;

      // Honour an exact pin when set; otherwise take the newest build for the version.
      const version = pin
        ? versions.find((candidate) => candidate.version_number === pin) ?? versions[0]
        : versions[0];

      if (pin && version?.version_number !== pin) {
        log.warn(`Pinned version ${pin} of ${mod.slug} not found; used the newest instead.`);
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
  const next: Record<string, ManagedEntry> = {};

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
    // separate lookup and two projects could in principle collide on it. The slug and
    // version ride along so the Mods screen can name the build without a Modrinth call.
    next[mod.projectId] = { fileName: mod.fileName, slug: mod.slug, version: mod.versionNumber };
    done++;
    onProgress?.({ done, total: mods.length, bytes, label: `Mod: ${mod.name}` });
  });

  const keep = new Set(Object.values(next).map((entry) => entry.fileName));

  for (const [id, entry] of Object.entries(previous)) {
    if (keep.has(entry.fileName)) continue;

    const stale = path.join(modsDir, entry.fileName);

    if (await exists(stale)) {
      await fs.promises.rm(stale, { force: true });
      log.info(`Removed stale managed mod ${id} (${entry.fileName}).`);
    }
  }

  await fs.promises.writeFile(manifestPath, JSON.stringify(next, null, 2), 'utf8');
}

/**
 * Swaps a managed pack mod to the newest build right now, without waiting for a launch.
 *
 * The pack's jars are normally managed as a set on the next install, but the Mods list's
 * "Update" button promises an immediate result. The new jar lands on disk (verified by
 * SHA-1) and the managed manifest is re-pointed at it, so the next resolve agrees
 * instead of cleaning it up as stale.
 */
export async function updateManagedToNewest(slug: string, pack: Pack): Promise<void> {
  const versions = newestFirst(await fetchJson<ModrinthVersion[]>(versionQuery(slug, pack)));
  const version = versions[0];

  if (!version) {
    throw new Error(`No ${pack.minecraft} build exists for ${slug}.`);
  }

  const file = primaryFile(version);

  if (!file) {
    throw new Error(`Modrinth has no downloadable file for ${slug}.`);
  }

  const dest = path.join(dirs().mods, file.filename);
  await downloadFile({ url: file.url, dest, sha1: file.hashes.sha1, size: file.size });

  const manifest = await readManagedManifest();
  const previous = Object.entries(manifest).find(([, entry]) => entry.slug === slug);

  // Switching build: drop the old jar so two versions never sit side by side, and clear
  // a stale "disabled" copy of it too.
  if (previous && previous[1].fileName !== file.filename) {
    await fs.promises.rm(path.join(dirs().mods, previous[1].fileName), { force: true });
    await fs.promises.rm(path.join(dirs().mods, `${previous[1].fileName}.disabled`), { force: true });
  }

  manifest[version.project_id] = {
    fileName: file.filename,
    slug,
    version: version.version_number,
  };

  await fs.promises.writeFile(
    path.join(dirs().mods, MANAGED_MANIFEST),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
}

/**
 * Applies the NVIDIA-optimization switch to the mods folder right now, instead of
 * waiting for the next install.
 *
 * Turning it on downloads the newest Nvidium build for the target Minecraft version and
 * records it in the managed manifest, so the next launch agrees with the jar on disk
 * instead of treating it as stale. Turning it off deletes the jar and its manifest entry.
 */
export async function applyNvidiaOptimization(on: boolean): Promise<void> {
  if (on) {
    await updateManagedToNewest('nvidium', await loadPack());
    log.info('NVIDIA optimization: Nvidium installed.');
    return;
  }

  const manifest = await readManagedManifest();
  const entry = Object.entries(manifest).find(([, candidate]) => candidate.slug === 'nvidium');

  if (!entry) return;

  await fs.promises.rm(path.join(dirs().mods, entry[1].fileName), { force: true });
  await fs.promises.rm(path.join(dirs().mods, `${entry[1].fileName}.disabled`), { force: true });

  delete manifest[entry[0]];
  await fs.promises.writeFile(
    path.join(dirs().mods, MANAGED_MANIFEST),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
  log.info('NVIDIA optimization: Nvidium removed.');
}

/**
 * Reads the managed manifest, accepting both shapes it has had: the original
 * `projectId -> "file.jar"` string map and the current record that also carries the slug
 * and the installed version number. An old install upgrades in place on the next sync.
 */
async function readManifest(file: string): Promise<Record<string, ManagedEntry>> {
  const result: Record<string, ManagedEntry> = {};

  try {
    const raw = parseJson<Record<string, unknown>>(await fs.promises.readFile(file, 'utf8'));

    for (const [id, value] of Object.entries(raw)) {
      if (typeof value === 'string') {
        result[id] = { fileName: value, slug: '', version: '' };
        continue;
      }

      const entry = value as Partial<ManagedEntry> | null;

      if (entry && typeof entry.fileName === 'string') {
        result[id] = {
          fileName: entry.fileName,
          slug: typeof entry.slug === 'string' ? entry.slug : '',
          version: typeof entry.version === 'string' ? entry.version : '',
        };
      }
    }
  } catch {
    // No manifest yet, or an unreadable one - treat every jar as the player's own.
  }

  return result;
}
