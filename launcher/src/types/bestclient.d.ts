export interface AppInfo {
  version: string;
  brand: { name: string; primary: string; secondary: string };
  target: { minecraft: string; fabricLoader: string; javaMajor: number };
  lockedServer: { name: string; address: string };
  cpuCount: number;
}

export interface PublicAccount {
  uuid: string;
  username: string;
}

export interface PublicSettings {
  memoryMb: number;
  enabledMods: string[];
  knownMods: string[];
  appliedPvpDefaults: boolean;
  closeOnLaunch: boolean;
  extraJvmArgs: string;
  account: PublicAccount | null;
}

export type ModCategory = 'core' | 'performance' | 'pvp' | 'library' | 'risky';

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

type Unsubscribe = () => void;

export interface BestClientApi {
  appInfo(): Promise<AppInfo>;
  minimize(): Promise<void>;
  close(): Promise<void>;
  getSettings(): Promise<PublicSettings>;
  setSettings(patch: Partial<PublicSettings>): Promise<PublicSettings>;
  getPack(): Promise<PackView>;
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
  repair(): Promise<InstallSummary>;
  resetPvpOptions(): Promise<{ applied: string[] }>;
  openInstanceFolder(): Promise<void>;
  openExternal(url: string): Promise<void>;
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
