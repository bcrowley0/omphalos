"use client";

import { useCallback, useEffect, useState } from "react";
import { createAutoRefreshController } from "./autoRefreshController";

// Generic on-demand fetch hook. Default behavior is snapshot/on-demand (load on
// open + explicit refresh). Passing `auto` opts a resource into bounded
// auto-refresh: a background timer that refetches without blanking the widget,
// paused when the tab is hidden, and auto-disabled on a degraded result.
// (CLAUDE.md rule 5.)
//
// `T` is the response envelope; widgets inspect `data.status` to render the
// source-down / unauthenticated / rate-limited / empty states. A transport
// failure (backend unreachable) surfaces as `transport_error`.
//
// Callers MUST memoize `load` (useCallback keyed on its inputs) so the resource
// refetches when inputs change and not on every render. `auto.isHealthy` and
// `auto.onAutoDisabled` must likewise be stable references.
export type ResourceState<T> =
  | { kind: "loading" }
  | { kind: "transport_error"; message: string }
  | { kind: "ok"; data: T };

export type AutoRefreshOptions<T> = {
  enabled: boolean;
  intervalMs: number;
  // Return false to auto-disable (e.g. a degraded source status). When omitted,
  // only a transport failure auto-disables.
  isHealthy?: (data: T) => boolean;
  onAutoDisabled?: (reason: string) => void;
};

export function useResource<T>(load: () => Promise<T>, auto?: AutoRefreshOptions<T>) {
  const [state, setState] = useState<ResourceState<T>>({ kind: "loading" });
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Manual / initial fetch: shows the full loading state.
  const run = useCallback(async () => {
    try {
      const data = await load();
      setState({ kind: "ok", data });
    } catch {
      setState({
        kind: "transport_error",
        message: "cannot reach backend (is the API running on :8000?)",
      });
    }
  }, [load]);

  const refresh = useCallback(() => {
    setState({ kind: "loading" });
    void run();
  }, [run]);

  // Background (auto) fetch: keeps current data on screen; on a degraded result
  // or transport failure it signals auto-disable rather than blanking.
  const isHealthy = auto?.isHealthy;
  const onAutoDisabled = auto?.onAutoDisabled;
  const backgroundRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const data = await load();
      setState({ kind: "ok", data });
      if (isHealthy && !isHealthy(data)) {
        onAutoDisabled?.("auto-refresh paused — source unavailable");
      }
    } catch {
      // Keep the last good snapshot visible; just stop auto-refreshing.
      onAutoDisabled?.("auto-refresh paused — cannot reach backend");
    } finally {
      setIsRefreshing(false);
    }
  }, [load, isHealthy, onAutoDisabled]);

  useEffect(() => {
    // Fetch the snapshot when the widget opens / its inputs change. setState
    // happens only after `await`, never synchronously; the lint rule can't see
    // past the call boundary, so it's suppressed here intentionally.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
  }, [run]);

  const enabled = auto?.enabled ?? false;
  const intervalMs = auto?.intervalMs ?? 0;
  useEffect(() => {
    if (!enabled || intervalMs <= 0 || typeof document === "undefined") return;
    const controller = createAutoRefreshController({
      intervalMs,
      onTick: () => void backgroundRefresh(),
    });
    const onVisibility = () => controller.setVisible(document.visibilityState === "visible");
    controller.setVisible(document.visibilityState === "visible");
    controller.start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      controller.stop();
    };
  }, [enabled, intervalMs, backgroundRefresh]);

  return { state, refresh, isRefreshing };
}
