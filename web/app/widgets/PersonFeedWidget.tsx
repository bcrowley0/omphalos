"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ResourceView, WidgetFrame } from "../components/ui";
import { loadPeopleFeed } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { useTerminal } from "../lib/useTerminal";
import { terminalStore } from "../lib/store";
import { CuratedToggle, FeedItemList } from "../components/FeedItemList";

export default function PersonFeedWidget({ person }: { person: string }) {
  const { following } = useTerminal();
  const entry = following.find((p) => p.name === person) ?? { name: person, feeds: [], lastSeenTs: 0 };
  const key = `${entry.name}:${entry.feeds.join("|")}`;
  const seenAtMount = useMemo(() => entry.lastSeenTs, [/* mount only */]); // eslint-disable-line react-hooks/exhaustive-deps
  const [feedUrl, setFeedUrl] = useState("");
  const [curated, setCurated] = useState(true);

  const load = useCallback(
    () => loadPeopleFeed([entry]),
    // `key` digests name+feeds — the real refetch trigger; `entry` is a fresh object
    // each render, so we intentionally key on the digest.
    [key], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { state, refresh } = useResource(load);

  // Mark this person seen for the view. Markers use the mount snapshot (seenAtMount),
  // so this only advances the persisted "last seen" for next visit.
  useEffect(() => {
    terminalStore.markSeen(person);
  }, [key, person]);

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
              <CuratedToggle curated={curated} hidden={hidden} onToggle={() => setCurated((v) => !v)} onShowAll={() => setCurated(false)} />
              {items.length === 0 ? (
                <p style={{ color: "var(--muted)" }}>
                  {curated && data.items.length > 0
                    ? `Nothing on-topic from primary sources for ${person} — try “show all”.`
                    : `No recent items for ${person}.`}
                </p>
              ) : (
                <FeedItemList items={items} isNew={(item) => (item.publishedTs ?? 0) > seenAtMount} />
              )}
            </div>
          );
        }}
      </ResourceView>
    </WidgetFrame>
  );
}
