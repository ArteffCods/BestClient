'use client';

export type LaunchState = 'locked' | 'signing-in' | 'ready' | 'working' | 'running';

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
 *
 * Signed out, the same button signs you in. It used to say "Sign in" and do nothing,
 * which left the only way in as a small head in the side rail - the button that fills the
 * top of the screen should be the one that works.
 */
export function LaunchButton({ state, percent, step, target, onClick }: Props) {
  // Locked is a live button now: it starts the sign-in. Only the states where a click has
  // nothing to do are disabled.
  const disabled = state === 'working' || state === 'running' || state === 'signing-in';
  const live = state === 'ready' || state === 'locked';

  const caption =
    state === 'locked'
      ? 'SIGN IN'
      : state === 'signing-in'
        ? 'Signing in…'
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
      aria-busy={state === 'working' || state === 'signing-in'}
      className={`no-drag group relative h-[52px] w-full overflow-hidden rounded-lg text-left transition-all duration-200 ${
        live
          ? 'cursor-pointer bg-rose-deep shadow-[0_2px_8px_-3px_rgba(0,0,0,0.7)] hover:scale-[1.02] hover:shadow-[0_0_30px_-6px_rgba(255,128,200,0.65)]'
          : state === 'working'
            ? 'cursor-progress bg-panel'
            : 'bg-panel'
      }`}
    >
      {/* The brand fill is painted by an inner layer that overhangs the box by a pixel on
          every side and is clipped back by the rounded overflow, so no border hairline can
          show. Muted at rest, full colour on hover. */}
      {live ? (
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
            live
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
