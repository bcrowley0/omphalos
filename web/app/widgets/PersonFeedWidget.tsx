"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ResourceView, WidgetFrame } from "../components/ui";
import { loadPeopleFeed } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { useTerminal } from "../lib/useTerminal";
import { terminalStore } from "../lib/store";
import { CuratedToggle, FeedItemList, KindFilterChips } from "../components/FeedItemList";
import PersonSettings from "../components/PersonSettings";
import type { Person } from "../lib/command/types";

export default function PersonFeedWidget({ person }: { person: string }) {
  const { following } = useTerminal();
  const fallback: Person = { name: person, lastSeenTs: 0, enabled: {}, anchors: { writing: [] } };
  const entry = following.find((p) => p.name === person) ?? fallback;
  const key = `${entry.name}:${JSON.stringify(entry.enabled)}:${entry.anchors.youtube ?? ""}:${entry.anchors.podcast ?? ""}:${entry.anchors.writing.join("|")}`;
  const seenAtMount = useMemo(() => entry.lastSeenTs, [/* mount only */]); // eslint-disable-line react-hooks/exhaustive-deps
  const [curated, setCurated] = useState(true);
  const [kindFilter, setKindFilter] = useState<string | null>(null);

  const load = useCallback(
    () => loadPeopleFeed([entry]),
    // `key` digests name+enabled+anchors — the real refetch trigger; `entry` is a
    // fresh object each render, so we intentionally key on the digest.
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
        <PersonSettings person={entry} />
      </div>
      <ResourceView state={state}>
        {(data) => {
          const scoped = kindFilter ? data.items.filter((i) => i.kind === kindFilter) : data.items;
          const items = curated ? scoped.filter((i) => i.primary && i.relevant) : scoped;
          const hidden = scoped.length - scoped.filter((i) => i.primary && i.relevant).length;
          return (
            <div>
              <KindFilterChips items={data.items} active={kindFilter} onPick={setKindFilter} />
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
