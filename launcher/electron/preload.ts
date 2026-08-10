import { contextBridge, ipcRenderer, webUtils } from 'electron';

import {
  CHANNELS,
  type AccountList,
  type AppInfo,
  type ProfileId,
  type ProfileList,
  type ChangelogEntry,
  type DeviceCodeEvent,
  type AuthConfigStatus,
  type InstallProgressEvent,
  type InstallSummary,
  type InventoryMod,
  type ModImportResult,
  type ModVerifyResult,
  type ModVersionOption,
  type NewsItem,
  type PartnerServer,
  type StoreSearchResult,
  type StoreSortIndex,
  type PackView,
  type PublicAccount,
  type PublicSettings,
  type ServerListEntry,
  type StoreInstallResult,
  type StoreInstalled,
  type UpdateState,
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

  getProfiles: (): Promise<ProfileList> => ipcRenderer.invoke(CHANNELS.profilesGet),
  setProfile: (id: ProfileId): Promise<ProfileId> => ipcRenderer.invoke(CHANNELS.profileSet, id),

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

  stop: (): Promise<void> => ipcRenderer.invoke(CHANNELS.stop),

  repair: (): Promise<InstallSummary> => ipcRenderer.invoke(CHANNELS.repair),

  // Modrinth store + drag-and-drop import. File objects are resolved to real paths here
  // (webUtils) because `File` cannot cross the IPC boundary.
  importModFiles: (files: File[]): Promise<ModImportResult> =>
    ipcRenderer.invoke(
      CHANNELS.modsImport,
      files.map((file) => webUtils.getPathForFile(file)),
    ),
  browseModFiles: (): Promise<ModImportResult> => ipcRenderer.invoke(CHANNELS.modsBrowse),
  verifyMods: (): Promise<ModVerifyResult> => ipcRenderer.invoke(CHANNELS.modsVerify),

  // The Mods screen works off one list covering pack, store and hand-added jars.
  modInventory: (): Promise<InventoryMod[]> => ipcRenderer.invoke(CHANNELS.modsInventory),
  setModEnabled: (id: string, next: boolean): Promise<InventoryMod[]> =>
    ipcRenderer.invoke(CHANNELS.modsSetEnabled, id, next),
  deleteMod: (id: string): Promise<InventoryMod[]> => ipcRenderer.invoke(CHANNELS.modsDelete, id),
  checkModUpdates: (): Promise<Record<string, string>> => ipcRenderer.invoke(CHANNELS.modsUpdates),
  updateMod: (slug: string): Promise<InventoryMod[]> => ipcRenderer.invoke(CHANNELS.modsUpdate, slug),

  getNews: (): Promise<NewsItem[]> => ipcRenderer.invoke(CHANNELS.newsGet),
  getPartners: (): Promise<PartnerServer[]> => ipcRenderer.invoke(CHANNELS.partnersGet),
  getChangelog: (): Promise<ChangelogEntry[]> => ipcRenderer.invoke(CHANNELS.changelogGet),
  searchMods: (query: string, page = 0, index: StoreSortIndex = 'relevance'): Promise<StoreSearchResult> =>
    ipcRenderer.invoke(CHANNELS.storeSearch, query, page, index),
  modVersions: (slug: string): Promise<ModVersionOption[]> =>
    ipcRenderer.invoke(CHANNELS.storeVersions, slug),
  installMod: (slug: string, versionId?: string): Promise<StoreInstallResult> =>
    ipcRenderer.invoke(CHANNELS.storeInstall, slug, versionId),
  removeMod: (slug: string): Promise<StoreInstalled> => ipcRenderer.invoke(CHANNELS.storeRemove, slug),
  installedMods: (): Promise<StoreInstalled> => ipcRenderer.invoke(CHANNELS.storeInstalled),

  resetPvpOptions: (): Promise<{ applied: string[] }> => ipcRenderer.invoke(CHANNELS.optionsReset),
  openInstanceFolder: (): Promise<void> => ipcRenderer.invoke(CHANNELS.openInstanceFolder),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(CHANNELS.openExternal, url),

  // Updates: check + install are explicit, the state arrives on its own channel.
  updateState: (): Promise<UpdateState> => ipcRenderer.invoke(CHANNELS.updateState),
  checkForUpdate: (): Promise<void> => ipcRenderer.invoke(CHANNELS.updateCheck),
  installUpdate: (): Promise<void> => ipcRenderer.invoke(CHANNELS.updateInstall),
  onUpdateState: (handler: (payload: UpdateState) => void): Unsubscribe =>
    on(CHANNELS.onUpdateState, handler),

  // Maintenance: clear regenerable caches and old game logs, returning what was removed.
  clearCache: (): Promise<number> => ipcRenderer.invoke(CHANNELS.maintenanceClearCache),
  clearLogs: (): Promise<number> => ipcRenderer.invoke(CHANNELS.maintenanceClearLogs),

  onDeviceCode: (handler: (payload: DeviceCodeEvent) => void): Unsubscribe =>
    on(CHANNELS.onDeviceCode, handler),
  onInstallProgress: (handler: (payload: InstallProgressEvent) => void): Unsubscribe =>
    on(CHANNELS.onInstallProgress, handler),
  onGameLog: (handler: (line: string) => void): Unsubscribe => on(CHANNELS.onGameLog, handler),
  onGameExit: (handler: (code: number | null) => void): Unsubscribe => on(CHANNELS.onGameExit, handler),
};

export type BestClientApi = typeof api;

contextBridge.exposeInMainWorld('bestclient', api);
