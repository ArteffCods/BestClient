'use client';

import { useState } from 'react';

import type { DeviceCodeEvent, PublicAccount } from '@/types/bestclient';

/** 2D front of the player's head, rendered blocky to keep the Minecraft look. */
function Avatar({ account }: { account: PublicAccount }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="brand-gradient grid h-9 w-9 shrink-0 place-items-center rounded font-display text-sm font-bold text-void">
        {account.username.slice(0, 1).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={`https://mc-heads.net/avatar/${account.uuid}/64`}
      alt=""
      aria-hidden="true"
      width={36}
      height={36}
      draggable={false}
      onError={() => setFailed(true)}
      className="h-9 w-9 shrink-0 rounded ring-1 ring-edge [image-rendering:pixelated]"
    />
  );
}

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
      <div className="border-t border-edge pt-3">
        <div className="flex items-center gap-2.5">
          <Avatar account={account} />
          <p className="min-w-0 flex-1 truncate text-[13px] text-ink">{account.username}</p>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="mt-2.5 w-full rounded border border-edge py-1.5 text-[11px] text-ink-dim transition-colors hover:border-edge-bright hover:text-ink"
        >
          Kijelentkezés
        </button>
      </div>
    );
  }

  if (deviceCode) {
    return (
      <div className="border-t border-rose/30 pt-3">
        <p className="eyebrow mb-2 text-rose-soft">Kód</p>
        <div className="flex items-center justify-center gap-2">
          <p className="select-text text-center font-mono text-lg font-bold tracking-[0.2em] text-ink">
            {deviceCode.userCode}
          </p>
          <button
            type="button"
            aria-label="Kód másolása"
            onClick={() => void navigator.clipboard.writeText(deviceCode.userCode)}
            className="grid h-6 w-6 place-items-center rounded border border-edge text-ink-dim transition-colors hover:border-rose/60 hover:text-ink"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
              <path
                d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
          </button>
        </div>
        <p className="mt-2 text-center text-[10px] leading-snug text-ink-dim">
          Nyisd meg a linket, és írd be a fenti kódot.
        </p>
        <button
          type="button"
          onClick={() =>
            void window.bestclient.openExternal(deviceCode.verificationUriComplete ?? deviceCode.verificationUri)
          }
          className="brand-gradient mt-2.5 w-full rounded py-1.5 text-[11px] font-semibold text-void transition hover:brightness-110"
        >
          Megnyitás böngészőben
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="mt-1.5 w-full rounded border border-edge py-1.5 text-[11px] text-ink-dim transition-colors hover:border-edge-bright hover:text-ink"
        >
          Mégse
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-edge pt-3">
      <button
        type="button"
        disabled={busy}
        onClick={onLogin}
        className="w-full rounded border border-rose/40 bg-panel-high py-2 text-[11px] font-semibold text-rose-soft transition-colors hover:border-rose hover:bg-rose/10 disabled:opacity-50"
      >
        {busy ? 'Bejelentkezés…' : 'Bejelentkezés'}
      </button>
      {error ? <p className="mt-2 text-[11px] leading-snug text-danger">{error}</p> : null}
    </div>
  );
}
