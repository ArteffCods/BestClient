import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { log } from './logger';
import type { Pack, PackContent } from './modpack';
import { downloadFile, fetchJson } from './net';
import { dirs, exists } from './paths';

/**
 * The resource packs and shaders a profile ships with.
 *
 * They are pinned to exact Modrinth versions in the pack file and fetched from there
 * rather than bundled in the installer. Three reasons, in order: the installer does not
 * grow with every pack, the download is checked against a hash recorded in the pack so a
 * swapped file is caught, and a shader its author distributes on Modrinth is linked to
 * rather than redistributed by us - which is the arrangement those licences expect.
 */

interface ModrinthVersion {
  files?: { url: string; filename: string; primary?: boolean }[];
}

/** The value options.txt wants: a JSON array, vanilla first, then each pack by file. */
export function resourcePackList(pack: Pack): string {
  const packs = pack.resourcePacks ?? [];
  return JSON.stringify(['vanilla', ...packs.map((entry) => `file/${entry.fileName}`)]);
}

/**
 * Downloads anything missing or not matching its hash.
 *
 * A pack the player deleted comes back, which is the point: these are what the profile
 * looks like. A pack they edited is replaced, because a hash mismatch cannot tell an edit
 * from a swap.
 */
export async function ensureContent(pack: Pack): Promise<void> {
  const instance = dirs().instance;

  await install(pack.resourcePacks ?? [], path.join(instance, 'resourcepacks'));
  await install(pack.shaders ?? [], path.join(instance, 'shaderpacks'));
}

async function install(entries: readonly PackContent[], folder: string): Promise<void> {
  if (entries.length === 0) return;

  await fs.promises.mkdir(folder, { recursive: true });

  for (const entry of entries) {
    const dest = path.join(folder, entry.fileName);

    // Checked here rather than inside the download, so a file that is already correct
    // costs one read and no network call - which is every launch after the first.
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
 * `enableShaders` is deliberately left off. A client that turns a shader on by itself
 * spends frames nobody asked it to spend; the shader is installed and selected, and one
 * switch in the shader menu makes it live.
 */
export async function applyShaderDefaults(pack: Pack, force: boolean): Promise<boolean> {
  const selected = pack.selectedShader ?? pack.shaders?.[0]?.fileName;

  if (!selected) return false;

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
    shaderPack: selected,
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
    const body = [...current.entries()]
      .map(([key, value]) => `${key}=${escapeProperty(value)}`)
      .join('\n');

    await fs.promises.writeFile(file, `${body}\n`, 'utf8');
    log.info(`iris.properties updated (shader: ${selected}).`);
  }

  return changed;
}

/**
 * Escapes anything outside plain ASCII as `\uXXXX`.
 *
 * A .properties file is read by Java as ISO-8859-1 unless the reader says otherwise, so a
 * UTF-8 byte written straight into it comes back as the wrong characters. Shader packs
 * routinely carry section signs in their file names - write one raw and Iris looks for a
 * pack that does not exist. The escape form is understood whatever the encoding, which is
 * exactly why Java uses it.
 */
function escapeProperty(value: string): string {
  let out = '';

  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;

    out += code > 0x7e || code < 0x20
      ? `\\u${code.toString(16).padStart(4, '0')}`
      : character;
  }

  return out;
}
