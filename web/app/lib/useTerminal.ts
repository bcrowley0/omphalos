"use client";

import { useSyncExternalStore } from "react";
import { terminalStore } from "./store";

// Subscribe a component to terminal UI state (tabs, watchlist, active tab,
// inline error). useSyncExternalStore handles SSR + localStorage hydration
// without setState-in-effect.
export function useTerminal() {
  return useSyncExternalStore(
    terminalStore.subscribe,
    terminalStore.getSnapshot,
    terminalStore.getServerSnapshot,
  );
}
