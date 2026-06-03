"use client";

import { useCallback, useEffect, useState } from "react";
import { ResourceView, WidgetFrame } from "../components/ui";
import WidgetSettingsMenu from "../components/WidgetSettingsMenu";
import {
  addFeed,
  disableSource,
  enableSource,
  loadCatalog,
  loadFeeds,
  loadNews,
} from "../lib/loaders";
import { loadEnabledSources, saveEnabledSources, withoutSource, withSource } from "../lib/newsSources";
import { useResource } from "../lib/useResource";
import { terminalStore } from "../lib/store";
import type { FeedInfo, SuggestedSource } from "../lib/api/client";
import { absTime, timeAgo } from "../lib/format";

// Feed chips + add-feed form. Clicking a feed runs `news <NAME>` (opens/focuses
// that feed's tab); adding a feed POSTs then opens it.
function FeedBar({ active }: { active?: string }) {
  const [feeds, setFeeds] = useState<FeedInfo[]>([]);
  const [catalog, setCatalog] = useState<SuggestedSource[]>([]);
  const [enabled, setEnabled] = useState<string[]>([]);
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
    // On mount: re-register the user's enabled suggested sources (the backend
    // registry is in-memory and resets on restart, so localStorage is the durable
    // source of truth), then load the chips + the suggested-source catalog.
    // External reads; setState happens inside the async IIFE (not synchronously
    // in the effect body), same justified exception as useResource.
    void (async () => {
      const want = loadEnabledSources();
      setEnabled(want);
      await Promise.all(want.map((n) => enableSource(n).catch(() => {})));
      await refreshFeeds();
      try {
        setCatalog((await loadCatalog()).sources ?? []);
      } catch {
        /* non-fatal: picker just won't show */
      }
    })();
  }, [refreshFeeds]);

  async function toggleSource(srcName: string, on: boolean) {
    const next = on ? withSource(enabled, srcName) : withoutSource(enabled, srcName);
    setEnabled(next);
    saveEnabledSources(next);
    try {
      await (on ? enableSource(srcName) : disableSource(srcName));
    } catch {
      /* leave localStorage as-is; a refresh / remount will re-sync */
    }
    await refreshFeeds();
  }

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
    <div>
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
      {catalog.length > 0 && (
        <div style={{ marginBottom: "0.6rem" }}>
          <div
            style={{
              color: "var(--muted)",
              fontSize: "0.72rem",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: "0.35rem",
            }}
          >
            Suggested sources
          </div>
          {Object.entries(groupByCategory(catalog)).map(([cat, srcs]) => (
            <div key={cat} style={{ marginBottom: "0.4rem" }}>
              <div style={{ color: "var(--muted)", fontSize: "0.68rem", marginBottom: "0.25rem" }}>{cat}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                {srcs.map((s) => {
                  const on = enabled.includes(s.name.toUpperCase());
                  return (
                    <button
                      key={s.name}
                      onClick={() => void toggleSource(s.name, !on)}
                      title={s.urls.join("\n")}
                      style={{
                        background: on ? "var(--accent)" : "transparent",
                        color: on ? "var(--background)" : "var(--muted)",
                        border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                        borderRadius: 999,
                        padding: "0.2rem 0.7rem",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        fontSize: "0.78rem",
                      }}
                    >
                      {on ? "✓ " : "+ "}
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
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

// Group catalog sources by category, preserving first-seen category order.
function groupByCategory(sources: SuggestedSource[]): Record<string, SuggestedSource[]> {
  const groups: Record<string, SuggestedSource[]> = {};
  for (const s of sources) (groups[s.category] ??= []).push(s);
  return groups;
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

  const settings = (
    <WidgetSettingsMenu title="news settings" label="⚙ feeds" minWidth={300}>
      <FeedBar active={feed} />
    </WidgetSettingsMenu>
  );

  return (
    <WidgetFrame
      title={feed ? `News · ${feed}` : "News · All"}
      onRefresh={refresh}
      busy={state.kind === "loading"}
      headerExtra={settings}
    >
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
                  gridTemplateColumns: "1fr auto auto",
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
                <span>Time</span>
              </div>
              {data.items.map((item) => (
                <div
                  key={item.url}
                  role="row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    alignItems: "baseline",
                    gap: "0.8rem",
                    padding: "0.4rem 0",
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={item.summary || item.title}
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.9rem" }}
                  >
                    {item.title}
                  </a>
                  <span style={{ color: "var(--muted)", fontSize: "0.78rem", whiteSpace: "nowrap" }}>
                    {item.feed}
                  </span>
                  <span
                    title={timeAgo(item.publishedTs)}
                    style={{ color: "var(--muted)", fontSize: "0.78rem", whiteSpace: "nowrap" }}
                  >
                    {absTime(item.publishedTs)}
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
