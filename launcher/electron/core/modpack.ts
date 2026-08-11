import fs from 'node:fs';
import path from 'node:path';

import {
  auditMods,
  describe,
  providers,
  readMods,
  satisfies,
  type Conflict,
  type Environment,
  type ModMeta,
} from './deps';
import { log } from './logger';
import { downloadFile, fetchJson, mapLimit, type ProgressFn, type VerifyMode } from './net';
import { dirs, exists, parseJson, resourceFile } from './paths';
import { PACK_FILE } from './profiles';
import { readSettings, writeSettings } from './store';

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

/**
 * Which renderer draws the game.
 *
 * `sodium` is the client's default: the OpenGL path rewritten, which is what shaders,
 * Nvidium and most of the visual mods are built against. `vulkan` swaps OpenGL out for
 * Vulkan through VulkanMod - a bigger win on some drivers, and incompatible with all of
 * the above. `opengl` is Minecraft's own renderer, untouched, for when a mod has to be
 * ruled out as the cause of something.
 */
export type Renderer = 'sodium' | 'vulkan' | 'opengl';

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
  /**
   * The Minecraft versions this mod is offered on. Absent means all of them.
   *
   * Some mods are only published for the newer versions. Listing them here keeps them in
   * the pack for the versions that have them, instead of the alternative: leaving them
   * unrestricted and telling every 1.21.11 player about a mod that was never going to
   * install.
   */
  minecraft?: string[];
  /**
   * The renderer this mod belongs to. Absent means it works under any of them.
   *
   * Sodium and VulkanMod each replace the whole renderer, so they cannot be installed
   * together, and the mods built on top of one are useless - or fatal - under the other.
   */
  renderer?: Renderer;
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
  /**
   * Bumped when the pack's own recommendations change, not when a mod is added.
   *
   * `defaultEnabled` only reaches installs that have never been offered the mod, which is
   * what stops a pack update from overriding a choice. That also means a change to what
   * the client recommends by default would reach nobody who already has it installed - so
   * a revision bump re-applies the recommendations once, and says so in the log.
   */
  revision?: number;
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

let packCache: Pack | null = null;

/**
 * The pack, with its Minecraft version replaced by the selected profile's.
 *
 * There is one pack file and it names 1.21.11, but the same set of mods is installed on
 * whichever version the player picked - the resolver asks Modrinth per version anyway, so
 * a mod with no build for that version is reported and skipped rather than breaking.
 */
async function rawPack(): Promise<Pack> {
  if (!packCache) {
    packCache = parseJson<Pack>(await fs.promises.readFile(resourceFile(PACK_FILE), 'utf8'));
  }

  return packCache;
}

/**
 * The renderers the selected Minecraft version can actually run.
 *
 * Sodium and plain OpenGL are always possible - one is the pack's own default and the
 * other is the game as Mojang ships it. Vulkan is only offered where VulkanMod has a
 * build, because a renderer with no mod behind it is a switch that changes nothing.
 */
export async function availableRenderers(): Promise<Renderer[]> {
  const pack = await rawPack();
  const minecraft = readSettings().activeProfile;

  const hasVulkan = pack.mods.some(
    (mod) => mod.renderer === 'vulkan' && (!mod.minecraft || mod.minecraft.includes(minecraft)),
  );

  return hasVulkan ? ['sodium', 'vulkan', 'opengl'] : ['sodium', 'opengl'];
}

export async function loadPack(): Promise<Pack> {
  const packCache = await rawPack();
  const settings = readSettings();
  const minecraft = settings.activeProfile;
  const renderer = settings.renderer ?? 'sodium';

  // Off by default: the client installs a mod set and nothing else. The packs and the
  // shader are a look, and a look is a choice - shipping one by default would change how
  // the game reads for someone who only asked for the frames.
  const content = settings.bundledContent === true;

  return {
    ...packCache,
    minecraft,
    mods: packCache.mods.filter(
      (mod) =>
        (!mod.minecraft || mod.minecraft.includes(minecraft)) &&
        (!mod.renderer || mod.renderer === renderer),
    ),
    resourcePacks: content ? packCache.resourcePacks : [],
    shaders: content ? packCache.shaders : [],
    selectedShader: content ? packCache.selectedShader : undefined,
  };
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

/**
 * Folds the pack into the stored selection and saves the result.
 *
 * The one place that decides what is installed, so the install path and the settings
 * panel cannot drift apart. A pack revision the install has not seen resets the selection
 * first: the recommendations changed, and a recommendation that only reaches new installs
 * is not a recommendation.
 */
export function foldPackIntoSelection(pack: Pack): Reconciled {
  const settings = readSettings();
  const revision = pack.revision ?? 0;

  const stale = revision > (settings.packRevision ?? 0);
  const known = stale ? [] : settings.knownMods;
  const enabled = stale ? [] : settings.enabledMods;

  if (stale) {
    log.info(`Pack revision ${revision}: mod selection reset to the client's recommendations.`);
  }

  const folded = reconcileSelection(pack, enabled, known);
  writeSettings({ ...folded, packRevision: revision });

  return folded;
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

// ---------------------------------------------------------------------------
// Keeping the installed set loadable
// ---------------------------------------------------------------------------

/** A mod the launcher stepped back to an older build to keep the game startable. */
export interface Repair {
  slug: string;
  from: string;
  to: string;
  /** The requirement that forced it, in the words the player would see in the log. */
  because: string;
}

export interface ReconcileResult {
  repairs: Repair[];
  /** What is still wrong after the repair pass - the game will not start with these. */
  unresolved: Conflict[];
}

/** How many builds back the launcher is willing to walk before giving up on a mod. */
const MAX_STEPBACK = 8;

/**
 * Checks the installed jars against each other and steps a mod back when they disagree.
 *
 * Two mods in the pack can both be at their newest build and still be unable to load
 * together: Nvidium accepts only Sodium 0.8.11 or 0.8.12, and the newest Sodium Extra
 * demands 0.8.13 or later. Neither mod is wrong and neither pin is stale - the pack simply
 * cannot have both newest at once, and which one has to give way changes every time either
 * of them publishes.
 *
 * Rather than freeze a version number in the pack file and have it rot, the disagreement is
 * settled here at install time: whoever is complaining walks back through its own older
 * builds until it finds one that accepts what is installed. The choice is written into the
 * player's pins, so the next launch resolves straight to it instead of paying for the walk
 * again.
 */
export async function reconcileInstalled(
  pack: Pack,
  installed: readonly ResolvedMod[],
  environment: Environment,
): Promise<ReconcileResult> {
  const modsDir = dirs().mods;
  let metas = await readMods(modsDir);
  let conflicts = auditMods(metas, environment);

  const repairs: Repair[] = [];

  if (conflicts.length === 0) return { repairs, unresolved: [] };

  log.warn(`Mods disagree: ${conflicts.map(describe).join('; ')}.`);

  // A jar can only be stepped back once per install; without this a pair that can never
  // agree would be downloaded back and forth until the depth limit ran out.
  const attempted = new Set<string>();

  for (let round = 0; round < 4 && conflicts.length > 0; round++) {
    const target = conflicts.find(
      (conflict) => conflict.kind === 'range' && !attempted.has(conflict.fileName),
    );

    if (!target) break;

    attempted.add(target.fileName);

    // The mod that is complaining is the one that moves. What it complains about is
    // usually held where it is on purpose - a pack pin, or another mod's hard bound - so
    // dragging that forward would only break something else.
    const mod = installed.find((candidate) => candidate.fileName === target.fileName);

    if (!mod) continue;

    const repair = await stepBack(pack, mod, metas, environment, target);

    if (!repair) {
      log.warn(`No older build of ${mod.slug} accepts ${target.target} ${target.present}.`);
      continue;
    }

    repairs.push(repair);
    metas = await readMods(modsDir);
    conflicts = auditMods(metas, environment);
  }

  if (repairs.length > 0) {
    // Remember the outcome so the resolver picks it directly next time.
    const pins = { ...readSettings().pinnedVersions };
    for (const repair of repairs) pins[repair.slug] = repair.to;
    writeSettings({ pinnedVersions: pins });
  }

  return { repairs, unresolved: conflicts };
}

/**
 * Walks a mod's published builds, newest first, until one loads against what is installed.
 *
 * The only way to know what a build demands is to open it: Modrinth records the version a
 * release was built against, not the range the jar enforces, and the loader honours the
 * jar. So each candidate is downloaded and read, and the first one whose whole `depends`
 * block is met takes the place of the jar that was there.
 */
async function stepBack(
  pack: Pack,
  mod: ResolvedMod,
  metas: readonly ModMeta[],
  environment: Environment,
  conflict: Conflict,
): Promise<Repair | null> {
  // What the folder would offer once this mod's own jar is out of it.
  const provided = providers(metas, environment, mod.fileName);

  let versions: ModrinthVersion[];

  try {
    versions = newestFirst(await fetchJson<ModrinthVersion[]>(versionQuery(mod.slug, pack)));
  } catch (error) {
    log.warn(`Could not list older builds of ${mod.slug}.`, error);
    return null;
  }

  const modsDir = dirs().mods;
  const staging = path.join(modsDir, '.repair');
  await fs.promises.mkdir(staging, { recursive: true });

  try {
    const older = versions.filter((candidate) => candidate.version_number !== mod.versionNumber);

    for (const candidate of older.slice(0, MAX_STEPBACK)) {
      const file = primaryFile(candidate);
      if (!file) continue;

      const staged = path.join(staging, file.filename);

      try {
        await downloadFile({ url: file.url, dest: staged, sha1: file.hashes.sha1, size: file.size });
      } catch (error) {
        log.warn(`Could not download ${mod.slug} ${candidate.version_number}.`, error);
        continue;
      }

      const [meta] = await readMods(staging);

      // Everything this build asks for has to hold, not only the requirement that failed:
      // an older build can demand an older library, and swapping one break for another is
      // not a repair.
      const fits =
        meta !== undefined &&
        Object.entries(meta.depends).every(([id, predicate]) => {
          const present = provided.get(id);
          // Java is the launcher's own choice and is always at or above what a mod asks.
          if (id === 'java') return true;
          return present !== undefined && satisfies(present, predicate);
        });

      if (!fits) {
        await fs.promises.rm(staged, { force: true });
        continue;
      }

      await fs.promises.rm(path.join(modsDir, mod.fileName), { force: true });
      await fs.promises.rm(path.join(modsDir, `${mod.fileName}.disabled`), { force: true });
      await fs.promises.rename(staged, path.join(modsDir, file.filename));

      const manifest = await readManagedManifest();
      manifest[candidate.project_id] = {
        fileName: file.filename,
        slug: mod.slug,
        version: candidate.version_number,
      };
      await fs.promises.writeFile(
        path.join(modsDir, MANAGED_MANIFEST),
        JSON.stringify(manifest, null, 2),
        'utf8',
      );

      log.info(
        `Stepped ${mod.slug} back from ${mod.versionNumber} to ${candidate.version_number}: ${describe(conflict)}.`,
      );

      return {
        slug: mod.slug,
        from: mod.versionNumber,
        to: candidate.version_number,
        because: describe(conflict),
      };
    }
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true });
  }

  return null;
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
