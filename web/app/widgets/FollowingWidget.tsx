"use client";

import { useCallback, useMemo, useState } from "react";
import { ResourceView, WidgetFrame } from "../components/ui";
import { loadPeopleFeed } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { useTerminal } from "../lib/useTerminal";
import { terminalStore } from "../lib/store";
import type { FollowItem } from "../lib/api/client";
import { CuratedToggle, FeedItemList } from "../components/FeedItemList";

export default function FollowingWidget() {
  const { following } = useTerminal();
  const key = following.map((p) => `${p.name}:${p.feeds.join("|")}`).join(",");
  // Capture lastSeen per person at mount so "new" badges persist for the session.
  const seenAtMount = useMemo(
    () => Object.fromEntries(following.map((p) => [p.name, p.lastSeenTs])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [filter, setFilter] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [curated, setCurated] = useState(true);

  const load = useCallback(async () => {
    const r = await loadPeopleFeed(following);
    terminalStore.markSeen("*"); // mark seen after the fetch resolves
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const { state, refresh } = useResource(load);

  return (
    <WidgetFrame title="Following" onRefresh={refresh} busy={state.kind === "loading"}>
      {/* roster */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.6rem" }}>
        {following.map((p) => (
          <span key={p.name} style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", border: "1px solid var(--border)", borderRadius: 999, padding: "0.2rem 0.6rem", fontSize: "0.78rem" }}>
            <button onClick={() => setFilter(filter === p.name ? null : p.name)} title="filter to this person"
              style={{ background: "none", border: "none", color: filter === p.name ? "var(--accent)" : "var(--foreground)", cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
              {p.name}
            </button>
            <button onClick={() => terminalStore.dispatch(`follow ${p.name}`)} title="open feed"
              style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0 }}>↗</button>
            <button onClick={() => terminalStore.unfollowPerson(p.name)} title="unfollow"
              style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0 }}>✕</button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.4rem", marginBottom: "1rem" }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="follow someone…"
          onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) { terminalStore.followPerson(newName.trim()); setNewName(""); } }}
          style={{ flex: 1, background: "transparent", border: "1px solid var(--border)", borderRadius: 6, color: "var(--foreground)", fontFamily: "inherit", fontSize: "0.85rem", padding: "0.3rem 0.6rem" }} />
        <button onClick={() => { if (newName.trim()) { terminalStore.followPerson(newName.trim()); setNewName(""); } }}
          style={{ background: "transparent", color: "var(--foreground)", border: "1px solid var(--border)", borderRadius: 6, padding: "0.3rem 0.7rem", cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem" }}>+ follow</button>
      </div>

      {following.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>Not following anyone. Try <code>follow Andrej Karpathy</code>.</p>
      ) : (
      <ResourceView state={state}>
        {(data) => {
          const scoped: FollowItem[] = filter ? data.items.filter((i) => i.person === filter) : data.items;
          const items = curated ? scoped.filter((i) => i.primary && i.relevant) : scoped;
          const hidden = scoped.length - scoped.filter((i) => i.primary && i.relevant).length;
          return (
            <div>
              <CuratedToggle curated={curated} hidden={hidden} onToggle={() => setCurated((v) => !v)} onShowAll={() => setCurated(false)} />
              {data.errors.length > 0 && (
                <p style={{ color: "#d9a441", fontSize: "0.78rem", marginBottom: "0.6rem" }}>
                  couldn&apos;t reach: {data.errors.map((e) => e.person).join(", ")}
                </p>
              )}
              {items.length === 0 ? (
                <p style={{ color: "var(--muted)" }}>
                  {curated && scoped.length > 0
                    ? "Nothing on-topic from primary sources right now — try “show all”."
                    : "No recent items."}
                </p>
              ) : (
                <FeedItemList items={items} isNew={(item) => (item.publishedTs ?? 0) > (seenAtMount[item.person] ?? 0)} showPerson />
              )}
            </div>
          );
        }}
      </ResourceView>
      )}
    </WidgetFrame>
  );
}
