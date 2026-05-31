"use client";

import { useCallback, useMemo, useState } from "react";
import { ResourceView, WidgetFrame } from "../components/ui";
import { loadPeopleFeed } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { useTerminal } from "../lib/useTerminal";
import { terminalStore } from "../lib/store";
import { timeAgo } from "../lib/format";

export default function PersonFeedWidget({ person }: { person: string }) {
  const { following } = useTerminal();
  const entry = following.find((p) => p.name === person) ?? { name: person, feeds: [], lastSeenTs: 0 };
  const key = `${entry.name}:${entry.feeds.join("|")}`;
  const seenAtMount = useMemo(() => entry.lastSeenTs, [/* mount only */]); // eslint-disable-line react-hooks/exhaustive-deps
  const [feedUrl, setFeedUrl] = useState("");
  const [curated, setCurated] = useState(true);

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
        {(data) => {
          const items = curated ? data.items.filter((i) => i.primary && i.relevant) : data.items;
          const hidden = data.items.length - data.items.filter((i) => i.primary && i.relevant).length;
          return (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.8rem", fontSize: "0.78rem", color: "var(--muted)" }}>
                <button onClick={() => setCurated((v) => !v)} title="Primary/official sources whose headline is about this person; duplicate stories collapsed"
                  style={{ background: curated ? "var(--panel)" : "transparent", color: curated ? "var(--accent)" : "var(--muted)", border: "1px solid var(--border)", borderRadius: 999, padding: "0.2rem 0.7rem", cursor: "pointer", fontFamily: "inherit", fontSize: "0.78rem" }}>
                  {curated ? "✓ primary & on-topic" : "primary & on-topic"}
                </button>
                {curated && hidden > 0 && (
                  <button onClick={() => setCurated(false)}
                    style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.78rem", textDecoration: "underline" }}>
                    show all ({hidden} more)
                  </button>
                )}
              </div>
              {items.length === 0 ? (
                <p style={{ color: "var(--muted)" }}>
                  {curated && data.items.length > 0
                    ? `Nothing on-topic from primary sources for ${person} — try “show all”.`
                    : `No recent items for ${person}.`}
                </p>
              ) : (
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                  {items.map((item, i) => {
                    const isNew = (item.publishedTs ?? 0) > seenAtMount;
                    return (
                      <li key={item.url} style={{ borderTop: i ? "1px solid var(--border)" : "none", paddingTop: i ? "0.9rem" : 0 }}>
                        <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "1rem" }}>
                          {isNew && <span style={{ color: "var(--accent)", marginRight: "0.4rem" }}>●</span>}
                          {item.title}
                        </a>
                        {item.summary && <p style={{ color: "var(--muted)", margin: "0.25rem 0" }}>{item.summary}</p>}
                        <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>
                          {item.publisher ?? item.source}{item.primary ? "" : " · secondary"} · {timeAgo(item.publishedTs)}
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
    </WidgetFrame>
  );
}
