'use client';

import type { ModCategory, PackModView, PackView } from '@/types/bestclient';

interface Props {
  pack: PackView | null;
  enabled: string[];
  unavailable: string[];
  onToggle: (slug: string, next: boolean) => void;
}

const CATEGORY_LABEL: Record<ModCategory, string> = {
  core: 'Alap',
  performance: 'Teljesítmény',
  pvp: 'PvP',
  library: 'Könyvtár',
  risky: 'Kockázatos',
};

const CATEGORY_STYLE: Record<ModCategory, string> = {
  core: 'border-brand-500/50 text-brand-300',
  performance: 'border-emerald-500/40 text-emerald-300',
  pvp: 'border-sky-500/40 text-sky-300',
  library: 'border-ink-500 text-ink-500',
  risky: 'border-amber-500/50 text-amber-300',
};

const ORDER: ModCategory[] = ['core', 'performance', 'pvp', 'library', 'risky'];

export function ModsView({ pack, enabled, unavailable, onToggle }: Props) {
  if (!pack) {
    return <p className="text-sm text-ink-500">Modlista betöltése…</p>;
  }

  const groups = ORDER.map((category) => ({
    category,
    mods: pack.mods.filter((mod) => mod.category === category),
  })).filter((group) => group.mods.length > 0);

  return (
    <div className="space-y-6">
      <p className="text-xs leading-relaxed text-ink-500">
        A modok a Modrinthről töltődnek le, mindig a {pack.minecraft} verzióhoz tartozó legfrissebb
        Fabric buildben. A bejelölt modok indításkor szinkronizálódnak; amit kikapcsolsz, azt a
        launcher törli a mods mappából.
      </p>

      {groups.map((group) => (
        <section key={group.category}>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-ink-500">
            {CATEGORY_LABEL[group.category]}
          </h3>
          <div className="space-y-2">
            {group.mods.map((mod) => (
              <ModRow
                key={mod.slug}
                mod={mod}
                checked={mod.locked || enabled.includes(mod.slug)}
                unavailable={unavailable.includes(mod.slug)}
                onToggle={onToggle}
              />
            ))}
          </div>
        </section>
      ))}
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
      className={`flex cursor-pointer items-start gap-3 rounded-xl border bg-ink-800 p-3 transition ${
        checked ? 'border-brand-500/40' : 'border-ink-700 hover:border-ink-600'
      } ${mod.locked ? 'cursor-default opacity-90' : ''}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={mod.locked}
        onChange={(event) => onToggle(mod.slug, event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-brand-100">{mod.name}</span>
          <span
            className={`rounded border px-1.5 py-px text-[10px] uppercase tracking-wide ${CATEGORY_STYLE[mod.category]}`}
          >
            {CATEGORY_LABEL[mod.category]}
          </span>
          {mod.locked ? (
            <span className="rounded border border-ink-500 px-1.5 py-px text-[10px] uppercase tracking-wide text-ink-500">
              Kötelező
            </span>
          ) : null}
          {unavailable ? (
            <span className="rounded border border-red-500/50 px-1.5 py-px text-[10px] uppercase tracking-wide text-red-300">
              Nem elérhető
            </span>
          ) : null}
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-ink-500">{mod.note}</span>
      </span>
    </label>
  );
}
