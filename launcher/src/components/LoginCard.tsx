'use client';

import { useState } from 'react';

import type { DeviceCodeEvent, PublicAccount } from '@/types/bestclient';

interface Props {
  accounts: PublicAccount[];
  activeUuid: string | null;
  deviceCode: DeviceCodeEvent | null;
  busy: boolean;
  error: string | null;
  onLogin: () => void;
  onCancel: () => void;
  onSelect: (uuid: string) => void;
  onRemove: (uuid: string) => void;
}

/** 2D front of the player's head, rendered blocky to keep the Minecraft look. */
function Avatar({
  account,
  size = 36,
  active = false,
}: {
  account: PublicAccount;
  size?: number;
  active?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const ring = active ? 'ring-2 ring-rose' : 'ring-1 ring-edge';

  if (failed) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`brand-gradient grid shrink-0 place-items-center rounded font-display text-sm font-bold text-void ${ring}`}
      >
        {account.username.slice(0, 1).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={`https://mc-heads.net/avatar/${account.uuid}/64`}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      draggable={false}
      onError={() => setFailed(true)}
      className={`shrink-0 rounded [image-rendering:pixelated] ${ring}`}
    />
  );
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid h-6 w-6 shrink-0 place-items-center rounded text-ink-faint transition-colors hover:bg-rose-deep/20 hover:text-rose-soft"
    >
      <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M0 0 L10 10 M10 0 L0 10" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </button>
  );
}

export function LoginCard({
  accounts,
  activeUuid,
  deviceCode,
  busy,
  error,
  onLogin,
  onCancel,
  onSelect,
  onRemove,
}: Props) {
  // Signing a new account in: show the device code and nothing else.
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
            void window.bestclient.openExternal(
              deviceCode.verificationUriComplete ?? deviceCode.verificationUri,
            )
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

  // No accounts yet: a single sign-in call to action.
  if (accounts.length === 0) {
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

  const active = accounts.find((entry) => entry.uuid === activeUuid) ?? accounts[0]!;
  const others = accounts.filter((entry) => entry.uuid !== active.uuid);

  return (
    <div className="space-y-2.5 border-t border-edge pt-3">
      <div className="flex items-center gap-2.5">
        <Avatar account={active} size={36} active />
        <p className="min-w-0 flex-1 truncate text-[13px] text-ink">{active.username}</p>
        <RemoveButton onClick={() => onRemove(active.uuid)} label="Aktív fiók kijelentkeztetése" />
      </div>

      {others.length > 0 ? (
        <div className="space-y-0.5">
          {others.map((entry) => (
            <div key={entry.uuid} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSelect(entry.uuid)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-panel"
              >
                <Avatar account={entry} size={22} />
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-dim">
                  {entry.username}
                </span>
              </button>
              <RemoveButton onClick={() => onRemove(entry.uuid)} label={`${entry.username} eltávolítása`} />
            </div>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        disabled={busy}
        onClick={onLogin}
        className="w-full rounded border border-edge py-1.5 text-[11px] font-semibold text-ink-dim transition-colors hover:border-rose/60 hover:text-rose-soft disabled:opacity-50"
      >
        {busy ? 'Bejelentkezés…' : '+ Fiók hozzáadása'}
      </button>
      {error ? <p className="text-[11px] leading-snug text-danger">{error}</p> : null}
    </div>
  );
}
