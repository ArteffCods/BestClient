/** IPC contract shared between the Electron main process and the preload bridge. */

export interface AppInfo {
  version: string;
  brand: { name: string; primary: string; secondary: string };
  target: { minecraft: string; fabricLoader: string; javaMajor: number };
  /** The GPU model string reported by Chromium, e.g. "AMD Radeon RX 6600 XT". */
  gpuModel: string;
  /**
   * The JVM flags this machine would launch with out of the box, resolved here because
   * one of them depends on the core count. Settings shows these when the player has not
   * edited the block, and restores them from here.
   */
  defaultJvmFlags: string[];
}

export interface PublicAccount {
  uuid: string;
  username: string;
}

export interface PublicSettings {
  memoryMb: number;
  enabledMods: string[];
  knownMods: string[];
  removedMods: string[];
  /** Pack slug -> Modrinth version_number chosen by the player. */
  pinnedVersions: Record<string, string>;
  appliedPvpDefaults: boolean;
  /** What the launcher does when the game window opens: stay, minimise or hide. */
  launchBehaviour: 'stay' | 'minimise' | 'hide';
  /** NVIDIA optimization (Nvidium). Resolved from the GPU once, then player-set. */
  nvidiaOptimize: boolean;
  /** The whole JVM flag block; empty means the launcher's defaults are in use. */
  jvmFlags: string;
  account: PublicAccount | null;
}

export interface PackModView {
  slug: string;
  name: string;
  category: 'core' | 'performance' | 'pvp' | 'library' | 'risky';
  locked: boolean;
  defaultEnabled: boolean;
  note: string;
}

export interface PackView {
  minecraft: string;
  loader: string;
  loaderVersion: string;
  mods: PackModView[];
}

export interface InstallProgressEvent {
  step: number;
  steps: number;
  percent: number;
  label: string;
  detail: string;
}

export interface InstallSummary {
  /** Pack slugs with no build for the target Minecraft version. */
  unavailableMods: string[];
  /** Titles of the libraries installed automatically to satisfy hard requirements. */
  dependencies: string[];
}

export interface DeviceCodeEvent {
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresInSeconds: number;
}

export interface AuthConfigStatus {
  configured: boolean;
  source: 'env' | 'file' | 'default' | null;
  file: string;
}

export interface AccountList {
  accounts: PublicAccount[];
  activeUuid: string | null;
}

export interface ServerListEntry {
  name: string;
  address: string;
  locked: boolean;
}

/** Where a jar in the mods folder came from. `client` mods ship inside the launcher. */
export type ModSource = 'pack' | 'store' | 'local' | 'client';

/** A mod packaged inside the launcher itself, verified against a locally stored hash. */
export interface BundledModInfo {
  id: string;
  name: string;
  note: string;
  fileName: string;
}

/** What the launcher is doing about a new release. */
export interface UpdateState {
  status: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error';
  version: string;
  notes: string;
  /** Download progress, 0-100. */
  percent: number;
  error?: string;
}

/** One row in the Mods screen: the pack's own mods, store installs and hand-added jars. */
export interface InventoryMod {
  /** Stable key: a pack slug, `store:<slug>` or `file:<name>`. */
  id: string;
  /** Modrinth slug, when the mod has one. */
  slug?: string;
  name: string;
  note: string;
  source: ModSource;
  locked: boolean;
  enabled: boolean;
  iconUrl?: string;
  fileName?: string;
  version?: string;
}

/** One selectable Modrinth build of a mod. */
export interface ModVersionOption {
  id: string;
  versionNumber: string;
  name: string;
  channel: 'release' | 'beta' | 'alpha';
  datePublished: string;
}

/** How the Modrinth store orders its results. */
export type StoreSortIndex = 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated';

/** One result in the Modrinth store search. */
export interface StoreHit {
  slug: string;
  title: string;
  description: string;
  iconUrl?: string;
  /** Wide gallery/banner image, distinct from the square icon. */
  bannerUrl?: string;
  downloads: number;
  follows: number;
  /** Display name of whoever published the project. */
  author?: string;
  /** Human-readable category names, capped at three. */
  categories: string[];
}

/** Extra mods installed from the store, keyed by project slug. */
export interface StoreInstalled {
  [slug: string]: { fileName: string; version: string };
}

export interface StoreInstallResult {
  slug: string;
  title: string;
  fileName: string;
  version: string;
}

/** Outcome of the pre-launch integrity check over `instance/mods`. */
export interface ModVerifyResult {
  /** Number of jars whose hash Modrinth confirmed. */
  verified: number;
  /** File names of jars Modrinth does not publish - these block the launch. */
  unknown: string[];
  /** File names matching a known hacked client or injector - these block the launch. */
  flagged: string[];
}

export interface ModImportResult {
  imported: string[];
  skipped: string[];
}

/** Live status of a partner server shown in the Play-screen marquee. */
export interface PartnerServer {
  name: string;
  address: string;
  online: boolean;
  players: number;
  maxPlayers: number;
  motd: string;
  /** data:image/png;base64 favicon from the server, or empty. */
  favicon: string;
}

/** A page of Modrinth search results. */
export interface StoreSearchResult {
  hits: StoreHit[];
  totalHits: number;
  /** True when at least one more page can be filled after this one. */
  hasMore: boolean;
}

/** One release in the changelog rail, loaded from the project's GitHub repo. */
export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  description: string;
  changes: string[];
  /** Optional pre-sanitized HTML snippet. */
  html?: string;
}

/** One card in the Play-screen news feed, loaded from the project's GitHub repo. */
export interface NewsItem {
  title: string;
  /** Free-form date string as authored in the feed, e.g. "2026-08-09". */
  date: string;
  /** Image URL, or empty when the card has no artwork. */
  image: string;
  /** Optional https link opened in the system browser when the card is clicked. */
  url?: string;
  /** Optional pre-sanitized HTML snippet embedded in the card body. */
  html?: string;
}

export type PlayState =
  | { phase: 'idle' }
  | { phase: 'installing'; progress: InstallProgressEvent }
  | { phase: 'starting' }
  | { phase: 'running' }
  | { phase: 'error'; message: string };

export const CHANNELS = {
  appInfo: 'app:info',
  windowMinimize: 'window:minimize',
  windowClose: 'window:close',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  packGet: 'pack:get',
  authLogin: 'auth:login',
  authConfigGet: 'auth:config-get',
  authConfigSet: 'auth:config-set',
  authCancel: 'auth:cancel',
  authLogout: 'auth:logout',
  authCurrent: 'auth:current',
  authList: 'auth:list',
  authSelect: 'auth:select',
  play: 'play:run',
  stop: 'play:stop',
  repair: 'install:repair',
  serversList: 'servers:list',
  optionsReset: 'options:reset',
  openInstanceFolder: 'folder:instance',
  openExternal: 'shell:external',
  storeSearch: 'store:search',
  storeInstall: 'store:install',
  storeRemove: 'store:remove',
  storeInstalled: 'store:installed',
  storeVersions: 'store:versions',
  modsImport: 'mods:import',
  modsBrowse: 'mods:browse',
  modsVerify: 'mods:verify',
  modsInventory: 'mods:inventory',
  modsSetEnabled: 'mods:set-enabled',
  modsDelete: 'mods:delete',
  modsUpdates: 'mods:updates',
  modsUpdate: 'mods:update',
  newsGet: 'news:get',
  partnersGet: 'partners:get',
  changelogGet: 'changelog:get',
  updateState: 'update:state-get',
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  maintenanceClearCache: 'maintenance:clear-cache',
  maintenanceClearLogs: 'maintenance:clear-logs',
  // main -> renderer
  onUpdateState: 'update:state',
  onDeviceCode: 'auth:device-code',
  onInstallProgress: 'install:progress',
  onGameLog: 'game:log',
  onGameExit: 'game:exit',
} as const;
