import fs from 'node:fs';

import { log } from './logger';
import { USER_AGENT } from './net';
import { parseJson, resourceFile } from './paths';
import { readSettings, writeSettings, type MinecraftAccount } from './store';

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
  expiresInSeconds: number;
}

export interface XboxError extends Error {
  xErr?: number;
}

/**
 * The Azure application (client) ID used for the Microsoft device-code login.
 *
 * There is deliberately no value checked into the repository: every launcher has to
 * register its own Azure application ("Allow public client flows" = yes) and get it
 * approved by Mojang. Set it with the BESTCLIENT_MS_CLIENT_ID environment variable or
 * put `{"clientId": "..."}` into `launcher/resources/auth.json` - see README.
 */
function clientId(): string {
  const fromEnv = process.env.BESTCLIENT_MS_CLIENT_ID?.trim();
  if (fromEnv) return fromEnv;

  try {
    const raw = fs.readFileSync(resourceFile('auth.json'), 'utf8');
    const parsed = parseJson<{ clientId?: string }>(raw);

    if (parsed.clientId?.trim()) return parsed.clientId.trim();
  } catch {
    // fall through to the explicit error below
  }

  throw new Error(
    'Nincs beállítva Microsoft Azure client ID. Hozz létre egy Azure alkalmazást ' +
      '(Allow public client flows = Yes), majd add meg a BESTCLIENT_MS_CLIENT_ID ' +
      'környezeti változóban vagy a launcher/resources/auth.json fájlban.',
  );
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
    expires_in: number;
    interval: number;
  }>(DEVICE_CODE_URL, { client_id: id, scope: SCOPE });

  onPrompt({
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    expiresInSeconds: device.expires_in,
  });

  const deadline = Date.now() + device.expires_in * 1000;
  let interval = Math.max(device.interval, 1) * 1000;

  for (;;) {
    if (shouldCancel()) {
      throw new Error('A bejelentkezést megszakítottad.');
    }

    if (Date.now() > deadline) {
      throw new Error('A bejelentkezési kód lejárt, próbáld újra.');
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
      throw new Error('A Microsoft válasza nem tartalmazott használható tokent.');
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
    throw new Error(token.error_description ?? 'A munkamenet nem újítható meg, jelentkezz be újra.');
  }

  return exchangeForMinecraft(token.access_token, token.refresh_token ?? account.refreshToken);
}

/** {@returns a valid account, refreshing it first when the token is close to expiry} */
export async function currentAccount(): Promise<MinecraftAccount | null> {
  const stored = readSettings().account;

  if (!stored) return null;
  if (stored.expiresAt - 60_000 > Date.now()) return stored;

  try {
    const refreshed = await refreshAccount(stored);
    writeSettings({ account: refreshed });
    return refreshed;
  } catch (error) {
    log.warn('Session refresh failed, the player has to sign in again.', error);
    writeSettings({ account: null });
    return null;
  }
}

export function logout(): void {
  writeSettings({ account: null });
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
    throw new Error('Az Xbox válasz nem tartalmazott felhasználói hash-t.');
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
    throw new Error('Ehhez a fiókhoz nem tartozik Minecraft: Java Edition profil.');
  }

  if (!profileResponse.ok) {
    throw new Error(`A Minecraft profil lekérdezése sikertelen: HTTP ${profileResponse.status}`);
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
      return 'Ehhez a Microsoft-fiókhoz nem tartozik Xbox profil. Hozz létre egyet az xbox.com oldalon.';
    case 2148916235:
      return 'Az Xbox Live nem érhető el ebben az országban.';
    case 2148916236:
    case 2148916237:
      return 'A fiókhoz felnőttkori ellenőrzés szükséges.';
    case 2148916238:
      return 'Gyerekfiók: előbb egy családhoz kell adni a fiókot.';
    default:
      return `Az Xbox hitelesítés sikertelen. ${error.message}`;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
