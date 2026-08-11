'use client';

import { useEffect, useState } from 'react';

import type { AppInfo, PublicSettings, UpdateState } from '@/types/bestclient';
import { Switch } from './ModsView';

interface Props {
  info: AppInfo | null;
  settings: PublicSettings | null;
  busy: boolean;
  onPatch: (patch: Partial<PublicSettings>) => Promise<void>;
  onRepair: () => void;
}

export function SettingsView({ info, settings, busy, onPatch, onRepair }: Props) {
  const [note, setNote] = useState<{ source: 'maintenance' | 'cache' | 'logs'; text: string } | null>(null);
  const [applyingNvidia, setApplyingNvidia] = useState(false);
  const [update, setUpdate] = useState<UpdateState | null>(null);

  useEffect(() => {
    void window.bestclient.updateState().then(setUpdate);
    return window.bestclient.onUpdateState(setUpdate);
  }, []);

  if (!settings || !info) {
    return <p className="text-sm text-ink-faint">Loading settings…</p>;
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="rise display-caps text-[26px] leading-none text-ink">Settings</h2>

      {/* The same soft panel as the store and the mod list, rounded and never touching the
          edges of the page. */}
      <div className="rise mt-7 rounded-2xl border border-edge bg-panel p-5 backdrop-blur-md sm:p-6">
        <div className="space-y-4">
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
                className="range-ram flex-1"
              />
              <span className="w-16 text-right font-mono text-[15px] tabular-nums text-rose-soft">
                {(settings.memoryMb / 1024).toFixed(1)} GB
              </span>
            </div>
          </Section>

          <Section title="Performance" delay={100}>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink">NVIDIA optimization</p>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
                  Adds the Nvidium renderer to the modpack. On by default on NVIDIA cards,
                  off on AMD and Intel. The mod is installed or removed as soon as you flip
                  the switch.
                </p>
              </div>
              <Switch
                checked={settings.nvidiaOptimize ?? false}
                disabled={applyingNvidia}
                onChange={async (next) => {
                  setApplyingNvidia(true);
                  try {
                    await onPatch({ nvidiaOptimize: next });
                  } finally {
                    setApplyingNvidia(false);
                  }
                }}
                label="NVIDIA optimization"
              />
              {applyingNvidia ? (
                <span className="animate-pulse font-mono text-[10.5px] text-ink-faint">
                  applying…
                </span>
              ) : null}
            </div>
          </Section>

          <Section title="Discord" delay={120}>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink">Discord RPC</p>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
                  Puts BestClient on your Discord profile: whether you are in the launcher or
                  in game, which server you joined, and how long you have been playing.
                  Nothing else is sent, and turning this off clears it straight away.
                </p>
              </div>
              <Switch
                checked={settings.discordRpc ?? true}
                onChange={(next) => void onPatch({ discordRpc: next })}
                label="Discord presence"
              />
            </div>
          </Section>

          <Section title="Launch" delay={140}>
            <p className="mb-3 text-[12px] leading-relaxed text-ink-faint">
              What the launcher does with itself once the game window opens. The choice is
              remembered - even a full close of the launcher leaves it as you set it.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <SegmentButton
                active={settings.launchBehaviour === 'stay'}
                onClick={() => onPatch({ launchBehaviour: 'stay' })}
              >
                Stay open
              </SegmentButton>
              <SegmentButton
                active={settings.launchBehaviour === 'minimise'}
                onClick={() => onPatch({ launchBehaviour: 'minimise' })}
              >
                Minimise launcher
              </SegmentButton>
              <SegmentButton
                active={settings.launchBehaviour === 'hide'}
                onClick={() => onPatch({ launchBehaviour: 'hide' })}
              >
                Hide launcher
              </SegmentButton>
            </div>

          </Section>

          <Section title="Startup flags" delay={160}>
            <StartupFlags
              value={settings.jvmFlags}
              defaults={info.defaultJvmFlags}
              memoryMb={settings.memoryMb}
              onChange={(next) => onPatch({ jvmFlags: next })}
            />
          </Section>

          <Section title="Maintenance" delay={180}>
            <p className="mb-3 text-[12px] leading-relaxed text-ink-faint">
              Verifying re-hashes every installed file and replaces whatever is corrupt; the
              rest are shortcuts around the game folder.
            </p>
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
                  setNote({ source: 'maintenance', text: `${result.applied.length} settings restored.` });
                }}
              >
                Reset defaults
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

            {note?.source === 'maintenance' ? (
              <p className="mt-2 text-[11.5px] text-rose-soft">{note.text}</p>
            ) : null}
          </Section>

          <Section title="Storage" delay={200}>
            <p className="mb-3 text-[12px] leading-relaxed text-ink-faint">
              Everything the launcher regenerates on its own lives here: hash lists,
              downloaded installers, news and changelog copies, extracted natives, and the
              log files it writes on every start. Nothing about the game or your settings
              is touched.
            </p>
            <div className="flex flex-wrap gap-2">
              <Action
                icon={
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path
                      d="M12.5 7a5.5 5.5 0 1 1-1.7-4M12.5 1.5v4h-4"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                }
                onClick={async () => {
                  setNote(null);
                  try {
                    const removed = await window.bestclient.clearCache();
                    setNote({
                      source: 'cache',
                      text:
                        removed > 0
                          ? `Cleared ${removed} cache entr${removed === 1 ? 'y' : 'ies'}. Re-downloads next launch.`
                          : 'The cache was already clean.',
                    });
                  } catch (error) {
                    setNote({
                      source: 'cache',
                      text: error instanceof Error ? error.message : String(error),
                    });
                  }
                }}
              >
                Clear cache
              </Action>
              <Action
                icon={
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path
                      d="M4 1.5h4.5L11.5 4.5 V12.5 H4 Z M8.5 1.5 V4.5 H11.5 M6 7.5 H10 M6 9.5 H10"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                }
                onClick={async () => {
                  setNote(null);
                  try {
                    const removed = await window.bestclient.clearLogs();
                    setNote({
                      source: 'logs',
                      text:
                        removed > 0
                          ? `Deleted ${removed} log file${removed === 1 ? '' : 's'}.`
                          : 'No log files to delete.',
                    });
                  } catch (error) {
                    setNote({
                      source: 'logs',
                      text: error instanceof Error ? error.message : String(error),
                    });
                  }
                }}
              >
                Clear logs
              </Action>
            </div>

            {note?.source === 'cache' || note?.source === 'logs' ? (
              <p className="mt-2 text-[11.5px] text-rose-soft">{note.text}</p>
            ) : null}
          </Section>

          <Section title="Check update" delay={220}>
            <p className="mb-3 text-[12px] leading-relaxed text-ink-faint">
              A check for new releases runs on its own in the background - this one just
              forces it right now. When a build is downloaded, the top bar offers the
              install.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Action
                icon={
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path
                      d="M12.5 7a5.5 5.5 0 1 1-1.7-4M12.5 1.5v4h-4"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                }
                disabled={update?.status === 'checking' || update?.status === 'downloading'}
                onClick={() => void window.bestclient.checkForUpdate()}
              >
                Check for updates
              </Action>
              <UpdateStatus update={update} current={info.version} />
            </div>

            {update?.status === 'ready' ? (
              <p className="mt-2 text-[11.5px] text-rose-soft">
                BestClient {update.version} is downloaded - install it from the top bar.
              </p>
            ) : null}
            {update?.status === 'error' && update.error ? (
              <p className="mt-2 text-[11.5px] text-rose-soft">{update.error}</p>
            ) : null}
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
    </div>
  );
}

/**
 * The JVM command line: the tuned set, locked, and a box for your own additions.
 *
 * The defaults are shown but not editable. They were chosen against frame time, and a
 * launcher that lets them be rewritten spends its life explaining why someone's game
 * stutters. Additions go after them, so a later flag still wins where the JVM takes the
 * last occurrence - nothing is hidden and nothing can be lost.
 *
 * Heap size is not in either box: the Memory slider owns it, and two controls writing the
 * same flag would fight.
 *
 * The text is written when the field loses focus, not per keystroke.
 */
function StartupFlags({
  value,
  defaults,
  memoryMb,
  onChange,
}: {
  value: string;
  defaults: string[];
  memoryMb: number;
  onChange: (next: string) => void;
}) {
  const [text, setText] = useState(value);

  return (
    <>
      <p className="mb-3 text-[12px] leading-relaxed text-ink-faint">
        The client is already tuned for frame time, and that set is fixed. Anything you put
        here is added on top and runs after it, so your flag wins where the JVM takes the
        last one. Heap size comes from the Memory slider above.
      </p>

      <textarea
        id="jvm-extra"
        rows={3}
        value={text}
        placeholder="-XX:+UseStringDeduplication"
        onChange={(event) => setText(event.target.value)}
        onBlur={() => onChange(text.trim())}
        spellCheck={false}
        className="w-full resize-y whitespace-pre rounded-lg bg-surface-high px-3 py-2 font-mono text-[11px] leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-faint hover:bg-surface-top"
      />

      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
        Flags that can load code - Java agents, the boot class path, Fabric and Mixin loader
        properties - are refused, because they would let a cheat client past the mod check.
      </p>
    </>
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
    <section className="rise rounded-lg bg-surface p-5" style={{ animationDelay: `${delay}ms` }}>
      <h3 className="eyebrow mb-3">{title}</h3>
      {children}
    </section>
  );
}

function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`cursor-pointer rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors ${
        active
          ? 'bg-rose-deep text-white'
          : 'bg-surface-high text-ink-dim hover:bg-surface-top hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function Action({
  children,
  onClick,
  disabled = false,
  icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex cursor-pointer items-center gap-2 rounded-lg bg-surface-high px-3 py-2 text-[11.5px] font-semibold text-white transition-colors hover:bg-surface-top hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
    >
      {icon}
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

function UpdateStatus({ update, current }: { update: UpdateState | null; current: string }) {
  if (!update) return null;

  switch (update.status) {
    case 'checking':
      return (
        <span className="animate-pulse font-mono text-[11px] text-ink-faint">
          Checking for updates…
        </span>
      );
    case 'up-to-date':
      return (
        <span className="font-mono text-[11px] text-ink-faint">
          You are on the newest release ({current}).
        </span>
      );
    case 'available':
      return (
        <span className="font-mono text-[11px] text-ink-faint">
          {update.version} found - downloading.
        </span>
      );
    case 'downloading':
      return (
        <span className="font-mono text-[11px] text-ink-faint">
          Downloading {update.version} - {Math.max(4, update.percent)}%
        </span>
      );
    case 'ready':
      return (
        <span className="font-mono text-[11px] text-rose-soft">
          {update.version} downloaded.
        </span>
      );
    case 'error':
      return (
        <span className="font-mono text-[11px] text-rose-soft">
          {update.error ?? 'Update check failed.'}
        </span>
      );
    default:
      return null;
  }
}
