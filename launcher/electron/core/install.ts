import path from 'node:path';

import { TARGET } from './brand';
import { resolveFabric } from './fabric';
import { ensureJava } from './java';
import { log } from './logger';
import { loadPack, reconcileSelection, resolveMods, syncMods } from './modpack';
import type { ProgressReport } from './net';
import { applyPvpDefaults } from './options';
import { dirs, ensureDirs } from './paths';
import { ensureLockedServer } from './servers';
import { readSettings, writeSettings } from './store';
import {
  extractNatives,
  installAssets,
  installClientJar,
  resolveLibraries,
  resolveVanilla,
  type VersionJson,
} from './vanilla';
import { downloadAll, type VerifyMode } from './net';

export interface InstallProgress {
  step: number;
  steps: number;
  /** 0-100 across the whole install. */
  percent: number;
  label: string;
  detail: string;
}

export type InstallProgressFn = (progress: InstallProgress) => void;

export interface InstallOptions {
  /**
   * Re-hash every existing file instead of trusting its size. Slow (reads the whole
   * install) and only meant for the explicit "verify and repair" action.
   */
  repair?: boolean;
}

export interface InstallResult {
  javaPath: string;
  versionId: string;
  mainClass: string;
  classpath: string[];
  nativesDir: string;
  vanilla: VersionJson;
  fabric: VersionJson;
  /** Mods with no build for the target Minecraft version - shown as a warning in the UI. */
  unavailableMods: string[];
  /** Libraries pulled in automatically to satisfy other mods' hard requirements. */
  dependencies: string[];
}

const STEPS = [
  'Java runtime',
  'Version metadata',
  'Libraries',
  'Game assets',
  'Natives',
  'Mods',
  'Client configuration',
] as const;

/**
 * Brings the whole client up to date: Java, Minecraft, Fabric, the mod pack, the
 * pinned server entry and the PvP options baseline.
 */
export async function installClient(
  onProgress?: InstallProgressFn,
  options: InstallOptions = {},
): Promise<InstallResult> {
  await ensureDirs();

  const pack = await loadPack();
  const verify: VerifyMode = options.repair ? 'hash' : 'size';

  // Fold the current pack into the stored selection here rather than relying on the UI
  // having opened the settings first — the install must be correct on its own.
  const stored = readSettings();
  const settings = {
    ...stored,
    ...writeSettings(reconcileSelection(pack, stored.enabledMods, stored.knownMods)),
  };

  const emit = (step: number, detail: string, fraction = 0) => {
    const label = STEPS[step - 1] ?? '';
    const percent = Math.min(100, Math.round(((step - 1 + fraction) / STEPS.length) * 100));
    onProgress?.({ step, steps: STEPS.length, percent, label, detail });
  };

  const relay = (step: number) => (report: ProgressReport) => {
    const fraction = report.total > 0 ? report.done / report.total : 0;
    emit(step, `${report.label} (${report.done}/${report.total})`, fraction);
  };

  // 1 - Java 21
  emit(1, 'Checking Java');
  const javaPath = await ensureJava(relay(1));

  // 2 - version metadata
  emit(2, `Minecraft ${pack.minecraft}`);
  const vanilla = await resolveVanilla(pack.minecraft);
  emit(2, `Fabric Loader ${pack.loaderVersion}`, 0.5);
  const fabric = await resolveFabric(pack.minecraft, pack.loaderVersion);
  await installClientJar(vanilla, relay(2), verify);

  // 3 - libraries (Fabric first so the loader wins on the classpath)
  const libraries = resolveLibraries([fabric, vanilla], verify);
  emit(3, `${libraries.tasks.length} libraries`);
  await downloadAll(libraries.tasks, 'Libraries', relay(3), 8);

  // 4 - assets
  emit(4, 'Verifying assets');
  await installAssets(vanilla, relay(4), verify);

  // 5 - natives
  emit(5, 'Extracting natives');
  const nativesDir = await extractNatives(pack.minecraft, libraries.nativeJars);

  // 6 - mods
  emit(6, 'Resolving mods from Modrinth');
  const resolved = await resolveMods(pack, settings.enabledMods);
  await syncMods(resolved.mods, relay(6), verify);

  // 7 - client configuration
  emit(7, 'Server list and settings');
  const servers = await ensureLockedServer();
  const gameOptions = await applyPvpDefaults(!settings.appliedPvpDefaults);

  writeSettings({ appliedPvpDefaults: true });

  emit(7, 'Done', 1);
  log.info(
    `Install complete: ${resolved.mods.length} mod (${resolved.dependencies.length} dependency), ` +
      `servers.dat restored=${servers.restored}, options.txt keys=${gameOptions.applied.length}`,
  );

  const clientJar = path.join(dirs().versions, vanilla.id, `${vanilla.id}.jar`);

  return {
    javaPath,
    versionId: fabric.id,
    mainClass: fabric.mainClass,
    classpath: [...libraries.classpath, clientJar],
    nativesDir,
    vanilla,
    fabric,
    unavailableMods: resolved.unavailable,
    dependencies: resolved.dependencies,
  };
}

export { TARGET };
