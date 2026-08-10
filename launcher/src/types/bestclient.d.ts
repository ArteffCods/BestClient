export type ProfileId = '26.2' | '26.1.2' | '1.21.11';

/** One Minecraft version, as the picker shows it: a picture and the version on it. */
export interface ProfileView {
  id: ProfileId;
  image: string;
}

export interface ProfileList {
  active: ProfileId;
  profiles: ProfileView[];
}

export interface AppInfo {
  version: string;
  brand: { name: string; primary: string; secondary: string };
  target: { minecraft: string; fabricLoader: string; javaMajor: number };
  /** GPU model string reported by Chromium, e.g. "AMD Radeon RX 6600 XT". */
  gpuModel: string;
  /** The JVM flags this machine launches with out of the box. */
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
  pinnedVersions: Record<string, string>;
  appliedPvpDefaults: boolean;
  /** What the launcher does when the game window opens: stay, minimise or hide. */
  launchBehaviour: 'stay' | 'minimise' | 'hide';
  /** NVIDIA optimization (Nvidium). Resolved from the GPU once, then player-set. */
  nvidiaOptimize: boolean;
  /** The whole JVM flag block; empty means the launcher's defaults are in use. */
  jvmFlags: string;
  /** Show what you are doing on your Discord profile. */
  discordRpc: boolean;
  account: PublicAccount | null;
}

export type ModCategory = 'core' | 'performance' | 'pvp' | 'library' | 'risky';

/** The result of updating everything at once. */
export interface UpdateAllResult {
  updated: string[];
  /** Mods left on their current build, and what is in the way. */
  skipped: { slug: string; reason: string }[];
  failed: { slug: string; reason: string }[];
  mods: InventoryMod[];
}

export interface PackModView {
  slug: string;
  name: string;
  category: ModCategory;
  locked: boolean;
  defaultEnabled: boolean;
  iconUrl?: string;
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
  unavailableMods: string[];
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

/** One result in the Modrinth store search. */
export interface StoreHit {
  slug: string;
  title: string;
  description: string;
  iconUrl?: string;
  bannerUrl?: string;
  downloads: number;
  follows: number;
  author?: string;
  categories: string[];
}

/** Where a jar in the mods folder came from. `client` mods ship inside the launcher. */
export type ModSource = 'pack' | 'store' | 'local' | 'client';

/** What the launcher is doing about a new release. */
export interface UpdateState {
  status: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error';
  version: string;
  notes: string;
  percent: number;
  error?: string;
}

/** One row in the Mods screen: pack mods, store installs and hand-added jars. */
export interface InventoryMod {
  id: string;
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

/** One release in the changelog rail. */
export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  description: string;
  changes: string[];
  html?: string;
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

/** Outcome of the pre-launch integrity check over the mods folder. */
export interface ModVerifyResult {
  verified: number;
  unknown: string[];
  flagged: string[];
}

export interface ModImportResult {
  imported: string[];
  skipped: string[];
}

/** One card in the Play-screen news feed. */
export interface NewsItem {
  title: string;
  date: string;
  image: string;
  url?: string;
  html?: string;
}

export interface PartnerServer {
  name: string;
  address: string;
  online: boolean;
  players: number;
  maxPlayers: number;
  motd: string;
  favicon: string;
}

export interface StoreSearchResult {
  hits: StoreHit[];
  totalHits: number;
  hasMore: boolean;
}

type Unsubscribe = () => void;

export interface BestClientApi {
  appInfo(): Promise<AppInfo>;
  minimize(): Promise<void>;
  close(): Promise<void>;
  getSettings(): Promise<PublicSettings>;
  setSettings(patch: Partial<PublicSettings>): Promise<PublicSettings>;
  getPack(): Promise<PackView>;
  getProfiles(): Promise<ProfileList>;
  setProfile(id: ProfileId): Promise<ProfileId>;
  getServers(): Promise<ServerListEntry[]>;
  login(): Promise<PublicAccount>;
  getAuthConfig(): Promise<AuthConfigStatus>;
  setAuthClientId(clientId: string): Promise<AuthConfigStatus>;
  cancelLogin(): Promise<void>;
  logout(uuid?: string): Promise<AccountList>;
  currentAccount(): Promise<PublicAccount | null>;
  listAccounts(): Promise<AccountList>;
  selectAccount(uuid: string): Promise<PublicAccount | null>;
  play(quickConnect?: string | null): Promise<InstallSummary>;
  stop(): Promise<void>;
  repair(): Promise<InstallSummary>;
  importModFiles(files: File[]): Promise<ModImportResult>;
  browseModFiles(): Promise<ModImportResult>;
  verifyMods(): Promise<ModVerifyResult>;
  modInventory(): Promise<InventoryMod[]>;
  setModEnabled(id: string, next: boolean): Promise<InventoryMod[]>;
  deleteMod(id: string): Promise<InventoryMod[]>;
  checkModUpdates(): Promise<Record<string, string>>;
  updateMod(slug: string): Promise<InventoryMod[]>;
  updateAllMods(): Promise<UpdateAllResult>;
  getNews(): Promise<NewsItem[]>;
  getPartners(): Promise<PartnerServer[]>;
  getChangelog(): Promise<ChangelogEntry[]>;
  searchMods(query: string, page?: number, index?: StoreSortIndex): Promise<StoreSearchResult>;
  modVersions(slug: string): Promise<ModVersionOption[]>;
  installMod(slug: string, versionId?: string): Promise<StoreInstallResult>;
  removeMod(slug: string): Promise<StoreInstalled>;
  installedMods(): Promise<StoreInstalled>;
  resetPvpOptions(): Promise<{ applied: string[] }>;
  openInstanceFolder(): Promise<void>;
  openExternal(url: string): Promise<void>;
  updateState(): Promise<UpdateState>;
  checkForUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  clearCache(): Promise<number>;
  clearLogs(): Promise<number>;
  onUpdateState(handler: (payload: UpdateState) => void): Unsubscribe;
  onDeviceCode(handler: (payload: DeviceCodeEvent) => void): Unsubscribe;
  onInstallProgress(handler: (payload: InstallProgressEvent) => void): Unsubscribe;
  onGameLog(handler: (line: string) => void): Unsubscribe;
  onGameExit(handler: (code: number | null) => void): Unsubscribe;
}

declare global {
  interface Window {
    bestclient: BestClientApi;
  }
}