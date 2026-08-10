import fs from 'node:fs';
import path from 'node:path';

import { resourcePackList } from './content';
import { log } from './logger';
import { dirs, exists } from './paths';

/**
 * The PvP baseline. Everything here is chosen for frame time and input latency, or to
 * remove a visual effect that hides an opponent:
 *
 * - `enableVsync:false`    - vsync adds up to a full frame of input lag.
 * - `bobView:false`        - view bobbing moves the crosshair while sprinting.
 * - `screenEffectScale:0`  - kills the nausea/portal warp overlay.
 * - `fovEffectScale:0`     - stops the FOV from jumping when speed effects apply.
 * - `particles:2`          - "minimal": explosion and potion particles stop blocking sight.
 * - `entityShadows:false`  - measurable in crowded fights.
 * - `graphicsMode:0`       - "fast": no fancy transparency or leaves.
 * - `fov:1.0`              - the maximum field of view; more of the arena on screen.
 * - `toggleSprint:false`   - hold to sprint, so sprint state is never a surprise.
 *
 * `resourcePacks` lists the packs the client ships with, lowest priority first - the order
 * Minecraft reads, where a later entry wins. The files themselves are installed before
 * this is written, because a pack the game cannot find is dropped from the list on the
 * first launch and the player would have to re-pick every one of them.
 */
const PVP_DEFAULTS: Record<string, string> = {
  renderDistance: '8',
  simulationDistance: '8',
  maxFps: '260',
  enableVsync: 'false',
  graphicsMode: '0',
  ao: 'true',
  particles: '2',
  entityShadows: 'false',
  bobView: 'false',
  screenEffectScale: '0.0',
  fovEffectScale: '0.0',
  darknessEffectScale: '0.0',
  guiScale: '2',
  autoJump: 'false',
  attackIndicator: '1',
  fov: '1.0',
  gamma: '0.0',
  fullscreen: 'true',
  toggleCrouch: 'false',
  toggleSprint: 'false',
  resourcePacks: resourcePackList(),
  incompatibleResourcePacks: '[]',
};

export interface OptionsResult {
  created: boolean;
  applied: string[];
}

/**
 * Merges the PvP baseline into `instance/options.txt`.
 *
 * By default only keys the player has never set are written, so tweaks made in-game
 * survive. Pass `force` to push every value back to the baseline.
 */
export async function applyPvpDefaults(force = false): Promise<OptionsResult> {
  const file = path.join(dirs().instance, 'options.txt');
  await fs.promises.mkdir(path.dirname(file), { recursive: true });

  const existed = await exists(file);
  const current = existed ? parseOptions(await fs.promises.readFile(file, 'utf8')) : new Map<string, string>();
  const applied: string[] = [];

  for (const [key, value] of Object.entries(PVP_DEFAULTS)) {
    if (!force && current.has(key)) continue;
    if (current.get(key) === value) continue;

    current.set(key, value);
    applied.push(key);
  }

  if (applied.length > 0 || !existed) {
    const body = [...current.entries()].map(([key, value]) => `${key}:${value}`).join('\n');
    await fs.promises.writeFile(file, `${body}\n`, 'utf8');
    log.info(`options.txt updated (${applied.length} key(s)).`);
  }

  return { created: !existed, applied };
}

function parseOptions(raw: string): Map<string, string> {
  const result = new Map<string, string>();

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;

    result.set(line.slice(0, separator), line.slice(separator + 1));
  }

  return result;
}
