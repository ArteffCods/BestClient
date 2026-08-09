import fs from 'node:fs';
import path from 'node:path';

import { log } from './logger';
import { fetchText } from './net';
import { dirs, parseJson } from './paths';

/**
 * Shared plumbing for the two JSON feeds the launcher pulls from the project's GitHub
 * repo (news and changelog). Both files are edited by hand, so parsing is deliberately
 * tolerant; both may carry an `html` snippet, so both go through the same sanitizer; and
 * both keep a disk copy so the launcher still shows something offline.
 */

/** Tags a feed snippet may use. Everything else is dropped, its text content kept. */
const ALLOWED_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 's', 'p', 'br', 'hr', 'ul', 'ol', 'li',
  'a', 'code', 'span', 'h3', 'h4', 'small', 'img',
]);

/** Attributes each tag may keep. Anything absent here is stripped. */
const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'width', 'height']),
};

const VOID_TAGS = new Set(['br', 'hr', 'img']);

/**
 * Allow-list HTML sanitizer.
 *
 * The feed lives in the project's own repo, but it is still remote text rendered inside
 * a privileged window, so it is treated as hostile: only the tags above survive, only the
 * attributes above survive, and `href`/`src` must be https. Blacklisting `<script>` and
 * `on*=` is not enough - an allow-list is the only version that cannot be talked around.
 */
export function sanitizeHtml(html: string): string {
  return html.replace(/<[^>]*>/g, (tag) => {
    const parts = /^<\s*(\/?)\s*([a-zA-Z0-9-]+)([\s\S]*?)\/?\s*>?$/.exec(tag);
    if (!parts) return '';

    const closing = parts[1] === '/';
    const name = (parts[2] ?? '').toLowerCase();

    if (!ALLOWED_TAGS.has(name)) return '';
    if (closing) return VOID_TAGS.has(name) ? '' : `</${name}>`;

    return `<${name}${safeAttributes(name, parts[3] ?? '')}${VOID_TAGS.has(name) ? ' /' : ''}>`;
  });
}

function safeAttributes(tag: string, raw: string): string {
  const allowed = ALLOWED_ATTRIBUTES[tag];
  if (!allowed) return '';

  const pattern = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let out = '';
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(raw)) !== null) {
    const name = (match[1] ?? '').toLowerCase();
    if (!allowed.has(name)) continue;

    const value = match[2] ?? match[3] ?? match[4] ?? '';

    // Links and images may only point at https - never at a file, a local port, or a
    // javascript: / data:text/html payload.
    if ((name === 'href' || name === 'src') && !/^https:\/\//i.test(value)) continue;
    if ((name === 'width' || name === 'height') && !/^\d{1,4}$/.test(value)) continue;

    out += ` ${name}="${value.replace(/["<>]/g, '')}"`;
  }

  // Feed links always leave for the system browser; the launcher never navigates itself.
  if (tag === 'a') out += ' target="_blank" rel="noreferrer noopener"';

  return out;
}

/**
 * Tolerant feed parser. The correct file is one JSON array of objects, but it is easy to
 * grow it by pasting each new entry as its own `[ { ... } ]` block, which yields several
 * arrays back to back - not valid JSON. This walks the text, parses every top-level
 * array/object it finds and flattens them, so both shapes work.
 */
export function parseFeed(text: string): unknown[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  try {
    const value = JSON.parse(trimmed);
    return Array.isArray(value) ? value : [value];
  } catch {
    // Fall through to the lenient scan below.
  }

  const items: unknown[] = [];
  let i = 0;

  while (i < trimmed.length) {
    const open = trimmed[i];

    if (open !== '[' && open !== '{') {
      i++;
      continue;
    }

    const start = i;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (; i < trimmed.length; i++) {
      const char = trimmed[i];

      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }

      if (char === '"') inString = true;
      else if (char === '[' || char === '{') depth++;
      else if (char === ']' || char === '}') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }

    try {
      const value = JSON.parse(trimmed.slice(start, i));
      if (Array.isArray(value)) items.push(...value);
      else items.push(value);
    } catch {
      // Skip a malformed block rather than losing the whole feed.
    }
  }

  return items;
}

/** How long a fetched feed is reused before the network is touched again. */
const MEMORY_TTL_MS = 5 * 60_000;

interface Memo {
  at: number;
  items: unknown[];
}

const memory = new Map<string, Memo>();

/**
 * Fetches a feed, normalizes it, refreshes the disk cache, and falls back to that cache
 * on any failure. Repeat calls inside the TTL are served from memory, so switching tabs
 * never re-hits GitHub.
 */
export async function loadFeed<T>(
  label: string,
  url: string,
  cacheName: string,
  normalize: (raw: unknown[]) => T[],
): Promise<T[]> {
  const cached = memory.get(url);

  if (cached && Date.now() - cached.at < MEMORY_TTL_MS) {
    return normalize(cached.items);
  }

  const file = path.join(dirs().root, cacheName);

  try {
    // GitHub's raw CDN caches for a few minutes; a per-request cache-buster makes an edit
    // show up on the next launch instead of after the CDN TTL expires.
    const text = await fetchText(`${url}?_=${Date.now()}`, { cache: 'no-store' });
    const items = parseFeed(text);

    memory.set(url, { at: Date.now(), items });

    try {
      await fs.promises.mkdir(dirs().root, { recursive: true });
      await fs.promises.writeFile(file, JSON.stringify(items), 'utf8');
    } catch (error) {
      log.warn(`Could not cache the ${label} feed.`, error);
    }

    return normalize(items);
  } catch (error) {
    log.warn(`Could not fetch the ${label} feed; using the cached copy.`, error);

    try {
      return normalize(parseJson<unknown[]>(await fs.promises.readFile(file, 'utf8')));
    } catch {
      return [];
    }
  }
}
