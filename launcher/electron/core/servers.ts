import fs from 'node:fs';
import path from 'node:path';

import { LOCKED_SERVER, REMOVED_SERVERS } from './brand';
import { log } from './logger';
import { readNbt, TAG, writeNbt, type NbtCompound, type NbtRoot, type NbtTag } from './nbt';
import { dirs, exists } from './paths';

export interface ServersResult {
  /** True when the pinned entry was missing or misplaced and had to be written back. */
  restored: boolean;
  /** True when a delisted address (e.g. bestpvp.hu) was stripped on this run. */
  removed: boolean;
  total: number;
}

/**
 * Guarantees that `instance/servers.dat` starts with the pinned BestPvP entry.
 *
 * This runs before every launch, so deleting the entry in-game only lasts until the
 * next start. Blocking the delete button while the game is running would need a
 * client mod - see README.
 */
export async function ensureLockedServer(): Promise<ServersResult> {
  const file = path.join(dirs().instance, 'servers.dat');
  await fs.promises.mkdir(path.dirname(file), { recursive: true });

  const root = await readServersFile(file);
  const list = compoundList(root);

  let restored = false;
  const lockedIndex = indexOfAddress(list, LOCKED_SERVER.address);

  if (lockedIndex === -1) {
    list.unshift(serverEntry(LOCKED_SERVER.name, LOCKED_SERVER.address));
    restored = true;
  } else {
    if (lockedIndex !== 0) {
      const [entry] = list.splice(lockedIndex, 1);
      if (entry) list.unshift(entry);
      restored = true;
    }

    const first = list[0];

    if (first && first.type === 'compound') {
      const name = first.value.name;

      if (name?.type !== 'string' || name.value !== LOCKED_SERVER.name) {
        first.value.name = { type: 'string', value: LOCKED_SERVER.name };
        restored = true;
      }
    }
  }

  // Strip delisted servers (bestpvp.hu) that older builds may have seeded, so the entry
  // does not linger in the player's list.
  let removed = false;

  for (let i = list.length - 1; i >= 0; i--) {
    const entry = list[i];
    if (entry?.type !== 'compound') continue;

    const ip = entry.value.ip;
    const host = ip?.type === 'string' ? normalize(ip.value) : '';

    if (REMOVED_SERVERS.some((address) => normalize(address) === host)) {
      list.splice(i, 1);
      removed = true;
    }
  }

  root.value.servers = { type: 'list', elementType: TAG.Compound, value: list };
  await fs.promises.writeFile(file, writeNbt(root));

  if (restored) {
    log.info(`Restored the pinned ${LOCKED_SERVER.address} entry in servers.dat.`);
  }
  if (removed) {
    log.info('Removed a delisted server entry from servers.dat.');
  }

  return { restored, removed, total: list.length };
}

/** {@returns the server list as the launcher UI shows it} */
export async function readServerList(): Promise<{ name: string; address: string; locked: boolean }[]> {
  const file = path.join(dirs().instance, 'servers.dat');

  if (!(await exists(file))) return [];

  const root = await readServersFile(file);

  return compoundList(root).flatMap((entry) => {
    if (entry.type !== 'compound') return [];

    const name = entry.value.name;
    const ip = entry.value.ip;
    const address = ip?.type === 'string' ? ip.value : '';

    return [
      {
        name: name?.type === 'string' ? name.value : address,
        address,
        locked: normalize(address) === normalize(LOCKED_SERVER.address),
      },
    ];
  });
}

async function readServersFile(file: string): Promise<NbtRoot> {
  if (!(await exists(file))) {
    return { name: '', value: {} };
  }

  try {
    return readNbt(await fs.promises.readFile(file));
  } catch (error) {
    // Never silently throw away the player's list: keep the unreadable file around.
    const backup = `${file}.corrupt-${Date.now()}`;
    await fs.promises.rename(file, backup).catch(() => undefined);
    log.warn(`servers.dat could not be parsed, moved to ${path.basename(backup)}.`, error);

    return { name: '', value: {} };
  }
}

function compoundList(root: NbtRoot): NbtTag[] {
  const servers = root.value.servers;
  return servers?.type === 'list' ? servers.value : [];
}

function serverEntry(name: string, address: string): NbtTag {
  const value: NbtCompound = {
    name: { type: 'string', value: name },
    ip: { type: 'string', value: address },
    hidden: { type: 'byte', value: 0 },
  };

  return { type: 'compound', value };
}

function indexOfAddress(list: readonly NbtTag[], address: string): number {
  const wanted = normalize(address);

  return list.findIndex((entry) => {
    if (entry.type !== 'compound') return false;

    const ip = entry.value.ip;
    return ip?.type === 'string' && normalize(ip.value) === wanted;
  });
}

/** Lower-cases the host and strips an explicit default port so `bestpvp.eu:25565` still matches. */
function normalize(address: string): string {
  const host = address.trim().toLowerCase();
  return host.endsWith(':25565') ? host.slice(0, -':25565'.length) : host;
}
