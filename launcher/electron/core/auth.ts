import fs from 'node:fs';
import path from 'node:path';

import { log } from './logger';
import { USER_AGENT } from './net';
import { externalResourceFile, parseJson, resourceFile } from './paths';
import { activeAccount, removeAccount, updateAccountTokens, type MinecraftAccount } from './store';

const DEVICE_CODE_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode';
const TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const XBL_URL = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const MC_LOGIN_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox';
const MC_PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile';
const SCOPE = 'XboxLive.signin offline_access';

export interface DeviceCodePrompt {
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresInSeconds: number;
}

export interface XboxError extends Error {
  xErr?: number;
}

export interface AuthConfigStatus {
  configured: boolean;
  source: 'env' | 'file' | 'default' | null;
  file: string;
}

/**
 * Public-client registration of the open-source Minosoft launcher
 * (client id: Minosoft 2 / microsoft-bixilon2), verified working with the
 * consumers tenant + `XboxLive.signin offline_access` device-code flow.
 *
 * It is the out-of-the-box fallback so login works straight from the client without
 * any Azure setup. Anyone running BestClient can override it - either the
 * BESTCLIENT_MS_CLIENT_ID environment variable, or `auth.json` written from the
 * Settings > Microsoft auth panel - with a client ID of their own.
 */
const DEFAULT_CLIENT_ID = 'feb3836f-0333-4185-8eb9-4cbf0498f947';

function clientId(): string {
  const fromEnv = process.env.BESTCLIENT_MS_CLIENT_ID?.trim();
  if (fromEnv) return fromEnv;

  const fromFile = readClientIdFromFiles();
  if (fromFile) return fromFile.clientId;

  return DEFAULT_CLIENT_ID;
}

export function authConfigStatus(): AuthConfigStatus {
  if (process.env.BESTCLIENT_MS_CLIENT_ID?.trim()) {
    return { configured: true, source: 'env', file: writableAuthConfigFile() };
  }

  const fromFile = readClientIdFromFiles();

  if (fromFile) {
    return { configured: true, source: 'file', file: fromFile.file };
  }

  return { configured: true, source: 'default', file: writableAuthConfigFile() };
}

export async function saveAuthClientId(clientId: string): Promise<AuthConfigStatus> {
  const trimmed = clientId.trim();
  const file = writableAuthConfigFile();

  if (!trimmed) {
    // Empty input reverts to the built-in default.
    await fs.promises.rm(file, { force: true });
    return authConfigStatus();
  }

  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, `${JSON.stringify({ clientId: trimmed }, null, 2)}\n`, 'utf8');

  return authConfigStatus();
}

function readClientIdFromFiles(): { clientId: string; file: string } | null {
  for (const file of [externalResourceFile('auth.json'), resourceFile('auth.json')]) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = parseJson<{ clientId?: string }>(raw);

      if (parsed.clientId?.trim()) return { clientId: parsed.clientId.trim(), file };
    } catch {
      // keep looking in the next supported location
    }
  }

  return null;
}

function writableAuthConfigFile(): string {
  return process.defaultApp ? resourceFile('auth.json') : externalResourceFile('auth.json');
}

async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();

  if (!response.ok) {
    const error: XboxError = new Error(`${url} -> HTTP ${response.status}: ${text}`);

    try {
      const parsed = JSON.parse(text) as { XErr?: number };
      if (parsed.XErr) error.xErr = parsed.XErr;
    } catch {
      // response was not JSON
    }

    throw error;
  }

  return JSON.parse(text) as T;
}

async function postForm<T>(url: string, form: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams(form).toString(),
  });

  const parsed = (await response.json()) as T & { error?: string; error_description?: string };

  if (!response.ok && !parsed.error) {
    throw new Error(`${url} -> HTTP ${response.status}`);
  }

  return parsed;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface XboxResponse {
  Token: string;
  DisplayClaims: { xui: { uhs: string }[] };
}

/**
 * Runs the full Microsoft device-code login.
 *
 * @param onPrompt called as soon as the user code is known, so the UI can show it
 * @param shouldCancel polled between attempts so the UI can abort the login
 */
export async function loginWithDeviceCode(
  onPrompt: (prompt: DeviceCodePrompt) => void,
  shouldCancel: () => boolean = () => false,
): Promise<MinecraftAccount> {
  const id = clientId();

  const device = await postForm<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval: number;
  }>(DEVICE_CODE_URL, { client_id: id, scope: SCOPE });

  onPrompt({
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    verificationUriComplete: device.verification_uri_complete,
    expiresInSeconds: device.expires_in,
  });

  const deadline = Date.now() + device.expires_in * 1000;
  let interval = Math.max(device.interval, 1) * 1000;

  for (;;) {
    if (shouldCancel()) {
      throw new Error('You cancelled the sign-in.');
    }

    if (Date.now() > deadline) {
      throw new Error('The sign-in code expired, please try again.');
    }

    await delay(interval);

    const token = await postForm<TokenResponse>(TOKEN_URL, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: id,
      device_code: device.device_code,
    });

    if (token.error === 'authorization_pending') continue;

    if (token.error === 'slow_down') {
      interval += 5000;
      continue;
    }

    if (token.error) {
      throw new Error(token.error_description ?? token.error);
    }

    if (!token.access_token || !token.refresh_token) {
      throw new Error('Microsoft returned no usable token.');
    }

    return exchangeForMinecraft(token.access_token, token.refresh_token);
  }
}

/** Renews an expired session with the stored refresh token. */
export async function refreshAccount(account: MinecraftAccount): Promise<MinecraftAccount> {
  const token = await postForm<TokenResponse>(TOKEN_URL, {
    grant_type: 'refresh_token',
    client_id: clientId(),
    refresh_token: account.refreshToken,
    scope: SCOPE,
  });

  if (token.error || !token.access_token) {
    throw new Error(token.error_description ?? 'The session could not be renewed, please sign in again.');
  }

  return exchangeForMinecraft(token.access_token, token.refresh_token ?? account.refreshToken);
}

/** {@returns the active account, refreshing it first when the token is close to expiry} */
export async function currentAccount(): Promise<MinecraftAccount | null> {
  const stored = activeAccount();

  if (!stored) return null;
  if (stored.expiresAt - 60_000 > Date.now()) return stored;

  try {
    const refreshed = await refreshAccount(stored);
    updateAccountTokens(refreshed);
    return refreshed;
  } catch (error) {
    log.warn('Session refresh failed, this account has to sign in again.', error);
    removeAccount(stored.uuid);
    return null;
  }
}

export function logout(uuid?: string): void {
  const target = uuid ?? activeAccount()?.uuid;
  if (target) removeAccount(target);
}

async function exchangeForMinecraft(microsoftToken: string, refreshToken: string): Promise<MinecraftAccount> {
  const xbl = await postJson<XboxResponse>(XBL_URL, {
    Properties: {
      AuthMethod: 'RPS',
      SiteName: 'user.auth.xboxlive.com',
      RpsTicket: `d=${microsoftToken}`,
    },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });

  let xsts: XboxResponse;

  try {
    xsts = await postJson<XboxResponse>(XSTS_URL, {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    });
  } catch (error) {
    throw new Error(describeXstsError(error as XboxError), { cause: error });
  }

  const userHash = xsts.DisplayClaims.xui[0]?.uhs;

  if (!userHash) {
    throw new Error('The Xbox response contained no user hash.');
  }

  const minecraft = await postJson<{ access_token: string; expires_in: number }>(MC_LOGIN_URL, {
    identityToken: `XBL3.0 x=${userHash};${xsts.Token}`,
  });

  const profileResponse = await fetch(MC_PROFILE_URL, {
    headers: {
      Authorization: `Bearer ${minecraft.access_token}`,
      'User-Agent': USER_AGENT,
    },
  });

  if (profileResponse.status === 404) {
    throw new Error('This account has no Minecraft: Java Edition profile.');
  }

  if (!profileResponse.ok) {
    throw new Error(`Failed to fetch the Minecraft profile: HTTP ${profileResponse.status}`);
  }

  const profile = (await profileResponse.json()) as { id: string; name: string };

  return {
    uuid: profile.id,
    username: profile.name,
    accessToken: minecraft.access_token,
    expiresAt: Date.now() + minecraft.expires_in * 1000,
    refreshToken,
  };
}

function describeXstsError(error: XboxError): string {
  switch (error.xErr) {
    case 2148916233:
      return 'This Microsoft account has no Xbox profile. Create one at xbox.com.';
    case 2148916235:
      return 'Xbox Live is not available in this country.';
    case 2148916236:
    case 2148916237:
      return 'This account requires adult verification.';
    case 2148916238:
      return 'Child account: it must be added to a family first.';
    default:
      return `Xbox authentication failed. ${error.message}`;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
