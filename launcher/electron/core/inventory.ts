import fs from 'node:fs';
import path from 'node:path';

import { bundledInfo } from './bundled';
import { log } from './logger';
import { readStoreManifest, removeInstalledMod } from './market';
import { loadPack, NVIDIA_MODS, readManagedManifest } from './modpack';
import { dirs } from './paths';
import { readSettings, writeSettings } from './store';
import type { InventoryMod } from '../shared';

/**
 * The single, honest list of what is actually in `instance/mods`.
 *
 * Three things can put a jar there and the Mods screen has to show all three, otherwise
 * installing from the store or dropping a file in looks like it did nothing:
 *
 *  - `pack`  - the client's own mods, resolved from the pack file on every launch.
 *  - `store` - installed by the player from Modrinth, tracked in the store manifest.
 *  - `local` - dropped in by hand; the launcher never touches these on its own.
 *
 * Pack mods are turned on and off through the stored selection (the installer then adds
 * or removes the jar). Store and local mods are switched by renaming the file: Fabric
 * only loads `.jar`, so `.jar.disabled` is off without deleting anything.
 */

const DISABLED_SUFFIX = '.disabled';

/** Guards every path built from a stored file name against escaping the mods folder. */
function modFile(fileName: string): string {
  const modsDir = dirs().mods;
  const resolved = path.resolve(modsDir, path.basename(fileName));

  if (!resolved.startsWith(path.resolve(modsDir) + path.sep)) {
    throw new Error(`Refusing to touch a file outside the mods folder: ${fileName}`);
  }

  return resolved;
}

async function listJarFiles(): Promise<string[]> {
  try {
    return (await fs.promises.readdir(dirs().mods)).filter(
      (name) =>
        !name.startsWith('.') &&
        (name.toLowerCase().endsWith('.jar') ||
          name.toLowerCase().endsWith(`.jar${DISABLED_SUFFIX}`)),
    );
  } catch {
    return [];
  }
}

const baseName = (fileName: string): string =>
  fileName.endsWith(DISABLED_SUFFIX) ? fileName.slice(0, -DISABLED_SUFFIX.length) : fileName;

/** Turns "sodium-fabric-0.6.13.jar" into "sodium fabric 0.6.13" for a readable row. */
function prettyName(fileName: string): string {
  return baseName(fileName)
    .replace(/\.jar$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

export async function listInventory(): Promise<InventoryMod[]> {
  const [pack, store, managed, files, bundled] = await Promise.all([
    loadPack(),
    readStoreManifest(),
    readManagedManifest(),
    listJarFiles(),
    bundledInfo(),
  ]);

  const settings = readSettings();
  const removed = new Set(settings.removedMods);
  const enabled = new Set(settings.enabledMods);
  const present = new Set(files);

  const rows: InventoryMod[] = [];

  // 0 - BestClient's own mods. They ship inside the launcher, are verified against a
  // hash stamped at build time, and cannot be switched off or deleted.
  const bundledFiles = new Set<string>();

  for (const mod of bundled) {
    bundledFiles.add(mod.fileName);

    rows.push({
      id: `client:${mod.id}`,
      name: mod.name,
      note: mod.note,
      source: 'client',
      locked: true,
      enabled: present.has(mod.fileName),
      iconUrl: '/logo.png',
      fileName: mod.fileName,
    });
  }

  // 1 - the pack's mods, resolved from Modrinth on every launch.
  const versionBySlug = new Map<string, string>();

  for (const entry of Object.values(managed)) {
    if (entry.slug && entry.version) versionBySlug.set(entry.slug, entry.version);
  }

  for (const mod of pack.mods) {
    if (removed.has(mod.slug)) continue;
    // The NVIDIA-optimization mod is not a player choice - the Settings switch is the
    // only control, so it never shows up as a row that could disagree with the switch.
    if ((NVIDIA_MODS as readonly string[]).includes(mod.slug)) continue;

    rows.push({
      id: mod.slug,
      slug: mod.slug,
      name: mod.name,
      note: mod.note,
      source: 'pack',
      locked: mod.locked,
      enabled: mod.locked || enabled.has(mod.slug),
      iconUrl: mod.iconUrl,
      // The build actually on disk, straight from the install manifest.
      version: versionBySlug.get(mod.slug),
    });
  }

  // 2 - mods the player installed from the store.
  const storeFiles = new Set<string>();

  for (const [slug, entry] of Object.entries(store)) {
    storeFiles.add(entry.fileName);
    storeFiles.add(`${entry.fileName}${DISABLED_SUFFIX}`);

    rows.push({
      id: `store:${slug}`,
      slug,
      name: entry.title?.trim() || prettyName(entry.fileName),
      note: `Installed from Modrinth · ${entry.version}`,
      source: 'store',
      locked: false,
      enabled: present.has(entry.fileName),
      iconUrl: entry.iconUrl,
      fileName: entry.fileName,
      version: entry.version,
    });
  }

  // 3 - anything else in the folder is the player's own file.
  const managedFiles = new Set(Object.values(managed).map((entry) => entry.fileName));

  for (const fileName of files) {
    const bare = baseName(fileName);
    if (managedFiles.has(bare) || bundledFiles.has(bare)) continue;
    if (storeFiles.has(fileName) || storeFiles.has(bare)) continue;

    rows.push({
      id: `file:${bare}`,
      name: prettyName(fileName),
      note: 'Added by hand · must still be published on Modrinth to launch',
      source: 'local',
      locked: false,
      enabled: !fileName.endsWith(DISABLED_SUFFIX),
      fileName: bare,
    });
  }

  return rows;
}

/** Renames a jar between its live and disabled names. Missing files are not an error. */
async function setFileEnabled(fileName: string, next: boolean): Promise<void> {
  const live = modFile(fileName);
  const off = `${live}${DISABLED_SUFFIX}`;
  const from = next ? off : live;
  const to = next ? live : off;

  try {
    await fs.promises.rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

export async function setModEnabled(id: string, next: boolean): Promise<void> {
  // BestClient's own mods are not optional; the UI hides the switch, and the main process
  // refuses as well so a crafted IPC message cannot turn them off either.
  if (id.startsWith('client:')) return;

  if (id.startsWith('store:') || id.startsWith('file:')) {
    const rows = await listInventory();
    const row = rows.find((entry) => entry.id === id);

    if (!row?.fileName) return;

    await setFileEnabled(row.fileName, next);
    log.info(`${next ? 'Enabled' : 'Disabled'} ${row.fileName}.`);
    return;
  }

  const settings = readSettings();
  const enabled = new Set(settings.enabledMods);

  if (next) enabled.add(id);
  else enabled.delete(id);

  writeSettings({ enabledMods: [...enabled] });
}

export async function deleteMod(id: string): Promise<void> {
  if (id.startsWith('client:')) return;

  if (id.startsWith('store:')) {
    await removeInstalledMod(id.slice('store:'.length));
    return;
  }

  if (id.startsWith('file:')) {
    const fileName = id.slice('file:'.length);
    await fs.promises.rm(modFile(fileName), { force: true });
    await fs.promises.rm(`${modFile(fileName)}${DISABLED_SUFFIX}`, { force: true });
    log.info(`Deleted ${fileName} from the mods folder.`);
    return;
  }

  // A pack mod: remember the choice. It stays in `knownMods`, so the next reconcile does
  // not re-adopt its default, and the installer deletes the jar as stale on the next run.
  const settings = readSettings();

  writeSettings({
    removedMods: [...new Set([...settings.removedMods, id])],
    enabledMods: settings.enabledMods.filter((slug) => slug !== id),
  });
}
