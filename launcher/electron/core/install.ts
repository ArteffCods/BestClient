import path from 'node:path';

import { TARGET } from './brand';
import { ensureBundledMods, loadBundledMods } from './bundled';
import { applyShaderDefaults, ensureContent } from './content';
import { resolveNvidiaOptimize } from './gpu';
import { resolveFabric } from './fabric';
import { ensureJava } from './java';
import { describe, readBundledLibraries } from './deps';
import { log } from './logger';
import {
  loadPack,
  NVIDIA_MODS,
  reconcileInstalled,
  reconcileSelection,
  resolveMods,
  syncMods,
  type Repair,
} from './modpack';
import type { ProgressReport } from './net';
import { applyPvpDefaults } from './options';
import { profile } from './profiles';
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
  /** Mods held back a build so the set loads together. */
  repairs: Repair[];
  /** Requirements the installed set still does not meet, in plain words. */
  conflicts: string[];
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
  const pruned = await ensureDirs();

  if (pruned.length > 0) {
    log.info(`Cleared game directories no version uses any more: ${pruned.join(', ')}.`);
  }

  const pack = await loadPack();
  const verify: VerifyMode = options.repair ? 'hash' : 'size';

  // Fold the current pack into the stored selection here rather than relying on the UI
  // having opened the settings first — the install must be correct on its own.
  const stored = readSettings();
  const settings = {
    ...stored,
    ...writeSettings(reconcileSelection(pack, stored.enabledMods, stored.knownMods)),
  };

  // NVIDIA optimization joins (or leaves) the pack as one switch, decided from the GPU
  // on the player's first run. When it is on, Nvidium is force-enabled here regardless
  // of what the Mods list says - it is not listed there at all.
  const enabled = new Set(settings.enabledMods);

  if (await resolveNvidiaOptimize()) {
    for (const slug of NVIDIA_MODS) enabled.add(slug);
  }

  const emit = (step: number, detail: string, fraction = 0) => {
    const label = STEPS[step - 1] ?? '';
    const percent = Math.min(100, Math.round(((step - 1 + fraction) / STEPS.length) * 100));
    onProgress?.({ step, steps: STEPS.length, percent, label, detail });
  };

  const relay = (step: number) => (report: ProgressReport) => {
    const fraction = report.total > 0 ? report.done / report.total : 0;
    emit(step, `${report.label} (${report.done}/${report.total})`, fraction);
  };

  // 1 - Java. The manifest says the least the game will accept and the profile says what
  // the launcher would rather use; the higher wins. Running above the minimum is normal -
  // the game's own classes are built for an older release either way - and it keeps one
  // runtime on disk instead of one per version.
  emit(1, 'Checking Java');
  const vanillaEarly = await resolveVanilla(pack.minecraft);
  const required = vanillaEarly.javaVersion?.majorVersion ?? 0;
  const javaMajor = Math.max(required, profile(settings.activeProfile).javaMajor);
  log.info(`Minecraft ${pack.minecraft} needs Java ${required || '?'}; using ${javaMajor}.`);
  const javaPath = await ensureJava(javaMajor, relay(1));

  // 2 - version metadata
  emit(2, `Minecraft ${pack.minecraft}`);
  const vanilla = vanillaEarly;
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
  const resolved = await resolveMods(pack, [...enabled], settings.pinnedVersions);
  await syncMods(resolved.mods, relay(6), verify);

  // BestClient's own mods go in last and are re-checked against their stamped hash every
  // launch, so they cannot be removed or swapped out from under the player.
  const expected = await loadBundledMods();
  const bundled = await ensureBundledMods();

  // Required, not best-effort. If a mod this build ships could not be put in place - the
  // jar is missing, or it failed its hash - the client is not the client any more, and
  // starting it anyway would hand the player something the server has no reason to trust.
  if (bundled.length < expected.length) {
    const missing = expected
      .filter((entry) => !bundled.some((installed) => installed.id === entry.id))
      .map((entry) => entry.name);

    throw new Error(
      `${missing.join(', ')} could not be installed or failed its integrity check. ` +
        'BestClient will not start without it - reinstall the launcher.',
    );
  }

  // With every jar on disk, read what they demand of each other. Two mods can both be at
  // their newest build and still refuse to load together, and the loader's answer to that
  // is to stop during startup - which reaches the player as "exited with code 1" and
  // nothing else. Anything solvable is solved here; anything left is at least named.
  emit(6, 'Checking mods against each other', 1);
  const loaderJar = libraries.classpath.find((entry) =>
    path.basename(entry).startsWith('fabric-loader-'),
  );

  const health = await reconcileInstalled(pack, resolved.mods, {
    minecraft: pack.minecraft,
    loader: pack.loaderVersion,
    java: javaMajor,
    builtIn: loaderJar ? readBundledLibraries(loaderJar) : [],
  });

  for (const repair of health.repairs) {
    log.info(`Held ${repair.slug} at ${repair.to} instead of ${repair.from}: ${repair.because}.`);
  }

  for (const conflict of health.unresolved) {
    log.warn(`Unresolved: ${describe(conflict)}.`);
  }

  // 7 - client configuration
  emit(7, 'Resource packs and shader');

  // Before options.txt on purpose: a pack the game cannot find when it starts is dropped
  // from the list, and the player would have to pick every one of them again by hand.
  await ensureContent(pack);

  emit(7, 'Server list and settings');
  const servers = await ensureLockedServer();
  const gameOptions = await applyPvpDefaults(pack, !settings.appliedPvpDefaults);
  await applyShaderDefaults(pack, !settings.appliedPvpDefaults);

  writeSettings({ appliedPvpDefaults: true });

  emit(7, 'Done', 1);
  log.info(
    `Install complete: ${resolved.mods.length} mod (${resolved.dependencies.length} dependency, ` +
      `${bundled.length} bundled), servers.dat restored=${servers.restored}, ` +
      `options.txt keys=${gameOptions.applied.length}`,
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
    repairs: health.repairs,
    conflicts: health.unresolved.map(describe),
  };
}

export { TARGET };
