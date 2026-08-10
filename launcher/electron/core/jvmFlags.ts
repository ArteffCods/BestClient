import os from 'node:os';

import { checkJvmFlags } from './hardening';
import { log } from './logger';

/**
 * The JVM flag set the game starts with.
 *
 * It lives in its own module because three places need it and none of them should have to
 * import the launcher: the launch command builds from it, the settings screen shows it,
 * and the settings store falls back to it when the player has not overridden anything.
 *
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
 * - `ParallelRefProcEnabled`   reference processing is a common long-pause contributor.
 * - `PerfDisableSharedMem`     stops the JVM writing perf counters to a memory-mapped file
 *                              in /tmp, which can stall on a busy disk.
 * - `DisableExplicitGC`        neutralises System.gc() calls from mods.
 *
 * Deliberately absent: `AlwaysPreTouch` (commits the whole heap at startup - the exact
 * opposite of a fast launch) and `UseNUMA` (not supported on Windows). With
 * `Xms == Xmx` the JVM still reserves the full heap up front, only the page-touching
 * step is skipped, so frame-time stability stays while booting gets no slower.
 * `IgnoreUnrecognizedVMOptions` keeps the same flag set launchable on every JVM build.
 */
export const PERFORMANCE_FLAGS = [
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
  '-XX:+PerfDisableSharedMem',
  '-XX:+DisableExplicitGC',
  // Peak-throughput / faster-warmup flags.
  // - AlwaysActAsServerClassMachine   forces the C2 (server) JIT even on machines the JVM
  //                                   would otherwise treat as "client", for higher peak FPS.
  // - ReservedCodeCacheSize=400M      a heavily modded client JITs a lot of code; a bigger
  //                                   cache stops it flushing and re-compiling mid-session.
  // - DontCompileHugeMethods off      lets the JIT compile the large methods mixins produce.
  // - UseFMA                          use fused-multiply-add where the CPU supports it.
  // - TieredCompilation               keep full tiered JIT.
  '-XX:+AlwaysActAsServerClassMachine',
  '-XX:ReservedCodeCacheSize=400M',
  '-XX:-DontCompileHugeMethods',
  '-XX:+UseFMA',
  '-XX:+TieredCompilation',
  // Cheaper timestamp source and class-data sharing both trim JVM startup time.
  '-XX:+UseFastUnorderedTimeStamps',
  '-Xshare:auto',
  '-XX:+IgnoreUnrecognizedVMOptions',
  '-Dfile.encoding=UTF-8',
] as const;

/**
 * The flags exactly as the launcher would use them on this machine.
 *
 * `-Xms`/`-Xmx` are not in here: they come from the memory slider, which stays the single
 * place heap size is decided. Everything else is fair game for the player to edit.
 */
export function defaultJvmFlags(): string[] {
  return [
    ...PERFORMANCE_FLAGS,
    // Let the JIT and GC use every logical core on the machine.
    `-XX:ActiveProcessorCount=${Math.max(1, os.cpus().length)}`,
  ];
}

/** Splits an edited flag block on any whitespace, tolerating blank lines and stray spaces. */
export function splitFlags(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * The flags a launch uses: the tuned set, then whatever the player added.
 *
 * The defaults are not editable. They were chosen against frame time, and a launcher that
 * lets them be rewritten spends its life explaining why someone's game stutters. What the
 * player adds goes after them, so a later flag still wins where the JVM takes the last
 * occurrence - the whole set stays reachable without any of it being removable.
 *
 * Additions are filtered here, not only when the box is saved: the settings file can be
 * edited by hand, so the gate has to sit where the command line is actually built.
 */
export function resolveJvmFlags(extra: string): string[] {
  const { safe, rejected } = checkJvmFlags(splitFlags(extra));

  for (const entry of rejected) {
    log.warn(`Refused JVM flag ${entry.flag}: it ${entry.why}.`);
  }

  return [...defaultJvmFlags(), ...safe];
}
