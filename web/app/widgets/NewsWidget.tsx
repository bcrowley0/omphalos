"use client";

import { useCallback, useEffect, useState } from "react";
import { ResourceView, WidgetFrame } from "../components/ui";
import { addFeed, loadFeeds, loadNews } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { terminalStore } from "../lib/store";
import type { FeedInfo } from "../lib/api/client";

function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "";
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

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
    <WidgetFrame title={feed ? `News · ${feed}` : "News"} onRefresh={refresh} busy={state.kind === "loading"}>
      <FeedBar active={feed} />
      <ResourceView state={state}>
        {(data) =>
          data.items.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No headlines.</p>
          ) : (
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
              {data.items.map((item, i) => (
                <li key={`${item.url}-${i}`} style={{ borderTop: i ? "1px solid var(--border)" : "none", paddingTop: i ? "0.9rem" : 0 }}>
                  {/* Headlines link OUT to the browser; no article bodies are fetched. */}
                  <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "1rem" }}>
                    {item.title}
                  </a>
                  {item.summary && <p style={{ color: "var(--muted)", margin: "0.25rem 0" }}>{item.summary}</p>}
                  <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>
                    {item.feed} · {timeAgo(item.publishedTs)}
                  </span>
                </li>
              ))}
            </ul>
          )
        }
      </ResourceView>
    </WidgetFrame>
  );
}
