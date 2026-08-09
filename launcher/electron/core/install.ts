import path from 'node:path';

import { TARGET } from './brand';
import { resolveFabric } from './fabric';
import { ensureJava } from './java';
import { log } from './logger';
import { loadPack, resolveMods, syncMods } from './modpack';
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
import { downloadAll } from './net';

export interface InstallProgress {
  step: number;
  steps: number;
  /** 0-100 across the whole install. */
  percent: number;
  label: string;
  detail: string;
}

export type InstallProgressFn = (progress: InstallProgress) => void;

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
}

const STEPS = [
  'Java futtatókörnyezet',
  'Verzióadatok',
  'Könyvtárak',
  'Játék assetek',
  'Natives',
  'Modok',
  'Kliens beállítások',
] as const;

/**
 * Brings the whole client up to date: Java, Minecraft, Fabric, the mod pack, the
 * pinned server entry and the PvP options baseline.
 */
export async function installClient(onProgress?: InstallProgressFn): Promise<InstallResult> {
  await ensureDirs();

  const settings = readSettings();
  const pack = await loadPack();

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
  emit(1, 'Java ellenőrzése');
  const javaPath = await ensureJava(relay(1));

  // 2 - version metadata
  emit(2, `Minecraft ${pack.minecraft}`);
  const vanilla = await resolveVanilla(pack.minecraft);
  emit(2, `Fabric Loader ${pack.loaderVersion}`, 0.5);
  const fabric = await resolveFabric(pack.minecraft, pack.loaderVersion);
  await installClientJar(vanilla, relay(2));

  // 3 - libraries (Fabric first so the loader wins on the classpath)
  const libraries = resolveLibraries([fabric, vanilla]);
  emit(3, `${libraries.tasks.length} könyvtár`);
  await downloadAll(libraries.tasks, 'Könyvtárak', relay(3), 8);

  // 4 - assets
  emit(4, 'Assetek ellenőrzése');
  await installAssets(vanilla, relay(4));

  // 5 - natives
  emit(5, 'Natives kicsomagolása');
  const nativesDir = await extractNatives(pack.minecraft, libraries.nativeJars);

  // 6 - mods
  emit(6, 'Modok feloldása a Modrinthről');
  const resolved = await resolveMods(pack, settings.enabledMods);
  await syncMods(resolved.mods, relay(6));

  // 7 - client configuration
  emit(7, 'Szerverlista és beállítások');
  const servers = await ensureLockedServer(!settings.seededSuggestedServer);
  const options = await applyPvpDefaults(!settings.appliedPvpDefaults);

  writeSettings({
    seededSuggestedServer: settings.seededSuggestedServer || servers.seeded,
    appliedPvpDefaults: true,
  });

  emit(7, 'Kész', 1);
  log.info(
    `Install complete: ${resolved.mods.length} mod, servers.dat restored=${servers.restored}, ` +
      `options.txt keys=${options.applied.length}`,
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
  };
}

export { TARGET };
