import fs from 'node:fs';
import path from 'node:path';

import { dirs } from './paths';

type Level = 'info' | 'warn' | 'error';

let stream: fs.WriteStream | null = null;

function sink(): fs.WriteStream {
  if (!stream) {
    const file = path.join(dirs().logs, 'launcher.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    stream = fs.createWriteStream(file, { flags: 'a' });
  }

  return stream;
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
    sink().write(`${line}${extra}\n`);
  } catch {
    // A broken log file must never take the launcher down.
  }
}

export const log = {
  info: (message: string, ...rest: unknown[]) => write('info', message, ...rest),
  warn: (message: string, ...rest: unknown[]) => write('warn', message, ...rest),
  error: (message: string, ...rest: unknown[]) => write('error', message, ...rest),
};
