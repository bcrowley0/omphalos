"use client";

import { useCallback, useEffect, useState } from "react";
import { loadAutoRefresh, saveAutoRefresh } from "./autoRefreshPrefs";

// Per-tab auto-refresh toggle backed by localStorage. Starts off (matching the
// SSR snapshot), then hydrates from storage on mount to avoid a server/client
// markup mismatch; persists on every change. Also tracks why auto-refresh was
// auto-disabled (pausedReason) so the widget can explain the pause to the user.
export function useAutoRefreshToggle(tabId: string) {
  const [on, setOnState] = useState(false);
  const [pausedReason, setPausedReason] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOnState(loadAutoRefresh(tabId));
  }, [tabId]);

  // Explicit user toggle: clears any prior paused note and persists the choice.
  const setOn = useCallback(
    (next: boolean) => {
      setOnState(next);
      setPausedReason(null);
      saveAutoRefresh(tabId, next);
    },
    [tabId],
  );

  // Auto-disable from useResource (degraded source / transport error): turn off,
  // remember why so the widget can show a paused note, and persist off so a
  // reload doesn't immediately re-hammer a known-bad source.
  const onAutoDisabled = useCallback(
    (reason: string) => {
      setOnState(false);
      setPausedReason(reason);
      saveAutoRefresh(tabId, false);
    },
    [tabId],
  );

  return { on, setOn, pausedReason, onAutoDisabled };
}
