"use client";

import { useState } from "react";
import { terminalStore } from "../lib/store";
import type { ContentType, Person } from "../lib/command/types";

const CONTENT_TYPES: { key: ContentType; label: string }[] = [
  { key: "news", label: "News" },
  { key: "videos", label: "Videos" },
  { key: "podcasts", label: "Podcasts" },
  { key: "speeches", label: "Speeches" },
  { key: "writing", label: "Writing" },
];

function AnchorInput({ label, value, setValue, onCommit }: {
  label: string; value: string; setValue: (v: string) => void; onCommit: (v: string) => void;
}) {
  return (
    <div style={{ marginBottom: "0.4rem" }}>
      <div style={{ color: "var(--muted)", marginBottom: "0.2rem" }}>{label}</div>
      <input value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => onCommit(value.trim())}
        onKeyDown={(e) => { if (e.key === "Enter") onCommit(value.trim()); }}
        placeholder="auto-discover"
        style={{ width: "100%", background: "transparent", border: "1px solid var(--border)", borderRadius: 6, color: "var(--foreground)", fontFamily: "inherit", fontSize: "0.8rem", padding: "0.25rem 0.5rem" }} />
    </div>
  );
}

export default function PersonSettings({ person }: { person: Person }) {
  const [open, setOpen] = useState(false);
  const [yt, setYt] = useState(person.anchors.youtube ?? "");
  const [pod, setPod] = useState(person.anchors.podcast ?? "");
  const [writeUrl, setWriteUrl] = useState("");
  const en = (t: ContentType) => person.enabled[t] ?? (t === "writing" ? person.anchors.writing.length > 0 : true);

  return (
    <span style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} title="sources & toggles"
        style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0 }}>⚙</button>
      {open && (
        <div style={{ position: "absolute", zIndex: 10, top: "1.4rem", right: 0, width: 260, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.7rem", fontSize: "0.8rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginBottom: "0.6rem" }}>
            {CONTENT_TYPES.map((c) => (
              <label key={c.key} style={{ display: "flex", justifyContent: "space-between", cursor: "pointer" }}>
                {c.label}
                <input type="checkbox" checked={en(c.key)}
                  onChange={(e) => terminalStore.setPersonEnabled(person.name, c.key, e.target.checked)} />
              </label>
            ))}
          </div>
          <AnchorInput label="YouTube @handle / URL" value={yt} setValue={setYt}
            onCommit={(v) => terminalStore.setPersonAnchor(person.name, "youtube", v || null)} />
          <AnchorInput label="Podcast feed URL" value={pod} setValue={setPod}
            onCommit={(v) => terminalStore.setPersonAnchor(person.name, "podcast", v || null)} />
          <div style={{ marginTop: "0.5rem" }}>
            <div style={{ color: "var(--muted)", marginBottom: "0.25rem" }}>Writing feeds</div>
            {person.anchors.writing.map((u) => (
              <div key={u} style={{ display: "flex", justifyContent: "space-between", gap: "0.4rem" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u}</span>
                <button onClick={() => terminalStore.removeWritingFeed(person.name, u)}
                  style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}>✕</button>
              </div>
            ))}
            <input value={writeUrl} onChange={(e) => setWriteUrl(e.target.value)} placeholder="add RSS URL…"
              onKeyDown={(e) => { if (e.key === "Enter" && writeUrl.trim()) { terminalStore.addWritingFeed(person.name, writeUrl.trim()); setWriteUrl(""); } }}
              style={{ width: "100%", marginTop: "0.3rem", background: "transparent", border: "1px solid var(--border)", borderRadius: 6, color: "var(--foreground)", fontFamily: "inherit", fontSize: "0.8rem", padding: "0.25rem 0.5rem" }} />
          </div>
        </div>
      )}
    </span>
  );
}
