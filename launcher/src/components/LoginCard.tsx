'use client';

import { useEffect, useRef, useState } from 'react';

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

/**
 * 2D front of the player's head, rendered blocky to keep the Minecraft look.
 *
 * No frame around the head , the active account is marked by a soft, lighter backdrop
 * behind it instead. The padding stays constant so switching active state only fades the
 * background in and out, with no layout jump.
 */
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

  const head = failed ? (
    <span
      style={{ width: size, height: size }}
      className="brand-gradient grid place-items-center rounded-[6px] font-display text-sm font-bold text-void"
    >
      {account.username.slice(0, 1).toUpperCase()}
    </span>
  ) : (
    <img
      src={`https://mc-heads.net/avatar/${account.uuid}/64`}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      draggable={false}
      onError={() => setFailed(true)}
      className="rounded-[6px] [image-rendering:pixelated]"
    />
  );

  return (
    <span
      className={`grid shrink-0 place-items-center rounded-[9px] p-[3px] transition-colors duration-300 ${
        active ? 'bg-white/10' : 'bg-transparent'
      }`}
    >
      {head}
    </span>
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close the switcher on an outside click or Escape.
  useEffect(() => {
    if (!open) return;

    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Signing a new account in: show the device code and nothing else.
  if (deviceCode) {
    return (
      <div className="border-t border-rose/30 pt-3">
        <p className="eyebrow mb-2 text-rose-soft">Code</p>
        <div className="flex items-center justify-center gap-2">
          <p className="select-text text-center font-mono text-lg font-bold tracking-[0.2em] text-ink">
            {deviceCode.userCode}
          </p>
          <button
            type="button"
            aria-label="Copy code"
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
          Open the link and enter the code above.
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
          Open in browser
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="mt-1.5 w-full rounded border border-edge py-1.5 text-[11px] text-ink-dim transition-colors hover:border-edge-bright hover:text-ink"
        >
          Cancel
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
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {error ? <p className="mt-2 text-[11px] leading-snug text-danger">{error}</p> : null}
      </div>
    );
  }

  const active = accounts.find((entry) => entry.uuid === activeUuid) ?? accounts[0]!;

  return (
    <div ref={ref} className="relative border-t border-edge pt-3">
      {/* Trigger: the active account, opening a dropdown of all accounts. */}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded px-1 py-1 text-left transition-colors hover:bg-panel"
      >
        <Avatar account={active} size={36} active />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-ink">{active.username}</span>
          <span className="block text-[10px] text-ink-faint">
            {accounts.length > 1 ? `${accounts.length} accounts` : 'Signed in'}
          </span>
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden="true"
          className={`shrink-0 text-ink-faint transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M1 3.5 L5 7 L9 3.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute bottom-full left-0 right-0 mb-2 rounded-lg border border-edge bg-panel-high p-1.5 shadow-[0_8px_30px_-10px_rgba(0,0,0,0.8)]"
        >
          {accounts.map((entry) => {
            const isActive = entry.uuid === active.uuid;

            return (
              <div key={entry.uuid} className="flex items-center gap-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    if (!isActive) onSelect(entry.uuid);
                    setOpen(false);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-panel"
                >
                  <Avatar account={entry} size={22} active={isActive} />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink-dim">
                    {entry.username}
                  </span>
                </button>
                <RemoveButton onClick={() => onRemove(entry.uuid)} label={`Remove ${entry.username}`} />
              </div>
            );
          })}

          <div className="my-1 h-px bg-edge" />

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              onLogin();
            }}
            className="w-full rounded px-1.5 py-1.5 text-left text-[11px] font-semibold text-rose-soft transition-colors hover:bg-panel disabled:opacity-50"
          >
            {busy ? 'Signing in…' : '+ Add account'}
          </button>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-[11px] leading-snug text-danger">{error}</p> : null}
    </div>
  );
}
