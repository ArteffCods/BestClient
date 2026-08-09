import fs from 'node:fs';
import path from 'node:path';

import { fetchJson } from './net';
import { dirs, exists, parseJson } from './paths';
import type { VersionJson } from './vanilla';

const FABRIC_META = 'https://meta.fabricmc.net/v2';

/**
 * Fetches the merged Fabric launch profile for a game/loader pair.
 * The returned JSON has the Fabric libraries and the Knot main class, and
 * `inheritsFrom` points at the vanilla version it must be combined with.
 */
export async function resolveFabric(minecraft: string, loader: string): Promise<VersionJson> {
  const id = `fabric-loader-${loader}-${minecraft}`;
  const target = path.join(dirs().versions, id, `${id}.json`);

  if (await exists(target)) {
    return parseJson<VersionJson>(await fs.promises.readFile(target, 'utf8'));
  }

  const url = `${FABRIC_META}/versions/loader/${encodeURIComponent(minecraft)}/${encodeURIComponent(loader)}/profile/json`;
  const json = await fetchJson<VersionJson>(url);

  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, JSON.stringify(json, null, 2), 'utf8');

  return json;
}

export interface FabricLoaderEntry {
  loader: { version: string; stable: boolean };
}

/** {@returns the newest stable loader version Fabric publishes for this game version} */
export async function latestStableLoader(minecraft: string): Promise<string | null> {
  const entries = await fetchJson<FabricLoaderEntry[]>(
    `${FABRIC_META}/versions/loader/${encodeURIComponent(minecraft)}`,
  );

  return entries.find((entry) => entry.loader.stable)?.loader.version ?? null;
}
