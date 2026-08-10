'use client';

import type { ProfileId, ProfileView } from '@/types/bestclient';

/**
 * The versions the client can run, as pictures.
 *
 * Nothing but the artwork and the version number on it: the mods, the packs and the
 * settings are the same on all of them, so there is nothing to compare - the only question
 * is which Minecraft you want to be in.
 *
 * The dialog covers the window because switching version changes what the launcher
 * installs and which game folder it uses. That is not a control to brush past.
 */
export function ProfilePicker({
  profiles,
  active,
  busy,
  onPick,
  onClose,
}: {
  profiles: ProfileView[];
  active: ProfileId;
  busy: boolean;
  onPick: (id: ProfileId) => void;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose a Minecraft version"
      className="fixed inset-0 z-50 grid place-items-center bg-void/70 p-5 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-6xl rounded-2xl bg-surface p-7 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)]"
      >
        <div className="flex items-start justify-between gap-4">
          <span>
            <p className="display-caps text-[24px] leading-none text-ink">Choose a version</p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-faint">
              The same mods and settings on every one. Each keeps its own worlds - switching
              never touches the others.
            </p>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg bg-surface-high text-ink-faint transition-colors hover:bg-surface-top hover:text-ink"
          >
            <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M1 1 L11 11 M11 1 L1 11" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {profiles.map((entry) => (
            <VersionCard
              key={entry.id}
              profile={entry}
              selected={entry.id === active}
              busy={busy}
              onPick={onPick}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function VersionCard({
  profile,
  selected,
  busy,
  onPick,
}: {
  profile: ProfileView;
  selected: boolean;
  busy: boolean;
  onPick: (id: ProfileId) => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onPick(profile.id)}
      aria-pressed={selected}
      aria-label={`Minecraft ${profile.id}`}
      className={`group relative block aspect-video w-full cursor-pointer overflow-hidden rounded-xl bg-void transition-opacity disabled:cursor-default disabled:opacity-60 ${
        selected ? 'ring-2 ring-rose' : ''
      }`}
    >
      <img
        src={profile.image}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={`h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04] ${
          selected ? '' : 'brightness-[0.72] group-hover:brightness-100'
        }`}
      />

      {/* The artwork is busy everywhere, so the number gets its own shade to sit on. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/75 to-transparent"
      />

      <span className="absolute left-4 top-3 display-caps text-[19px] leading-none text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
        {profile.id}
      </span>
    </button>
  );
}
