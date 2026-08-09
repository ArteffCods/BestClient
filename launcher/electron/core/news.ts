import { loadFeed, sanitizeHtml } from './feed';
import type { NewsItem } from '../shared';

/**
 * News feed. The launcher pulls a small JSON array straight from the project's GitHub
 * repo (raw) and caches the last good copy on disk, so the Play screen still shows
 * something when the machine is offline or GitHub is briefly unreachable.
 *
 * Expected shape of the raw file (an array, newest first):
 *   [
 *     {
 *       "title": "Season 3 is live",
 *       "date": "2026-08-09",
 *       "image": "https://.../banner.png",
 *       "url": "https://bestpvp.eu/news/season-3",   // optional, opens in the browser
 *       "html": "<p>Optional rich body.</p>"          // optional, sanitized before use
 *     }
 *   ]
 */
const NEWS_URL = 'https://raw.githubusercontent.com/ArteffCods/BestClient/refs/heads/main/news.json';
const CACHE_FILE = 'news-cache.json';

interface RawNews {
  title?: unknown;
  date?: unknown;
  image?: unknown;
  url?: unknown;
  html?: unknown;
}

function normalize(raw: unknown[]): NewsItem[] {
  return raw
    .map((value): NewsItem | null => {
      const entry = (value ?? {}) as RawNews;
      const title = typeof entry.title === 'string' ? entry.title : '';
      if (!title) return null;

      const image = typeof entry.image === 'string' ? entry.image : '';

      return {
        title,
        date: typeof entry.date === 'string' ? entry.date : '',
        // Only https artwork is ever loaded, so a bad feed cannot point the launcher at a
        // local file or a tracking pixel on an arbitrary scheme.
        image: /^https:\/\//i.test(image) ? image : '',
        url: typeof entry.url === 'string' && /^https:\/\//i.test(entry.url) ? entry.url : undefined,
        html: typeof entry.html === 'string' ? sanitizeHtml(entry.html) : undefined,
      };
    })
    .filter((item): item is NewsItem => item !== null)
    .slice(0, 30);
}

export function getNews(): Promise<NewsItem[]> {
  return loadFeed('news', NEWS_URL, CACHE_FILE, normalize);
}
