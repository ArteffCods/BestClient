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
          : 'LAUNCH GAME';

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={state === 'ready' ? `Launch Minecraft ${target}` : caption}
      aria-busy={state === 'working'}
      className={`no-drag group relative h-[52px] w-full overflow-hidden rounded-lg text-left transition-all duration-200 ${
        state === 'ready'
          ? 'cursor-pointer bg-rose-deep shadow-[0_2px_8px_-3px_rgba(0,0,0,0.7)]'
          : state === 'running'
            ? 'bg-panel'
            : state === 'working'
              ? 'cursor-progress bg-panel'
              : 'cursor-not-allowed bg-panel'
      }`}
    >
      {/* The brand fill is painted by an inner layer that overhangs the box by a pixel on
          every side and is clipped back by the rounded overflow, so no border hairline can
          show. Muted at rest, full colour on hover. */}
      {state === 'ready' ? (
        <span
          aria-hidden="true"
          className="brand-gradient absolute -inset-px saturate-[.6] brightness-90 transition-[filter] duration-200 group-hover:saturate-100 group-hover:brightness-100"
        />
      ) : null}

      {/* Progress fill: a soft translucent rose that grows while installing. */}
      {state === 'working' ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 bg-rose/20 transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(percent, 2)}%` }}
        />
      ) : null}

      <span className="relative flex h-full items-center justify-between px-5">
        <span
          className={`display-caps text-[20px] leading-none ${
            state === 'ready'
              ? 'text-void'
              : state === 'running'
                ? 'text-rose'
                : 'text-ink-dim'
          }`}
        >
          {caption}
        </span>

        {state === 'working' ? (
          <span className="font-mono text-[16px] tabular-nums text-ink">{percent}%</span>
        ) : null}
      </span>
    </button>
  );
}
