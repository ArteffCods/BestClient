'use client';

import type { UpdateState } from '@/types/bestclient';

interface Props {
  version: string;
  update: UpdateState;
  onInstallUpdate: () => void;
}

export function TitleBar({ version, update, onInstallUpdate }: Props) {
  return (
    <header className="drag-region flex h-11 shrink-0 items-center justify-between border-b border-edge bg-void/50 pl-3 pr-0 backdrop-blur-sm">
      <div className="flex min-w-0 items-center gap-1">
        {/* Served from public/logo.png through the app:// protocol. Decorative next to
            the wordmark, so it stays out of the accessibility tree.

            The artwork carries its own dark tile and corner radius, so no rounding is
            applied here , it would clip the corners twice. The hairline ring is what
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

        {/* leading-none keeps the wordmarks's line box at exactly 13px so the glyphs
            centre against the 22px logo tile; the 1px nudge compensates for the empty
            descender room the display face leaves below its caps. */}
        <span className="display-caps mt-px text-[13px] leading-none text-ink">
          Best<span className="text-rose">Client</span>
        </span>

        <span className="font-mono text-[10px] tracking-wider text-ink-faint">v{version}</span>

        <UpdateControl update={update} onInstall={onInstallUpdate} />
      </div>

      <div className="flex h-full">
        <button
          type="button"
          aria-label="Minimize"
          onClick={() => void window.bestclient?.minimize()}
          className="no-drag grid h-full w-11 cursor-pointer place-items-center text-ink-dim transition-colors hover:bg-panel-high hover:text-ink"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Close"
          onClick={() => void window.bestclient?.close()}
          className="no-drag grid h-full w-11 cursor-pointer place-items-center text-ink-dim transition-colors hover:bg-rose-deep hover:text-white"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0 L10 10 M10 0 L0 10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </header>
  );
}

/**
 * Update affordance, sitting next to the version because that is the thing it changes.
 *
 * While a build is downloading it is a quiet line of text - nothing to do yet, and an
 * unusable button would only invite clicking. Once the file is on disk it becomes a
 * button: outlined rather than filled, so it reads as available rather than urgent, but
 * carrying the brand colour so it is impossible to miss.
 */
function UpdateControl({ update, onInstall }: { update: UpdateState; onInstall: () => void }) {
  if (update.status === 'downloading') {
    return (
      <span className="ml-2 flex items-center gap-1.5 font-mono text-[10px] text-ink-faint">
        <span aria-hidden="true" className="h-1 w-10 overflow-hidden rounded-full bg-edge">
          <span
            className="brand-gradient block h-full transition-[width] duration-300"
            style={{ width: `${Math.max(4, update.percent)}%` }}
          />
        </span>
        Downloading {update.version}
      </span>
    );
  }

  if (update.status !== 'ready') return null;

  return (
    <button
      type="button"
      onClick={onInstall}
      title={update.notes || `Install BestClient ${update.version}`}
      className="no-drag ml-2 flex cursor-pointer items-center gap-1.5 rounded-md border border-rose/50 px-2 py-[3px] text-[10px] font-semibold text-rose-soft transition-colors hover:border-rose hover:bg-rose/10"
    >
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M6 9.5 V2 M3 5 L6 1.8 L9 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 10.5 H10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      Update to {update.version}
    </button>
  );
}
