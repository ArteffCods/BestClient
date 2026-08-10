'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { ChangelogRail } from '@/components/ChangelogRail';
import { LaunchButton, type LaunchState } from '@/components/LaunchButton';
import { LoginCard } from '@/components/LoginCard';
import { ModsView } from '@/components/ModsView';
import { ProfilePicker } from '@/components/ProfilePicker';
import { SettingsView } from '@/components/SettingsView';
import { StoreView } from '@/components/StoreView';
import { TitleBar } from '@/components/TitleBar';
import type {
  AccountList,
  AppInfo,
  ChangelogEntry,
  DeviceCodeEvent,
  InstallProgressEvent,
  NewsItem,
  PartnerServer,
  ProfileList,
  PublicAccount,
  PublicSettings,
  UpdateState,
} from '@/types/bestclient';

type Tab = 'play' | 'mods' | 'store' | 'settings';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'play', label: 'Play', icon: <IconPlay /> },
  { id: 'mods', label: 'Mods', icon: <IconMods /> },
  { id: 'store', label: 'Modrinth', icon: <IconStore /> },
  { id: 'settings', label: 'Settings', icon: <IconSettings /> },
];

const MAX_LOG_LINES = 400;

export default function Page() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [accounts, setAccounts] = useState<PublicAccount[]>([]);
  const [activeUuid, setActiveUuid] = useState<string | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [partners, setPartners] = useState<PartnerServer[]>([]);
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);

  const [tab, setTab] = useState<Tab>('play');
  const [deviceCode, setDeviceCode] = useState<DeviceCodeEvent | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [progress, setProgress] = useState<InstallProgressEvent | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string[]>([]);

  const [profiles, setProfiles] = useState<ProfileList | null>(null);
  const [pickingProfile, setPickingProfile] = useState(false);
  const [switchingProfile, setSwitchingProfile] = useState(false);

  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [bridgeMissing, setBridgeMissing] = useState(false);
  const [update, setUpdate] = useState<UpdateState>({
    status: 'idle',
    version: '',
    notes: '',
    percent: 0,
  });
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
      const [appInfo, currentSettings] = await Promise.all([api.appInfo(), api.getSettings()]);
      setInfo(appInfo);
      setSettings(currentSettings);
    })();

    // Normalize servers.dat on startup (pins bestpvp.eu, strips delisted entries). The
    // list itself is no longer shown in the UI, so only the side effect matters here.
    void api.getServers();

    // The three feeds are fetched from GitHub / the network and cached; a slow connection
    // never blocks the first paint.
    void api.getProfiles().then(setProfiles);
    void api.getNews().then(setNews);
    void api.getPartners().then(setPartners);
    void api.getChangelog().then(setChangelog);

    // A download may already have finished before this window rendered.
    void api.updateState().then(setUpdate);

    // Accounts load on their own: a stale token triggers a Microsoft refresh (several
    // round trips), and the UI must not wait on the network to render. The stored list
    // shows instantly; currentAccount() then validates the active token and drops it if
    // the session died, after which we re-read the (self-healed) list.
    void api.listAccounts().then(applyAccountList);
    void api.currentAccount().then(() => api.listAccounts().then(applyAccountList));

    const unsubscribers = [
      api.onUpdateState(setUpdate),
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

  const handlePlay = useCallback(async (quickConnect: string | null = null) => {
    setBusy(true);
    setPlayError(null);
    setProgress(null);
    setLogs([]);
    // The console rises from the bottom edge as soon as a launch starts, so the install
    // and the game's own output are visible without going looking for them.
    setShowLogs(true);

    try {
      // Normally the game opens on the main menu; double-clicking a partner card passes
      // that server's address and the game connects straight to it.
      const result = await window.bestclient.play(quickConnect);

      setUnavailable(result.unavailableMods);
      setRunning(true);
    } catch (error) {
      setPlayError(error instanceof Error ? cleanError(error.message) : String(error));
      setBusy(false);
    } finally {
      setProgress(null);
    }
  }, []);

  const handleStop = useCallback(async () => {
    await window.bestclient.stop();
  }, []);

  const handleRepair = useCallback(async () => {
    setBusy(true);
    setPlayError(null);
    setProgress(null);

    try {
      const result = await window.bestclient.repair();
      setUnavailable(result.unavailableMods);
    } catch (error) {
      setPlayError(error instanceof Error ? cleanError(error.message) : String(error));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, []);

  const pinVersion = useCallback(
    (slug: string, versionNumber: string | null) => {
      const pins = { ...(settings?.pinnedVersions ?? {}) };

      if (versionNumber) pins[slug] = versionNumber;
      else delete pins[slug];

      void patchSettings({ pinnedVersions: pins });
    },
    [patchSettings, settings],
  );

  /**
   * Switching build changes which Minecraft is installed and which game folder is used,
   * so everything that was read for the old one is read again: the version shown above
   * Launch, the mod list, the settings and the pack all belong to a profile.
   */
  const handlePickProfile = useCallback(
    async (id: string) => {
      // Picking never closes the dialog. Switching is a comparison - you look at the
      // three, try one, and the card lighting up is the answer; being thrown back to the
      // Play screen each time would make trying a second one a chore.
      if (profiles?.active === id) return;

      setSwitchingProfile(true);

      try {
        await window.bestclient.setProfile(id as never);

        const [nextInfo, nextSettings, nextProfiles] = await Promise.all([
          window.bestclient.appInfo(),
          window.bestclient.getSettings(),
          window.bestclient.getProfiles(),
        ]);

        setInfo(nextInfo);
        setSettings(nextSettings);
        setProfiles(nextProfiles);
        // The old profile's "these mods had no build" list means nothing here.
        setUnavailable([]);
        setPlayError(null);
      } catch (error) {
        setPlayError(error instanceof Error ? cleanError(error.message) : String(error));
      } finally {
        setSwitchingProfile(false);
      }
    },
    [profiles],
  );

  const activeAccount = useMemo(
    () => accounts.find((entry) => entry.uuid === activeUuid) ?? null,
    [accounts, activeUuid],
  );

  const launchState: LaunchState = !activeAccount
    ? loginBusy
      ? 'signing-in'
      : 'locked'
    : running
      ? 'running'
      : busy
        ? 'working'
        : 'ready';

  if (bridgeMissing) {
    return (
      <div className="flex h-full flex-col">
        <TitleBar version="0.1.0" update={update} onInstallUpdate={() => {}} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <h1 className="display-caps text-2xl text-ink">
            Best<span className="text-rose">Client</span>
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-ink-dim">
            The preload bridge did not load, so the launcher can&apos;t reach system functions.
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
        update={update}
        onInstallUpdate={() => void window.bestclient.installUpdate()}
      />

      <div className="flex min-h-0 flex-1">
        <nav className="relative z-30 flex w-[68px] shrink-0 flex-col items-center gap-1 border-r border-edge bg-void/25 px-2 py-4 backdrop-blur-xl">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              aria-current={tab === entry.id ? 'page' : undefined}
              aria-label={entry.label}
              title={entry.label}
              className={`relative grid h-12 w-12 cursor-pointer place-items-center rounded-lg transition-colors ${
                tab === entry.id
                  ? 'bg-panel text-rose-soft'
                  : 'text-ink-faint hover:bg-panel/60 hover:text-ink-dim'
              }`}
            >
              {tab === entry.id ? (
                <span
                  aria-hidden="true"
                  className="brand-gradient absolute inset-y-2 left-0 w-0.5 rounded-full"
                />
              ) : null}
              {entry.icon}
            </button>
          ))}

          <div className="mt-auto w-full">
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
              onPlay={(quickConnect) => void handlePlay(quickConnect)}
              onStop={() => void handleStop()}
              onSignIn={() => void handleLogin()}
              signInError={loginError}
              onEditProfile={() => setPickingProfile(true)}
              memoryMb={settings?.memoryMb ?? 4096}
              news={news}
              partners={partners}
            />
          ) : null}

          {tab === 'mods' ? (
            <div className="px-5 py-6 sm:px-8 sm:py-7">
              <ModsView
                unavailable={unavailable}
                pins={settings?.pinnedVersions ?? {}}
                onPin={pinVersion}
              />
            </div>
          ) : null}

          {tab === 'store' ? (
            <div className="px-5 py-6 sm:px-8 sm:py-7">
              <StoreView />
            </div>
          ) : null}

          {tab === 'settings' ? (
            <div className="px-5 py-6 sm:px-8 sm:py-7">
              <SettingsView
                info={info}
                settings={settings}
                busy={busy}
                onPatch={(patch) => patchSettings(patch)}
                onRepair={() => void handleRepair()}
              />
            </div>
          ) : null}
        </main>

        <ChangelogRail entries={changelog} />
      </div>

      {pickingProfile && profiles ? (
        <ProfilePicker
          profiles={profiles.profiles}
          active={profiles.active}
          busy={switchingProfile}
          onPick={(id) => void handlePickProfile(id)}
          onClose={() => setPickingProfile(false)}
        />
      ) : null}

      <footer className="shrink-0 border-t border-edge bg-void/40 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setShowLogs((value) => !value)}
          aria-expanded={showLogs}
          className="flex w-full cursor-pointer items-center justify-between px-4 py-1.5 transition-colors hover:bg-panel"
        >
          <span className="eyebrow">Log · {logs.length} lines</span>
          <span aria-hidden="true" className="text-[10px] text-ink-faint">
            {showLogs ? '▾' : '▸'}
          </span>
        </button>

        {showLogs ? (
          <div className="slide-up h-44 overflow-y-auto border-t border-edge bg-[#050308] px-4 py-2">
            {logs.length === 0 ? (
              <p className="font-mono text-[11px] text-ink-faint">
                The game output appears here after launch.
              </p>
            ) : (
              logs.map((line, index) => (
                <p
                  key={index}
                  className={`select-text font-mono text-[11px] leading-[1.6] ${logLineColor(line)}`}
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
  onStop,
  onSignIn,
  signInError,
  onEditProfile,
  memoryMb,
  news,
  partners,
}: {
  info: AppInfo | null;
  launchState: LaunchState;
  progress: InstallProgressEvent | null;
  error: string | null;
  unavailable: string[];
  onPlay: (quickConnect: string | null) => void;
  onStop: () => void;
  onSignIn: () => void;
  signInError: string | null;
  onEditProfile: () => void;
  memoryMb: number;
  news: NewsItem[];
  partners: PartnerServer[];
}) {
  const minecraft = info?.target.minecraft ?? '1.21.11';

  return (
    // Launch control anchored top-left; nothing floats in the middle.
    <div className="flex min-h-full flex-col px-5 py-6 sm:px-8 sm:py-8">
      <div className="rise flex w-full max-w-sm flex-col gap-2">
        {/* What you are about to launch. Only the version is the control - the pencil sits
            against it, so the thing you can change and the mark saying so are one target;
            the renderer beside it is a fact, not a button. */}
        <p className="flex items-baseline gap-2.5">
          <button
            type="button"
            onClick={onEditProfile}
            aria-haspopup="dialog"
            aria-label={`Minecraft ${minecraft}. Choose a different version`}
            className="group flex cursor-pointer items-baseline gap-2 rounded-md transition-colors"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
              className="translate-y-0.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] transition-transform group-hover:scale-110"
            >
              <path
                d="M11.2 2.3 L13.7 4.8 L5.4 13.1 L2 14 L2.9 10.6 Z M10 3.5 L12.5 6"
                stroke="#ffffff"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="display-caps text-[15px] leading-none text-rose-soft">
              {minecraft}
            </span>
          </button>
          <span aria-hidden="true" className="h-3 w-px bg-edge-bright" />
          <span className="display-caps text-[15px] leading-none text-ink">OpenGL</span>
        </p>

        <LaunchButton
          state={launchState}
          percent={progress?.percent ?? 0}
          step={progress?.label ?? ''}
          target={`v${minecraft}`}
          // Signed out, the same button starts the Microsoft sign-in; the code to enter
          // appears in the account popup as soon as Microsoft hands it over.
          onClick={() => (launchState === 'locked' ? onSignIn() : onPlay(null))}
        />

        {launchState === 'signing-in' ? (
          <p className="text-[11.5px] leading-relaxed text-ink-dim">
            Finish signing in with the code in the account panel, bottom left.
          </p>
        ) : null}

        {signInError && launchState === 'locked' ? (
          <p className="rounded-lg bg-danger/15 px-3 py-2 text-[11.5px] leading-relaxed text-danger">
            {signInError}
          </p>
        ) : null}

        {/* Close-game button: directly under Launch, left-aligned, a little smaller, and
            only while the game is running. */}
        {launchState === 'running' ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Close the game"
            className="flex h-[40px] w-[72%] cursor-pointer items-center justify-center rounded-lg border border-danger/60 bg-danger/15 text-danger transition-colors hover:border-danger hover:bg-danger/25"
          >
            <span className="display-caps text-[14px] leading-none">Close game</span>
          </button>
        ) : null}
      </div>

      <div
        className="rise mt-7 flex max-w-xl flex-wrap items-stretch"
        style={{ animationDelay: '120ms' }}
      >
        <Readout
          label="Memory"
          value={`${(memoryMb / 1024).toFixed(1)} GB`}
          unit={
            // A memory chip instead of "max": bigger and grey, so the icon reads as
            // hardware rather than brand.
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="h-[20px] w-[20px] text-ink-dim">
              <rect x="3.5" y="6" width="17" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
              <path
                d="M8 6 V3 M12 6 V3 M16 6 V3 M8 21 V18 M12 21 V18 M16 21 V18"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path
                d="M8 10 h3 M8 14 h3 M13.5 10 h3 M13.5 14 h3"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          }
          last
        />
      </div>

      <PartnerMarquee partners={partners} onJoin={(address) => onPlay(address)} />

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

      <NewsStrip news={news} />
    </div>
  );
}

/**
 * Partner servers, pinged live for favicon, player count and MOTD.
 *
 * The row only starts moving when the cards are wider than the space they have; a list
 * that already fits stays still, because scrolling something that is fully visible is
 * motion for its own sake. When it does scroll it runs left to right and pauses on hover.
 */
function PartnerMarquee({
  partners,
  onJoin,
}: {
  partners: PartnerServer[];
  onJoin: (address: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    const copy = copyRef.current;
    if (!viewport || !copy) return;

    // Measured on the first copy only, so the result never depends on whether the second
    // copy is currently rendered - that would flip the state back and forth forever.
    const measure = () => setOverflow(copy.scrollWidth > viewport.clientWidth + 1);

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(copy);

    return () => observer.disconnect();
  }, [partners]);

  if (partners.length === 0) return null;

  const cards = partners.map((server, index) => (
    <div key={`${server.address}-${index}`} className="pr-3">
      <PartnerCard server={server} onJoin={onJoin} />
    </div>
  ));

  return (
    <section className="rise mt-7" style={{ animationDelay: '150ms' }} aria-label="Partner servers">
      <p className="display-caps text-[10px] font-semibold tracking-[0.12em] text-rose-soft">
        Partner servers <span className="font-mono normal-case tracking-normal text-ink-faint">· Double-click to join</span>
      </p>
      <div ref={viewportRef} className="mt-3 overflow-hidden">
        <div
          className={`flex w-max ${overflow ? 'marquee-right hover:[animation-play-state:paused]' : ''}`}
          style={overflow ? { animationDuration: `${Math.max(24, partners.length * 14)}s` } : undefined}
        >
          <div ref={copyRef} className="flex">
            {cards}
          </div>
          {/* Second copy only exists to make the loop seamless. */}
          {overflow ? (
            <div className="flex" aria-hidden="true">
              {cards}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function PartnerCard({
  server,
  onJoin,
}: {
  server: PartnerServer;
  onJoin: (address: string) => void;
}) {
  return (
    // Double-click launches the game straight onto this server. A single click does
    // nothing on purpose: the card scrolls past, and starting Minecraft is not something
    // a stray click should be able to do.
    <div
      role="button"
      tabIndex={0}
      title={`Double-click to launch and join ${server.address}`}
      onDoubleClick={() => onJoin(server.address)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onJoin(server.address);
      }}
      className="flex w-[300px] shrink-0 cursor-pointer items-center gap-3 rounded-xl border border-edge bg-surface p-3 transition-colors hover:bg-surface-high"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg border border-edge-bright bg-void">
        {server.favicon ? (
          <img
            src={server.favicon}
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover [image-rendering:pixelated]"
            draggable={false}
          />
        ) : (
          <span className="brand-gradient grid h-full w-full place-items-center font-display text-[15px] font-bold text-void">
            {server.name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-semibold text-ink">{server.name}</span>
          <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] tabular-nums text-ink-faint">
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${server.online ? 'bg-[#63d492]' : 'bg-ink-faint'}`}
            />
            {server.online ? `${server.players}/${server.maxPlayers}` : 'offline'}
          </span>
        </span>
        <span className="mc-emoji mt-0.5 block truncate text-[11px] leading-relaxed text-ink-dim">
          {server.online ? minecraftish(server.motd) || server.address : server.address}
        </span>
      </span>
    </div>
  );
}

/**
 * Rewrites the emojis servers put in their MOTDs to the monochrome, pixel-font glyphs
 * Minecraft actually draws. A colorful Windows emoji would render in Segoe UI Emoji -
 * a flat, candy-coloured glyph from outside the game - so each one is swapped for the
 * closest symbol in the game's own alphabet before it is painted.
 */
function minecraftish(text: string): string {
  const swaps: [string, string][] = [
    // Swords, shields and picks are already pixel-font symbols; only the variation
    // selector (the invisible tag Windows adds for colour) needs to go.
    ['\u{1F5E1}\uFE0F', '🗡'],
    ['\u{1F6E1}\uFE0F', '🛡'],
    ['\u{2694}\uFE0F', '⚔'],
    ['\u{26CF}\uFE0F', '⛏'],
    ['\u{2620}\uFE0F', '☠'],
    ['\u{2764}\uFE0F', '♥'],
    // Everything from here on is a real swap.
    ['💀', '☠'],
    ['❤', '♥'],
    ['💗', '♥'],
    ['💘', '♥'],
    ['💕', '♥'],
    ['💓', '♥'],
    ['💖', '♥'],
    ['💝', '♥'],
    ['⭐', '★'],
    ['🌟', '★'],
    ['✨', '★'],
    ['🎇', '★'],
    ['🎆', '★'],
    ['💫', '★'],
    ['💎', '◆'],
    ['🔷', '◆'],
    ['🔹', '◆'],
    ['💠', '◆'],
    ['👑', '♚'],
    ['🏆', '♛'],
    ['🥇', '♛'],
    ['🥈', '♛'],
    ['🥉', '♛'],
    ['🎖', '♛'],
    ['🔥', '✹'],
    ['🌋', '✹'],
    ['🌞', '☀'],
    ['💧', '☁'],
    ['🌊', '☁'],
    ['🌙', '☽'],
    ['🌈', '❈'],
    ['🌨', '❄'],
    ['🌬', '☁'],
  ];

  let out = text;
  for (const [emoji, symbol] of swaps) {
    out = out.split(emoji).join(symbol);
  }
  return out;
}

/**
 * News feed from the project's GitHub repo, at the foot of the Play screen. The window
 * is one fixed size, so the grid is hard-coded to two columns and every banner is locked
 * to a fixed 16:9 box; more items simply continue below, on the same page scroll. The
 * pictures never move on hover - the cursor over a card only marks it.
 */
function NewsStrip({ news }: { news: NewsItem[] }) {
  if (news.length === 0) return null;

  return (
    // `flex-1` hands the feed whatever height is left under the launch controls, so the
    // grid fills the page instead of trailing off.
    <section
      className="rise mt-20 flex min-h-0 flex-1 flex-col"
      style={{ animationDelay: '180ms' }}
      aria-label="News"
    >
      <h2 className="display-caps text-[18px] leading-none text-white">News</h2>
      <div className="mt-4 grid grid-cols-2 gap-8">
        {news.map((item, index) => (
          <NewsCard key={`${item.title}-${index}`} item={item} />
        ))}
      </div>
    </section>
  );
}

function NewsCard({ item }: { item: NewsItem }) {
  const clickable = Boolean(item.url);

  const inner = (
    <>
      {/* Banner in a fixed 16:9 box: cover-cropped, so every picture lines up and no
          letterboxing shows. On hover the picture lifts a little - anchored to its bottom
          edge, so the movement reads as the card answering, not as the image jumping. */}
      {item.image ? (
        <span className="block origin-bottom overflow-hidden rounded-lg transition-transform duration-300 ease-out group-hover:scale-[1.02]">
          <img
            src={item.image}
            alt=""
            aria-hidden="true"
            loading="lazy"
            className="aspect-video h-full w-full object-cover"
            draggable={false}
          />
        </span>
      ) : null}
      <span className="block pt-3 text-left">
        {/* Title under the image, white; date under the title. */}
        <span className="block text-[17px] font-bold leading-tight text-white">{item.title}</span>
        {item.date ? (
          <span className="mt-1.5 block font-mono text-[11.5px] tracking-wide text-ink-faint">
            {item.date}
          </span>
        ) : null}
        {item.html ? (
          <span
            className="feed-html mt-2 block text-[14px] leading-relaxed text-ink-dim"
            // Sanitized in the main process against a tag/attribute allow-list.
            dangerouslySetInnerHTML={{ __html: item.html }}
          />
        ) : null}
      </span>
    </>
  );

  // No frame: just the rounded banner and the text below it. `group` lets the banner's
  // image answer to the hover on the whole card.
  const shared = 'group flex flex-col text-left transition-opacity';

  if (clickable) {
    return (
      <button
        type="button"
        onClick={() => void window.bestclient.openExternal(item.url!)}
        className={`${shared} cursor-pointer`}
      >
        {inner}
      </button>
    );
  }

  return <div className={shared}>{inner}</div>;
}

/** One reading in the stat strip: hairline-separated, no boxes, no gray. */
function Readout({
  label,
  value,
  unit,
  accent = false,
  last = false,
}: {
  label: string;
  value: string;
  unit?: ReactNode;
  accent?: boolean;
  last?: boolean;
}) {
  return (
    <div className={`px-5 first:pl-0 ${last ? '' : 'border-r border-edge'}`}>
      <p className="display-caps text-[10px] font-semibold tracking-[0.12em] text-rose-soft">
        {label}
      </p>
      <p className="mt-1.5 flex items-baseline gap-1.5">
        <span
          className={`display-caps text-[22px] leading-none ${accent ? 'text-rose-soft' : 'text-ink'}`}
        >
          {value}
        </span>
        {unit ? (
          <span className="display-caps text-[10px] leading-none text-rose-soft">{unit}</span>
        ) : null}
      </p>
    </div>
  );
}

/**
 * Colours a game log line by severity so the console reads at a glance:
 * red for errors, orange for warnings, green for healthy INFO, white for the rest.
 */
function logLineColor(line: string): string {
  if (/\b(error|exception|fatal|severe|caused by)\b/i.test(line)) return 'text-danger';
  if (/\bwarn(ing)?\b/i.test(line)) return 'text-warn';
  if (/\binfo\b|loaded|started|success|ready|done/i.test(line)) return 'text-[#63d492]';
  return 'text-ink';
}

/** Electron prefixes IPC rejections with "Error invoking remote method '...':". */
function cleanError(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '');
}

/** GPU strings from Chromium trail a vendor suffix after the first parenthesis. */

function IconPlay() {
  return (
    <svg width="19" height="19" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">
      <path d="M2.5 1.3 L10.5 6 L2.5 10.7 Z" />
    </svg>
  );
}

function IconMods() {
  return (
    <svg width="19" height="19" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconStore() {
  return (
    <svg width="19" height="19" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <path
        d="M8 1.5 V10 M3.5 5.5 L8 10.5 L12.5 5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
      />
      <path d="M2 13.5 H14" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconSettings() {
  // A real cog with teeth, not straight rays - reads as "settings", not a sun.
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z" />
    </svg>
  );
}
