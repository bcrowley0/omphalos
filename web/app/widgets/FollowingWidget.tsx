"use client";

import { useCallback, useMemo, useState } from "react";
import { ResourceView, WidgetFrame } from "../components/ui";
import { loadPeopleFeed } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { useTerminal } from "../lib/useTerminal";
import { terminalStore } from "../lib/store";
import type { FollowItem } from "../lib/api/client";
import { timeAgo } from "../lib/format";

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
  const [primaryOnly, setPrimaryOnly] = useState(true);

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
          const items = primaryOnly ? scoped.filter((i) => i.primary) : scoped;
          const hiddenSecondary = scoped.length - scoped.filter((i) => i.primary).length;
          return (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.8rem", fontSize: "0.78rem", color: "var(--muted)" }}>
                <button onClick={() => setPrimaryOnly((v) => !v)} title="Primary = first-party + wire-grade/official sources"
                  style={{ background: primaryOnly ? "var(--panel)" : "transparent", color: primaryOnly ? "var(--accent)" : "var(--muted)", border: "1px solid var(--border)", borderRadius: 999, padding: "0.2rem 0.7rem", cursor: "pointer", fontFamily: "inherit", fontSize: "0.78rem" }}>
                  {primaryOnly ? "✓ primary sources only" : "primary sources only"}
                </button>
                {primaryOnly && hiddenSecondary > 0 && (
                  <button onClick={() => setPrimaryOnly(false)}
                    style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.78rem", textDecoration: "underline" }}>
                    show all ({hiddenSecondary} more)
                  </button>
                )}
              </div>
              {data.errors.length > 0 && (
                <p style={{ color: "#d9a441", fontSize: "0.78rem", marginBottom: "0.6rem" }}>
                  couldn&apos;t reach: {data.errors.map((e) => e.person).join(", ")}
                </p>
              )}
              {items.length === 0 ? (
                <p style={{ color: "var(--muted)" }}>
                  {primaryOnly && scoped.length > 0
                    ? "No primary sources right now — try “show all”."
                    : "No recent items."}
                </p>
              ) : (
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                  {items.map((item, i) => {
                    const isNew = (item.publishedTs ?? 0) > (seenAtMount[item.person] ?? 0);
                    return (
                      <li key={`${item.url}-${i}`} style={{ borderTop: i ? "1px solid var(--border)" : "none", paddingTop: i ? "0.9rem" : 0 }}>
                        <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "1rem" }}>
                          {isNew && <span style={{ color: "var(--accent)", marginRight: "0.4rem" }}>●</span>}
                          {item.title}
                        </a>
                        {item.summary && <p style={{ color: "var(--muted)", margin: "0.25rem 0" }}>{item.summary}</p>}
                        <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>
                          {item.person} · {item.publisher ?? item.source}
                          {item.primary ? "" : " · secondary"} · {timeAgo(item.publishedTs)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        }}
      </ResourceView>
      )}
    </WidgetFrame>
  );
}
