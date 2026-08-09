'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LaunchButton, type LaunchState } from '@/components/LaunchButton';
import { LoginCard } from '@/components/LoginCard';
import { ModsView } from '@/components/ModsView';
import { SettingsView } from '@/components/SettingsView';
import { TitleBar } from '@/components/TitleBar';
import type {
  AccountList,
  AppInfo,
  DeviceCodeEvent,
  InstallProgressEvent,
  PackView,
  PublicAccount,
  PublicSettings,
} from '@/types/bestclient';

type Tab = 'play' | 'mods' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'play', label: 'Play' },
  { id: 'mods', label: 'Mods' },
  { id: 'settings', label: 'Settings' },
];

const MAX_LOG_LINES = 400;

export default function Page() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [pack, setPack] = useState<PackView | null>(null);
  const [accounts, setAccounts] = useState<PublicAccount[]>([]);
  const [activeUuid, setActiveUuid] = useState<string | null>(null);

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

  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [bridgeMissing, setBridgeMissing] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const applyAccountList = useCallback((list: AccountList) => {
    setAccounts(list.accounts);
    setActiveUuid(list.activeUuid);
  }, []);

  useEffect(() => {
    const api = window.bestclient;

    // Without the preload bridge nothing in this UI can work. Fail visibly instead of
    // letting every call throw and take the whole render tree down.
    if (!api) {
      setBridgeMissing(true);
      return;
    }

    // Everything here is local (JSON + servers.dat), so the first paint is instant.
    void (async () => {
      const [appInfo, currentSettings, currentPack] = await Promise.all([
        api.appInfo(),
        api.getSettings(),
        api.getPack(),
      ]);

      setInfo(appInfo);
      setSettings(currentSettings);
      setPack(currentPack);
    })();

    // Normalize servers.dat on startup (pins bestpvp.eu, strips delisted entries). The
    // list itself is no longer shown in the UI, so only the side effect matters here.
    void api.getServers();

    // Accounts load on their own: a stale token triggers a Microsoft refresh (several
    // round trips), and the UI must not wait on the network to render. The stored list
    // shows instantly; currentAccount() then validates the active token and drops it if
    // the session died, after which we re-read the (self-healed) list.
    void api.listAccounts().then(applyAccountList);
    void api.currentAccount().then(() => api.listAccounts().then(applyAccountList));

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
          setPlayError(`The game exited with code ${code}. See the log for details.`);
          setShowLogs(true);
        }
      }),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [applyAccountList]);

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
      await window.bestclient.login();
      applyAccountList(await window.bestclient.listAccounts());
    } catch (error) {
      setLoginError(error instanceof Error ? cleanError(error.message) : String(error));
    } finally {
      setLoginBusy(false);
      setDeviceCode(null);
    }
  }, [applyAccountList]);

  const handleSelectAccount = useCallback(
    async (uuid: string) => {
      await window.bestclient.selectAccount(uuid);
      applyAccountList(await window.bestclient.listAccounts());
    },
    [applyAccountList],
  );

  const handleRemoveAccount = useCallback(
    async (uuid: string) => {
      applyAccountList(await window.bestclient.logout(uuid));
    },
    [applyAccountList],
  );

  const handlePlay = useCallback(async () => {
    setBusy(true);
    setPlayError(null);
    setProgress(null);
    setLogs([]);

    try {
      // Always drop the player straight onto the fixed server.
      const result = await window.bestclient.play(info?.lockedServer.address ?? 'bestpvp.eu');

      setUnavailable(result.unavailableMods);
      setDependencies(result.dependencies);
      setRunning(true);
    } catch (error) {
      setPlayError(error instanceof Error ? cleanError(error.message) : String(error));
      setBusy(false);
    } finally {
      setProgress(null);
    }
  }, [info]);

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

  const activeAccount = useMemo(
    () => accounts.find((entry) => entry.uuid === activeUuid) ?? null,
    [accounts, activeUuid],
  );

  const launchState: LaunchState = !activeAccount
    ? 'locked'
    : running
      ? 'running'
      : busy
        ? 'working'
        : 'ready';

  if (bridgeMissing) {
    return (
      <div className="flex h-full flex-col">
        <TitleBar version="0.1.0" minecraft="1.21.11" fabric="0.19.3" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <h1 className="display-caps text-2xl text-ink">
            Best<span className="text-rose">Client</span>
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-ink-dim">
            The preload bridge did not load, so the launcher can't reach system functions.
            Restart the app. If the error persists, run{' '}
            <code className="rounded bg-panel px-1 py-0.5 font-mono text-rose-soft">
              npm run build:main
            </code>
            .
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TitleBar
        version={info?.version ?? '0.1.0'}
        minecraft={info?.target.minecraft ?? '1.21.11'}
        fabric={info?.target.fabricLoader ?? '0.19.3'}
      />

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[168px] shrink-0 flex-col border-r border-edge bg-void/40 px-3 py-4 backdrop-blur-sm">
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
              accounts={accounts}
              activeUuid={activeUuid}
              deviceCode={deviceCode}
              busy={loginBusy}
              error={loginError}
              onLogin={() => void handleLogin()}
              onCancel={() => void window.bestclient.cancelLogin()}
              onSelect={(uuid) => void handleSelectAccount(uuid)}
              onRemove={(uuid) => void handleRemoveAccount(uuid)}
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
                busy={busy}
                onPatch={(patch) => void patchSettings(patch)}
                onRepair={() => void handleRepair()}
              />
            </div>
          ) : null}
        </main>
      </div>

      <footer className="shrink-0 border-t border-edge bg-void/40 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setShowLogs((value) => !value)}
          aria-expanded={showLogs}
          className="flex w-full items-center justify-between px-4 py-1.5 transition-colors hover:bg-panel"
        >
          <span className="eyebrow">Log · {logs.length} lines</span>
          <span aria-hidden="true" className="text-[10px] text-ink-faint">
            {showLogs ? '▾' : '▸'}
          </span>
        </button>

        {showLogs ? (
          <div className="h-44 overflow-y-auto border-t border-edge bg-[#050308] px-4 py-2">
            {logs.length === 0 ? (
              <p className="font-mono text-[11px] text-ink-faint">
                The game output appears here after launch.
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
  onPlay,
  activeModCount,
  memoryMb,
}: {
  info: AppInfo | null;
  launchState: LaunchState;
  progress: InstallProgressEvent | null;
  error: string | null;
  unavailable: string[];
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
        ? 'Installing'
        : launchState === 'locked'
          ? 'Locked'
          : 'Ready';

  return (
    // Title and launch control anchored top-left; nothing floats in the middle.
    <div className="flex flex-col px-8 py-8">
      <h1 className="rise display-caps text-[44px] leading-[0.9] text-ink">
        {name}
        <span className="text-rose">.{tld}</span>
      </h1>

      <div className="rise mt-6 max-w-xl" style={{ animationDelay: '60ms' }}>
        <LaunchButton
          state={launchState}
          percent={progress?.percent ?? 0}
          step={progress?.label ?? ''}
          target={address}
          onClick={onPlay}
        />
      </div>

      <div
        className="rise mt-7 flex max-w-xl flex-wrap items-stretch"
        style={{ animationDelay: '120ms' }}
      >
        <Readout label="Mods" value={String(activeModCount)} />
        <Readout label="Memory" value={`${(memoryMb / 1024).toFixed(1)} GB`} />
        <Readout label="Java" value={String(info?.target.javaMajor ?? 21)} />
        <Readout label="Status" value={statusWord} accent={launchState === 'ready'} last />
      </div>

      {unavailable.length > 0 ? (
        <p className="mt-6 max-w-xl rounded-lg border border-warn/40 bg-warn/5 px-4 py-3 text-[12px] leading-relaxed text-warn">
          No {info?.target.minecraft} build for these, so they were skipped:{' '}
          <span className="font-mono">{unavailable.join(', ')}</span>
        </p>
      ) : null}

      {error ? (
        <p className="mt-6 max-w-xl rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-[12px] leading-relaxed text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** One reading in the stat strip: hairline-separated, no boxes. */
function Readout({
  label,
  value,
  accent = false,
  last = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
  last?: boolean;
}) {
  return (
    <div className={`px-5 first:pl-0 ${last ? '' : 'border-r border-edge'}`}>
      <p className="eyebrow">{label}</p>
      <p className={`mt-1 font-mono text-[15px] tabular-nums ${accent ? 'text-rose-soft' : 'text-ink'}`}>
        {value}
      </p>
    </div>
  );
}

/** Electron prefixes IPC rejections with "Error invoking remote method '...':". */
function cleanError(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '');
}
