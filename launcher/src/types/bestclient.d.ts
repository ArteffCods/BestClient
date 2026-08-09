export interface AppInfo {
  version: string;
  brand: { name: string; primary: string; secondary: string };
  target: { minecraft: string; fabricLoader: string; javaMajor: number };
  lockedServer: { name: string; address: string };
}

export interface PublicAccount {
  uuid: string;
  username: string;
}

export interface PublicSettings {
  memoryMb: number;
  enabledMods: string[];
  seededSuggestedServer: boolean;
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

export interface DeviceCodeEvent {
  userCode: string;
  verificationUri: string;
  expiresInSeconds: number;
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
  cancelLogin(): Promise<void>;
  logout(): Promise<void>;
  currentAccount(): Promise<PublicAccount | null>;
  play(quickConnect?: string | null): Promise<{ unavailableMods: string[] }>;
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
