'use client';

import type { ChangelogEntry } from '@/types/bestclient';

/**
 * Fixed rail down the right-hand edge, present on every screen and always the same
 * width, so the version history is never something you have to go looking for. It is the
 * only column in the launcher that never changes with the tab - the client's own record
 * of what shipped, sitting beside whatever you are doing.
 *
 * The rail scrolls internally; the page behind it never does.
 */
export function ChangelogRail({ entries }: { entries: ChangelogEntry[] }) {
  return (
    <aside
      aria-label="Changelog"
      className="hidden w-[248px] shrink-0 flex-col border-l border-edge bg-void/30 backdrop-blur-xl min-[1040px]:flex xl:w-[268px]"
    >
      <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="text-rose-soft">
          <path d="M8 1.5 A6.5 6.5 0 1 1 1.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M1.5 8 L3.4 6.1 M1.5 8 L-0.4 6.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M8 4.6 V8 L10.4 9.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h2 className="display-caps text-[13px] leading-none text-ink">Changelog</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {entries.length === 0 ? (
          <p className="text-[11.5px] leading-relaxed text-ink-faint">
            No releases published yet. Entries appear here as soon as changelog.json is filled in.
          </p>
        ) : (
          <ol className="space-y-5">
            {entries.map((entry, index) => (
              <li key={`${entry.version}-${index}`}>
                <Release entry={entry} latest={index === 0} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}

function Release({ entry, latest }: { entry: ChangelogEntry; latest: boolean }) {
  return (
    <article>
      <div className="flex items-baseline gap-2">
        <span
          className={`font-mono text-[12px] font-semibold tabular-nums ${
            latest ? 'text-rose' : 'text-ink'
          }`}
        >
          {entry.version || '—'}
        </span>
        {latest ? (
          <span className="rounded border border-rose/40 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-rose-soft">
            Latest
          </span>
        ) : null}
        {entry.date ? (
          <span className="ml-auto font-mono text-[10px] text-ink-faint">{entry.date}</span>
        ) : null}
      </div>

      {entry.title ? (
        <p className="mt-1.5 text-[12.5px] font-semibold leading-snug text-ink">{entry.title}</p>
      ) : null}

      {entry.description ? (
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-dim">{entry.description}</p>
      ) : null}

      {entry.changes.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {entry.changes.map((line, index) => (
            <li key={index} className="flex gap-2 text-[11.5px] leading-relaxed text-ink-dim">
              <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-rose/70" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{line}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {entry.html ? (
        <div
          className="feed-html mt-2 text-[11.5px] leading-relaxed text-ink-dim"
          // Sanitized in the main process against a tag/attribute allow-list.
          dangerouslySetInnerHTML={{ __html: entry.html }}
        />
      ) : null}
    </article>
  );
}
