"use client";

import { useCallback } from "react";
import { ResourceView, WidgetFrame } from "../components/ui";
import { loadCalendar } from "../lib/loaders";
import { useResource } from "../lib/useResource";

export default function CalendarWidget() {
  const load = useCallback(() => loadCalendar(), []);
  const { state, refresh } = useResource(load);

  // The backend returns status "not_implemented", which ResourceView renders as
  // a clear notice — no crash, no blank panel (CLAUDE.md hard rule #6).
  return (
    <WidgetFrame title="Economic Calendar" onRefresh={refresh} busy={state.kind === "loading"}>
      <ResourceView state={state}>{() => null}</ResourceView>
    </WidgetFrame>
  );
}
