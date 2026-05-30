"use client";

import { useCallback, useEffect, useState } from "react";

// Generic on-demand fetch hook (CLAUDE.md: snapshot/on-demand only — load on
// widget open and on explicit refresh; no polling/streaming).
//
// `T` is the response envelope; widgets inspect `data.status` to render the
// source-down / unauthenticated / rate-limited / empty states. A transport
// failure (backend unreachable) surfaces as `transport_error`.
//
// Callers MUST memoize `load` (useCallback keyed on its inputs) so the resource
// refetches when the inputs change and not on every render.
export type ResourceState<T> =
  | { kind: "loading" }
  | { kind: "transport_error"; message: string }
  | { kind: "ok"; data: T };

export function useResource<T>(load: () => Promise<T>) {
  const [state, setState] = useState<ResourceState<T>>({ kind: "loading" });

  // First statement is `await` — no synchronous setState inside the effect path.
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

  useEffect(() => {
    // Fetch the snapshot when the widget opens / its inputs change. This is a
    // legitimate data fetch (an external-system read), not derived state — the
    // setState happens only after `await`, never synchronously. The lint rule
    // can't see past the call boundary, so it's suppressed here intentionally.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
  }, [run]);

  return { state, refresh };
}
