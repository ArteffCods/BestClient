import { contextBridge, ipcRenderer } from 'electron';

import {
  CHANNELS,
  type AccountList,
  type AppInfo,
  type DeviceCodeEvent,
  type AuthConfigStatus,
  type InstallProgressEvent,
  type InstallSummary,
  type PackView,
  type PublicAccount,
  type PublicSettings,
  type ServerListEntry,
} from './shared';

type Unsubscribe = () => void;

function on<T>(channel: string, handler: (payload: T) => void): Unsubscribe {
  const listener = (_event: unknown, payload: T) => handler(payload);
  ipcRenderer.on(channel, listener);

  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api = {
  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke(CHANNELS.appInfo),

  minimize: (): Promise<void> => ipcRenderer.invoke(CHANNELS.windowMinimize),
  close: (): Promise<void> => ipcRenderer.invoke(CHANNELS.windowClose),

  getSettings: (): Promise<PublicSettings> => ipcRenderer.invoke(CHANNELS.settingsGet),
  setSettings: (patch: Partial<PublicSettings>): Promise<PublicSettings> =>
    ipcRenderer.invoke(CHANNELS.settingsSet, patch),

  getPack: (): Promise<PackView> => ipcRenderer.invoke(CHANNELS.packGet),
  getServers: (): Promise<ServerListEntry[]> => ipcRenderer.invoke(CHANNELS.serversList),

  login: (): Promise<PublicAccount> => ipcRenderer.invoke(CHANNELS.authLogin),
  getAuthConfig: (): Promise<AuthConfigStatus> => ipcRenderer.invoke(CHANNELS.authConfigGet),
  setAuthClientId: (clientId: string): Promise<AuthConfigStatus> =>
    ipcRenderer.invoke(CHANNELS.authConfigSet, clientId),
  cancelLogin: (): Promise<void> => ipcRenderer.invoke(CHANNELS.authCancel),
  logout: (uuid?: string): Promise<AccountList> => ipcRenderer.invoke(CHANNELS.authLogout, uuid),
  currentAccount: (): Promise<PublicAccount | null> => ipcRenderer.invoke(CHANNELS.authCurrent),
  listAccounts: (): Promise<AccountList> => ipcRenderer.invoke(CHANNELS.authList),
  selectAccount: (uuid: string): Promise<PublicAccount | null> =>
    ipcRenderer.invoke(CHANNELS.authSelect, uuid),

  play: (quickConnect?: string | null): Promise<InstallSummary> =>
    ipcRenderer.invoke(CHANNELS.play, quickConnect ?? null),

  repair: (): Promise<InstallSummary> => ipcRenderer.invoke(CHANNELS.repair),

  resetPvpOptions: (): Promise<{ applied: string[] }> => ipcRenderer.invoke(CHANNELS.optionsReset),
  openInstanceFolder: (): Promise<void> => ipcRenderer.invoke(CHANNELS.openInstanceFolder),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(CHANNELS.openExternal, url),

  onDeviceCode: (handler: (payload: DeviceCodeEvent) => void): Unsubscribe =>
    on(CHANNELS.onDeviceCode, handler),
  onInstallProgress: (handler: (payload: InstallProgressEvent) => void): Unsubscribe =>
    on(CHANNELS.onInstallProgress, handler),
  onGameLog: (handler: (line: string) => void): Unsubscribe => on(CHANNELS.onGameLog, handler),
  onGameExit: (handler: (code: number | null) => void): Unsubscribe => on(CHANNELS.onGameExit, handler),
};

export type BestClientApi = typeof api;

contextBridge.exposeInMainWorld('bestclient', api);
