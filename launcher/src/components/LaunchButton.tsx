'use client';

export type LaunchState = 'locked' | 'ready' | 'working' | 'running';

interface Props {
  state: LaunchState;
  /** 0-100, only meaningful while `working`. */
  percent: number;
  /** Which install step is running, e.g. "Libraries". */
  step: string;
  target: string;
  onClick: () => void;
}

/**
 * The launch control also carries install progress: while `working` a subtle rose fill
 * grows from the left. No gradient block, just a compact button with a soft shadow.
 */
export function LaunchButton({ state, percent, step, target, onClick }: Props) {
  const disabled = state !== 'ready';

  const caption =
    state === 'locked'
      ? 'Sign in'
      : state === 'running'
        ? 'Running'
        : state === 'working'
          ? step || 'Preparing'
          : 'Play';

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={state === 'ready' ? `Play - ${target}` : caption}
      aria-busy={state === 'working'}
      className={`no-drag group relative h-[52px] w-full overflow-hidden rounded-lg border text-left transition-all duration-200 ${
        state === 'ready'
          ? 'cursor-pointer border-rose/30 bg-panel-high shadow-[0_4px_16px_-6px_rgba(255,117,195,0.45)] hover:border-rose/60 hover:shadow-[0_6px_22px_-6px_rgba(255,117,195,0.65)]'
          : state === 'running'
            ? 'border-rose/40 bg-panel'
            : state === 'working'
              ? 'cursor-progress border-edge bg-panel'
              : 'cursor-not-allowed border-edge bg-panel'
      }`}
    >
      {/* Progress fill: a soft translucent rose that grows while installing. */}
      {state === 'working' ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 bg-rose/20 transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(percent, 2)}%` }}
        />
      ) : null}

      <span className="relative flex h-full items-center justify-between px-5">
        <span className="flex items-baseline gap-2.5">
          <span
            className={`display-caps text-[20px] leading-none ${
              state === 'ready'
                ? 'text-rose-soft'
                : state === 'running'
                  ? 'text-rose'
                  : 'text-ink-dim'
            }`}
          >
            {caption}
          </span>
          {state === 'ready' ? (
            <span className="font-mono text-[11px] tracking-wide text-ink-faint">{target}</span>
          ) : null}
        </span>

        {state === 'working' ? (
          <span className="font-mono text-[16px] tabular-nums text-ink">{percent}%</span>
        ) : state === 'ready' ? (
          <span aria-hidden="true" className="display-caps text-[18px] leading-none text-rose-soft/70">
            &#9656;
          </span>
        ) : null}
      </span>
    </button>
  );
}
