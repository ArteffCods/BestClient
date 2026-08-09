import { app, shell } from 'electron';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { log } from './logger';
import { fetchJson, fetchText, USER_AGENT } from './net';
import { dirs, exists, parseJson, resourceFile } from './paths';
import type { UpdateState } from '../shared';

/**
 * Update channel.
 *
 * `version.json` in the project repo is the only thing the launcher polls. When it names
 * a version newer than the running one, the installer is fetched quietly in the
 * background - the player is never interrupted - and the title bar grows an Update
 * button. Nothing is installed until that button is pressed.
 *
 * Expected shape of version.json:
 *   {
 *     "version": "0.2.0",
 *     "notes": "One line shown next to the button.",
 *     "tag": "v0.2.0",
 *     "asset": "BestClient-Setup-0.2.0.exe",
 *     "sha256": "…"          // optional but strongly recommended
 *   }
 */
const VERSION_URL =
  'https://raw.githubusercontent.com/ArteffCods/BestClient/refs/heads/main/version.json';
const REPO = 'ArteffCods/BestClient';

/** Re-check on this interval while the launcher is open. */
export const CHECK_INTERVAL_MS = 15 * 60_000;

interface Manifest {
  version: string;
  notes: string;
  tag: string;
  asset: string;
  sha256: string;
}

let state: UpdateState = { status: 'idle', version: '', notes: '', percent: 0 };
let listener: ((next: UpdateState) => void) | null = null;
let inFlight: Promise<void> | null = null;

export function onUpdateState(handler: (next: UpdateState) => void): void {
  listener = handler;
}

export function currentUpdateState(): UpdateState {
  return state;
}

function setState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch };
  listener?.(state);
}

/**
 * Token for a private repository, read from `update-token.json` next to the settings or
 * from the environment. It is deliberately not compiled into the source: the file is
 * git-ignored, so the token never reaches the repository.
 *
 * A token shipped inside a desktop application can be extracted by anyone who has the
 * application. Keep it a fine-grained, read-only, single-repository token so that is all
 * it can ever do, and rotate it when a build leaks.
 */
function readToken(): string {
  const fromEnv = process.env.BESTCLIENT_UPDATE_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  // Per-machine override first, then the copy packaged with the build.
  for (const file of [path.join(dirs().root, 'update-token.json'), resourceFile('update-token.json')]) {
    try {
      const parsed = parseJson<{ token?: string }>(fs.readFileSync(file, 'utf8'));
      const token = typeof parsed.token === 'string' ? parsed.token.trim() : '';
      if (token) return token;
    } catch {
      // Not configured here; try the next location.
    }
  }

  return '';
}

function authHeaders(): Record<string, string> {
  const token = readToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Semantic-version comparison, tolerant of a leading `v` and of missing segments. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (value: string) =>
    value
      .trim()
      .replace(/^v/i, '')
      .split(/[.\-+]/)
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));

  const a = parse(candidate);
  const b = parse(current);

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }

  return false;
}

async function readManifest(): Promise<Manifest | null> {
  const text = await fetchText(`${VERSION_URL}?_=${Date.now()}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });

  const trimmed = text.trim();
  if (!trimmed) return null;

  // The file started life as a bare version string; accept that too rather than break.
  if (!trimmed.startsWith('{')) {
    return { version: trimmed, notes: '', tag: `v${trimmed}`, asset: '', sha256: '' };
  }

  const raw = parseJson<Partial<Manifest>>(trimmed);

  if (typeof raw.version !== 'string' || !raw.version.trim()) return null;

  return {
    version: raw.version.trim(),
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 300) : '',
    tag: typeof raw.tag === 'string' && raw.tag ? raw.tag : `v${raw.version.trim()}`,
    asset: typeof raw.asset === 'string' ? path.basename(raw.asset) : '',
    sha256: typeof raw.sha256 === 'string' ? raw.sha256.toLowerCase() : '',
  };
}

interface ReleaseAsset {
  name: string;
  url: string;
  browser_download_url: string;
  size: number;
}

/** Resolves the release asset's download URL, which works for a private repo with a token. */
async function resolveAssetUrl(manifest: Manifest): Promise<{ url: string; headers: Record<string, string> }> {
  const release = await fetchJson<{ assets?: ReleaseAsset[] }>(
    `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(manifest.tag)}`,
    { headers: { Accept: 'application/vnd.github+json', ...authHeaders() } },
  );

  const asset = manifest.asset
    ? release.assets?.find((candidate) => candidate.name === manifest.asset)
    : release.assets?.find((candidate) => candidate.name.toLowerCase().endsWith('.exe'));

  if (!asset) {
    throw new Error(`Release ${manifest.tag} has no installer asset to download.`);
  }

  const token = readToken();

  // The API asset endpoint is the only one that works on a private repository; the
  // browser URL is used when there is no token, so a public repo needs no configuration.
  return token
    ? { url: asset.url, headers: { Accept: 'application/octet-stream', ...authHeaders() } }
    : { url: asset.browser_download_url, headers: {} };
}

function installerPath(manifest: Manifest): string {
  const name = manifest.asset || `BestClient-Setup-${manifest.version}.exe`;
  return path.join(dirs().root, 'updates', path.basename(name));
}

async function sha256File(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  hash.update(await fs.promises.readFile(file));
  return hash.digest('hex');
}

/**
 * Checks for a newer build and, if there is one, downloads it in the background.
 * Safe to call repeatedly: a check already running is reused.
 */
export function checkForUpdate(): Promise<void> {
  if (inFlight) return inFlight;

  inFlight = run().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

async function run(): Promise<void> {
  // A download that already finished must not be thrown away by the next poll.
  if (state.status === 'ready' || state.status === 'downloading') return;

  setState({ status: 'checking', percent: 0, error: undefined });

  let manifest: Manifest | null;

  try {
    manifest = await readManifest();
  } catch (error) {
    log.warn('Could not read the update manifest.', error);
    setState({ status: 'idle', error: undefined });
    return;
  }

  if (!manifest || !isNewer(manifest.version, app.getVersion())) {
    setState({ status: 'up-to-date', version: '', notes: '', percent: 0 });
    return;
  }

  setState({ status: 'available', version: manifest.version, notes: manifest.notes, percent: 0 });

  const dest = installerPath(manifest);

  // Already downloaded and still intact from an earlier session.
  if ((await exists(dest)) && (!manifest.sha256 || (await sha256File(dest)) === manifest.sha256)) {
    setState({ status: 'ready', percent: 100 });
    return;
  }

  setState({ status: 'downloading', percent: 0 });

  try {
    const { url, headers } = await resolveAssetUrl(manifest);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });

    let received = 0;
    const total = await contentLength(url, headers);

    await downloadWithHeaders(url, headers, dest, (delta) => {
      received += delta;
      if (total > 0) setState({ percent: Math.min(99, Math.round((received / total) * 100)) });
    });

    if (manifest.sha256) {
      const actual = await sha256File(dest);

      if (actual !== manifest.sha256) {
        await fs.promises.rm(dest, { force: true });
        throw new Error(`Installer checksum mismatch (expected ${manifest.sha256}, got ${actual}).`);
      }
    }

    await pruneOldInstallers(dest);
    setState({ status: 'ready', percent: 100 });
    log.info(`Update ${manifest.version} downloaded and waiting for the player.`);
  } catch (error) {
    log.warn('Could not download the update.', error);
    setState({
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      percent: 0,
    });
  }
}

/** Only the installer we are about to offer is worth keeping; the rest is ~100 MB each. */
async function pruneOldInstallers(keep: string): Promise<void> {
  const folder = path.dirname(keep);

  try {
    for (const name of await fs.promises.readdir(folder)) {
      const file = path.join(folder, name);
      if (file === keep) continue;
      await fs.promises.rm(file, { force: true });
    }
  } catch {
    // Housekeeping only - a file we cannot remove must never fail the update.
  }
}

async function contentLength(url: string, headers: Record<string, string>): Promise<number> {
  try {
    const response = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT, ...headers } });
    return Number(response.headers.get('content-length') ?? 0);
  } catch {
    return 0;
  }
}

/** downloadFile() cannot carry auth headers, so the update stream is handled here. */
async function downloadWithHeaders(
  url: string,
  headers: Record<string, string>,
  dest: string,
  onBytes: (delta: number) => void,
): Promise<void> {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers } });

  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} ${response.statusText} while downloading the update.`);
  }

  const temp = `${dest}.part`;
  const handle = await fs.promises.open(temp, 'w');

  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      await handle.write(chunk);
      onBytes(chunk.byteLength);
    }
  } finally {
    await handle.close();
  }

  await fs.promises.rm(dest, { force: true });
  await fs.promises.rename(temp, dest);
}

/**
 * Runs the downloaded installer and quits.
 *
 * The flags are what makes this an update rather than a second installation:
 *   /S           install without the wizard, into the location already on record
 *   --updated    tells the NSIS package this is an upgrade, not a first install
 *   --force-run  start the new build once it is in place
 *
 * The package installs per-user, so nothing here asks for administrator rights.
 */
export async function installUpdate(): Promise<void> {
  if (state.status !== 'ready') {
    throw new Error('No update has finished downloading yet.');
  }

  const manifest = await readManifest();
  if (!manifest) throw new Error('The update manifest is no longer readable.');

  const installer = installerPath(manifest);

  if (!(await exists(installer))) {
    setState({ status: 'idle', percent: 0 });
    throw new Error('The downloaded installer is gone; it will be fetched again.');
  }

  log.info(`Starting the installer for ${manifest.version}.`);

  try {
    const child = spawn(installer, ['--updated', '/S', '--force-run'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (error) {
    log.warn('Could not spawn the installer; handing it to the shell instead.', error);
    await shell.openPath(installer);
  }

  // Give the installer a moment to take over the window before the app disappears.
  setTimeout(() => app.quit(), 600);
}
