'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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
    const saved = await window.bestclient.setSettings(patch);
    setSettings(saved);
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
      setRunning(true);
      setServers(await window.bestclient.getServers());
    } catch (error) {
      setPlayError(error instanceof Error ? cleanError(error.message) : String(error));
      setBusy(false);
    } finally {
      setProgress(null);
    }
  }, [info, quickConnect]);

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

  if (bridgeMissing) {
    return (
      <div className="flex h-full flex-col bg-ink-900">
        <TitleBar version="0.1.0" minecraft="1.21.11" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <h1 className="brand-text text-2xl font-bold">BestClient</h1>
          <p className="max-w-md text-sm leading-relaxed text-ink-500">
            A preload híd nem töltődött be, így a launcher nem éri el a rendszerfunkciókat.
            Indítsd újra az alkalmazást – ha a hiba megmarad, futtasd újra a{' '}
            <code className="rounded bg-ink-800 px-1 py-0.5 font-mono text-brand-300">
              npm run build:main
            </code>{' '}
            parancsot.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-ink-900">
      <TitleBar version={info?.version ?? '0.1.0'} minecraft={info?.target.minecraft ?? '1.21.11'} />

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-44 shrink-0 flex-col gap-1 border-r border-ink-700 bg-ink-950/40 p-3">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={`rounded-lg px-3 py-2 text-left text-sm transition ${
                tab === entry.id
                  ? 'bg-ink-700 font-semibold text-brand-200'
                  : 'text-ink-500 hover:bg-ink-800 hover:text-brand-300'
              }`}
            >
              {entry.label}
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

        <main className="min-w-0 flex-1 overflow-y-auto p-6">
          {tab === 'play' ? (
            <PlayPanel
              info={info}
              account={account}
              busy={busy}
              running={running}
              progress={progress}
              error={playError}
              unavailable={unavailable}
              quickConnect={quickConnect}
              onQuickConnect={setQuickConnect}
              onPlay={() => void handlePlay()}
            />
          ) : null}

          {tab === 'mods' ? (
            <ModsView
              pack={pack}
              enabled={settings?.enabledMods ?? []}
              unavailable={unavailable}
              onToggle={toggleMod}
            />
          ) : null}

          {tab === 'settings' ? (
            <SettingsView
              info={info}
              settings={settings}
              servers={servers}
              onPatch={(patch) => void patchSettings(patch)}
            />
          ) : null}
        </main>
      </div>

      <footer className="shrink-0 border-t border-ink-700 bg-ink-950/60">
        <button
          type="button"
          onClick={() => setShowLogs((value) => !value)}
          className="flex w-full items-center justify-between px-4 py-2 text-[11px] text-ink-500 transition hover:text-brand-300"
        >
          <span>Napló ({logs.length})</span>
          <span>{showLogs ? '▾' : '▸'}</span>
        </button>

        {showLogs ? (
          <div className="h-40 overflow-y-auto border-t border-ink-700 bg-ink-950 px-4 py-2">
            {logs.map((line, index) => (
              <p key={index} className="select-text font-mono text-[11px] leading-relaxed text-ink-500">
                {line}
              </p>
            ))}
            <div ref={logEndRef} />
          </div>
        ) : null}
      </footer>
    </div>
  );
}

function PlayPanel({
  info,
  account,
  busy,
  running,
  progress,
  error,
  unavailable,
  quickConnect,
  onQuickConnect,
  onPlay,
}: {
  info: AppInfo | null;
  account: PublicAccount | null;
  busy: boolean;
  running: boolean;
  progress: InstallProgressEvent | null;
  error: string | null;
  unavailable: string[];
  quickConnect: boolean;
  onQuickConnect: (value: boolean) => void;
  onPlay: () => void;
}) {
  const address = info?.lockedServer.address ?? 'bestpvp.eu';

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="brand-text text-3xl font-bold tracking-tight">BestClient</h1>
        <p className="mt-1 text-sm text-ink-500">
          Fabric {info?.target.fabricLoader ?? ''} · Minecraft {info?.target.minecraft ?? ''} ·
          PvP-re hangolva
        </p>
      </div>

      <div className="rounded-2xl border border-brand-500/30 bg-ink-800 p-5">
        <p className="text-[11px] uppercase tracking-widest text-ink-500">Rögzített szerver</p>
        <p className="mt-1 text-xl font-semibold text-brand-200">{info?.lockedServer.name ?? 'BestPvP.eu'}</p>
        <p className="font-mono text-sm text-ink-500">{address}</p>

        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-brand-100">
          <input
            type="checkbox"
            checked={quickConnect}
            onChange={(event) => onQuickConnect(event.target.checked)}
            className="h-4 w-4 accent-brand-500"
          />
          Csatlakozás egyből indítás után
        </label>
      </div>

      <button
        type="button"
        disabled={!account || busy || running}
        onClick={onPlay}
        className="brand-gradient rounded-2xl px-6 py-4 text-lg font-bold text-ink-950 shadow-lg shadow-brand-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {running ? 'A játék fut' : busy ? 'Előkészítés…' : 'JÁTÉK'}
      </button>

      {!account ? (
        <p className="text-center text-xs text-ink-500">
          Az indításhoz jelentkezz be a bal alsó sarokban.
        </p>
      ) : null}

      {progress ? (
        <div className="rounded-xl border border-ink-700 bg-ink-800 p-4">
          <div className="mb-2 flex items-baseline justify-between text-xs">
            <span className="font-medium text-brand-200">
              {progress.step}/{progress.steps} · {progress.label}
            </span>
            <span className="font-mono text-ink-500">{progress.percent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-ink-600">
            <div
              className="brand-gradient h-full rounded-full transition-[width] duration-300"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <p className="mt-2 truncate text-[11px] text-ink-500">{progress.detail}</p>
        </div>
      ) : null}

      {unavailable.length > 0 ? (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200">
          Ezekhez a modokhoz nincs {info?.target.minecraft} build, ezért kimaradtak:{' '}
          {unavailable.join(', ')}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-red-500/40 bg-red-500/5 p-3 text-xs leading-relaxed text-red-200">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Electron prefixes IPC rejections with "Error invoking remote method '...':". */
function cleanError(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '');
}
