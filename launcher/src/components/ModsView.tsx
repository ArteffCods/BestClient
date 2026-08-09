'use client';

import type { ModCategory, PackModView, PackView } from '@/types/bestclient';

interface Props {
  pack: PackView | null;
  enabled: string[];
  unavailable: string[];
  /** Libraries the launcher added automatically; known only after an install run. */
  dependencies: string[];
  onToggle: (slug: string, next: boolean) => void;
}

const CATEGORY_LABEL: Record<ModCategory, string> = {
  core: 'Alap',
  performance: 'Teljesítmény',
  pvp: 'PvP',
  library: 'Könyvtár',
  risky: 'Kockázatos',
};

/** Only `risky` gets a warning colour — the rest stay in the brand's own range. */
const CATEGORY_STYLE: Record<ModCategory, string> = {
  core: 'border-rose/40 text-rose-soft',
  performance: 'border-edge-bright text-ink-dim',
  pvp: 'border-edge-bright text-ink-dim',
  library: 'border-edge text-ink-faint',
  risky: 'border-warn/50 text-warn',
};

const ORDER: ModCategory[] = ['core', 'performance', 'pvp', 'library', 'risky'];

export function ModsView({ pack, enabled, unavailable, dependencies, onToggle }: Props) {
  if (!pack) {
    return <p className="text-sm text-ink-faint">Modlista betöltése…</p>;
  }

  const groups = ORDER.map((category) => ({
    category,
    mods: pack.mods.filter((mod) => mod.category === category),
  })).filter((group) => group.mods.length > 0);

  const activeCount = pack.mods.filter((mod) => mod.locked || enabled.includes(mod.slug)).length;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rise flex items-baseline justify-between">
        <h2 className="display-caps text-[26px] leading-none text-ink">Modok</h2>
        <span className="font-mono text-[12px] tabular-nums text-ink-dim">
          {activeCount}/{pack.mods.length} aktív
        </span>
      </div>

      <p className="rise mt-3 text-[12px] leading-relaxed text-ink-faint" style={{ animationDelay: '60ms' }}>
        A modok a Modrinthről töltődnek le, mindig a {pack.minecraft} verzióhoz tartozó legfrissebb
        Fabric buildben. Indításkor szinkronizálódnak: amit kikapcsolsz, azt a launcher törli a mods
        mappából. A kézzel bemásolt jarokhoz nem nyúl.
      </p>

      <div className="mt-7 space-y-7">
        {groups.map((group, index) => (
          <section key={group.category} className="rise" style={{ animationDelay: `${100 + index * 40}ms` }}>
            <div className="mb-2.5 flex items-center gap-3">
              <h3 className="eyebrow">{CATEGORY_LABEL[group.category]}</h3>
              <span className="h-px flex-1 bg-edge" />
            </div>

            <div className="space-y-1.5">
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

        {dependencies.length > 0 ? (
          <section className="rise">
            <div className="mb-2.5 flex items-center gap-3">
              <h3 className="eyebrow">Automatikus függőségek</h3>
              <span className="h-px flex-1 bg-edge" />
            </div>
            <p className="mb-2 text-[11.5px] leading-relaxed text-ink-faint">
              A Fabric nem indul el, ha egy mod kötelező függősége hiányzik, ezért ezeket a
              launcher magától telepíti.
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {dependencies.map((name) => (
                <li
                  key={name}
                  className="rounded border border-edge bg-panel px-2 py-1 font-mono text-[10px] text-ink-dim"
                >
                  {name}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
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
      className={`flex items-start gap-3 rounded-lg border bg-panel px-3.5 py-3 transition-colors ${
        mod.locked
          ? 'cursor-default border-edge'
          : checked
            ? 'cursor-pointer border-rose/30 hover:border-rose/60'
            : 'cursor-pointer border-edge hover:border-edge-bright'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={mod.locked}
        onChange={(event) => onToggle(mod.slug, event.target.checked)}
        className="mt-1 h-3.5 w-3.5 shrink-0 accent-rose"
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-ink">{mod.name}</span>
          <span
            className={`rounded border px-1.5 py-px font-mono text-[9px] uppercase tracking-wider ${CATEGORY_STYLE[mod.category]}`}
          >
            {CATEGORY_LABEL[mod.category]}
          </span>
          {mod.locked ? (
            <span className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">
              kötelező
            </span>
          ) : null}
          {unavailable ? (
            <span className="rounded border border-danger/50 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-danger">
              nem elérhető
            </span>
          ) : null}
        </span>
        <span className="mt-1 block text-[11.5px] leading-relaxed text-ink-faint">{mod.note}</span>
      </span>
    </label>
  );
}
