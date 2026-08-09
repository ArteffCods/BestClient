'use client';

interface Props {
  version: string;
  minecraft: string;
  fabric: string;
}

export function TitleBar({ version, minecraft, fabric }: Props) {
  return (
    <header className="drag-region flex h-10 shrink-0 items-center justify-between border-b border-edge bg-void pl-3 pr-0">
      <div className="flex items-center gap-1">
        {/* Served from public/logo.png through the app:// protocol. Decorative next to
            the wordmark, so it stays out of the accessibility tree.

            The artwork carries its own dark tile and corner radius, so no rounding is
            applied here — it would clip the corners twice. The hairline ring is what
            separates the tile (#1a1a1a) from the title bar (#08060b). */}
        <img
          src="/logo.png"
          alt=""
          aria-hidden="true"
          width={22}
          height={22}
          draggable={false}
          className="rounded-[25%] ring-1 ring-edge"
        />

        <span className="display-caps text-[13px] text-ink">
          Best<span className="text-rose">Client</span>
        </span>

        <span className="font-mono text-[10px] tracking-wider text-ink-faint">
          v{version} · MC {minecraft} · FABRIC {fabric}
        </span>
      </div>

      <div className="flex h-full">
        <button
          type="button"
          aria-label="Kicsinyítés"
          onClick={() => void window.bestclient?.minimize()}
          className="no-drag grid h-full w-11 place-items-center text-ink-dim transition-colors hover:bg-panel-high hover:text-ink"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Bezárás"
          onClick={() => void window.bestclient?.close()}
          className="no-drag grid h-full w-11 place-items-center text-ink-dim transition-colors hover:bg-rose-deep hover:text-white"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0 L10 10 M10 0 L0 10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </header>
  );
}
