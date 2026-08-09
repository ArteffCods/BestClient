import { loadFeed, sanitizeHtml } from './feed';
import type { ChangelogEntry } from '../shared';

/**
 * Changelog feed, shown in the fixed rail down the right-hand side of the launcher. Same
 * contract as the news feed: a JSON array in the project's GitHub repo, newest first,
 * cached on disk so the rail is never empty offline.
 *
 * Expected shape:
 *   [
 *     {
 *       "version": "0.2.0",
 *       "date": "2026-08-09",
 *       "title": "Partner servers",             // optional headline
 *       "description": "One-paragraph summary", // optional
 *       "changes": ["Added ...", "Fixed ..."],  // optional bullet list
 *       "html": "<p>...</p>"                    // optional, sanitized before use
 *     }
 *   ]
 *
 * `notes` also accepts a plain string, and the whole entry accepts `body` as an alias of
 * `description`, because the file is written by hand.
 */
const CHANGELOG_URL =
  'https://raw.githubusercontent.com/ArteffCods/BestClient/refs/heads/main/changelog.json';
const CACHE_FILE = 'changelog-cache.json';

interface RawEntry {
  version?: unknown;
  date?: unknown;
  title?: unknown;
  description?: unknown;
  body?: unknown;
  changes?: unknown;
  notes?: unknown;
  html?: unknown;
}

/** Accepts a bullet list, a single string, or nothing at all. */
function toLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((line): line is string => typeof line === 'string' && line.trim() !== '').slice(0, 20);
  }

  if (typeof value === 'string' && value.trim()) return [value];

  return [];
}

function normalize(raw: unknown[]): ChangelogEntry[] {
  return raw
    .map((value): ChangelogEntry | null => {
      const entry = (value ?? {}) as RawEntry;
      const version = typeof entry.version === 'string' ? entry.version : '';
      const title = typeof entry.title === 'string' ? entry.title : '';

      // An entry with neither a version nor a headline has nothing to show.
      if (!version && !title) return null;

      const description =
        typeof entry.description === 'string'
          ? entry.description
          : typeof entry.body === 'string'
            ? entry.body
            : '';

      return {
        version,
        date: typeof entry.date === 'string' ? entry.date : '',
        title,
        description,
        changes: [...toLines(entry.changes), ...toLines(entry.notes)].slice(0, 20),
        html: typeof entry.html === 'string' ? sanitizeHtml(entry.html) : undefined,
      };
    })
    .filter((item): item is ChangelogEntry => item !== null)
    .slice(0, 40);
}

export function getChangelog(): Promise<ChangelogEntry[]> {
  return loadFeed('changelog', CHANGELOG_URL, CACHE_FILE, normalize);
}
