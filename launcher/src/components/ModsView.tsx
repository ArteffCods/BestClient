'use client';

import type { PackModView, PackView } from '@/types/bestclient';

interface Props {
  pack: PackView | null;
  enabled: string[];
  unavailable: string[];
  /** Libraries the launcher added automatically; known only after an install run. */
  dependencies: string[];
  onToggle: (slug: string, next: boolean) => void;
}

export function ModsView({ pack, enabled, unavailable, onToggle }: Props) {
  if (!pack) {
    return <p className="text-sm text-ink-faint">Loading mod list…</p>;
  }

  const activeCount = pack.mods.filter((mod) => mod.locked || enabled.includes(mod.slug)).length;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rise flex items-baseline justify-between">
        <h2 className="display-caps text-[26px] leading-none text-ink">Mods</h2>
        <span className="font-mono text-[12px] tabular-nums text-rose-soft">
          {activeCount}/{pack.mods.length} active
        </span>
      </div>

      <div className="rise mt-6 space-y-2" style={{ animationDelay: '60ms' }}>
        {pack.mods.map((mod) => (
          <ModRow
            key={mod.slug}
            mod={mod}
            checked={mod.locked || enabled.includes(mod.slug)}
            unavailable={unavailable.includes(mod.slug)}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

function ModRow({
  mod,
  checked,
  unavailable,
  onToggle,
}: {
  mod: PackModView;
  checked: boolean;
  unavailable: boolean;
  onToggle: (slug: string, next: boolean) => void;
}) {
  return (
    <label
      className={`grid grid-cols-[46px_1fr_auto] items-center gap-4 rounded-lg border bg-panel px-4 py-3.5 transition-colors ${
        mod.locked
          ? 'cursor-default border-edge'
          : checked
            ? 'cursor-pointer border-rose/30 hover:border-rose/60'
            : 'cursor-pointer border-edge hover:border-edge-bright'
      } ${unavailable ? 'opacity-50' : ''}`}
    >
      <ModIcon mod={mod} />
      <span className="min-w-0">
        <span className="block text-[15px] font-medium text-ink">{mod.name}</span>
        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ink-dim">{mod.note}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={mod.locked}
        onChange={(event) => onToggle(mod.slug, event.target.checked)}
        className="h-4 w-4 shrink-0 accent-rose"
      />
    </label>
  );
}

function ModIcon({ mod }: { mod: PackModView }) {
  return (
    <span className="grid h-[46px] w-[46px] shrink-0 place-items-center">
      {mod.iconUrl ? (
        <img
          src={mod.iconUrl}
          alt=""
          aria-hidden="true"
          loading="lazy"
          className="h-full w-full rounded-[25%] border border-edge-bright bg-void object-cover"
          draggable={false}
        />
      ) : (
        <span className="brand-gradient grid h-full w-full place-items-center rounded-[25%] border border-edge-bright font-display text-[15px] font-bold text-void">
          {mod.name.slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}
