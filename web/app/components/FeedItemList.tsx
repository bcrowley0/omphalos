"use client";

import type { FollowItem } from "../lib/api/client";
import { timeAgo } from "../lib/format";

// The "primary & on-topic" curation toggle + "show all (N more)" link, shared by
// the per-person and aggregate follow feeds.
export function CuratedToggle({
  curated,
  hidden,
  onToggle,
  onShowAll,
}: {
  curated: boolean;
  hidden: number;
  onToggle: () => void;
  onShowAll: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.8rem", fontSize: "0.78rem", color: "var(--muted)" }}>
      <button onClick={onToggle} title="Primary/official sources whose headline is about this person; duplicate stories collapsed"
        style={{ background: curated ? "var(--panel)" : "transparent", color: curated ? "var(--accent)" : "var(--muted)", border: "1px solid var(--border)", borderRadius: 999, padding: "0.2rem 0.7rem", cursor: "pointer", fontFamily: "inherit", fontSize: "0.78rem" }}>
        {curated ? "✓ primary & on-topic" : "primary & on-topic"}
      </button>
      {curated && hidden > 0 && (
        <button onClick={onShowAll}
          style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.78rem", textDecoration: "underline" }}>
          show all ({hidden} more)
        </button>
      )}
    </div>
  );
}

// A list of follow-feed items. `isNew` flags the session "●" marker; `showPerson`
// prefixes the byline with the item's person (the aggregate Following view).
export function FeedItemList({
  items,
  isNew,
  showPerson = false,
}: {
  items: FollowItem[];
  isNew: (item: FollowItem) => boolean;
  showPerson?: boolean;
}) {
  return (
    <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
      {items.map((item, i) => (
        <li key={item.url} style={{ borderTop: i ? "1px solid var(--border)" : "none", paddingTop: i ? "0.9rem" : 0 }}>
          <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "1rem" }}>
            {isNew(item) && <span style={{ color: "var(--accent)", marginRight: "0.4rem" }}>●</span>}
            {item.title}
          </a>
          {item.summary && <p style={{ color: "var(--muted)", margin: "0.25rem 0" }}>{item.summary}</p>}
          <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>
            {showPerson && `${item.person} · `}
            {item.publisher ?? item.source}
            {item.primary ? "" : " · secondary"} · {timeAgo(item.publishedTs)}
          </span>
        </li>
      ))}
    </ul>
  );
}
