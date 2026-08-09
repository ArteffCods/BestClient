/** IPC contract shared between the Electron main process and the preload bridge. */

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
  knownMods: string[];
  seededSuggestedServer: boolean;
  appliedPvpDefaults: boolean;
  closeOnLaunch: boolean;
  extraJvmArgs: string;
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

export interface ServerListEntry {
  name: string;
  address: string;
  locked: boolean;
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
  play: 'play:run',
  repair: 'install:repair',
  serversList: 'servers:list',
  optionsReset: 'options:reset',
  openInstanceFolder: 'folder:instance',
  openExternal: 'shell:external',
  // main -> renderer
  onDeviceCode: 'auth:device-code',
  onInstallProgress: 'install:progress',
  onGameLog: 'game:log',
  onGameExit: 'game:exit',
} as const;
