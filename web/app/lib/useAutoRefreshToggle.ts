"use client";

import { useCallback, useEffect, useState } from "react";
import { loadAutoRefresh, saveAutoRefresh } from "./autoRefreshPrefs";

// Per-tab auto-refresh toggle backed by localStorage. Starts off (matching the
// SSR snapshot), then hydrates from storage on mount to avoid a server/client
// markup mismatch; persists on every change.
export function useAutoRefreshToggle(tabId: string) {
  const [on, setOnState] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOnState(loadAutoRefresh(tabId));
  }, [tabId]);

  const setOn = useCallback(
    (next: boolean) => {
      setOnState(next);
      saveAutoRefresh(tabId, next);
    },
    [tabId],
  );

  return { on, setOn };
}
