"use client";

import { useCallback, useMemo, useState } from "react";
import { ResourceView, WidgetFrame } from "../components/ui";
import { loadPeopleFeed } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { useTerminal } from "../lib/useTerminal";
import { terminalStore } from "../lib/store";

function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "";
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

export default function PersonFeedWidget({ person }: { person: string }) {
  const { following } = useTerminal();
  const entry = following.find((p) => p.name === person) ?? { name: person, feeds: [], lastSeenTs: 0 };
  const key = `${entry.name}:${entry.feeds.join("|")}`;
  const seenAtMount = useMemo(() => entry.lastSeenTs, [/* mount only */]); // eslint-disable-line react-hooks/exhaustive-deps
  const [feedUrl, setFeedUrl] = useState("");

  const load = useCallback(async () => {
    const r = await loadPeopleFeed([entry]);
    terminalStore.markSeen(person);
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const { state, refresh } = useResource(load);

  const isFollowed = useMemo(() => following.some((p) => p.name === person), [following, person]);

  return (
    <WidgetFrame title={`Following · ${person}`} onRefresh={refresh} busy={state.kind === "loading"}>
      <div style={{ display: "flex", gap: "0.4rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        {!isFollowed && (
          <button onClick={() => terminalStore.followPerson(person)}
            style={{ background: "transparent", color: "var(--accent)", border: "1px solid var(--border)", borderRadius: 6, padding: "0.25rem 0.7rem", cursor: "pointer", fontFamily: "inherit", fontSize: "0.8rem" }}>+ follow</button>
        )}
        <input value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} placeholder="attach a feed URL (blog / YouTube)…"
          onKeyDown={(e) => { if (e.key === "Enter" && feedUrl.trim()) { terminalStore.addPersonFeed(person, feedUrl.trim()); setFeedUrl(""); refresh(); } }}
          style={{ flex: 1, minWidth: 200, background: "transparent", border: "1px solid var(--border)", borderRadius: 6, color: "var(--foreground)", fontFamily: "inherit", fontSize: "0.8rem", padding: "0.25rem 0.5rem" }} />
        <button onClick={() => { if (feedUrl.trim()) { terminalStore.addPersonFeed(person, feedUrl.trim()); setFeedUrl(""); refresh(); } }}
          style={{ background: "transparent", color: "var(--foreground)", border: "1px solid var(--border)", borderRadius: 6, padding: "0.25rem 0.7rem", cursor: "pointer", fontFamily: "inherit", fontSize: "0.8rem" }}>+ feed</button>
      </div>
      {entry.feeds.length > 0 && (
        <p style={{ color: "var(--muted)", fontSize: "0.75rem", marginBottom: "0.8rem" }}>feeds: {entry.feeds.join(", ")}</p>
      )}
      <ResourceView state={state}>
        {(data) =>
          data.items.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No recent items for {person}.</p>
          ) : (
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
              {data.items.map((item, i) => {
                const isNew = (item.publishedTs ?? 0) > seenAtMount;
                return (
                  <li key={`${item.url}-${i}`} style={{ borderTop: i ? "1px solid var(--border)" : "none", paddingTop: i ? "0.9rem" : 0 }}>
                    <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "1rem" }}>
                      {isNew && <span style={{ color: "var(--accent)", marginRight: "0.4rem" }}>●</span>}
                      {item.title}
                    </a>
                    {item.summary && <p style={{ color: "var(--muted)", margin: "0.25rem 0" }}>{item.summary}</p>}
                    <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>{item.kind} · {item.source} · {timeAgo(item.publishedTs)}</span>
                  </li>
                );
              })}
            </ul>
          )
        }
      </ResourceView>
    </WidgetFrame>
  );
}
