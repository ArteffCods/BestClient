'use client';

import type { ProfileId, ProfileView } from '@/types/bestclient';

/**
 * The two builds, side by side.
 *
 * Each card carries its own artwork rather than a photograph: the two profiles are moods,
 * not places, so a hot pink diagonal for Fight and a cool green horizon for Survival say
 * more in a sixteenth of the file size - and they never fail to load.
 *
 * The dialog covers the window because switching profile changes which Minecraft the
 * client installs and which game folder it uses. That is not a toggle to bump into.
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
      aria-label="Choose a build"
      className="fixed inset-0 z-50 grid place-items-center bg-void/70 p-6 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl bg-surface p-5 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)]"
      >
        <div className="flex items-start justify-between gap-3">
          <span>
            <p className="display-caps text-[18px] leading-none text-ink">Choose a build</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">
              Each build is its own Minecraft, its own mods and its own worlds. Switching
              keeps both installed - nothing is deleted.
            </p>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-lg bg-surface-high text-ink-faint transition-colors hover:bg-surface-top hover:text-ink"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M1 1 L11 11 M11 1 L1 11" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {profiles.map((entry) => (
            <ProfileCard
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

function ProfileCard({
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
      className={`group flex cursor-pointer flex-col overflow-hidden rounded-xl bg-surface-high text-left transition-colors hover:bg-surface-top disabled:cursor-default disabled:opacity-60 ${
        selected ? 'ring-2 ring-rose' : ''
      }`}
    >
      <span className="relative block h-24 w-full overflow-hidden">
        <ProfileArt id={profile.id} />

        {selected ? (
          <span className="absolute right-2 top-2 rounded-full bg-void/70 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-rose-soft">
            In use
          </span>
        ) : null}
      </span>

      <span className="block p-4">
        <span className="flex items-baseline justify-between gap-2">
          <span className="display-caps text-[17px] leading-none text-ink">{profile.name}</span>
          <span className="font-mono text-[11px] tabular-nums text-rose-soft">
            {profile.minecraft}
          </span>
        </span>
        <span className="mt-2 block text-[12px] leading-relaxed text-ink-dim">
          {profile.tagline}
        </span>
        <span className="mt-2 block font-mono text-[10.5px] tabular-nums text-ink-faint">
          {profile.mods} mods
        </span>
      </span>
    </button>
  );
}

/** Card artwork, drawn rather than loaded: two gradients and a horizon. */
function ProfileArt({ id }: { id: ProfileId }) {
  if (id === 'fight') {
    return (
      <svg
        viewBox="0 0 240 96"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="h-full w-full transition-transform duration-300 group-hover:scale-[1.03]"
      >
        <defs>
          <linearGradient id="art-fight" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#3a1030" />
            <stop offset="55%" stopColor="#d94a9c" />
            <stop offset="100%" stopColor="#ff75c3" />
          </linearGradient>
        </defs>
        <rect width="240" height="96" fill="url(#art-fight)" />
        {/* Crossed blades: the one shape that says PvP without a word. */}
        <g stroke="#0d0913" strokeWidth="5" strokeLinecap="round" opacity="0.55">
          <path d="M92 74 L148 26" />
          <path d="M148 74 L92 26" />
        </g>
        <g stroke="#ffe3f2" strokeWidth="2" strokeLinecap="round" opacity="0.9">
          <path d="M92 74 L148 26" />
          <path d="M148 74 L92 26" />
        </g>
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 240 96"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="h-full w-full transition-transform duration-300 group-hover:scale-[1.03]"
    >
      <defs>
        <linearGradient id="art-survival" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#12283a" />
          <stop offset="60%" stopColor="#2f6b52" />
          <stop offset="100%" stopColor="#63d492" />
        </linearGradient>
      </defs>
      <rect width="240" height="96" fill="url(#art-survival)" />
      {/* A horizon with trees: a world you live in rather than fight in. */}
      <circle cx="196" cy="26" r="12" fill="#ffe9b0" opacity="0.85" />
      <path d="M0 74 L52 52 L96 70 L142 46 L192 68 L240 54 L240 96 L0 96 Z" fill="#0f2a22" opacity="0.75" />
      <g fill="#0d211b">
        <path d="M42 78 L52 58 L62 78 Z" />
        <path d="M128 82 L140 56 L152 82 Z" />
        <path d="M182 80 L191 62 L200 80 Z" />
      </g>
    </svg>
  );
}
