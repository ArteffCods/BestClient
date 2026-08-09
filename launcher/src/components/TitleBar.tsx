'use client';

interface Props {
  version: string;
  minecraft: string;
}

export function TitleBar({ version, minecraft }: Props) {
  return (
    <header className="drag-region flex h-11 shrink-0 items-center justify-between border-b border-ink-700 bg-ink-950/60 pl-4 pr-0">
      <div className="flex items-baseline gap-3">
        <span className="brand-text text-[15px] font-bold tracking-tight">BestClient</span>
        <span className="text-[11px] text-ink-500">
          v{version} · Minecraft {minecraft}
        </span>
      </div>

      <div className="no-drag flex h-full">
        <button
          type="button"
          aria-label="Kicsinyítés"
          onClick={() => void window.bestclient?.minimize()}
          className="grid h-full w-12 place-items-center text-brand-300/70 transition hover:bg-ink-700 hover:text-brand-200"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
            <rect x="0" y="5" width="11" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Bezárás"
          onClick={() => void window.bestclient?.close()}
          className="grid h-full w-12 place-items-center text-brand-300/70 transition hover:bg-brand-600 hover:text-white"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
            <path d="M0 0 L11 11 M11 0 L0 11" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </header>
  );
}
