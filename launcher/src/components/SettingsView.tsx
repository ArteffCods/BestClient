'use client';

import { useState } from 'react';

import type { AppInfo, PublicSettings } from '@/types/bestclient';

interface Props {
  info: AppInfo | null;
  settings: PublicSettings | null;
  busy: boolean;
  onPatch: (patch: Partial<PublicSettings>) => void;
  onRepair: () => void;
}

export function SettingsView({ info, settings, busy, onPatch, onRepair }: Props) {
  const [note, setNote] = useState<string | null>(null);

  if (!settings || !info) {
    return <p className="text-sm text-ink-faint">Loading settings…</p>;
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="rise display-caps text-[26px] leading-none text-ink">Settings</h2>

      <div className="mt-7 space-y-4">
        <Section title="Memory" delay={60}>
          <p className="mb-4 text-[12px] leading-relaxed text-ink-faint">
            Maximum handed to the JVM. 4–6 GB is plenty for PvP: extra heap brings no FPS, only
            longer GC pauses, and it is the pause that costs you the hit.
          </p>
          <div className="flex items-center gap-5">
            <input
              type="range"
              min={2048}
              max={12288}
              step={512}
              value={settings.memoryMb}
              onChange={(event) => onPatch({ memoryMb: Number(event.target.value) })}
              aria-label="Memory"
              className="h-1 flex-1 accent-rose"
            />
            <span className="w-16 text-right font-mono text-[15px] tabular-nums text-rose-soft">
              {(settings.memoryMb / 1024).toFixed(1)} GB
            </span>
          </div>
        </Section>

        <Section title="Launch" delay={140}>
          <label className="flex cursor-pointer items-center justify-between py-1.5">
            <span className="text-[13px] text-ink">Hide launcher on launch</span>
            <input
              type="checkbox"
              checked={settings.closeOnLaunch}
              onChange={(event) => onPatch({ closeOnLaunch: event.target.checked })}
              className="h-3.5 w-3.5 accent-rose"
            />
          </label>

          <div className="pt-3">
            <label className="eyebrow mb-2 block" htmlFor="jvm-args">
              Extra JVM arguments
            </label>
            <input
              id="jvm-args"
              type="text"
              value={settings.extraJvmArgs}
              placeholder="-XX:+UseStringDeduplication"
              onChange={(event) => onPatch({ extraJvmArgs: event.target.value })}
              className="w-full rounded border border-edge bg-void px-3 py-2 font-mono text-[11px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-rose"
            />
          </div>
        </Section>

        <Section title="Maintenance" delay={200}>
          <div className="flex flex-wrap gap-2">
            <Action
              disabled={busy}
              onClick={() => {
                setNote(null);
                onRepair();
              }}
            >
              {busy ? 'Verifying…' : 'Verify and repair files'}
            </Action>
            <Action
              onClick={async () => {
                const result = await window.bestclient.resetPvpOptions();
                setNote(`${result.applied.length} settings restored.`);
              }}
            >
              Reset PvP defaults
            </Action>
            <Action onClick={() => void window.bestclient.openInstanceFolder()}>
              Open game folder
            </Action>
          </div>

          <p className="mt-3 text-[11.5px] leading-relaxed text-ink-faint">
            On a normal launch the launcher checks existing files by size. After the download-time
            SHA-1 check that is enough, and it avoids reading hundreds of megabytes on every start.
            This button re-hashes every file and replaces whatever is corrupt.
          </p>

          {note ? <p className="mt-2 text-[11.5px] text-rose-soft">{note}</p> : null}
        </Section>

        <Section title="Versions" delay={240}>
          <dl className="grid grid-cols-2 gap-y-2 text-[12px]">
            <Row term="Launcher" value={info.version} />
            <Row term="Minecraft" value={info.target.minecraft} />
            <Row term="Fabric Loader" value={info.target.fabricLoader} />
            <Row term="Java" value={String(info.target.javaMajor)} />
          </dl>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  delay,
  children,
}: {
  title: string;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rise rounded-lg border border-edge bg-panel p-5" style={{ animationDelay: `${delay}ms` }}>
      <h3 className="eyebrow mb-3">{title}</h3>
      {children}
    </section>
  );
}

function Action({
  children,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded border border-edge px-3 py-2 text-[11.5px] text-ink-dim transition-colors hover:border-rose/60 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <>
      <dt className="text-ink-faint">{term}</dt>
      <dd className="text-right font-mono tabular-nums text-ink">{value}</dd>
    </>
  );
}
