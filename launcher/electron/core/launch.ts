import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { BRAND } from './brand';
import type { InstallResult } from './install';
import { log } from './logger';
import { dirs, exists } from './paths';
import type { MinecraftAccount } from './store';
import { isAllowed, type LaunchArgument } from './vanilla';

export interface LaunchOptions {
  memoryMb: number;
  extraJvmArgs: string;
  /** When set, the game connects to this address straight from the main menu. */
  quickConnect?: string | null;
}

export interface LaunchHandle {
  process: ChildProcess;
  command: string[];
}

/**
 * Client-side GC tuning. The goal is a flat frame time, not raw throughput - in PvP a
 * single 200 ms pause is a missed hit, while a slightly lower average FPS is invisible.
 *
 * - `MaxGCPauseMillis=50`      target short enough to hide inside a frame budget.
 * - `G1NewSizePercent=20`      Minecraft allocates hard and dies young; a big eden keeps
 *                              collections in the cheap young generation.
 * - `MaxTenuringThreshold=1`   stops short-lived render garbage from being promoted into
 *                              the old generation, where cleaning it is far more costly.
 * - `IHOP=15`                  starts the concurrent cycle early so a mixed collection is
 *                              never forced at a bad moment.
 * - `AlwaysPreTouch`           pays for every heap page up front instead of taking page
 *                              faults mid-fight.
 * - `ParallelRefProcEnabled`   reference processing is a common long-pause contributor.
 * - `PerfDisableSharedMem`     stops the JVM writing perf counters to a memory-mapped file
 *                              in /tmp, which can stall on a busy disk.
 * - `DisableExplicitGC`        neutralises System.gc() calls from mods.
 */
const PERFORMANCE_FLAGS = [
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+UseG1GC',
  '-XX:MaxGCPauseMillis=50',
  '-XX:G1NewSizePercent=20',
  '-XX:G1MaxNewSizePercent=40',
  '-XX:G1ReservePercent=20',
  '-XX:G1HeapRegionSize=32M',
  '-XX:G1HeapWastePercent=5',
  '-XX:G1MixedGCCountTarget=4',
  '-XX:G1MixedGCLiveThresholdPercent=90',
  '-XX:G1RSetUpdatingPauseTimePercent=5',
  '-XX:InitiatingHeapOccupancyPercent=15',
  '-XX:SurvivorRatio=32',
  '-XX:MaxTenuringThreshold=1',
  '-XX:+ParallelRefProcEnabled',
  '-XX:+AlwaysPreTouch',
  '-XX:+PerfDisableSharedMem',
  '-XX:+DisableExplicitGC',
];

export function buildCommand(
  install: InstallResult,
  account: MinecraftAccount,
  options: LaunchOptions,
): string[] {
  const assetIndexId = install.vanilla.assets ?? install.vanilla.assetIndex?.id ?? 'legacy';

  const placeholders: Record<string, string> = {
    auth_player_name: account.username,
    auth_uuid: account.uuid,
    auth_access_token: account.accessToken,
    auth_xuid: '',
    clientid: '',
    user_type: 'msa',
    version_name: install.versionId,
    version_type: BRAND.name,
    game_directory: dirs().instance,
    assets_root: dirs().assets,
    assets_index_name: assetIndexId,
    natives_directory: install.nativesDir,
    launcher_name: BRAND.name.toLowerCase(),
    launcher_version: app.getVersion(),
    classpath: install.classpath.join(path.delimiter),
    classpath_separator: path.delimiter,
    library_directory: dirs().libraries,
  };

  // Inherited versions append the child's arguments after the parent's, which is how
  // Fabric gets its -Dfabric.* system properties in front of the game arguments.
  const jvmArgs = [
    ...flatten(install.vanilla.arguments?.jvm, placeholders),
    ...flatten(install.fabric.arguments?.jvm, placeholders),
  ];

  const gameArgs = [
    ...flatten(install.vanilla.arguments?.game, placeholders),
    ...flatten(install.fabric.arguments?.game, placeholders),
  ];

  // Older manifests only carry the flat string; keep the fallback so the launcher does
  // not break if a future version JSON drops the structured form.
  if (jvmArgs.length === 0) {
    jvmArgs.push(
      `-Djava.library.path=${install.nativesDir}`,
      '-cp',
      install.classpath.join(path.delimiter),
    );
  }

  const memory = Math.max(1024, Math.round(options.memoryMb));

  const command = [
    // Xms == Xmx on purpose: combined with AlwaysPreTouch the whole heap is committed
    // and touched once at startup, so the JVM never grows the heap mid-fight.
    `-Xms${memory}M`,
    `-Xmx${memory}M`,
    ...PERFORMANCE_FLAGS,
    `-Dminecraft.launcher.brand=${BRAND.name.toLowerCase()}`,
    `-Dminecraft.launcher.version=${app.getVersion()}`,
    ...splitExtraArgs(options.extraJvmArgs),
    ...jvmArgs,
    install.mainClass,
    ...gameArgs,
  ];

  if (options.quickConnect) {
    command.push('--quickPlayMultiplayer', options.quickConnect);
  }

  return command;
}

export async function launchGame(
  install: InstallResult,
  account: MinecraftAccount,
  options: LaunchOptions,
  onLog: (line: string) => void,
  onExit: (code: number | null) => void,
): Promise<LaunchHandle> {
  const command = buildCommand(install, account, options);

  // java.exe rather than javaw.exe: javaw detaches from the console and we would lose
  // the game log. windowsHide keeps the console window itself invisible.
  const javaExe = path.join(path.dirname(install.javaPath), 'java.exe');
  const executable = (await exists(javaExe)) ? javaExe : install.javaPath;

  log.info(`Launching ${install.versionId} as ${account.username}`);

  const child = spawn(executable, command, {
    cwd: dirs().instance,
    windowsHide: true,
  });

  // Above-normal keeps the render thread ahead of background work (updaters, browsers)
  // when the CPU is contended. Deliberately not HIGH: starving the OS input and audio
  // threads makes the game feel worse, not better.
  if (child.pid) {
    try {
      os.setPriority(child.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL);
      log.info('Raised the game process priority to above-normal.');
    } catch (error) {
      log.warn('Could not raise the game process priority.', error);
    }
  }

  const pump = (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (line.trim()) onLog(line);
    }
  };

  child.stdout?.on('data', pump);
  child.stderr?.on('data', pump);

  child.on('error', (error) => {
    log.error('Failed to start the game process.', error);
    onLog(`[launcher] A játék indítása sikertelen: ${error.message}`);
    onExit(null);
  });

  child.on('exit', (code) => {
    log.info(`Game process exited with code ${code}`);
    onExit(code);
  });

  return { process: child, command };
}

function flatten(args: LaunchArgument[] | undefined, placeholders: Record<string, string>): string[] {
  if (!args) return [];

  const result: string[] = [];

  for (const argument of args) {
    if (typeof argument === 'string') {
      result.push(substitute(argument, placeholders));
      continue;
    }

    // Feature-gated arguments (demo mode, custom resolution) stay off.
    if (!isAllowed(argument.rules, {})) continue;

    const values = Array.isArray(argument.value) ? argument.value : [argument.value];

    for (const value of values) {
      result.push(substitute(value, placeholders));
    }
  }

  return result;
}

function substitute(value: string, placeholders: Record<string, string>): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, key: string) => placeholders[key] ?? match);
}

function splitExtraArgs(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}
