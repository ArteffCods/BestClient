'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { InventoryMod, ModVerifyResult, ModVersionOption } from '@/types/bestclient';

interface Props {
  /** Slugs with no build for the target Minecraft version. */
  unavailable: string[];
  /** Pack slug -> version number the player pinned by hand. */
  pins: Record<string, string>;
  onPin: (slug: string, versionNumber: string | null) => void;
}

/**
 * Everything that is actually in the mods folder, in one flat list: the client's own
 * mods, anything installed from Modrinth, and anything dropped in by hand. Nothing is
 * categorised - a mod is a mod, and the only thing that matters per row is whether it is
 * on, which build it is, and whether you want it gone.
 */
export function ModsView({ unavailable, pins, onPin }: Props) {
  const [mods, setMods] = useState<InventoryMod[] | null>(null);
  const [query, setQuery] = useState('');
  const [drop, setDrop] = useState(false);
  const [verify, setVerify] = useState<ModVerifyResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [latest, setLatest] = useState<Record<string, string> | null>(null);
  const [updatingSlug, setUpdatingSlug] = useState<string | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);
  const dragDepth = useRef(0);

  const refresh = useCallback(async () => {
    setMods(await window.bestclient.modInventory());
    setVerify(await window.bestclient.verifyMods());
    // Which slugs have a newer build than what is on disk, straight from Modrinth.
    setLatest(await window.bestclient.checkModUpdates());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const noteFromResult = useCallback(
    (result: { imported: string[]; skipped: string[] }) => {
      if (result.imported.length === 0 && result.skipped.length === 0) return;

      const added = result.imported.length ? `Added ${result.imported.join(', ')}` : '';
      const skipped = result.skipped.length ? `Skipped ${result.skipped.join(', ')}` : '';

      setNote([added, skipped].filter(Boolean).join(' · '));
      void refresh();
    },
    [refresh],
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDrop(false);

      const files = Array.from(event.dataTransfer.files).filter((file) => /\.jar$/i.test(file.name));

      if (files.length === 0) {
        setNote('Only .jar files can be added.');
        return;
      }

      noteFromResult(await window.bestclient.importModFiles(files));
    },
    [noteFromResult],
  );

  const handleBrowse = useCallback(async () => {
    noteFromResult(await window.bestclient.browseModFiles());
  }, [noteFromResult]);

  const toggle = useCallback(async (id: string, next: boolean) => {
    setMods(await window.bestclient.setModEnabled(id, next));
    setVerify(await window.bestclient.verifyMods());
  }, []);

  const remove = useCallback(async (id: string) => {
    setMods(await window.bestclient.deleteMod(id));
    setVerify(await window.bestclient.verifyMods());
  }, []);

  // Instant update: the newest build is fetched from Modrinth and swapped in on the
  // spot, no need to wait for the next launch.
  const update = useCallback(
    async (slug: string) => {
      setUpdatingSlug(slug);

      try {
        await window.bestclient.updateMod(slug);
        await refresh();
        setNote('Updated to the newest build.');
      } catch (cause) {
        setNote(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setUpdatingSlug(null);
      }
    },
    [refresh],
  );

  /**
   * Moves everything it safely can to its newest build.
   *
   * The main process works out the plan first, reading each candidate build's own
   * dependency block, so a mod whose new build clashes with something else in the set is
   * left alone. Whatever was held back is named here rather than left to be discovered as
   * a game that will not start.
   */
  const updateAll = useCallback(async () => {
    setUpdatingAll(true);
    setNote(null);

    try {
      const result = await window.bestclient.updateAllMods();

      const lines = [
        result.updated.length
          ? `Updated ${result.updated.length} mod${result.updated.length === 1 ? '' : 's'}.`
          : 'Everything is already on its newest build.',
        ...result.skipped.map((entry) => `${entry.slug}: ${entry.reason}`),
        ...result.failed.map((entry) => `${entry.slug} failed: ${entry.reason}`),
      ];

      setNote(lines.join(' · '));
      await refresh();
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUpdatingAll(false);
    }
  }, [refresh]);

  const visible = useMemo(() => {
    if (!mods) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return mods;

    return mods.filter(
      (mod) =>
        mod.name.toLowerCase().includes(needle) ||
        (mod.slug ?? '').toLowerCase().includes(needle) ||
        (mod.fileName ?? '').toLowerCase().includes(needle),
    );
  }, [mods, query]);

  if (!mods) {
    return <p className="text-sm text-ink-faint">Loading mod list…</p>;
  }

  const activeCount = mods.filter((mod) => mod.enabled).length;
  const dirty = (verify?.unknown ?? []).length > 0;

  return (
    <div
      className="mx-auto w-full max-w-5xl"
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current++;
        setDrop(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current--;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDrop(false);
        }
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <div className="rise flex flex-wrap items-center justify-between gap-3">
        <h2 className="display-caps text-[26px] leading-none text-ink">Mods</h2>

        {/* The counter used to sit here. It was a number nobody acts on; the one thing you
            actually want from this screen is everything on its newest build. */}
        <button
          type="button"
          disabled={updatingAll}
          onClick={() => void updateAll()}
          className="flex cursor-pointer items-center gap-2 rounded-lg bg-rose-deep px-4 py-2 text-[12.5px] font-bold text-void transition-colors hover:bg-rose disabled:cursor-default disabled:opacity-60"
        >
          {/* A download arrow into a tray: this pulls new builds down, it does not reload. */}
          <svg
            width="15"
            height="15"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className={updatingAll ? 'animate-pulse' : ''}
          >
            <path
              d="M8 1.5 V9.5 M4.6 6.2 L8 9.7 L11.4 6.2"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M2.5 11.5 V13 a1 1 0 0 0 1 1 h9 a1 1 0 0 0 1-1 v-1.5"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {updatingAll ? 'Updating…' : 'Update all'}
        </button>
      </div>

      {/* The same soft panel as the store: behind the filter, the list and the drop zone,
          rounded and never touching the edges of the page. */}
      <div
        className="rise mt-5 rounded-2xl border border-edge bg-panel p-5 backdrop-blur-md sm:p-6"
        style={{ animationDelay: '40ms' }}
      >
        {/* Filter across everything installed, by name, slug or file name. */}
        <div className="relative">
          <svg
            width="15"
            height="15"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
          >
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M10.5 10.5 L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your mods…"
            aria-label="Search installed mods"
            className="w-full rounded-lg bg-surface py-2.5 pl-10 pr-4 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-faint hover:bg-surface-high"
          />
        </div>

        {/* A jar that matches a known hacked client or injector gets its own banner on
            top: it is not a case of forgetting where a mod came from. */}
        {verify && verify.flagged.length > 0 ? (
          <p className="rise mt-5 rounded-lg bg-danger/15 px-4 py-3 text-[12px] leading-relaxed text-danger">
            The game will not start: {verify.flagged.join(', ')}{' '}
            {verify.flagged.length === 1 ? 'looks' : 'look'} like a hacked client or
            injector. Delete {verify.flagged.length === 1 ? 'it' : 'them'} from the mods
            folder before launching.
          </p>
        ) : null}

        {/* Only the blocking case is surfaced - a jar Modrinth doesn't publish stops the
            game. The all-clear count is deliberately not shown. */}
        {verify && dirty ? (
          <p className="rise mt-5 rounded-lg bg-danger/15 px-4 py-3 text-[12px] leading-relaxed text-danger">
            The game will not start: {verify.unknown.join(', ')}{' '}
            {verify.unknown.length === 1 ? 'is' : 'are'} not from Modrinth. Switch
            {verify.unknown.length === 1 ? ' it' : ' them'} off below, delete
            {verify.unknown.length === 1 ? ' it' : ' them'}, or reinstall from the store.
          </p>
        ) : null}

        {note ? <p className="mt-3 text-[11.5px] text-rose-soft">{note}</p> : null}

        {/* Two per row so the list reads as a shelf rather than a ledger; one per row when
            the window is too narrow to keep the controls from crowding the name. */}
        {visible.length === 0 ? (
          <p className="py-8 text-center text-[12.5px] text-ink-faint">
            {query.trim() ? 'No mod matches that.' : 'No mods installed yet.'}
          </p>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {visible.map((mod) => {
              const displayed = mod.slug && pins[mod.slug] ? pins[mod.slug] : mod.version;
              const newest = mod.slug ? (latest?.[mod.slug] ?? null) : null;
              const hasUpdate = newest !== null && newest !== displayed;

              return (
                <ModRow
                  key={mod.id}
                  mod={mod}
                  unavailable={Boolean(mod.slug && unavailable.includes(mod.slug))}
                  pinnedVersion={mod.slug ? pins[mod.slug] : undefined}
                  latest={hasUpdate ? newest : undefined}
                  updating={mod.slug ? updatingSlug === mod.slug : false}
                  onToggle={toggle}
                  onDelete={remove}
                  onPin={onPin}
                  onUpdate={update}
                  onChanged={refresh}
                />
              );
            })}
          </div>
        )}

        {/* Add-your-own: drag & drop or a native Windows file picker. */}
        {/* At rest this is a plain grey panel; the dashed outline only appears while a file is
            actually over the window, where it means "let go here". */}
        <div
          className={`mt-4 flex flex-col items-center gap-3 rounded-xl px-4 py-5 text-center transition-colors ${
            drop ? 'border-2 border-dashed border-rose bg-rose/10' : 'bg-surface'
          }`}
        >
          <p className="text-[11.5px] leading-relaxed text-ink-faint">
            {drop ? 'Drop the jars here' : 'Drag & drop .jar files here, or'}
          </p>
          {!drop ? (
            <button
              type="button"
              onClick={handleBrowse}
              className="flex cursor-pointer items-center gap-2 rounded-lg bg-rose-deep px-4 py-2 text-[12px] font-bold text-white transition-colors hover:bg-rose"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none">
                <path
                  d="M1.5 4 a1 1 0 0 1 1-1 h3 l1.5 1.5 h6 a1 1 0 0 1 1 1 v6 a1 1 0 0 1-1 1 h-11 a1 1 0 0 1-1-1 z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
              </svg>
              Browse files
            </button>
          ) : null}
          <p className="text-[10.5px] leading-relaxed text-ink-faint/80">
            Only mods published on Modrinth will launch - anything else stops the game at start.
          </p>
        </div>
      </div>
    </div>
  );
}

function ModRow({
  mod,
  unavailable,
  pinnedVersion,
  latest,
  updating,
  onToggle,
  onDelete,
  onPin,
  onUpdate,
  onChanged,
}: {
  mod: InventoryMod;
  unavailable: boolean;
  pinnedVersion?: string;
  /** Newest build number, when it is newer than the build on disk. */
  latest?: string;
  updating?: boolean;
  onToggle: (id: string, next: boolean) => void;
  onDelete: (id: string) => void;
  onPin: (slug: string, versionNumber: string | null) => void;
  onUpdate: (slug: string) => Promise<void>;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [placeAbove, setPlaceAbove] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The build menu hangs off its button; anything outside it, or Escape, closes it.
  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !anchorRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleOpen = () => {
    if (open) {
      setOpen(false);
      return;
    }

    // Open below the button when it fits, above it when the window is too short.
    const rect = anchorRef.current?.getBoundingClientRect();
    setPlaceAbove(Boolean(rect && rect.bottom + 340 > window.innerHeight));
    setOpen(true);
  };

  return (
    <div
      // Solid grey card, no frame. Whether the mod is on is the switch's job to say, so a
      // card that is off simply steps back instead of carrying a second signal.
      className={`flex flex-col gap-3 rounded-xl bg-surface px-4 py-4 transition-colors sm:px-5 ${
        mod.enabled ? '' : 'opacity-70'
      } ${unavailable ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center gap-4">
        <ModIcon mod={mod} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="min-w-0 truncate text-[16px] font-semibold text-ink">{mod.name}</span>
            {mod.source === 'client' ? (
              <span className="shrink-0 rounded bg-rose/20 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-rose-soft">
                Client
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-dim">{mod.note}</span>
        </span>
      </div>

      {/* Bottom-right controls: update (when one exists), change build, delete for good,
          then the on/off switch. Locked mods (Fabric API, Sodium, the client's own)
          cannot be deleted or turned off. */}
      <div className="mt-auto flex items-center justify-end gap-2.5">
        {latest && mod.slug ? (
          <button
            type="button"
            disabled={updating}
            onClick={() => void onUpdate(mod.slug!)}
            title={`Update ${mod.name} to ${latest}`}
            className="flex h-[30px] cursor-pointer items-center gap-1.5 rounded-lg bg-rose/15 px-2.5 font-mono text-[10.5px] font-bold text-rose-soft transition-colors hover:bg-rose/25 disabled:cursor-default disabled:opacity-60"
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M8 13.5 V3 M4.5 6.5 L8 3 L11.5 6.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {updating ? 'Updating…' : 'Update'}
          </button>
        ) : null}

        {mod.slug ? (
          <span className="relative">
            <button
              ref={anchorRef}
              type="button"
              onClick={toggleOpen}
              aria-haspopup="listbox"
              aria-expanded={open}
              className="cursor-pointer rounded-lg bg-surface-high px-3 py-1.5 font-mono text-[11px] text-white transition-colors hover:bg-surface-top hover:text-white"
            >
              {pinnedVersion ?? mod.version ?? 'Version'}
            </button>

            {open ? (
              <VersionMenu
                mod={mod}
                pinnedVersion={pinnedVersion}
                onPin={onPin}
                onChanged={onChanged}
                onClose={() => setOpen(false)}
                placeAbove={placeAbove}
                menuRef={menuRef}
              />
            ) : null}
          </span>
        ) : null}

        {!mod.locked ? (
          <button
            type="button"
            onClick={() => onDelete(mod.id)}
            aria-label={`Delete ${mod.name}`}
            title="Delete mod"
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg bg-danger/20 text-danger transition-colors hover:bg-danger/40"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M2.5 4 H13.5 M6.5 4 V2.8 a0.8 0.8 0 0 1 0.8-0.8 h1.4 a0.8 0.8 0 0 1 0.8 0.8 V4 M4 4 l0.6 9 a1 1 0 0 0 1 0.95 h4.8 a1 1 0 0 0 1-0.95 L12 4 M6.5 6.5 V11.5 M9.5 6.5 V11.5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}

        <Switch
          checked={mod.enabled || mod.locked}
          disabled={mod.locked}
          onChange={(next) => onToggle(mod.id, next)}
          label={`${mod.name} enabled`}
        />
      </div>
    </div>
  );
}

/**
 * Build menu, backed by the Modrinth version list for the target Minecraft version.
 *
 * It hangs directly off the version button - below it when the window has room, above it
 * when it does not - so the grid never moves, and nothing covers the rest of the window.
 *
 * A store mod switches build immediately - the jar is swapped on disk. A pack mod is
 * pinned instead, and the installer picks the pinned build up on the next launch, because
 * the pack's jars are managed as a set.
 */
function VersionMenu({
  mod,
  pinnedVersion,
  onPin,
  onChanged,
  onClose,
  placeAbove,
  menuRef,
}: {
  mod: InventoryMod;
  pinnedVersion?: string;
  onPin: (slug: string, versionNumber: string | null) => void;
  onChanged: () => void;
  onClose: () => void;
  placeAbove: boolean;
  menuRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [versions, setVersions] = useState<ModVersionOption[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mod.slug) return;

    let cancelled = false;

    void window.bestclient
      .modVersions(mod.slug)
      .then((list) => {
        if (!cancelled) setVersions(list);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [mod.slug]);

  const choose = async (option: ModVersionOption) => {
    if (!mod.slug) return;

    setBusy(option.id);
    setError(null);

    try {
      if (mod.source === 'store') {
        await window.bestclient.installMod(mod.slug, option.id);
        onChanged();
      } else {
        onPin(mod.slug, option.versionNumber);
      }

      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const current = pinnedVersion ?? mod.version;

  return (
    <div
      ref={menuRef}
      role="listbox"
      aria-label={`Choose a build of ${mod.name}`}
      className={`absolute right-0 z-30 w-72 rounded-xl border border-edge bg-surface p-3 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)] ${
        placeAbove ? 'bottom-full mb-2' : 'top-full mt-2'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-ink">{mod.name}</p>
          <p className="eyebrow mt-1">Choose a build</p>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-lg bg-surface-high text-white transition-colors hover:bg-surface-top hover:text-white"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M1 1 L11 11 M11 1 L1 11" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>

      {error ? <p className="mt-3 text-[11px] text-danger">{error}</p> : null}

      {versions === null && !error ? (
        <p className="mt-3 text-[11.5px] text-ink-faint">Loading builds from Modrinth…</p>
      ) : null}

      {versions?.length === 0 ? (
        <p className="mt-3 text-[11.5px] text-ink-faint">No build published for this version.</p>
      ) : null}

      {versions && versions.length > 0 ? (
        <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto pr-1">
          {versions.map((option) => {
            const active = option.versionNumber === current;

            return (
              <li key={option.id}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void choose(option)}
                  className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-60 ${
                    active ? 'bg-rose/15 text-rose-soft' : 'text-ink-dim hover:bg-surface-high'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
                    {option.versionNumber}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] uppercase text-ink-faint">
                    {busy === option.id ? 'working…' : option.channel}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-3 pt-3">
        <p className="text-[10.5px] leading-relaxed text-ink-faint">
          {mod.source === 'pack'
            ? 'Pack mods switch build on the next launch.'
            : 'The jar is swapped straight away.'}
        </p>
        {pinnedVersion && mod.source === 'pack' ? (
          <button
            type="button"
            onClick={() => {
              onPin(mod.slug!, null);
              onClose();
            }}
            className="shrink-0 cursor-pointer font-mono text-[10px] text-ink-faint underline underline-offset-2 transition-colors hover:text-rose-soft"
          >
            use newest
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** On/off pill switch: green when on, grey when off. */
export function Switch({
  checked,
  disabled = false,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-[#2e9e5b]' : 'bg-surface-top'
      } ${disabled ? 'cursor-default opacity-70' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-all ${
          checked ? 'left-[22px] bg-white' : 'left-[3px] bg-ink-faint'
        }`}
      />
    </button>
  );
}

function ModIcon({ mod }: { mod: InventoryMod }) {
  return (
    <span className="grid h-[52px] w-[52px] shrink-0 place-items-center">
      {mod.iconUrl ? (
        <img
          src={mod.iconUrl}
          alt=""
          aria-hidden="true"
          loading="lazy"
          className="h-full w-full rounded-[25%] bg-void object-cover"
          draggable={false}
        />
      ) : (
        <span className="brand-gradient grid h-full w-full place-items-center rounded-[25%] font-display text-[17px] font-bold text-void">
          {mod.name.slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}
