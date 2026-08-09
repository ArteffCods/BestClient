import fs from 'node:fs';
import path from 'node:path';

import { log } from './logger';
import { sha1File } from './net';
import { dirs, exists, parseJson, resourceFile } from './paths';
import type { BundledModInfo } from '../shared';

/**
 * Mods that ship inside the launcher instead of coming from Modrinth.
 *
 * These are BestClient's own: they are not published anywhere, so the Modrinth integrity
 * check can never vouch for them. Instead the launcher carries the expected SHA-1 in
 * `resources/bundled-mods.json`, checks the packaged jar against it, and then checks the
 * copy sitting in the mods folder against the packaged jar. A tampered copy is replaced
 * on the spot, and a tampered *resource* is refused outright rather than installed.
 *
 * They cannot be switched off or deleted from the Mods screen - that is the point of them.
 */

const MANIFEST = 'bundled-mods.json';

interface RawBundled {
  id?: unknown;
  name?: unknown;
  note?: unknown;
  fileName?: unknown;
  sha1?: unknown;
}

export interface BundledMod {
  id: string;
  name: string;
  note: string;
  fileName: string;
  /** Expected SHA-1 of the packaged jar, stamped at build time. */
  sha1: string;
}

let cache: BundledMod[] | null = null;

export async function loadBundledMods(): Promise<BundledMod[]> {
  if (cache) return cache;

  try {
    const raw = parseJson<RawBundled[]>(await fs.promises.readFile(resourceFile(MANIFEST), 'utf8'));

    cache = raw
      .map((entry): BundledMod | null => {
        const fileName = typeof entry.fileName === 'string' ? path.basename(entry.fileName) : '';
        const sha1 = typeof entry.sha1 === 'string' ? entry.sha1.toLowerCase() : '';

        if (!fileName || !/^[0-9a-f]{40}$/.test(sha1)) return null;

        return {
          id: typeof entry.id === 'string' ? entry.id : fileName,
          name: typeof entry.name === 'string' ? entry.name : fileName,
          note: typeof entry.note === 'string' ? entry.note : 'Ships with BestClient.',
          fileName,
          sha1,
        };
      })
      .filter((entry): entry is BundledMod => entry !== null);
  } catch {
    // No manifest in this build - the launcher simply ships no mods of its own.
    cache = [];
  }

  return cache;
}

/**
 * Puts every bundled mod in `instance/mods` and keeps it there, byte for byte.
 * {@returns the mods that are actually installed}
 */
export async function ensureBundledMods(): Promise<BundledMod[]> {
  const entries = await loadBundledMods();
  if (entries.length === 0) return [];

  const modsDir = dirs().mods;
  await fs.promises.mkdir(modsDir, { recursive: true });

  const installed: BundledMod[] = [];

  for (const entry of entries) {
    const source = resourceFile(path.join('mods', entry.fileName));

    if (!(await exists(source))) {
      log.warn(`Bundled mod ${entry.fileName} is missing from the build; skipped.`);
      continue;
    }

    // The packaged jar must match what the build stamped. If it does not, something has
    // rewritten the installation - never copy that into the game.
    const sourceHash = await sha1File(source);

    if (sourceHash !== entry.sha1) {
      log.error(
        `Bundled mod ${entry.fileName} failed its integrity check ` +
          `(expected ${entry.sha1}, got ${sourceHash}); it was not installed.`,
      );
      continue;
    }

    const dest = path.join(modsDir, entry.fileName);
    let needsCopy = true;

    if (await exists(dest)) {
      needsCopy = (await sha1File(dest)) !== entry.sha1;
    }

    if (needsCopy) {
      await fs.promises.copyFile(source, dest);
      log.info(`Installed bundled mod ${entry.fileName}.`);
    }

    // A bundled mod cannot be switched off, so a leftover disabled twin is removed.
    await fs.promises.rm(`${dest}.disabled`, { force: true });

    installed.push(entry);
  }

  return installed;
}

/** SHA-1s the launcher trusts on its own authority, without asking Modrinth. */
export async function bundledHashes(): Promise<Set<string>> {
  return new Set((await loadBundledMods()).map((entry) => entry.sha1));
}

/** File names of the bundled jars, so the Mods screen can mark them as the client's own. */
export async function bundledInfo(): Promise<BundledModInfo[]> {
  return (await loadBundledMods()).map((entry) => ({
    id: entry.id,
    name: entry.name,
    note: entry.note,
    fileName: entry.fileName,
  }));
}
