'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { StoreHit, StoreInstalled, StoreSortIndex } from '@/types/bestclient';

type InstallState = 'idle' | 'working' | 'done' | 'error';

const SORTS: { id: StoreSortIndex; label: string }[] = [
  { id: 'relevance', label: 'Relevance' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'follows', label: 'Followers' },
  { id: 'newest', label: 'Newest' },
  { id: 'updated', label: 'Recently updated' },
];

export function StoreView() {
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [sort, setSort] = useState<StoreSortIndex>('downloads');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [hits, setHits] = useState<StoreHit[] | null>(null);
  const [installed, setInstalled] = useState<StoreInstalled>({});
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [installState, setInstallState] = useState<Record<string, InstallState>>({});
  const didInitialSearch = useRef(false);
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  // The sort menu hangs off its button; anything outside it, or Escape, closes it.
  useEffect(() => {
    if (!sortOpen) return;

    const onDown = (event: MouseEvent) => {
      if (!sortRef.current?.contains(event.target as Node)) setSortOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSortOpen(false);
    };

    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [sortOpen]);

  const refreshInstalled = useCallback(async () => {
    try {
      setInstalled(await window.bestclient.installedMods());
    } catch {
      // The store works without the manifest, only the installed badges vanish.
    }
  }, []);

  useEffect(() => {
    void refreshInstalled();
  }, [refreshInstalled]);

  const run = useCallback(async (raw: string, nextPage: number, index: StoreSortIndex) => {
    const value = raw.trim();
    setSearching(true);
    setSearchError(null);

    try {
      const result = await window.bestclient.searchMods(value, nextPage, index);
      setHits(result.hits);
      setHasMore(result.hasMore);
      setActiveQuery(value);
      setPage(nextPage);
      setSort(index);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : String(error));
      setHits(null);
    } finally {
      setSearching(false);
    }
  }, []);

  // On open: no query, just the filtered browse (client Fabric 1.21.11), by downloads.
  useEffect(() => {
    if (!didInitialSearch.current) {
      didInitialSearch.current = true;
      void run('', 0, 'downloads');
    }
  }, [run]);

  const remove = useCallback(async (slug: string) => {
    setInstalled(await window.bestclient.removeMod(slug));
    setInstallState((prev) => ({ ...prev, [slug]: 'idle' }));
  }, []);

  const install = useCallback(
    async (hit: StoreHit) => {
      setInstallState((prev) => ({ ...prev, [hit.slug]: 'working' }));

      try {
        await window.bestclient.installMod(hit.slug);
        setInstallState((prev) => ({ ...prev, [hit.slug]: 'done' }));
        await refreshInstalled();
      } catch (error) {
        setInstallState((prev) => ({ ...prev, [hit.slug]: 'error' }));

        if (error instanceof Error) {
          setSearchError(`Could not install ${hit.title}: ${error.message}`);
        }
      }
    },
    [refreshInstalled],
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    // Only run a search when the box actually has something in it; an empty box keeps
    // the current browse.
    if (query.trim()) void run(query, 0, query.trim() ? 'relevance' : sort);
  };

  return (
    // Wider than the other screens on purpose: this is a browsing surface, and a page of
    // twelve results only reads as a catalogue if the cards get room to breathe.
    <div className="mx-auto w-full max-w-5xl">
      <div className="rise flex flex-wrap items-center justify-between gap-3">
        <h2 className="display-caps flex items-center gap-2.5 text-[26px] leading-none text-ink">
          <img src="/modrinth.png" alt="" aria-hidden="true" width={24} height={24} draggable={false} />
          Modrinth
        </h2>
        {hits ? (
          <span className="flex items-center gap-2 rounded-lg bg-surface px-3 py-1.5">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" className="text-rose-soft">
              <path d="M8 1.5 V9.5 M4.5 6 L8 9.7 L11.5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2.5 13.5 H13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="font-mono text-[12px] tabular-nums text-rose-soft">
              {Object.keys(installed).length} installed
            </span>
          </span>
        ) : null}
      </div>

      {/* The search sits on its own soft panel, in front of the wallpaper: it starts at the
          search bar, reaches down past the pager, and never touches the edges of the page. */}
      <div
        className="rise mt-6 rounded-2xl border border-edge bg-panel p-5 backdrop-blur-md sm:p-6"
        style={{ animationDelay: '60ms' }}
      >
        <form onSubmit={submit} className="flex flex-wrap gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Fabric mods for Minecraft…"
            aria-label="Search Modrinth"
            className="min-w-0 flex-1 rounded-lg bg-surface px-4 py-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-faint hover:bg-surface-high"
          />

          {/* Result order. Changing it re-runs the current search from page one. */}
          <div ref={sortRef} className="relative shrink-0">
            <button
              type="button"
              disabled={searching}
              onClick={() => setSortOpen((open) => !open)}
              aria-haspopup="listbox"
              aria-expanded={sortOpen}
              className="flex cursor-pointer items-center gap-2 rounded-lg bg-surface pl-3 text-white transition-colors hover:bg-surface-high hover:text-white disabled:cursor-default disabled:opacity-60"
            >
              {/* Filter glyph: three stacked rules, shortest at the bottom. */}
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
                <path d="M2 4 H14 M4 8 H12 M6.5 12 H9.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <span className="py-2.5 pr-3 text-[12px] font-semibold">
                {SORTS.find((option) => option.id === sort)?.label ?? 'Sort'}
              </span>
            </button>

            {sortOpen && (
              <div
                role="listbox"
                aria-label="Sort results"
                className="absolute right-0 top-full z-40 mt-2 w-44 rounded-xl bg-surface p-1 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)] space-y-0.5"
              >
                {SORTS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={option.id === sort}
                    onClick={() => {
                      setSortOpen(false);
                      if (option.id !== sort) void run(activeQuery, 0, option.id);
                    }}
                    className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium transition-colors ${
                      option.id === sort
                        ? 'bg-rose/15 text-rose-soft'
                        : 'text-ink-dim hover:bg-surface-high hover:text-ink'
                    }`}
                  >
                    {option.label}
                    {option.id === sort && (
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
                        <path d="M3 8.5 L6.5 12 L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={searching || !query.trim()}
            aria-label="Search Modrinth"
            title="Search Modrinth"
            className="flex cursor-pointer items-center gap-2 rounded-lg bg-surface px-4 py-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-surface-high hover:text-white disabled:cursor-default disabled:opacity-50"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true" className={searching ? 'animate-pulse' : ''}>
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.6" />
              <path d="M10.5 10.5 L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>

        {searchError ? (
          <p className="mt-4 rounded-lg bg-warn/15 px-4 py-3 text-[12px] leading-relaxed text-warn">
            {searchError}
          </p>
        ) : null}

        {/* Fixed column counts rather than auto-fill: a page holds twelve results, and 12
            divides by 2, 3 and 4, so every row is full at every width. An auto-fitting grid
            would leave a ragged two-card row at the bottom. */}
        <div
          className="rise mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-4"
          style={{ animationDelay: '120ms' }}
        >
          {hits?.length ? (
            hits.map((hit) => {
              const present = installed[hit.slug];
              const state = present ? 'done' : (installState[hit.slug] ?? 'idle');
              const usingFallback = !hit.bannerUrl;

              return (
                <div
                  key={hit.slug}
                  className="flex flex-col overflow-hidden rounded-xl bg-surface transition-colors hover:bg-surface-high"
                >
                  {/* Banner: the wide gallery image, separate from the icon. Mods with no
                      gallery art fall back to the BestClient landing banner, zoomed in so it
                      fills the card rather than sitting tiny and far away. */}
                  <span className="block aspect-[16/9] w-full overflow-hidden bg-void">
                    <img
                      src={hit.bannerUrl ?? '/landing.webp'}
                      alt=""
                      aria-hidden="true"
                      loading="lazy"
                      className={`h-full w-full object-cover ${usingFallback ? 'scale-150' : ''}`}
                      draggable={false}
                    />
                  </span>

                  <div className="flex min-w-0 flex-1 flex-col p-3">
                    <div className="flex items-center gap-2.5">
                      {hit.iconUrl ? (
                        <img
                          src={hit.iconUrl}
                          alt=""
                          aria-hidden="true"
                          loading="lazy"
                          className="h-8 w-8 shrink-0 rounded-[25%] bg-void object-cover"
                          draggable={false}
                        />
                      ) : (
                        <span className="brand-gradient grid h-8 w-8 shrink-0 place-items-center rounded-[25%] font-display text-[13px] font-bold text-void">
                          {hit.title.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">
                        {hit.title}
                      </span>
                    </div>

                    <span className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-ink-dim">
                      {hit.description}
                    </span>

                    {hit.author && (
                      <span className="mt-2 flex items-center gap-1.5 text-[10.5px] text-ink-faint">
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 16 16"
                          fill="none"
                          className="shrink-0"
                          aria-hidden="true"
                        >
                          <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.5" />
                          <path
                            d="M2.5 14 C3 10.5 5.2 9 8 9 C10.8 9 13 10.5 13.5 14"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                          />
                        </svg>
                        <span className="truncate">{hit.author}</span>
                      </span>
                    )}

                    {hit.categories.length > 0 && (
                      <span className="mt-2 flex flex-wrap gap-1">
                        {hit.categories.map((tag) => (
                          <span
                            key={tag}
                            className="rounded bg-surface-high px-1.5 py-px font-mono text-[9px] uppercase tracking-wide text-ink-dim"
                          >
                            {tag}
                          </span>
                        ))}
                      </span>
                    )}

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-3 font-mono text-[10px] tabular-nums text-ink-faint">
                        <span className="flex items-center gap-1" title="Downloads">
                          <svg
                            width="11"
                            height="11"
                            viewBox="0 0 16 16"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path
                              d="M8 1.5 V9.5 M4.5 6 L8 9.7 L11.5 6"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path d="M2.5 13.5 H13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          </svg>
                          {formatDownloads(hit.downloads)}
                        </span>
                        <span className="flex items-center gap-1" title="Followers">
                          <svg
                            width="11"
                            height="11"
                            viewBox="0 0 16 16"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path
                              d="M8 3.2 C6.4 1.3 3.6 1.4 2.2 3.4 C0.9 5.3 1.4 8.1 3.7 10.4 C4.9 11.6 7 13.4 8 14.4 C9 13.4 11.1 11.6 12.3 10.4 C14.6 8.1 15.1 5.3 13.8 3.4 C12.4 1.4 9.6 1.3 8 3.2 Z"
                              stroke="currentColor"
                              strokeWidth="1.2"
                              strokeLinejoin="round"
                            />
                          </svg>
                          {formatDownloads(hit.follows)}
                        </span>
                      </span>

                      {present ? (
                        <span className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={state === 'working'}
                            onClick={() => void install(hit)}
                            aria-label={`Update ${hit.title}`}
                            className="cursor-pointer rounded-lg bg-surface-high px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-surface-top disabled:cursor-default disabled:opacity-60"
                          >
                            {state === 'working' ? 'Updating…' : 'Update'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void remove(hit.slug)}
                            aria-label={`Remove ${hit.title}`}
                            title="Remove"
                            className="grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-lg bg-surface-high text-white transition-colors hover:bg-danger/20 hover:text-danger"
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                              <path d="M1 1 L11 11 M11 1 L1 11" stroke="currentColor" strokeWidth="1.5" />
                            </svg>
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={state === 'working'}
                          onClick={() => void install(hit)}
                          aria-label={`Download ${hit.title}`}
                          // Solid, one colour, bold: the only thing on the card you are meant
                          // to press. It sits in the muted brand pink and lifts to the bright
                          // one under the cursor, so the target answers before it is clicked.
                          className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-[11px] font-bold transition-colors disabled:cursor-default ${
                            state === 'error'
                              ? 'bg-danger text-white'
                              : 'bg-rose-deep text-white hover:bg-rose'
                          }`}
                        >
                          {state === 'working' ? 'Downloading…' : state === 'error' ? 'Failed' : 'Download'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="col-span-full py-8 text-center text-[12.5px] text-ink-faint">
              {searching ? 'Searching Modrinth…' : 'No matching mods.'}
            </p>
          )}
        </div>

        {/* Pagination. Every page is filled to ten results before it is shown, so the grid
            never thins out just because a hit was already in the pack. */}
        {hits && (page > 0 || hasMore) ? (
          <div className="mt-6 flex items-center justify-center gap-3">
            <PagerButton disabled={page === 0 || searching} onClick={() => void run(activeQuery, page - 1, sort)}>
              ‹ Previous
            </PagerButton>
            <span className="font-mono text-[12px] tabular-nums text-ink-faint">Page {page + 1}</span>
            <PagerButton disabled={!hasMore || searching} onClick={() => void run(activeQuery, page + 1, sort)}>
              Next ›
            </PagerButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PagerButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="cursor-pointer rounded-lg bg-surface px-4 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-surface-high hover:text-white disabled:cursor-default disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function formatDownloads(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}
