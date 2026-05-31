// Framework-agnostic auto-refresh timer with visibility gating. Pure logic (no
// React, no document access) so it is unit-testable with fake timers. The hook
// owns reading document.visibilityState and feeds it in via setVisible().
export type AutoRefreshController = {
  start: () => void;
  stop: () => void;
  setVisible: (visible: boolean) => void;
  isRunning: () => boolean;
};

export function createAutoRefreshController(opts: {
  intervalMs: number;
  onTick: () => void;
}): AutoRefreshController {
  let timer: ReturnType<typeof setInterval> | null = null;
  let started = false;
  let visible = true;

  const clear = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  // Run the interval only while started AND visible; otherwise idle.
  const sync = () => {
    if (started && visible) {
      if (timer === null) timer = setInterval(opts.onTick, opts.intervalMs);
    } else {
      clear();
    }
  };

  return {
    start() {
      started = true;
      sync();
    },
    stop() {
      started = false;
      clear();
    },
    setVisible(next: boolean) {
      const was = visible;
      visible = next;
      // Coming back into view after being hidden: refresh immediately, then
      // resume the regular cadence.
      if (started && next && !was) opts.onTick();
      sync();
    },
    isRunning() {
      return timer !== null;
    },
  };
}
