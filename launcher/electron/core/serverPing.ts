import net from 'node:net';
import dns from 'node:dns';

import { log } from './logger';
import { fetchJson } from './net';
import type { PartnerServer } from '../shared';

/**
 * Partner servers shown on the Play screen. Each is queried live over the Minecraft
 * Server List Ping protocol for its MOTD, player count and favicon.
 */
export const PARTNER_SERVERS: { name: string; address: string }[] = [
  { name: 'BestPvP', address: 'bestpvp.eu' },
];

const DEFAULT_PORT = 25565;
const TIMEOUT_MS = 4000;
/** Status responses are reused for this long so opening the Play tab never re-pings. */
const CACHE_MS = 30_000;
/** A status payload larger than this is a hostile or broken server; drop the connection. */
const MAX_STATUS_BYTES = 256 * 1024;

interface StatusResponse {
  version?: { name?: string };
  players?: { online?: number; max?: number };
  description?: unknown;
  favicon?: string;
}

// --- VarInt helpers (Minecraft's variable-length integer encoding) ---

function writeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let v = value >>> 0;

  do {
    let temp = v & 0b0111_1111;
    v >>>= 7;
    if (v !== 0) temp |= 0b1000_0000;
    bytes.push(temp);
  } while (v !== 0);

  return Buffer.from(bytes);
}

function readVarInt(buffer: Buffer, offset: number): { value: number; size: number } | null {
  let value = 0;
  let size = 0;

  for (;;) {
    if (offset + size >= buffer.length) return null;
    const byte = buffer[offset + size]!;
    value |= (byte & 0b0111_1111) << (7 * size);
    size++;
    if ((byte & 0b1000_0000) === 0) break;
    if (size > 5) return null;
  }

  return { value, size };
}

function writePacket(...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  return Buffer.concat([writeVarInt(body.length), body]);
}

function writeString(value: string): Buffer {
  const str = Buffer.from(value, 'utf8');
  return Buffer.concat([writeVarInt(str.length), str]);
}

/**
 * Concatenates the text of a chat component tree without touching spacing - servers
 * paint a MOTD one coloured letter at a time, and trimming each component would glue the
 * words together.
 */
function collectText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (!node || typeof node !== 'object') return '';

  const component = node as { text?: unknown; extra?: unknown };
  const own = typeof component.text === 'string' ? component.text : '';

  return Array.isArray(component.extra) ? own + component.extra.map(collectText).join('') : own;
}

/** Flattens a chat-component MOTD to one clean line of plain text. */
function flattenMotd(description: unknown): string {
  return collectText(description)
    .replace(/§[0-9a-fk-or]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface DohAnswer {
  name: string;
  type: number;
  data: string;
}

/**
 * SRV lookup over DNS-over-HTTPS.
 *
 * Node's resolver talks to the machine's configured DNS servers directly on port 53, and
 * plenty of networks (corporate DNS, some routers, VPNs) refuse anything that is not a
 * plain A query - the SRV record then looks missing and the launcher falls back to port
 * 25565, where nothing is listening. Asking over https always works, because the
 * launcher already needs https for Modrinth.
 */
async function resolveSrvOverHttps(name: string): Promise<{ host: string; port: number } | null> {
  const response = await fetchJson<{ Answer?: DohAnswer[] }>(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=SRV`,
    { headers: { accept: 'application/dns-json' } },
  );

  // "<priority> <weight> <port> <target>"
  for (const answer of response.Answer ?? []) {
    if (answer.type !== 33) continue;

    const [, , rawPort, rawTarget] = answer.data.trim().split(/\s+/);
    const port = Number(rawPort);
    const host = (rawTarget ?? '').replace(/\.$/, '');

    if (host && Number.isInteger(port) && port > 0 && port < 65536) return { host, port };
  }

  return null;
}

async function resolveTarget(address: string): Promise<{ host: string; port: number }> {
  const [rawHost, rawPort] = address.split(':');
  const host = rawHost ?? address;

  if (rawPort) return { host, port: Number(rawPort) || DEFAULT_PORT };

  const srvName = `_minecraft._tcp.${host}`;

  try {
    const records = await dns.promises.resolveSrv(srvName);
    const best = [...records].sort((a, b) => a.priority - b.priority)[0];
    if (best) return { host: best.name, port: best.port };
  } catch {
    // The system resolver has no answer (or refuses SRV) - try https next.
  }

  try {
    const overHttps = await resolveSrvOverHttps(srvName);
    if (overHttps) return overHttps;
  } catch (error) {
    log.warn(`SRV lookup over https failed for ${host}.`, error);
  }

  return { host, port: DEFAULT_PORT };
}

function requestStatus(host: string, port: number, sni: string): Promise<StatusResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let chunks = Buffer.alloc(0);
    let settled = false;

    const done = (error: Error | null, value?: StatusResponse) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(value!);
    };

    socket.setTimeout(TIMEOUT_MS, () => done(new Error('ping timed out')));
    socket.on('error', (error) => done(error));

    socket.on('connect', () => {
      const handshake = writePacket(
        writeVarInt(0x00),
        writeVarInt(767),
        writeString(sni),
        Buffer.from([(port >> 8) & 0xff, port & 0xff]),
        writeVarInt(1),
      );
      socket.write(handshake);
      socket.write(writePacket(writeVarInt(0x00)));
    });

    socket.on('data', (data) => {
      chunks = Buffer.concat([chunks, data]);

      if (chunks.length > MAX_STATUS_BYTES) return done(new Error('status response too large'));

      const outer = readVarInt(chunks, 0);
      if (!outer) return;
      if (outer.value > MAX_STATUS_BYTES) return done(new Error('status response too large'));
      if (chunks.length < outer.size + outer.value) return; // packet still arriving

      let cursor = outer.size;
      const packetId = readVarInt(chunks, cursor);
      if (!packetId) return done(new Error('bad packet'));
      cursor += packetId.size;

      const jsonLen = readVarInt(chunks, cursor);
      if (!jsonLen) return done(new Error('bad length'));
      cursor += jsonLen.size;

      if (chunks.length < cursor + jsonLen.value) return; // string still arriving

      const json = chunks.subarray(cursor, cursor + jsonLen.value).toString('utf8');

      try {
        done(null, JSON.parse(json) as StatusResponse);
      } catch (error) {
        done(error as Error);
      }
    });
  });
}

/**
 * Favicons arrive as a base64 PNG data URL and are rendered straight into an <img>.
 * Anything that is not exactly that shape is dropped rather than handed to the renderer.
 */
function safeFavicon(value: unknown): string {
  if (typeof value !== 'string') return '';

  const compact = value.replace(/\s+/g, '');

  return /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(compact) ? compact : '';
}

async function pingOne(entry: { name: string; address: string }): Promise<PartnerServer> {
  const offline: PartnerServer = {
    name: entry.name,
    address: entry.address,
    online: false,
    players: 0,
    maxPlayers: 0,
    motd: '',
    favicon: '',
  };

  try {
    const { host, port } = await resolveTarget(entry.address);
    // The handshake carries the address the player typed, not the SRV target: servers
    // behind a proxy route on that hostname and answer differently without it.
    const status = await requestStatus(host, port, entry.address.split(':')[0] ?? host);

    return {
      ...offline,
      online: true,
      players: Math.max(0, Math.trunc(status.players?.online ?? 0)),
      maxPlayers: Math.max(0, Math.trunc(status.players?.max ?? 0)),
      motd: flattenMotd(status.description).slice(0, 200),
      favicon: safeFavicon(status.favicon),
    };
  } catch (error) {
    log.warn(`Could not ping ${entry.address}.`, error);
    return offline;
  }
}

let cache: { at: number; servers: PartnerServer[] } | null = null;

/** Pings every partner server in parallel and returns their live status. */
export async function getPartnerServers(): Promise<PartnerServer[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.servers;

  const servers = await Promise.all(PARTNER_SERVERS.map(pingOne));
  cache = { at: Date.now(), servers };

  return servers;
}
