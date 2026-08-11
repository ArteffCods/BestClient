import fs from 'node:fs';
import path from 'node:path';

import { dirs } from './paths';

type Level = 'info' | 'warn' | 'error';

let file: string | null = null;

/**
 * The log is appended synchronously, a few dozen lines a session.
 *
 * A buffered write stream loses whatever has not been flushed when the process ends, and
 * the end of the file is exactly the part worth reading: the launcher points the player at
 * this log when something goes wrong, so a log that is missing its last lines is worse
 * than no log at all.
 */
function target(): string {
  if (!file) {
    file = path.join(dirs().logs, 'launcher.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  return file;
}

function write(level: Level, message: string, ...rest: unknown[]): void {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;

  if (level === 'error') {
    console.error(line, ...rest);
  } else if (level === 'warn') {
    console.warn(line, ...rest);
  } else {
    console.log(line, ...rest);
  }

  try {
    const extra = rest.length ? ` ${rest.map((value) => String(value)).join(' ')}` : '';
    fs.appendFileSync(target(), `${line}${extra}\n`, 'utf8');
  } catch {
    // A broken log file must never take the launcher down.
  }
}

export const log = {
  info: (message: string, ...rest: unknown[]) => write('info', message, ...rest),
  warn: (message: string, ...rest: unknown[]) => write('warn', message, ...rest),
  error: (message: string, ...rest: unknown[]) => write('error', message, ...rest),
};
