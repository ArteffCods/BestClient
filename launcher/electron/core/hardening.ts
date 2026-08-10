import fs from 'node:fs';
import path from 'node:path';

import { log } from './logger';
import { dirs } from './paths';

/**
 * The things a player can do to their own machine that would let a cheat client in, and
 * what the launcher does about each.
 *
 * None of this stops someone determined - code running on their computer is theirs. What
 * it does is close the cheap routes, so getting a cheat in means real work rather than
 * pasting a flag into a settings box, and so the launcher refuses instead of quietly
 * starting a compromised game.
 */

/**
 * JVM flags that can load code the launcher never checked.
 *
 * The settings box takes free text, which makes it the shortest path into the game if it
 * is not filtered: `-javaagent:` alone is enough to inject anything, and Fabric's own
 * `fabric.addMods` property loads jars from outside the mods folder, so the Modrinth hash
 * check would never see them.
 */
const BLOCKED_FLAGS: { pattern: RegExp; why: string }[] = [
  { pattern: /^-javaagent:/i, why: 'loads a Java agent into the game' },
  { pattern: /^-agentlib:/i, why: 'loads a native agent into the game' },
  { pattern: /^-agentpath:/i, why: 'loads a native agent into the game' },
  { pattern: /^-Xbootclasspath/i, why: 'replaces core classes before the game starts' },
  { pattern: /^--patch-module\b/i, why: 'patches classes into a module' },
  { pattern: /^-(cp|classpath)$/i, why: 'rewrites the class path' },
  { pattern: /^--class-path\b/i, why: 'rewrites the class path' },
  // Fabric and Mixin read these at startup; both can pull in code from anywhere on disk.
  { pattern: /^-Dfabric\./i, why: 'reconfigures the Fabric loader' },
  { pattern: /^-Dmixin\./i, why: 'reconfigures Mixin' },
  { pattern: /^-Dloader\./i, why: 'reconfigures the loader' },
  { pattern: /^-Djava\.security\.manager/i, why: 'changes the security manager' },
  // The launcher pins this on; letting it be turned back off would undo the guard below.
  { pattern: /^-XX:-DisableAttachMechanism$/i, why: 're-opens the JVM attach mechanism' },
];

/**
 * Closes the JVM's attach mechanism.
 *
 * This is the one that matters against an injector. A cheat like Doomsday is usually not
 * dropped into the mods folder at all - a separate process attaches to the already running
 * java.exe through the Attach API and loads itself there, which no amount of checking the
 * mods folder can see. With the mechanism off, that process has nothing to attach to.
 *
 * It goes last on the command line: for -XX flags the JVM takes the final occurrence, so
 * nothing earlier can override it.
 */
export const ATTACH_GUARD = '-XX:+DisableAttachMechanism';

export interface FlagCheck {
  safe: string[];
  /** The rejected flag and the reason, ready to show. */
  rejected: { flag: string; why: string }[];
}

export function checkJvmFlags(flags: readonly string[]): FlagCheck {
  const safe: string[] = [];
  const rejected: { flag: string; why: string }[] = [];

  for (const flag of flags) {
    const blocked = BLOCKED_FLAGS.find((entry) => entry.pattern.test(flag));

    if (blocked) {
      rejected.push({ flag, why: blocked.why });
    } else {
      safe.push(flag);
    }
  }

  return { safe, rejected };
}

/**
 * Config files another launcher leaves in a game folder it has been pointed at.
 *
 * BestClient keeps the game in its own directory rather than `.minecraft` precisely so a
 * second launcher does not land in it by accident. One of these appearing means somebody
 * aimed another launcher here deliberately - which is how the mod check gets skipped
 * entirely, because the launcher that runs the check is not the one starting the game.
 */
const FOREIGN_LAUNCHER_FILES = [
  'launcher_profiles.json',
  'launcher_accounts.json',
  'instance.cfg',
  'mmc-pack.json',
  'minecraftinstance.json',
  'profilekeys',
];

/**
 * Reports another launcher's fingerprints in the game folder.
 *
 * Be clear about what this buys: it cannot stop anyone. Someone starting the game from a
 * different launcher never runs this code. It catches the common case - a player who set a
 * second launcher onto this folder and still uses BestClient sometimes - and it turns a
 * silent bypass into something visible.
 */
export async function detectForeignLauncher(): Promise<string[]> {
  const found: string[] = [];

  for (const name of FOREIGN_LAUNCHER_FILES) {
    try {
      await fs.promises.stat(path.join(dirs().instance, name));
      found.push(name);
    } catch {
      // Absent, which is the normal case.
    }
  }

  if (found.length > 0) {
    log.warn(`Another launcher has been pointed at the game folder: ${found.join(', ')}`);
  }

  return found;
}
