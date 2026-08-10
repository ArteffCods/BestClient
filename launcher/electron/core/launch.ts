import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { BRAND } from './brand';
import type { InstallResult } from './install';
import { ATTACH_GUARD } from './hardening';
import { resolveJvmFlags } from './jvmFlags';
import { log } from './logger';
import { dirs, exists } from './paths';
import type { MinecraftAccount } from './store';
import { isAllowed, type LaunchArgument } from './vanilla';

export interface LaunchOptions {
  memoryMb: number;
  /**
   * The JVM flag block as edited in Settings. Empty means the launcher's own defaults,
   * which is the normal case - see `jvmFlags.ts`.
   */
  jvmFlags: string;
  /** When set, the game connects to this address straight from the main menu. */
  quickConnect?: string | null;
}

export interface LaunchHandle {
  process: ChildProcess;
  command: string[];
}

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
    // Xms == Xmx on purpose: the whole heap is reserved up front, so the JVM never
    // grows the heap mid-fight - without AlwaysPreTouch, so startup needs no page-touching.
    `-Xms${memory}M`,
    `-Xmx${memory}M`,
    // Everything else is one editable block: the launcher's tuned defaults unless the
    // player replaced them in Settings.
    ...resolveJvmFlags(options.jvmFlags),
    `-Dminecraft.launcher.brand=${BRAND.name.toLowerCase()}`,
    `-Dminecraft.launcher.version=${app.getVersion()}`,
    ...jvmArgs,
    // Last on purpose: for -XX flags the JVM takes the final occurrence, so nothing
    // earlier on the line can re-open the attach mechanism an injector needs.
    ATTACH_GUARD,
    install.mainClass,
    ...gameArgs,
    // The client always opens in fullscreen. Windowed installs are the disconnector's
    // fantasy: a windowed game loses the cursor lock the moment the mouse crosses the
    // edge, exactly when a fight starts.
    '--fullscreen',
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

  // High priority puts the game ahead of every background process (updaters, browsers,
  // Discord) when the CPU is contended, so the render thread never waits its turn.
  if (child.pid) {
    try {
      os.setPriority(child.pid, os.constants.priority.PRIORITY_HIGH);
      log.info('Raised the game process priority to high.');
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
    onLog(`[launcher] Failed to start the game: ${error.message}`);
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

