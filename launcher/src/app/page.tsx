'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LaunchButton, type LaunchState } from '@/components/LaunchButton';
import { LoginCard } from '@/components/LoginCard';
import { ModsView } from '@/components/ModsView';
import { SettingsView } from '@/components/SettingsView';
import { TitleBar } from '@/components/TitleBar';
import type {
  AppInfo,
  DeviceCodeEvent,
  InstallProgressEvent,
  PackView,
  PublicAccount,
  PublicSettings,
  ServerListEntry,
} from '@/types/bestclient';

type Tab = 'play' | 'mods' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'play', label: 'Játék' },
  { id: 'mods', label: 'Modok' },
  { id: 'settings', label: 'Beállítások' },
];

const MAX_LOG_LINES = 400;

export default function Page() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [pack, setPack] = useState<PackView | null>(null);
  const [servers, setServers] = useState<ServerListEntry[]>([]);
  const [account, setAccount] = useState<PublicAccount | null>(null);

  const [tab, setTab] = useState<Tab>('play');
  const [deviceCode, setDeviceCode] = useState<DeviceCodeEvent | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [progress, setProgress] = useState<InstallProgressEvent | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [quickConnect, setQuickConnect] = useState(true);

  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [bridgeMissing, setBridgeMissing] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const api = window.bestclient;

    // Without the preload bridge nothing in this UI can work. Fail visibly instead of
    // letting every call throw and take the whole render tree down.
    if (!api) {
      setBridgeMissing(true);
      return;
    }

    void (async () => {
      const [appInfo, currentSettings, currentPack, currentAccount, serverList] = await Promise.all([
        api.appInfo(),
        api.getSettings(),
        api.getPack(),
        api.currentAccount(),
        api.getServers(),
      ]);

      setInfo(appInfo);
      setSettings(currentSettings);
      setPack(currentPack);
      setAccount(currentAccount);
      setServers(serverList);
    })();

    const unsubscribers = [
      api.onDeviceCode(setDeviceCode),
      api.onInstallProgress(setProgress),
      api.onGameLog((line) => {
        setLogs((previous) => {
          const next = [...previous, line];
          return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
        });
      }),
      api.onGameExit((code) => {
        setRunning(false);
        setBusy(false);

        if (code !== 0 && code !== null) {
          setPlayError(`A játék ${code} hibakóddal lépett ki. A részletek a naplóban.`);
          setShowLogs(true);
        }
      }),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  useEffect(() => {
    if (showLogs) logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, showLogs]);

  const patchSettings = useCallback(async (patch: Partial<PublicSettings>) => {
    setSettings((previous) => (previous ? { ...previous, ...patch } : previous));
    setSettings(await window.bestclient.setSettings(patch));
  }, []);

  const handleLogin = useCallback(async () => {
    setLoginBusy(true);
    setLoginError(null);

    try {
      setAccount(await window.bestclient.login());
    } catch (error) {
      setLoginError(error instanceof Error ? cleanError(error.message) : String(error));
    } finally {
      setLoginBusy(false);
      setDeviceCode(null);
    }
  }, []);

  const handlePlay = useCallback(async () => {
    setBusy(true);
    setPlayError(null);
    setProgress(null);
    setLogs([]);

    try {
      const result = await window.bestclient.play(
        quickConnect && info ? info.lockedServer.address : null,
      );

      setUnavailable(result.unavailableMods);
      setDependencies(result.dependencies);
      setRunning(true);
      setServers(await window.bestclient.getServers());
    } catch (error) {
      setPlayError(error instanceof Error ? cleanError(error.message) : String(error));
      setBusy(false);
    } finally {
      setProgress(null);
    }
  }, [info, quickConnect]);

  const handleRepair = useCallback(async () => {
    setBusy(true);
    setPlayError(null);
    setProgress(null);

    try {
      const result = await window.bestclient.repair();
      setUnavailable(result.unavailableMods);
      setDependencies(result.dependencies);
    } catch (error) {
      setPlayError(error instanceof Error ? cleanError(error.message) : String(error));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, []);

  const toggleMod = useCallback(
    (slug: string, next: boolean) => {
      if (!settings) return;

      const enabledMods = next
        ? [...new Set([...settings.enabledMods, slug])]
        : settings.enabledMods.filter((value) => value !== slug);

      void patchSettings({ enabledMods });
    },
    [patchSettings, settings],
  );

  const activeModCount = useMemo(() => {
    if (!pack || !settings) return 0;
    return pack.mods.filter((mod) => mod.locked || settings.enabledMods.includes(mod.slug)).length;
  }, [pack, settings]);

  const launchState: LaunchState = !account
    ? 'locked'
    : running
      ? 'running'
      : busy
        ? 'working'
        : 'ready';

  if (bridgeMissing) {
    return (
      <div className="flex h-full flex-col bg-void">
        <TitleBar version="0.1.0" minecraft="1.21.11" fabric="0.19.3" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <h1 className="display-caps text-2xl text-ink">
            Best<span className="text-rose">Client</span>
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-ink-dim">
            A preload híd nem töltődött be, így a launcher nem éri el a rendszerfunkciókat.
            Indítsd újra az alkalmazást – ha a hiba megmarad, futtasd újra a{' '}
            <code className="rounded bg-panel px-1 py-0.5 font-mono text-rose-soft">
              npm run build:main
            </code>{' '}
            parancsot.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-void">
      <TitleBar
        version={info?.version ?? '0.1.0'}
        minecraft={info?.target.minecraft ?? '1.21.11'}
        fabric={info?.target.fabricLoader ?? '0.19.3'}
      />

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[168px] shrink-0 flex-col border-r border-edge px-3 py-4">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              aria-current={tab === entry.id ? 'page' : undefined}
              className={`relative rounded px-3 py-2.5 text-left transition-colors ${
                tab === entry.id ? 'bg-panel text-ink' : 'text-ink-faint hover:bg-panel/60 hover:text-ink-dim'
              }`}
            >
              {tab === entry.id ? (
                <span
                  aria-hidden="true"
                  className="brand-gradient absolute inset-y-2 left-0 w-0.5 rounded-full"
                />
              ) : null}
              <span className="display-caps text-[13px]">{entry.label}</span>
            </button>
          ))}

          <div className="mt-auto">
            <LoginCard
              account={account}
              deviceCode={deviceCode}
              busy={loginBusy}
              error={loginError}
              onLogin={() => void handleLogin()}
              onCancel={() => void window.bestclient.cancelLogin()}
              onLogout={() => {
                void window.bestclient.logout();
                setAccount(null);
              }}
            />
          </div>
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto">
          {tab === 'play' ? (
            <PlayStage
              info={info}
              launchState={launchState}
              progress={progress}
              error={playError}
              unavailable={unavailable}
              quickConnect={quickConnect}
              onQuickConnect={setQuickConnect}
              onPlay={() => void handlePlay()}
              activeModCount={activeModCount}
              memoryMb={settings?.memoryMb ?? 4096}
            />
          ) : null}

          {tab === 'mods' ? (
            <div className="px-8 py-7">
              <ModsView
                pack={pack}
                enabled={settings?.enabledMods ?? []}
                unavailable={unavailable}
                dependencies={dependencies}
                onToggle={toggleMod}
              />
            </div>
          ) : null}

          {tab === 'settings' ? (
            <div className="px-8 py-7">
              <SettingsView
                info={info}
                settings={settings}
                servers={servers}
                busy={busy}
                onPatch={(patch) => void patchSettings(patch)}
                onRepair={() => void handleRepair()}
              />
            </div>
          ) : null}
        </main>
      </div>

      <footer className="shrink-0 border-t border-edge">
        <button
          type="button"
          onClick={() => setShowLogs((value) => !value)}
          aria-expanded={showLogs}
          className="flex w-full items-center justify-between px-4 py-1.5 transition-colors hover:bg-panel"
        >
          <span className="eyebrow">Napló · {logs.length} sor</span>
          <span aria-hidden="true" className="text-[10px] text-ink-faint">
            {showLogs ? '▾' : '▸'}
          </span>
        </button>

        {showLogs ? (
          <div className="h-44 overflow-y-auto border-t border-edge bg-[#050308] px-4 py-2">
            {logs.length === 0 ? (
              <p className="font-mono text-[11px] text-ink-faint">
                A játék kimenete itt jelenik meg indítás után.
              </p>
            ) : (
              logs.map((line, index) => (
                <p
                  key={index}
                  className="select-text font-mono text-[11px] leading-[1.6] text-ink-dim"
                >
                  {line}
                </p>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        ) : null}
      </footer>
    </div>
  );
}

function PlayStage({
  info,
  launchState,
  progress,
  error,
  unavailable,
  quickConnect,
  onQuickConnect,
  onPlay,
  activeModCount,
  memoryMb,
}: {
  info: AppInfo | null;
  launchState: LaunchState;
  progress: InstallProgressEvent | null;
  error: string | null;
  unavailable: string[];
  quickConnect: boolean;
  onQuickConnect: (value: boolean) => void;
  onPlay: () => void;
  activeModCount: number;
  memoryMb: number;
}) {
  const address = info?.lockedServer.address ?? 'bestpvp.eu';
  const [name, tld] = address.split(/\.(?=[^.]+$)/);

  const statusWord =
    launchState === 'running'
      ? 'Fut'
      : launchState === 'working'
        ? 'Telepítés'
        : launchState === 'locked'
          ? 'Zárolva'
          : 'Kész';

  return (
    // The play tab is a stage, not a document: centre it so the launch control sits at
    // the optical middle instead of the content hanging off the top edge.
    <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-8 py-9">
      <div className="rise">
        <p className="eyebrow">Rögzített célpont</p>
        <h1 className="display-caps mt-2.5 text-[46px] leading-[0.9] text-ink">
          {name}
          <span className="text-rose">.{tld}</span>
        </h1>
      </div>

      <div className="rise mt-7" style={{ animationDelay: '70ms' }}>
        <LaunchButton
          state={launchState}
          percent={progress?.percent ?? 0}
          step={progress?.label ?? ''}
          target={address}
          onClick={onPlay}
        />

        <div className="mt-2.5 flex min-h-[16px] items-center justify-between gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-dim transition-colors hover:text-ink">
            <input
              type="checkbox"
              checked={quickConnect}
              onChange={(event) => onQuickConnect(event.target.checked)}
              className="h-3.5 w-3.5 accent-rose"
            />
            Csatlakozás egyből indítás után
          </label>

          {progress ? (
            <span className="truncate font-mono text-[11px] text-ink-faint">{progress.detail}</span>
          ) : null}
        </div>
      </div>

      <dl
        className="rise mt-8 grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-edge bg-edge"
        style={{ animationDelay: '140ms' }}
      >
        <Readout label="Modok" value={String(activeModCount)} unit="aktív" />
        <Readout label="Memória" value={(memoryMb / 1024).toFixed(1)} unit="GB" />
        <Readout label="Java" value={String(info?.target.javaMajor ?? 21)} unit="LTS" />
        <Readout label="Állapot" value={statusWord} accent={launchState === 'ready'} />
      </dl>

      {unavailable.length > 0 ? (
        <p className="mt-5 rounded-lg border border-warn/40 bg-warn/5 px-4 py-3 text-[12px] leading-relaxed text-warn">
          Ezekhez nincs {info?.target.minecraft} build, ezért kimaradtak:{' '}
          <span className="font-mono">{unavailable.join(', ')}</span>
        </p>
      ) : null}

      {error ? (
        <p className="mt-5 rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-[12px] leading-relaxed text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Readout({
  label,
  value,
  unit,
  accent = false,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-panel px-4 py-3">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1.5 flex items-baseline gap-1">
        <span
          className={`font-mono text-[17px] tabular-nums ${accent ? 'text-rose-soft' : 'text-ink'}`}
        >
          {value}
        </span>
        {unit ? <span className="font-mono text-[10px] text-ink-faint">{unit}</span> : null}
      </dd>
    </div>
  );
}

/** Electron prefixes IPC rejections with "Error invoking remote method '...':". */
function cleanError(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '');
}
