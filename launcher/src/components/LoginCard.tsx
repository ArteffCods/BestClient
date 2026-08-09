'use client';

import type { DeviceCodeEvent, PublicAccount } from '@/types/bestclient';

interface Props {
  account: PublicAccount | null;
  deviceCode: DeviceCodeEvent | null;
  busy: boolean;
  error: string | null;
  onLogin: () => void;
  onCancel: () => void;
  onLogout: () => void;
}

export function LoginCard({ account, deviceCode, busy, error, onLogin, onCancel, onLogout }: Props) {
  if (account) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-800 px-4 py-3">
        {/* Deliberately no remote skin service: the launcher should not leak the
            player's UUID to a third party just to draw a 36px avatar. */}
        <div className="brand-gradient grid h-9 w-9 place-items-center rounded-md text-sm font-bold text-ink-950">
          {account.username.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-brand-100">{account.username}</p>
          <p className="text-[11px] text-ink-500">Microsoft-fiók</p>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs text-brand-300 transition hover:border-brand-500 hover:text-brand-200"
        >
          Kijelentkezés
        </button>
      </div>
    );
  }

  if (deviceCode) {
    return (
      <div className="rounded-xl border border-brand-500/40 bg-ink-800 p-4">
        <p className="text-xs text-brand-300">Nyisd meg a linket, és írd be ezt a kódot:</p>
        <p className="my-3 select-text text-center font-mono text-2xl font-bold tracking-[0.3em] text-brand-100">
          {deviceCode.userCode}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void window.bestclient.openExternal(deviceCode.verificationUri)}
            className="brand-gradient flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-ink-950 transition hover:brightness-110"
          >
            Megnyitás a böngészőben
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-ink-600 px-3 py-2 text-xs text-brand-300 transition hover:border-brand-500"
          >
            Mégse
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-ink-700 bg-ink-800 p-4">
      <p className="mb-3 text-xs text-ink-500">
        A játékhoz saját Microsoft-fiók és Minecraft: Java Edition licenc szükséges.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={onLogin}
        className="brand-gradient w-full rounded-lg px-3 py-2.5 text-sm font-semibold text-ink-950 transition hover:brightness-110 disabled:opacity-50"
      >
        {busy ? 'Bejelentkezés folyamatban…' : 'Bejelentkezés Microsoft-fiókkal'}
      </button>
      {error ? <p className="mt-3 text-xs leading-relaxed text-brand-500">{error}</p> : null}
    </div>
  );
}
