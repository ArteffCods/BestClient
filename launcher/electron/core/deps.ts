import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';

import { log } from './logger';

/**
 * Reads what the Fabric loader is about to read, before it gets the chance to refuse.
 *
 * Every mod jar carries a `fabric.mod.json` naming the ids it provides and the version
 * ranges it demands of everything else. When one of those ranges is not met the loader
 * stops during startup and the process ends with exit code 1 - the launcher sees a number
 * and the player sees "the game exited with code 1", which says nothing about the two mods
 * that disagreed.
 *
 * Modrinth's own dependency data cannot answer this: it records "built against version X"
 * per release, not the range the jar actually enforces, and the loader only honours what
 * is inside the jar. So the jars are opened and the same arithmetic is done here.
 */

/** An id a jar declares, and the version it declares it at. */
export interface ModMeta {
  id: string;
  version: string;
  /** Extra ids the mod answers to (`provides`), all at the mod's own version. */
  provides: string[];
  /** Hard requirements: id -> predicate. A failure here stops the game. */
  depends: Record<string, string[]>;
  /** Hard incompatibilities: id -> predicate. A match here stops the game. */
  breaks: Record<string, string[]>;
  /** The jar this came from, relative to the mods folder. */
  fileName: string;
}

export interface Conflict {
  kind: 'missing' | 'range' | 'breaks';
  /** The jar that will not load, as `id version`. */
  from: string;
  fileName: string;
  /** The id it has a problem with. */
  target: string;
  /** The range it demands, as written. */
  wanted: string;
  /** What is actually installed, or null when nothing provides the id. */
  present: string | null;
}

/**
 * Ids the loader and the game supply themselves. Without them every jar looks broken,
 * because essentially all of them depend on `minecraft` and `fabricloader`.
 */
export interface Environment {
  minecraft: string;
  loader: string;
  java: number;
  /** Ids the loader supplies from inside its own jar, from {@link readBundledLibraries}. */
  builtIn?: readonly ModMeta[];
}

// ---------------------------------------------------------------------------
// fabric.mod.json
// ---------------------------------------------------------------------------

function asPredicates(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  return [];
}

function asMap(value: unknown): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;

  for (const [id, predicate] of Object.entries(value as Record<string, unknown>)) {
    const parsed = asPredicates(predicate);
    if (parsed.length > 0) result[id] = parsed;
  }

  return result;
}

function toMeta(raw: unknown, fileName: string): ModMeta | null {
  if (!raw || typeof raw !== 'object') return null;

  const json = raw as Record<string, unknown>;
  if (typeof json.id !== 'string' || !json.id) return null;

  return {
    id: json.id,
    version: typeof json.version === 'string' ? json.version : '0',
    provides: Array.isArray(json.provides)
      ? json.provides.filter((entry): entry is string => typeof entry === 'string')
      : [],
    depends: asMap(json.depends),
    breaks: asMap(json.breaks),
    fileName,
  };
}

function parse(text: string): unknown {
  // fabric.mod.json is hand-written and some mods ship it with a byte order mark or with
  // trailing commas; a jar the loader accepts must not be rejected here.
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return JSON.parse(withoutBom.replace(/,(\s*[}\]])/g, '$1'));
}

/**
 * Every id a jar contributes, including the ones nested inside it.
 *
 * Fabric mods bundle their libraries as jar-in-jar, and those inner jars provide ids that
 * other mods depend on. Reading only the outer manifest would report perfectly good
 * libraries as missing.
 */
function readJar(file: string): ModMeta[] {
  const found: ModMeta[] = [];
  const fileName = path.basename(file);

  let zip: AdmZip;

  try {
    zip = new AdmZip(file);
  } catch (error) {
    log.warn(`Could not open ${fileName} as a jar.`, error);
    return found;
  }

  const outerEntry = zip.getEntry('fabric.mod.json');
  if (!outerEntry) return found;

  let raw: { jars?: { file?: string }[] };
  let outer: ModMeta | null;

  try {
    raw = parse(zip.readAsText(outerEntry)) as { jars?: { file?: string }[] };
    outer = toMeta(raw, fileName);
  } catch (error) {
    log.warn(`Could not read fabric.mod.json in ${fileName}.`, error);
    return found;
  }

  if (!outer) return found;
  found.push(outer);

  for (const nested of raw.jars ?? []) {
    if (typeof nested.file !== 'string') continue;

    const entry = zip.getEntry(nested.file);
    if (!entry) continue;

    try {
      const inner = new AdmZip(entry.getData());
      const innerEntry = inner.getEntry('fabric.mod.json');
      if (!innerEntry) continue;

      const meta = toMeta(parse(inner.readAsText(innerEntry)), fileName);
      // A nested library's own requirements are already satisfied by whoever bundled it,
      // so only what it provides is taken - its depends would double-report.
      if (meta) found.push({ ...meta, depends: {}, breaks: {} });
    } catch {
      // A nested jar that will not open is the outer mod's problem, not the launcher's.
    }
  }

  return found;
}

/**
 * The ids a jar supplies without being a mod in the folder.
 *
 * Fabric Loader carries libraries inside itself - 0.19.3 ships MixinExtras 0.5.4 - and
 * mods depend on them by id. They are nowhere in the mods folder, so without reading the
 * loader they look absent, and a mod asking for a version newer than whatever some other
 * mod happens to bundle gets reported as broken when the loader was always going to hand
 * it the newer one.
 */
export function readBundledLibraries(jar: string): ModMeta[] {
  // Requirements are dropped: the loader's own dependencies are its business, and it is
  // on the classpath before any of this runs.
  return readJar(jar).map((meta) => ({ ...meta, depends: {}, breaks: {} }));
}

/** Reads every jar in a mods folder. `.disabled` files are skipped, as the loader skips them. */
export async function readMods(modsDir: string): Promise<ModMeta[]> {
  let names: string[];

  try {
    names = await fs.promises.readdir(modsDir);
  } catch {
    return [];
  }

  const metas: ModMeta[] = [];

  for (const name of names) {
    if (!name.endsWith('.jar')) continue;
    metas.push(...readJar(path.join(modsDir, name)));
  }

  return metas;
}

// ---------------------------------------------------------------------------
// Version predicates
// ---------------------------------------------------------------------------

interface Semver {
  parts: number[];
  /** Dot-separated prerelease identifiers; empty for a release. */
  pre: string[];
}

/**
 * Parses `1.2.3-beta.4+build`. Build metadata is dropped - semver says it takes no part in
 * ordering, and mod versions carry the Minecraft version there (`0.9.3+mc1.21.11`).
 */
function semver(value: string): Semver | null {
  const withoutBuild = value.split('+')[0]!;
  const dash = withoutBuild.indexOf('-');
  const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
  const pre = dash === -1 ? '' : withoutBuild.slice(dash + 1);

  const parts: number[] = [];

  for (const piece of core.split('.')) {
    if (!/^\d+$/.test(piece)) return null;
    parts.push(Number(piece));
  }

  if (parts.length === 0) return null;

  return { parts, pre: pre ? pre.split('.') : [] };
}

function comparePre(a: string[], b: string[]): number {
  // A release outranks any prerelease of the same numbers - 1.0.0 is newer than 1.0.0-rc.1.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i];
    const right = b[i];

    if (left === undefined) return -1;
    if (right === undefined) return 1;

    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);

    if (leftNumeric && rightNumeric) {
      if (Number(left) !== Number(right)) return Number(left) < Number(right) ? -1 : 1;
      continue;
    }

    // Numeric identifiers always rank below alphanumeric ones.
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    if (left !== right) return left < right ? -1 : 1;
  }

  return 0;
}

function compare(a: Semver, b: Semver): number {
  for (let i = 0; i < Math.max(a.parts.length, b.parts.length); i++) {
    const left = a.parts[i] ?? 0;
    const right = b.parts[i] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }

  return comparePre(a.pre, b.pre);
}

/** `0.8.x` and `1.2.*` are ranges: the first wildcard sets the bound the rest ignores. */
function wildcardRange(value: string): { from: Semver; to: Semver } | null {
  const core = value.split('+')[0]!.split('-')[0]!;
  const pieces = core.split('.');
  const at = pieces.findIndex((piece) => piece === 'x' || piece === 'X' || piece === '*');

  if (at === -1) return null;
  if (at === 0) return { from: { parts: [0], pre: [] }, to: { parts: [Number.MAX_SAFE_INTEGER], pre: [] } };

  const fixed = pieces.slice(0, at).map(Number);
  if (fixed.some((piece) => !Number.isFinite(piece))) return null;

  const upper = [...fixed];
  upper[upper.length - 1] = upper[upper.length - 1]! + 1;

  return { from: { parts: fixed, pre: [] }, to: { parts: upper, pre: [] } };
}

function matchesTerm(version: Semver | null, raw: string, literal: string): boolean {
  const term = raw.trim();
  if (!term || term === '*') return true;

  const match = /^(>=|<=|>|<|\^|~|=)?\s*(.+)$/.exec(term);
  if (!match) return false;

  const operator = match[1] ?? '=';
  const wanted = match[2]!.trim();

  // A version the loader treats as a plain string (no dotted numbers) only ever matches
  // itself, whatever the operator says.
  if (!version) return operator === '=' && wanted === literal;

  const range = wildcardRange(wanted);

  if (range) {
    if (operator === '=' || operator === '~' || operator === '^') {
      return compare(version, range.from) >= 0 && compare(version, range.to) < 0;
    }
    // A wildcard under an inequality is compared against the bound it opens.
    return matchesBound(version, operator, operator === '<' || operator === '<=' ? range.from : range.to);
  }

  const target = semver(wanted);
  if (!target) return operator === '=' && wanted === literal;

  if (operator === '~' || operator === '^') {
    if (compare(version, target) < 0) return false;

    const upper = [...target.parts];
    // `~1.2.3` allows patch updates, `^1.2.3` allows minor ones.
    const index = operator === '~' ? Math.max(0, upper.length - 2) : 0;
    upper[index] = (upper[index] ?? 0) + 1;
    for (let i = index + 1; i < upper.length; i++) upper[i] = 0;

    return compare(version, { parts: upper, pre: [] }) < 0;
  }

  return matchesBound(version, operator, target);
}

function matchesBound(version: Semver, operator: string, target: Semver): boolean {
  const order = compare(version, target);

  switch (operator) {
    case '>=':
      return order >= 0;
    case '<=':
      return order <= 0;
    case '>':
      return order > 0;
    case '<':
      return order < 0;
    default:
      return order === 0;
  }
}

/**
 * Evaluates one of Fabric's version predicates against an installed version.
 *
 * The shape is: an array is a list of alternatives (any one may match), and within a
 * single string, every term must hold. Terms are separated by a comma or by whitespace -
 * both are in the wild, often in the same pack (`">=1.21.8 <=1.21.11"`), and reading only
 * commas turns a two-sided range into one unparseable term that nothing satisfies.
 */
export function satisfies(installed: string, predicate: string[]): boolean {
  const version = semver(installed);

  return predicate.some((alternative) =>
    alternative
      .split(/[\s,]+/)
      .filter((term) => term.length > 0)
      .every((term) => matchesTerm(version, term, installed)),
  );
}

// ---------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------

/**
 * Every id the installed set makes available, at the version the loader would use.
 *
 * The same library arrives bundled inside several mods at once - MixinExtras ships inside
 * a dozen of them - and Fabric loads the newest of the copies for everybody. Taking the
 * first one read off disk instead would report the mod that wanted the newer one as
 * broken, when the newer one is exactly what it is going to get.
 */
export function providers(
  metas: readonly ModMeta[],
  environment: Environment,
  /** Skip this jar, for asking "what would be here without it?". */
  ignoreFile?: string,
): Map<string, string> {
  const provided = new Map<string, string>();

  const offer = (id: string, version: string): void => {
    const current = provided.get(id);
    if (current === undefined || newer(version, current)) provided.set(id, version);
  };

  for (const meta of [...metas, ...(environment.builtIn ?? [])]) {
    if (ignoreFile && meta.fileName === ignoreFile) continue;

    offer(meta.id, meta.version);
    for (const id of meta.provides) offer(id, meta.version);
  }

  // The loader and the game are not jars in the folder, but every mod depends on them.
  provided.set('minecraft', environment.minecraft);
  provided.set('fabricloader', environment.loader);
  provided.set('fabric-loader', environment.loader);
  provided.set('java', String(environment.java));

  return provided;
}

/** True when `a` is a later version than `b`. Unparseable versions never win. */
export function newer(a: string, b: string): boolean {
  const left = semver(a);
  const right = semver(b);

  if (!left) return false;
  if (!right) return true;

  return compare(left, right) > 0;
}

/**
 * Reports every hard requirement the installed set does not meet.
 *
 * Only `depends` and `breaks` are considered: those are the two the loader treats as
 * fatal. `recommends`, `suggests` and `conflicts` produce a log line in-game at worst,
 * and refusing to launch over them would be stricter than Minecraft itself.
 */
export function auditMods(metas: readonly ModMeta[], environment: Environment): Conflict[] {
  const provided = providers(metas, environment);
  const conflicts: Conflict[] = [];

  for (const meta of metas) {
    const from = `${meta.id} ${meta.version}`;

    for (const [id, predicate] of Object.entries(meta.depends)) {
      const present = provided.get(id);

      if (present === undefined) {
        conflicts.push({
          kind: 'missing',
          from,
          fileName: meta.fileName,
          target: id,
          wanted: predicate.join(' or '),
          present: null,
        });
        continue;
      }

      if (!satisfies(present, predicate)) {
        conflicts.push({
          kind: 'range',
          from,
          fileName: meta.fileName,
          target: id,
          wanted: predicate.join(' or '),
          present,
        });
      }
    }

    for (const [id, predicate] of Object.entries(meta.breaks)) {
      const present = provided.get(id);
      if (present === undefined || !satisfies(present, predicate)) continue;

      conflicts.push({
        kind: 'breaks',
        from,
        fileName: meta.fileName,
        target: id,
        wanted: predicate.join(' or '),
        present,
      });
    }
  }

  return conflicts;
}

/** One line a player can act on, rather than "exited with code 1". */
export function describe(conflict: Conflict): string {
  switch (conflict.kind) {
    case 'missing':
      return `${conflict.from} needs ${conflict.target} ${conflict.wanted}, which is not installed`;
    case 'breaks':
      return `${conflict.from} cannot run alongside ${conflict.target} ${conflict.present}`;
    default:
      return `${conflict.from} needs ${conflict.target} ${conflict.wanted}, but ${conflict.present} is installed`;
  }
}
