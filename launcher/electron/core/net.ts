import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { log } from './logger';

export const USER_AGENT = 'BestClient-Launcher/0.1.0 (+https://bestpvp.eu)';

export interface DownloadTask {
  url: string;
  dest: string;
  /** Expected SHA-1. When present the file is verified and re-downloaded on mismatch. */
  sha1?: string;
  size?: number;
}

export interface ProgressReport {
  /** Number of finished tasks. */
  done: number;
  total: number;
  /** Bytes written so far across all tasks in this batch. */
  bytes: number;
  label: string;
}

export type ProgressFn = (report: ProgressReport) => void;

const MAX_RETRIES = 4;

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await request(url, init);
  return (await response.json()) as T;
}

export async function fetchText(url: string, init: RequestInit = {}): Promise<string> {
  const response = await request(url, init);
  return response.text();
}

async function request(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
      }

      return response;
    } catch (error) {
      lastError = error;

      if (attempt < MAX_RETRIES) {
        await delay(250 * 2 ** (attempt - 1));
      }
    }
  }

  throw new Error(`Request failed after ${MAX_RETRIES} attempts: ${url}`, { cause: lastError });
}

export async function sha1File(file: string): Promise<string> {
  const hash = crypto.createHash('sha1');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

/** {@returns true when the file already exists and matches the expected hash/size} */
async function isUpToDate(task: DownloadTask): Promise<boolean> {
  let stat: fs.Stats;

  try {
    stat = await fs.promises.stat(task.dest);
  } catch {
    return false;
  }

  if (!stat.isFile()) return false;
  if (task.size !== undefined && stat.size !== task.size) return false;

  if (task.sha1) {
    return (await sha1File(task.dest)) === task.sha1;
  }

  // No hash to check against: an existing non-empty file is good enough.
  return stat.size > 0;
}

export async function downloadFile(task: DownloadTask, onBytes?: (delta: number) => void): Promise<void> {
  if (await isUpToDate(task)) return;

  await fs.promises.mkdir(path.dirname(task.dest), { recursive: true });

  const temp = `${task.dest}.part`;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(task.url, { headers: { 'User-Agent': USER_AGENT } });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} ${response.statusText} for ${task.url}`);
      }

      const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);

      if (onBytes) {
        source.on('data', (chunk: Buffer) => onBytes(chunk.length));
      }

      await pipeline(source, fs.createWriteStream(temp));

      if (task.sha1) {
        const actual = await sha1File(temp);

        if (actual !== task.sha1) {
          throw new Error(`SHA-1 mismatch for ${task.url}: expected ${task.sha1}, got ${actual}`);
        }
      }

      await fs.promises.rm(task.dest, { force: true });
      await fs.promises.rename(temp, task.dest);
      return;
    } catch (error) {
      lastError = error;
      await fs.promises.rm(temp, { force: true });

      if (attempt < MAX_RETRIES) {
        await delay(400 * attempt);
      }
    }
  }

  log.error(`Download failed: ${task.url}`, lastError);
  throw new Error(`Could not download ${task.url}`, { cause: lastError });
}

/** Runs the tasks with a bounded number of parallel connections. */
export async function downloadAll(
  tasks: DownloadTask[],
  label: string,
  onProgress?: ProgressFn,
  concurrency = 8,
): Promise<void> {
  let done = 0;
  let bytes = 0;
  let cursor = 0;

  const report = () => onProgress?.({ done, total: tasks.length, bytes, label });
  report();

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      const task = tasks[index];

      if (!task) return;

      await downloadFile(task, (delta) => {
        bytes += delta;
      });

      done++;
      report();
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, tasks.length || 1) }, worker);
  await Promise.all(workers);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
