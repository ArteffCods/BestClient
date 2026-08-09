'use client';

import { useState } from 'react';

import type { AppInfo, PublicSettings, ServerListEntry } from '@/types/bestclient';

interface Props {
  info: AppInfo | null;
  settings: PublicSettings | null;
  servers: ServerListEntry[];
  onPatch: (patch: Partial<PublicSettings>) => void;
}

export function SettingsView({ info, settings, servers, onPatch }: Props) {
  const [resetNote, setResetNote] = useState<string | null>(null);

  if (!settings || !info) {
    return <p className="text-sm text-ink-500">Beállítások betöltése…</p>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-ink-700 bg-ink-800 p-4">
        <h3 className="mb-1 text-sm font-semibold text-brand-200">Memória</h3>
        <p className="mb-3 text-xs text-ink-500">
          A JVM-nek adott maximum. PvP-hez 4–6 GB bőven elég; több memória hosszabb GC-szünetet
          jelent, nem több FPS-t.
        </p>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={2048}
            max={12288}
            step={512}
            value={settings.memoryMb}
            onChange={(event) => onPatch({ memoryMb: Number(event.target.value) })}
            className="h-1 flex-1 accent-brand-500"
          />
          <span className="w-20 text-right font-mono text-sm text-brand-200">
            {(settings.memoryMb / 1024).toFixed(1)} GB
          </span>
        </div>
      </section>

      <section className="rounded-xl border border-ink-700 bg-ink-800 p-4">
        <h3 className="mb-3 text-sm font-semibold text-brand-200">Szerverlista</h3>
        <ul className="space-y-1.5">
          {servers.length === 0 ? (
            <li className="text-xs text-ink-500">
              Még nincs szerverlista – az első indítás után jelenik meg.
            </li>
          ) : (
            servers.map((server) => (
              <li
                key={server.address}
                className="flex items-center justify-between rounded-lg border border-ink-700 px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-brand-100">{server.name}</span>
                  <span className="block font-mono text-[11px] text-ink-500">{server.address}</span>
                </span>
                {server.locked ? (
                  <span className="shrink-0 rounded border border-brand-500/50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-brand-300">
                    Rögzített
                  </span>
                ) : null}
              </li>
            ))
          )}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-ink-500">
          A {info.lockedServer.address} bejegyzést a launcher minden indítás előtt visszaírja a
          lista elejére.
        </p>
      </section>

      <section className="rounded-xl border border-ink-700 bg-ink-800 p-4">
        <h3 className="mb-3 text-sm font-semibold text-brand-200">Játék</h3>

        <label className="flex cursor-pointer items-center justify-between py-2">
          <span className="text-sm text-brand-100">Launcher elrejtése indításkor</span>
          <input
            type="checkbox"
            checked={settings.closeOnLaunch}
            onChange={(event) => onPatch({ closeOnLaunch: event.target.checked })}
            className="h-4 w-4 accent-brand-500"
          />
        </label>

        <div className="py-2">
          <label className="mb-1.5 block text-sm text-brand-100" htmlFor="jvm-args">
            Extra JVM-argumentumok
          </label>
          <input
            id="jvm-args"
            type="text"
            value={settings.extraJvmArgs}
            placeholder="-XX:+UseStringDeduplication"
            onChange={(event) => onPatch({ extraJvmArgs: event.target.value })}
            className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 font-mono text-xs text-brand-100 outline-none transition focus:border-brand-500"
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={async () => {
              const result = await window.bestclient.resetPvpOptions();
              setResetNote(`${result.applied.length} beállítás visszaállítva.`);
            }}
            className="rounded-lg border border-ink-600 px-3 py-2 text-xs text-brand-300 transition hover:border-brand-500 hover:text-brand-200"
          >
            PvP alapbeállítások visszaállítása
          </button>
          <button
            type="button"
            onClick={() => void window.bestclient.openInstanceFolder()}
            className="rounded-lg border border-ink-600 px-3 py-2 text-xs text-brand-300 transition hover:border-brand-500 hover:text-brand-200"
          >
            Játék mappa megnyitása
          </button>
        </div>

        {resetNote ? <p className="mt-2 text-xs text-brand-300">{resetNote}</p> : null}
      </section>

      <section className="rounded-xl border border-ink-700 bg-ink-800 p-4">
        <h3 className="mb-2 text-sm font-semibold text-brand-200">Verziók</h3>
        <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
          <dt className="text-ink-500">Launcher</dt>
          <dd className="text-right font-mono text-brand-100">{info.version}</dd>
          <dt className="text-ink-500">Minecraft</dt>
          <dd className="text-right font-mono text-brand-100">{info.target.minecraft}</dd>
          <dt className="text-ink-500">Fabric Loader</dt>
          <dd className="text-right font-mono text-brand-100">{info.target.fabricLoader}</dd>
          <dt className="text-ink-500">Java</dt>
          <dd className="text-right font-mono text-brand-100">{info.target.javaMajor}</dd>
        </dl>
      </section>
    </div>
  );
}
