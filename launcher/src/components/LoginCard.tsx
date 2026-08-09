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
      <div className="border-t border-edge pt-3">
        <p className="eyebrow mb-2">Fiók</p>
        <div className="flex items-center gap-2.5">
          {/* No remote skin service: drawing a 32px avatar is not worth handing the
              player's UUID to a third party. */}
          <div className="brand-gradient grid h-8 w-8 shrink-0 place-items-center rounded font-display text-sm font-bold text-void">
            {account.username.slice(0, 1).toUpperCase()}
          </div>
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
      <p className="eyebrow mb-2">Fiók</p>
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
