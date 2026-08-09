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
 * 2D front of the player's head, rendered blocky to keep the Minecraft look. The active
 * account gets a soft, lighter backdrop; the constant padding means switching active state
 * only fades the background, with no layout jump.
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
      className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded text-ink-faint transition-colors hover:bg-rose-deep/20 hover:text-rose-soft"
    >
      <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M0 0 L10 10 M10 0 L0 10" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </button>
  );
}

/**
 * Account control for the narrow (68px) icon rail. The trigger is just the active head;
 * clicking it opens a popup to the right with the full profile - the switcher, the full
 * (untruncated) names, and add / remove. In the rail itself no text is ever shown, so
 * nothing can overflow.
 */
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

  // The device code drives the popup open on its own, so the code is always visible.
  const popupOpen = open || Boolean(deviceCode);

  useEffect(() => {
    if (!popupOpen) return;

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
  }, [popupOpen]);

  const active = accounts.find((entry) => entry.uuid === activeUuid) ?? accounts[0] ?? null;

  return (
    <div ref={ref} className="relative flex justify-center border-t border-edge pt-3">
      {/* Rail trigger: the active head, or a generic user glyph when signed out. */}
      <button
        type="button"
        onClick={() => (accounts.length === 0 && !popupOpen ? onLogin() : setOpen((v) => !v))}
        aria-haspopup="menu"
        aria-expanded={popupOpen}
        aria-label="Account"
        title={active ? active.username : 'Sign in'}
        className={`grid h-12 w-12 cursor-pointer place-items-center rounded-lg transition-colors ${
          popupOpen ? 'bg-panel' : 'hover:bg-panel/60'
        }`}
      >
        {active ? (
          <Avatar account={active} size={40} active />
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-ink-faint">
            <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.8" />
            <path d="M4.5 20 a7.5 7.5 0 0 1 15 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        )}
      </button>

      {popupOpen ? (
        <div
          role="menu"
          className="absolute bottom-0 left-full z-50 ml-2 w-60 rounded-xl border border-edge bg-surface p-3 shadow-[0_8px_30px_-10px_rgba(0,0,0,0.85)]"
        >
          {deviceCode ? (
            <DeviceCodePanel deviceCode={deviceCode} onCancel={onCancel} />
          ) : accounts.length === 0 ? (
            <div>
              <p className="eyebrow mb-2">Account</p>
              <button
                type="button"
                disabled={busy}
                onClick={onLogin}
                className="w-full cursor-pointer rounded-lg border border-rose/40 bg-panel py-2 text-[12px] font-semibold text-rose-soft transition-colors hover:border-rose hover:bg-rose/10 disabled:opacity-50"
              >
                {busy ? 'Signing in…' : 'Sign in with Microsoft'}
              </button>
            </div>
          ) : (
            <div>
              {/* Active profile, shown large with the full name. */}
              <div className="flex items-center gap-2.5 rounded-lg bg-panel px-2 py-2">
                <Avatar account={active!} size={38} active />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold leading-tight text-ink [overflow-wrap:anywhere]">
                    {active!.username}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-ink-faint">Active account</span>
                </span>
              </div>

              {accounts.length > 1 ? (
                <div className="mt-2 space-y-0.5">
                  <p className="eyebrow px-1 pb-1">Switch</p>
                  {accounts
                    .filter((entry) => entry.uuid !== active!.uuid)
                    .map((entry) => (
                      <div key={entry.uuid} className="flex items-center gap-1">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            onSelect(entry.uuid);
                            setOpen(false);
                          }}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-panel"
                        >
                          <Avatar account={entry} size={24} />
                          <span className="min-w-0 flex-1 text-[12px] text-ink-dim [overflow-wrap:anywhere]">
                            {entry.username}
                          </span>
                        </button>
                        <RemoveButton onClick={() => onRemove(entry.uuid)} label={`Remove ${entry.username}`} />
                      </div>
                    ))}
                </div>
              ) : null}

              <div className="my-2 h-px bg-edge" />

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setOpen(false);
                    onLogin();
                  }}
                  className="flex-1 cursor-pointer rounded-lg px-1.5 py-1.5 text-left text-[12px] font-semibold text-rose-soft transition-colors hover:bg-panel disabled:opacity-50"
                >
                  {busy ? 'Signing in…' : '+ Add account'}
                </button>
                {accounts.length === 1 ? (
                  <RemoveButton onClick={() => onRemove(active!.uuid)} label={`Sign out ${active!.username}`} />
                ) : null}
              </div>
            </div>
          )}

          {error ? <p className="mt-2 text-[11px] leading-snug text-danger">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function DeviceCodePanel({
  deviceCode,
  onCancel,
}: {
  deviceCode: DeviceCodeEvent;
  onCancel: () => void;
}) {
  return (
    <div>
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
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2" />
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
