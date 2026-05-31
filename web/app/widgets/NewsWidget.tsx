"use client";

import { useCallback, useEffect, useState } from "react";
import { ResourceView, WidgetFrame } from "../components/ui";
import { addFeed, loadFeeds, loadNews } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { terminalStore } from "../lib/store";
import type { FeedInfo } from "../lib/api/client";
import { timeAgo } from "../lib/format";

// Feed chips + add-feed form. Clicking a feed runs `news <NAME>` (opens/focuses
// that feed's tab); adding a feed POSTs then opens it.
function FeedBar({ active }: { active?: string }) {
  const [feeds, setFeeds] = useState<FeedInfo[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refreshFeeds = useCallback(async () => {
    try {
      const r = await loadFeeds();
      setFeeds(r.feeds);
    } catch {
      /* non-fatal: chips just won't show */
    }
  }, []);

  useEffect(() => {
    // On-demand fetch of the feed list (external read, setState only after
    // await) — same justified exception as useResource.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshFeeds();
  }, [refreshFeeds]);

  async function onAdd() {
    if (!name.trim() || !url.trim()) {
      setErr("name and URL are required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await addFeed(name.trim(), url.trim());
      setFeeds(r.feeds);
      const added = name.trim().toUpperCase();
      setName("");
      setUrl("");
      terminalStore.dispatch(`news ${added}`); // open the new feed
    } catch {
      setErr("could not add feed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginBottom: "1rem" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.6rem" }}>
        {/* the default News tab (no feed) = aggregate of all sources */}
        <button
          onClick={() => terminalStore.dispatch("news")}
          title="All sources, newest first"
          style={{
            background: !active ? "var(--panel)" : "transparent",
            color: !active ? "var(--accent)" : "var(--muted)",
            border: "1px solid var(--border)",
            borderRadius: 999,
            padding: "0.2rem 0.7rem",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: "0.78rem",
          }}
        >
          All
        </button>
        {feeds.map((f) => {
          const isActive = (active ?? "").toUpperCase() === f.name.toUpperCase();
          return (
            <button
              key={f.name}
              onClick={() => terminalStore.dispatch(`news ${f.name}`)}
              title={f.urls.join("\n")}
              style={{
                background: isActive ? "var(--panel)" : "transparent",
                color: isActive ? "var(--foreground)" : "var(--muted)",
                border: "1px solid var(--border)",
                borderRadius: 999,
                padding: "0.2rem 0.7rem",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: "0.78rem",
              }}
            >
              {f.name}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="feed name"
          style={inputStyle(90)}
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…/rss.xml"
          style={inputStyle(220)}
        />
        <button onClick={() => void onAdd()} disabled={busy} style={addBtnStyle(busy)}>
          {busy ? "…" : "+ add feed"}
        </button>
      </div>
      {err && <p style={{ color: "var(--error)", fontSize: "0.78rem", marginTop: "0.3rem" }}>{err}</p>}
    </div>
  );
}

function inputStyle(width: number): React.CSSProperties {
  return {
    width,
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: 6,
    color: "var(--foreground)",
    fontFamily: "inherit",
    fontSize: "0.8rem",
    padding: "0.25rem 0.5rem",
  };
}
function addBtnStyle(busy: boolean): React.CSSProperties {
  return {
    background: "transparent",
    color: "var(--foreground)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "0.25rem 0.7rem",
    cursor: busy ? "default" : "pointer",
    fontFamily: "inherit",
    fontSize: "0.8rem",
  };
}

export default function NewsWidget({ feed }: { feed?: string }) {
  const load = useCallback(() => loadNews(feed), [feed]);
  const { state, refresh } = useResource(load);

  return (
    <WidgetFrame title={feed ? `News · ${feed}` : "News · All"} onRefresh={refresh} busy={state.kind === "loading"}>
      <FeedBar active={feed} />
      <ResourceView state={state}>
        {(data) =>
          data.items.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No headlines.</p>
          ) : (
            <div role="table" style={{ display: "flex", flexDirection: "column" }}>
              <div
                role="row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 8rem 5rem",
                  gap: "0.8rem",
                  padding: "0 0 0.4rem",
                  color: "var(--muted)",
                  fontSize: "0.72rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                <span>Headline</span>
                <span>Source</span>
                <span style={{ textAlign: "right" }}>Time</span>
              </div>
              {data.items.map((item) => (
                <div
                  key={item.url}
                  role="row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 8rem 5rem",
                    alignItems: "baseline",
                    gap: "0.8rem",
                    padding: "0.4rem 0",
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  {/* One line; links OUT to the browser. Full headline + teaser on hover. */}
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={item.summary || item.title}
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.9rem" }}
                  >
                    {item.title}
                  </a>
                  <span
                    title={item.feed}
                    style={{ color: "var(--muted)", fontSize: "0.78rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {item.feed}
                  </span>
                  <span style={{ color: "var(--muted)", fontSize: "0.78rem", textAlign: "right", whiteSpace: "nowrap" }}>
                    {timeAgo(item.publishedTs)}
                  </span>
                </div>
              ))}
            </div>
          )
        }
      </ResourceView>
    </WidgetFrame>
  );
}
