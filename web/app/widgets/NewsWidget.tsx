"use client";

import { useCallback } from "react";
import { ResourceView, WidgetFrame } from "../components/ui";
import { loadNews } from "../lib/loaders";
import { useResource } from "../lib/useResource";

function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "";
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

export default function NewsWidget({ feed }: { feed?: string }) {
  const load = useCallback(() => loadNews(feed), [feed]);
  const { state, refresh } = useResource(load);

  return (
    <WidgetFrame title={feed ? `News · ${feed}` : "News"} onRefresh={refresh} busy={state.kind === "loading"}>
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
                  <p style={{ color: "var(--muted)", margin: "0.25rem 0" }}>{item.summary}</p>
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
