'use client';

export type LaunchState = 'locked' | 'ready' | 'working' | 'running';

interface Props {
  state: LaunchState;
  /** 0–100, only meaningful while `working`. */
  percent: number;
  /** Which install step is running, e.g. "Libraries". */
  step: string;
  target: string;
  onClick: () => void;
}

/**
 * The signature control: the launch button *is* the progress bar.
 *
 * A launcher has exactly one action, so it gets exactly one control. Rather than putting
 * a separate bar underneath, the button fills with the brand gradient as the install
 * proceeds and fires when it reaches the end — the control shows its own readiness.
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
      aria-label={state === 'ready' ? `Play – ${target}` : caption}
      aria-busy={state === 'working'}
      className={`no-drag group relative h-[76px] w-full overflow-hidden rounded-lg border text-left transition-colors duration-200 ${
        state === 'ready'
          ? 'border-transparent cursor-pointer'
          : state === 'running'
            ? 'border-rose/50 bg-panel'
            : state === 'working'
              ? 'border-edge bg-panel cursor-progress'
              : 'border-edge bg-panel cursor-not-allowed'
      }`}
    >
      {/* Fill. Ready = fully charged, working = charging, otherwise empty. */}
      <span
        aria-hidden="true"
        className={`brand-gradient absolute inset-y-0 left-0 transition-[width] duration-500 ease-out ${
          state === 'ready' ? 'shadow-[0_0_36px_-6px_var(--color-rose)]' : ''
        }`}
        style={{
          width: state === 'ready' ? '100%' : state === 'working' ? `${Math.max(percent, 2)}%` : '0%',
        }}
      />

      {/* Hover lift, ready state only. */}
      {state === 'ready' ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 bg-white opacity-0 transition-opacity duration-200 group-hover:opacity-10"
        />
      ) : null}

      <span className="relative flex h-full items-center justify-between px-6">
        <span className="flex items-baseline gap-3">
          <span
            className={`display-caps text-[26px] leading-none ${
              state === 'ready' ? 'text-void' : state === 'running' ? 'text-rose' : 'text-ink-dim'
            }`}
          >
            {caption}
          </span>
          {state === 'ready' ? (
            <span className="font-mono text-[11px] tracking-wide text-void/60">{target}</span>
          ) : null}
        </span>

        {state === 'working' ? (
          <span className="font-mono text-[22px] tabular-nums text-ink">{percent}%</span>
        ) : state === 'ready' ? (
          <span aria-hidden="true" className="display-caps text-[26px] leading-none text-void/70">
            ▸
          </span>
        ) : null}
      </span>
    </button>
  );
}
