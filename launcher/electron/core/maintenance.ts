import fs from 'node:fs';
import path from 'node:path';

import { log } from './logger';
import { dirs } from './paths';

/**
 * Maintenance actions for the Settings screen.
 *
 * Everything here is safe to throw away: the launcher re-creates what it needs on the
 * next launch, and the only cost is a re-download or a re-query. None of the mod packs
 * or the stored settings are touched.
 */

/** Cache files that can be regenerated: hashes, feeds, downloaded installers, natives. */
export async function clearCache(): Promise<number> {
  const d = dirs();
  const targets = [
    path.join(d.mods, '.bestclient-mod-hashes.json'),
    path.join(d.mods, '.bestclient-mod-good.json'),
    path.join(d.root, 'changelog-cache.json'),
    path.join(d.root, 'news-cache.json'),
    path.join(d.root, 'updates'),
    d.natives,
  ];

  let removed = 0;

  for (const target of targets) {
    try {
      await fs.promises.rm(target, { recursive: true, force: true });
      removed++;
    } catch (error) {
      // A cache entry that cannot be removed must never fail the whole action.
      log.warn(`Could not clear ${target}.`, error);
    }
  }

  if (removed > 0) log.info(`Cleared ${removed} cache entr${removed === 1 ? 'y' : 'ies'}.`);
  return removed;
}

/** Old game logs. The current launcher.log stays open, so it is skipped if locked. */
export async function clearLogs(): Promise<number> {
  const d = dirs();
  let removed = 0;

  try {
    for (const name of await fs.promises.readdir(d.logs)) {
      if (!name.toLowerCase().endsWith('.log')) continue;

      try {
        await fs.promises.rm(path.join(d.logs, name));
        removed++;
      } catch (error) {
        // The launcher holds its own log open (Windows locks it); that one is skipped.
        log.warn(`Could not delete ${name}.`, error);
      }
    }
  } catch {
    return 0;
  }

  if (removed > 0) log.info(`Deleted ${removed} log file${removed === 1 ? '' : 's'}.`);
  return removed;
}