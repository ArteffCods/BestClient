import { app } from 'electron';
import fs from 'node:fs';
import net from 'node:net';

import { log } from './logger';
import { parseJson, resourceFile } from './paths';

/**
 * Discord Rich Presence.
 *
 * Discord's own client listens on a local named pipe and speaks a tiny framed protocol:
 * a four-byte opcode, a four-byte length and a JSON body. That is the whole thing, so
 * there is no library here - a dependency for eight lines of framing would be a
 * dependency to keep patched forever.
 *
 * Everything about this is best-effort. Discord not running, a stale pipe, a user who
 * never made an application: all of them end with presence quietly off and the launcher
 * behaving exactly as before.
 */

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

/** Discord drops SET_ACTIVITY updates sent more often than this. */
const UPDATE_INTERVAL_MS = 15_000;
const RECONNECT_MS = 30_000;
/** Discord opens one pipe per running client, numbered from zero. */
const MAX_PIPES = 10;

interface Activity {
  details?: string;
  state?: string;
  timestamps?: { start?: number };
  assets?: { large_image?: string; large_text?: string; small_image?: string; small_text?: string };
  buttons?: { label: string; url: string }[];
}

let socket: net.Socket | null = null;
let ready = false;
let enabled = true;
let clientId = '';

let current: Activity | null = null;
let sentAt = 0;
let flushTimer: NodeJS.Timeout | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

/** The session clock Discord shows as "elapsed"; set once so it never restarts. */
const startedAt = Math.floor(Date.now() / 1000);

/**
 * The application id, from `resources/discord.json`.
 *
 * It is not a secret - it identifies the application to Discord and is visible to anyone
 * with the client - but it is per-installation, so it is configuration rather than code.
 * Without the file presence simply never starts.
 */
function readClientId(): string {
  try {
    const parsed = parseJson<{ clientId?: string }>(
      fs.readFileSync(resourceFile('discord.json'), 'utf8'),
    );
    const value = typeof parsed.clientId === 'string' ? parsed.clientId.trim() : '';
    return /^\d{17,20}$/.test(value) ? value : '';
  } catch {
    return '';
  }
}

function pipePath(index: number): string {
  return `\\\\.\\pipe\\discord-ipc-${index}`;
}

function encode(op: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(8);

  header.writeInt32LE(op, 0);
  header.writeInt32LE(body.length, 4);

  return Buffer.concat([header, body]);
}

function send(op: number, payload: unknown): void {
  if (!socket || socket.destroyed) return;

  try {
    socket.write(encode(op, payload));
  } catch (error) {
    log.warn('Discord presence write failed.', error);
    drop();
  }
}

/** Tries each pipe in turn; the first one that accepts a handshake wins. */
function connect(index = 0): void {
  if (!enabled || !clientId || socket || index >= MAX_PIPES) {
    if (index >= MAX_PIPES) scheduleReconnect();
    return;
  }

  const candidate = net.createConnection(pipePath(index));
  let settled = false;

  candidate.on('connect', () => {
    settled = true;
    socket = candidate;
    send(OP_HANDSHAKE, { v: 1, client_id: clientId });
  });

  candidate.on('error', () => {
    candidate.destroy();
    if (!settled) connect(index + 1);
  });

  candidate.on('close', () => {
    if (socket === candidate) {
      drop();
      scheduleReconnect();
    }
  });

  candidate.on('data', (chunk) => handle(chunk));
}

/**
 * Reads whatever arrived.
 *
 * Only the opcode matters: READY means presence can start, and a PING has to be answered
 * or Discord closes the pipe. The body is parsed only far enough to notice a READY.
 */
function handle(chunk: Buffer): void {
  let offset = 0;

  while (offset + 8 <= chunk.length) {
    const op = chunk.readInt32LE(offset);
    const length = chunk.readInt32LE(offset + 4);
    const end = offset + 8 + length;

    if (length < 0 || end > chunk.length) return;

    const body = chunk.toString('utf8', offset + 8, end);
    offset = end;

    if (op === OP_PING) {
      send(OP_PONG, parseSafe(body));
      continue;
    }

    if (op === OP_CLOSE) {
      drop();
      scheduleReconnect();
      return;
    }

    if (op === OP_FRAME && body.includes('"READY"')) {
      ready = true;
      // Whatever state the launcher is in right now goes out immediately.
      flush(true);
    }
  }
}

function parseSafe(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function drop(): void {
  ready = false;

  if (socket) {
    socket.removeAllListeners();
    socket.destroy();
    socket = null;
  }
}

function scheduleReconnect(): void {
  if (!enabled || !clientId || reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_MS);

  reconnectTimer.unref();
}

/**
 * Pushes the current activity, respecting Discord's rate limit.
 *
 * An update that arrives too soon is not dropped - it is held and sent when the window
 * opens, so the last state the player was actually in is always the one on show.
 */
function flush(immediate = false): void {
  if (!ready || !current) return;

  const wait = immediate ? 0 : Math.max(0, UPDATE_INTERVAL_MS - (Date.now() - sentAt));

  if (wait > 0) {
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flush(true);
      }, wait);
      flushTimer.unref();
    }

    return;
  }

  sentAt = Date.now();

  send(OP_FRAME, {
    cmd: 'SET_ACTIVITY',
    args: { pid: process.pid, activity: current },
    nonce: `${Date.now()}`,
  });
}

function set(activity: Activity): void {
  current = activity;
  flush();
}

/** Starts presence if it is configured and the player has not switched it off. */
export function startDiscord(on: boolean): void {
  enabled = on;
  clientId = readClientId();

  if (!enabled || !clientId) {
    return;
  }

  connect();
}

/** Turns presence on or off at runtime, from Settings. */
export function setDiscordEnabled(on: boolean): void {
  if (on === enabled) return;

  enabled = on;

  if (!on) {
    stopDiscord();
    return;
  }

  startDiscord(true);
}

export function stopDiscord(): void {
  enabled = false;

  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (socket && !socket.destroyed) {
    // A clean SET_ACTIVITY with no activity clears the presence instead of leaving a
    // stale one behind until Discord notices the pipe died.
    send(OP_FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid }, nonce: `${Date.now()}` });
  }

  drop();
  current = null;
}

const ASSETS = {
  large_image: 'bestclient',
  large_text: `BestClient ${app.getVersion()}`,
};

const BUTTONS = [{ label: 'bestpvp.eu', url: 'https://bestpvp.eu' }];

/** In the launcher, not in a world. */
export function presenceIdle(): void {
  set({
    details: 'In the launcher',
    state: 'Minecraft 1.21.11',
    timestamps: { start: startedAt },
    assets: ASSETS,
    buttons: BUTTONS,
  });
}

/** The game is running. `server` is shown when the launch went straight onto one. */
export function presencePlaying(server: string | null): void {
  set({
    details: server ? `Playing on ${server}` : 'In game',
    state: 'Minecraft 1.21.11',
    // Restarted here on purpose: this timer is the one players read as "how long have I
    // been in the game", not "how long has the launcher been open".
    timestamps: { start: Math.floor(Date.now() / 1000) },
    assets: ASSETS,
    buttons: BUTTONS,
  });
}
