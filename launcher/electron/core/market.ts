import fs from 'node:fs';
import path from 'node:path';

import { bundledHashes } from './bundled';
import { log } from './logger';
import { downloadFile, fetchJson, mapLimit, sha1File } from './net';
import { dirs, parseJson } from './paths';
import type {
  ModImportResult,
  ModVerifyResult,
  ModVersionOption,
  StoreHit,
  StoreInstalled,
  StoreSearchResult,
  StoreSortIndex,
} from '../shared';

const MODRINTH = 'https://api.modrinth.com/v2';

/** Hash cache: every jar maps to its SHA-1 so a repeat launch needs no re-hashing. */
const HASH_CACHE = '.bestclient-mod-hashes.json';
/** SHA-1s Modrinth has already confirmed, so they are never queried again. */
const GOOD_CACHE = '.bestclient-mod-good.json';
/** Which extra mods the player installed and which file each resolved to. */
const STORE_MANIFEST = '.bestclient-store.json';

export interface StoreManifestEntry {
  projectId: string;
  version: string;
  fileName: string;
  /** Project title, remembered so the Mods list can name the jar without a lookup. */
  title?: string;
  /** Square project icon, so the Mods list looks the same as the store. */
  iconUrl?: string;
}

export interface StoreManifest {
  [slug: string]: StoreManifestEntry;
}

interface SearchResponse {
  hits: {
    slug: string;
    title: string;
    description: string;
    author: string | null;
    icon_url: string | null;
    featured_gallery: string | null;
    gallery: string[] | null;
    downloads: number;
    follows: number;
    categories: string[] | null;
    display_categories: string[] | null;
  }[];
  total_hits: number;
}

/**
 * Results per store page. Every page is filled to exactly this many when they exist, and
 * 12 divides by the 2, 3 and 4 column counts the grid uses, so no row is ever half empty.
 */
export const STORE_PAGE_SIZE = 12;
/** How many raw hits are pulled per Modrinth request while filling a page. */
const RAW_CHUNK = 50;
/** Safety valve so a pathological filter can never spin the fill loop forever. */
const MAX_FILL_ROUNDS = 12;

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
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  version_type: 'release' | 'beta' | 'alpha';
  date_published: string;
  files: ModrinthFile[];
  dependencies?: ModrinthDependency[];
}

interface ModrinthProject {
  slug: string;
  title: string;
  icon_url: string | null;
}

/** `POST /version_files`: a map from the requested hash to the version it belongs to. */
const HASH_CHUNK = 32;

const SORT_INDEXES: readonly StoreSortIndex[] = [
  'relevance',
  'downloads',
  'follows',
  'newest',
  'updated',
];

function safeIndex(index: string, query: string): StoreSortIndex {
  if ((SORT_INDEXES as readonly string[]).includes(index)) return index as StoreSortIndex;
  // "Relevance" is meaningless without a query, so an empty box browses by downloads.
  return query ? 'relevance' : 'downloads';
}

/**
 * One raw Modrinth page, restricted to mods that actually run on the target loader and
 * version on the client side - the store never offers something that cannot be installed.
 */
async function fetchSearchPage(
  query: string,
  minecraft: string,
  loader: string,
  index: StoreSortIndex,
  offset: number,
): Promise<{ hits: StoreHit[]; totalHits: number }> {
  // Outer array = AND, inner arrays = OR.
  const facets = JSON.stringify([
    ['versions:' + minecraft],
    ['categories:' + loader],
    ['project_type:mod'],
    ['client_side:required', 'client_side:optional'],
  ]);

  const url =
    `${MODRINTH}/search?limit=${RAW_CHUNK}&offset=${Math.max(0, offset)}` +
    `&index=${index}&query=${encodeURIComponent(query)}&facets=${encodeURIComponent(facets)}`;

  const result = await fetchJson<SearchResponse>(url);

  return {
    totalHits: result.total_hits,
    hits: result.hits.map((hit) => ({
      slug: hit.slug,
      title: hit.title,
      description: hit.description,
      // Icon and banner are two separate things: the small square icon sits by the title,
      // the wide gallery image is the banner.
      iconUrl: hit.icon_url ?? undefined,
      bannerUrl: hit.featured_gallery ?? hit.gallery?.[0] ?? undefined,
      downloads: hit.downloads,
      follows: hit.follows,
      author: hit.author ?? undefined,
      // The store shows the human-readable category names when Modrinth gives them, and
      // falls back to the bare slugs otherwise.
      categories: (hit.display_categories ?? hit.categories ?? []).slice(0, 3),
    })),
  };
}

interface FillCache {
  key: string;
  hits: StoreHit[];
  seen: Set<string>;
  rawOffset: number;
  totalHits: number;
  exhausted: boolean;
}

/**
 * Filtered results accumulated for the current query, kept for the session.
 *
 * Mods already bundled with the client are hidden, which means a raw Modrinth page of 50
 * can yield fewer usable hits than a page of the store holds. Rather than showing a short
 * page, results are pulled until the requested page is full - and everything pulled stays
 * here, so paging back and forth costs no further requests.
 */
let fillCache: FillCache | null = null;

export async function searchModsPage(options: {
  query: string;
  minecraft: string;
  loader: string;
  index: string;
  page: number;
  exclude: ReadonlySet<string>;
}): Promise<StoreSearchResult> {
  const query = options.query.trim().slice(0, 64);
  const index = safeIndex(options.index, query);
  const page = Math.min(200, Math.max(0, Math.trunc(options.page)));
  const key = `${query}|${index}|${options.minecraft}|${options.loader}`;

  if (!fillCache || fillCache.key !== key) {
    fillCache = { key, hits: [], seen: new Set(), rawOffset: 0, totalHits: 0, exhausted: false };
  }

  const cache = fillCache;
  const need = (page + 1) * STORE_PAGE_SIZE;

  for (let round = 0; cache.hits.length < need && !cache.exhausted && round < MAX_FILL_ROUNDS; round++) {
    const batch = await fetchSearchPage(query, options.minecraft, options.loader, index, cache.rawOffset);

    cache.totalHits = batch.totalHits;
    cache.rawOffset += RAW_CHUNK;

    if (batch.hits.length < RAW_CHUNK) cache.exhausted = true;

    for (const hit of batch.hits) {
      if (options.exclude.has(hit.slug) || cache.seen.has(hit.slug)) continue;
      cache.seen.add(hit.slug);
      cache.hits.push(hit);
    }
  }

  const start = page * STORE_PAGE_SIZE;

  return {
    hits: cache.hits.slice(start, start + STORE_PAGE_SIZE),
    totalHits: cache.totalHits,
    hasMore: cache.hits.length > start + STORE_PAGE_SIZE || !cache.exhausted,
  };
}

/** Newest build first. Modrinth does not promise an order, so it is imposed here. */
function newestFirst(versions: ModrinthVersion[]): ModrinthVersion[] {
  return [...versions].sort(
    (a, b) => Date.parse(b.date_published ?? '') - Date.parse(a.date_published ?? ''),
  );
}

function versionQuery(slug: string, minecraft: string, loader: string): string {
  return (
    `${MODRINTH}/project/${encodeURIComponent(slug)}/version` +
    `?loaders=${encodeURIComponent(JSON.stringify([loader]))}` +
    `&game_versions=${encodeURIComponent(JSON.stringify([minecraft]))}`
  );
}

/**
 * The newest published build of each slug, keyed by slug. A failed lookup is skipped -
 * the Mods list just shows no update for that row. Six lanes keeps the launcher inside
 * Modrinth's rate budget even with a full pack.
 */
/**
 * Works out which mods can move to a newer build without breaking the set.
 *
 * The check is done against the builds that would actually be installed, not against a
 * list written by hand: every candidate's own dependency block is read, and a build that
 * declares another mod in the set incompatible is left where it is. The test runs both
 * ways - a new build that rejects an installed mod is refused, and so is one that an
 * installed mod already rejects.
 *
 * Anything skipped is named with the reason. Silently not updating a mod and silently
 * breaking the game are both worse than saying which one is in the way.
 */
export async function planModUpdates(
  minecraft: string,
  loader: string,
  slugs: readonly string[],
  current: Readonly<Record<string, string>>,
): Promise<UpdatePlan> {
  const unique = [...new Set(slugs)];
  const candidates = new Map<string, ModrinthVersion>();
  const skipped: UpdateSkip[] = [];

  await mapLimit(unique, 6, async (slug) => {
    try {
      const newest = newestFirst(
        await fetchJson<ModrinthVersion[]>(versionQuery(slug, minecraft, loader)),
      )[0];

      if (newest) candidates.set(slug, newest);
    } catch (error) {
      log.warn(`Could not look up ${slug}.`, error);
      skipped.push({ slug, reason: 'Modrinth could not be reached for this one.' });
    }
  });

  // Every project that will be present once the run finishes - the newest build where
  // there is one, the installed build otherwise. Incompatibility is a property of the
  // whole set, so it has to be judged against the whole set.
  const projectBySlug = new Map<string, string>();
  for (const [slug, version] of candidates) projectBySlug.set(slug, version.project_id);

  const present = new Set(projectBySlug.values());
  const slugByProject = new Map([...projectBySlug].map(([slug, id]) => [id, slug]));

  const updates: UpdateChoice[] = [];

  for (const [slug, version] of candidates) {
    if (current[slug] === version.version_number) continue;

    const clash = (version.dependencies ?? []).find(
      (dependency) =>
        dependency.dependency_type === 'incompatible' &&
        dependency.project_id !== null &&
        dependency.project_id !== version.project_id &&
        present.has(dependency.project_id),
    );

    if (clash) {
      const other = slugByProject.get(clash.project_id!) ?? clash.project_id!;
      skipped.push({ slug, reason: `Its newest build does not work with ${other}.` });
      continue;
    }

    updates.push({ slug, version: version.version_number });
  }

  // The other direction: a build already installed may reject one of the candidates.
  const rejected = new Set<string>();

  for (const [slug, version] of candidates) {
    for (const dependency of version.dependencies ?? []) {
      if (dependency.dependency_type !== 'incompatible' || !dependency.project_id) continue;

      const other = slugByProject.get(dependency.project_id);
      if (other && other !== slug) rejected.add(`${slug}:${other}`);
    }
  }

  return {
    updates: updates.filter((entry) => {
      const blocker = [...rejected].find((pair) => pair.endsWith(`:${entry.slug}`));

      if (!blocker) return true;

      skipped.push({
        slug: entry.slug,
        reason: `${blocker.split(':')[0]} does not work alongside this build.`,
      });

      return false;
    }),
    skipped,
  };
}

export interface UpdateChoice {
  slug: string;
  version: string;
}

export interface UpdateSkip {
  slug: string;
  reason: string;
}

export interface UpdatePlan {
  updates: UpdateChoice[];
  skipped: UpdateSkip[];
}

export async function checkModUpdates(
  minecraft: string,
  loader: string,
  slugs: readonly string[],
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  await mapLimit([...new Set(slugs)], 6, async (slug) => {
    try {
      const latest = newestFirst(await fetchJson<ModrinthVersion[]>(versionQuery(slug, minecraft, loader)))[0];

      if (latest) result[slug] = latest.version_number;
    } catch (error) {
      log.warn(`Could not check updates for ${slug}.`, error);
    }
  });

  return result;
}

/** Every build of a project that runs on the target loader/version, newest first. */
export async function listModVersions(
  slug: string,
  minecraft: string,
  loader: string,
): Promise<ModVersionOption[]> {
  const versions = await fetchJson<ModrinthVersion[]>(versionQuery(slug, minecraft, loader));

  return newestFirst(versions)
    .slice(0, 40)
    .map((version) => ({
      id: version.id,
      versionNumber: version.version_number,
      name: version.name,
      channel: version.version_type ?? 'release',
      datePublished: version.date_published ?? '',
    }));
}

/**
 * Downloads a build of a project into `instance/mods` and remembers the mapping in the
 * store manifest. Without `versionId` the newest build is taken. The file is verified
 * against its Modrinth SHA-1, so everything that lands in the mods folder is something
 * Modrinth actually publishes.
 */
export async function installFromModrinth(
  slug: string,
  minecraft: string,
  loader: string,
  versionId?: string,
): Promise<{ title: string; fileName: string; version: string }> {
  const [project, version] = await Promise.all([
    fetchJson<ModrinthProject>(`${MODRINTH}/project/${encodeURIComponent(slug)}`),
    versionId
      ? fetchJson<ModrinthVersion>(`${MODRINTH}/version/${encodeURIComponent(versionId)}`)
      : fetchJson<ModrinthVersion[]>(versionQuery(slug, minecraft, loader)).then(
          (versions) => newestFirst(versions)[0],
        ),
  ]);

  if (!version) {
    throw new Error(`No ${minecraft} build exists for ${slug} on ${loader}.`);
  }

  const file = version.files.find((candidate) => candidate.primary) ?? version.files[0];

  if (!file) {
    throw new Error(`Modrinth has no downloadable file for ${slug}.`);
  }

  const dest = path.join(dirs().mods, file.filename);
  await downloadFile({ url: file.url, dest, sha1: file.hashes.sha1, size: file.size });

  const manifest = await readStoreManifest();
  const previous = manifest[slug];

  // Switching build: drop the old jar so two versions never sit side by side, and clear a
  // stale "disabled" copy of it too.
  if (previous && previous.fileName !== file.filename) {
    await fs.promises.rm(path.join(dirs().mods, previous.fileName), { force: true });
    await fs.promises.rm(path.join(dirs().mods, `${previous.fileName}.disabled`), { force: true });
  }

  manifest[slug] = {
    projectId: version.project_id,
    version: version.version_number,
    fileName: file.filename,
    title: project.title,
    iconUrl: project.icon_url ?? undefined,
  };
  await writeStoreManifest(manifest);

  log.info(`Installed ${file.filename} (${version.version_number}) from Modrinth.`);
  return { title: project.title, fileName: file.filename, version: version.version_number };
}

/** Deletes an extra mod installed from the store and forgets it in the manifest. */
export async function removeInstalledMod(slug: string): Promise<void> {
  const manifest = await readStoreManifest();
  const entry = manifest[slug];
  if (!entry) return;

  await fs.promises.rm(path.join(dirs().mods, entry.fileName), { force: true });
  await fs.promises.rm(path.join(dirs().mods, `${entry.fileName}.disabled`), { force: true });
  delete manifest[slug];
  await writeStoreManifest(manifest);
  log.info(`Removed ${entry.fileName} from the mods folder.`);
}

export async function listInstalledMods(): Promise<StoreInstalled> {
  const manifest = await readStoreManifest();
  const result: StoreInstalled = {};

  for (const [slug, entry] of Object.entries(manifest)) {
    result[slug] = { fileName: entry.fileName, version: entry.version };
  }

  return result;
}

interface HashCache {
  [key: string]: string;
}

const hashCacheKey = (fileName: string, size: number, mtimeMs: number) =>
  `${fileName}|${size}|${Math.round(mtimeMs)}`;

/**
 * Known hacked clients and injectors, matched two ways: the file name against
 * `namePattern` (instant), and the raw jar bytes against `byteSignatures` (catches a
 * renamed jar dressed up as a normal mod). Byte matches only matter for jars Modrinth
 * itself vouches for - any jar it has never confirmed is blocked by the hash check
 * anyway, so only the vouched-for ones are worth reading.
 */
const KNOWN_INJECTORS: { name: string; namePattern: RegExp; byteSignatures: string[] }[] = [
  { name: 'Doomsday', namePattern: /\bdoomsday\b/i, byteSignatures: ['doomsday'] },
  { name: 'LiquidBounce', namePattern: /\bliquid[ _-]?bounce\b/i, byteSignatures: ['liquidbounce'] },
  { name: 'Aristois', namePattern: /\baristois\b/i, byteSignatures: ['aristois'] },
  { name: 'Wurst', namePattern: /\bwurst\b/i, byteSignatures: [] },
  { name: 'Future', namePattern: /\bfutureclient\b/i, byteSignatures: ['futureclient'] },
];

/**
 * Verifies that every jar in `instance/mods` is a file Modrinth publishes.
 *
 * Every jar is SHA-1'd once (cached across launches by name+size+mtime) and the hashes
 * are then looked up in one batched Modrinth request. Anything that comes back with no
 * matching version is not a Modrinth mod - often something a player dropped in by hand -
 * and must never launch.
 */
export async function verifyModsAreFromModrinth(): Promise<ModVerifyResult> {
  const modsDir = dirs().mods;
  let files: string[];

  try {
    // Only live jars are checked: a mod switched off is renamed to .jar.disabled and the
    // game never loads it, so it cannot affect integrity.
    files = (await fs.promises.readdir(modsDir)).filter((name) => name.toLowerCase().endsWith('.jar'));
  } catch {
    return { verified: 0, unknown: [], flagged: [] };
  }

  const cache = await readHashCache();
  const sha1ByName = new Map<string, string>();
  const stats = new Map<string, fs.Stats>();
  const changed: string[] = [];

  for (const fileName of files) {
    const stat = await fs.promises.stat(path.join(modsDir, fileName));
    stats.set(fileName, stat);

    const cached = cache[hashCacheKey(fileName, stat.size, stat.mtimeMs)];

    if (cached) sha1ByName.set(fileName, cached);
    else changed.push(fileName);
  }

  for (const fileName of changed) {
    sha1ByName.set(fileName, await sha1File(path.join(modsDir, fileName)));
  }

  const byHash = new Map<string, string>();

  for (const [fileName, sha] of sha1ByName) byHash.set(sha, fileName);

  // Persistent cache: writing a few KB makes every later launch skip all hashing. The
  // stats were already read above, so this costs no extra syscalls.
  const nextCache: HashCache = {};

  for (const [fileName, sha] of sha1ByName) {
    const stat = stats.get(fileName);
    if (stat) nextCache[hashCacheKey(fileName, stat.size, stat.mtimeMs)] = sha;
  }

  // Known-good cache: a hash Modrinth has already confirmed never needs asking about
  // again. On an unchanged mods folder every hash is already in here, so the launch makes
  // zero Modrinth requests - no latency, no rate limit.
  //
  // The launcher's own mods are added to it outright: they are not published on Modrinth,
  // so the only authority for them is the hash stamped into this build.
  const good = await readGoodCache();

  for (const hash of await bundledHashes()) good.add(hash);

  const toQuery = [...byHash.keys()].filter((hash) => !good.has(hash));
  const unknown: string[] = [];

  for (let offset = 0; offset < toQuery.length; offset += HASH_CHUNK) {
    const chunk = toQuery.slice(offset, offset + HASH_CHUNK);

    try {
      const byHashResponse = await fetchJson<Record<string, ModrinthVersion>>(
        `${MODRINTH}/version_files`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hashes: chunk, algorithm: 'sha1' }),
        },
      );

      for (const hash of chunk) {
        if (hash in byHashResponse) good.add(hash);
        else unknown.push(byHash.get(hash)!);
      }
    } catch (error) {
      // Modrinth answers 400 when none of the chunk's hashes are known files.
      if (/(^|\s)400(\s|$)/.test(String((error as Error).cause ?? error))) {
        for (const hash of chunk) unknown.push(byHash.get(hash)!);
        continue;
      }

      throw error;
    }
  }

  // Injector scan. Name matches are instant; the byte scan only reads jars Modrinth has
  // vouched for (any other hash is already blocked above) and stops at the first hit.
  const flagged: string[] = [];

  for (const fileName of files) {
    const base = fileName.replace(/\.jar$/i, '');

    if (KNOWN_INJECTORS.some((inj) => inj.namePattern.test(base))) {
      flagged.push(fileName);
      continue;
    }

    const sha = sha1ByName.get(fileName);
    if (!sha || !good.has(sha)) continue;

    const data = await fs.promises.readFile(path.join(modsDir, fileName));

    if (KNOWN_INJECTORS.some((inj) => inj.byteSignatures.some((sig) => data.includes(sig)))) {
      flagged.push(fileName);
    }
  }

  // Keep the good cache to the hashes still present, so it cannot grow without bound.
  await writeGoodCache(new Set([...good].filter((hash) => byHash.has(hash))));

  try {
    await fs.promises.writeFile(hashCacheFile(), JSON.stringify(nextCache), 'utf8');
  } catch (error) {
    log.warn('Could not persist the mod hash cache.', error);
  }

  return { verified: byHash.size, unknown, flagged };
}

/**
 * Copies dropped-in jars into `instance/mods`. Integrity is checked before every launch:
 * a jar Modrinth does not know blocks the game, so hand-added files only get stored here.
 */
export async function importModFiles(paths: string[]): Promise<ModImportResult> {
  const modsDir = dirs().mods;
  await fs.promises.mkdir(modsDir, { recursive: true });

  const imported: string[] = [];
  const skipped: string[] = [];

  for (const source of paths) {
    // basename() alone: a crafted name must never be able to write outside the folder.
    const fileName = path.basename(source);

    if (!fileName.toLowerCase().endsWith('.jar') || fileName.startsWith('.')) {
      skipped.push(fileName);
      continue;
    }

    try {
      await fs.promises.copyFile(source, path.join(modsDir, fileName));
      imported.push(fileName);
    } catch (error) {
      log.warn(`Could not import ${fileName}.`, error);
      skipped.push(fileName);
    }
  }

  return { imported, skipped };
}

function hashCacheFile(): string {
  return path.join(dirs().mods, HASH_CACHE);
}

function storeManifestFile(): string {
  return path.join(dirs().mods, STORE_MANIFEST);
}

async function readHashCache(): Promise<HashCache> {
  try {
    return parseJson<HashCache>(await fs.promises.readFile(hashCacheFile(), 'utf8'));
  } catch {
    return {};
  }
}

function goodCacheFile(): string {
  return path.join(dirs().mods, GOOD_CACHE);
}

async function readGoodCache(): Promise<Set<string>> {
  try {
    return new Set(parseJson<string[]>(await fs.promises.readFile(goodCacheFile(), 'utf8')));
  } catch {
    return new Set();
  }
}

async function writeGoodCache(good: Set<string>): Promise<void> {
  try {
    await fs.promises.writeFile(goodCacheFile(), JSON.stringify([...good]), 'utf8');
  } catch (error) {
    log.warn('Could not persist the verified-hash cache.', error);
  }
}

export async function readStoreManifest(): Promise<StoreManifest> {
  try {
    return parseJson<StoreManifest>(await fs.promises.readFile(storeManifestFile(), 'utf8'));
  } catch {
    return {};
  }
}

export async function writeStoreManifest(manifest: StoreManifest): Promise<void> {
  await fs.promises.mkdir(dirs().mods, { recursive: true });
  await fs.promises.writeFile(storeManifestFile(), JSON.stringify(manifest, null, 2), 'utf8');
}
