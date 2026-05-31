import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutoRefreshController } from "./autoRefreshController";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createAutoRefreshController", () => {
  it("ticks on the interval after start (when visible)", () => {
    const onTick = vi.fn();
    const c = createAutoRefreshController({ intervalMs: 1000, onTick });
    c.start();
    expect(onTick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(onTick).toHaveBeenCalledTimes(3);
    c.stop();
  });

  it("does not tick while hidden; resumes with an immediate tick when visible", () => {
    const onTick = vi.fn();
    const c = createAutoRefreshController({ intervalMs: 1000, onTick });
    c.start();
    c.setVisible(false);
    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(0);
    c.setVisible(true); // immediate refresh on resume
    expect(onTick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(onTick).toHaveBeenCalledTimes(3);
    c.stop();
  });

  it("stop() clears the timer; isRunning() reflects state", () => {
    const onTick = vi.fn();
    const c = createAutoRefreshController({ intervalMs: 1000, onTick });
    c.start();
    expect(c.isRunning()).toBe(true);
    c.stop();
    expect(c.isRunning()).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(0);
  });

  it("setVisible(true) without start does not begin ticking", () => {
    const onTick = vi.fn();
    const c = createAutoRefreshController({ intervalMs: 1000, onTick });
    c.setVisible(true);
    vi.advanceTimersByTime(3000);
    expect(onTick).toHaveBeenCalledTimes(0);
    expect(c.isRunning()).toBe(false);
  });

  it("setVisible(true) while already visible does not double-fire", () => {
    const onTick = vi.fn();
    const c = createAutoRefreshController({ intervalMs: 1000, onTick });
    c.start();
    c.setVisible(true); // no transition hidden->visible, so no immediate tick
    expect(onTick).toHaveBeenCalledTimes(0);
    c.stop();
  });
});
