import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
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
 * Client-side GC tuning. The goal is a flat frame time rather than raw throughput:
 * a 50 ms pause target with G1 keeps collections short enough that they do not show
 * up as a dropped hit, and pre-touching the heap avoids page faults mid-fight.
 */
const PERFORMANCE_FLAGS = [
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+UseG1GC',
  '-XX:G1NewSizePercent=20',
  '-XX:G1ReservePercent=20',
  '-XX:MaxGCPauseMillis=50',
  '-XX:G1HeapRegionSize=32M',
  '-XX:+ParallelRefProcEnabled',
  '-XX:+AlwaysPreTouch',
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
    `-Xms${Math.min(memory, 1024)}M`,
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
