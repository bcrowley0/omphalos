"use client";

import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { WidgetFrame } from "../components/ui";
import { loadStatus, saveKeys } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import {
  type AppSettings,
  type TextSize,
  TEXT_SIZE_LABELS,
  applyAppSettings,
  loadAppSettings,
  saveAppSettings,
  setTheme,
  setTextSize,
  setDefaultSpan,
  setDefaultInterval,
} from "../lib/appSettings";
import { THEME_LABELS, type ThemeName } from "../lib/themes";
import { useIbkrAuth } from "../components/IbkrAuthProvider";
import { IbkrLoginButton, IbkrRecheckButton } from "../components/IbkrLoginButton";
import { ibkrDotColor, ibkrLoginActionable } from "../lib/ibkrAuth";
import { SPANS, INTERVALS, type Span, type Interval } from "../lib/chart/range";

const selectStyle: React.CSSProperties = {
  background: "var(--background)",
  color: "var(--foreground)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "0.25rem 0.5rem",
  fontFamily: "inherit",
  fontSize: "0.85rem",
  minWidth: "9rem",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: "1.4rem" }}>
      <h3 style={{ fontSize: "0.78rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.7rem" }}>
        {title}
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
      <span style={{ width: "8rem", fontSize: "0.9rem" }}>{label}</span>
      {children}
    </div>
  );
}

// Write-only password input for a key (never prefilled with an existing value).
function KeyInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
      <span style={{ width: "8rem", fontSize: "0.85rem", color: "var(--muted)" }}>{label}</span>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        placeholder="paste to set"
        style={{
          flex: 1,
          maxWidth: "18rem",
          background: "var(--background)",
          color: "var(--foreground)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "0.25rem 0.5rem",
          fontFamily: "inherit",
          fontSize: "0.82rem",
        }}
      />
    </div>
  );
}

export default function SettingsWidget() {
  const [settings, setSettingsState] = useState<AppSettings>(() => loadAppSettings());
  // Persist + apply to the document on every change so the effect is immediate.
  const update = useCallback((s: AppSettings) => {
    setSettingsState(s);
    saveAppSettings(s);
    applyAppSettings(s);
  }, []);

  const statusLoad = useCallback(() => loadStatus(), []);
  const { state, refresh } = useResource(statusLoad);
  const ibkr = useIbkrAuth();

  // Local-first key entry. Inputs are write-only: never prefilled, cleared after
  // save. Keys go to the localhost backend → api/.env; never read back here.
  const [fredKey, setFredKey] = useState("");
  const [krakenKey, setKrakenKey] = useState("");
  const [krakenSecret, setKrakenSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty = Boolean(fredKey || krakenKey || krakenSecret);
  const saveAllKeys = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await saveKeys({
        fredApiKey: fredKey || undefined,
        krakenApiKey: krakenKey || undefined,
        krakenApiSecret: krakenSecret || undefined,
      });
      setFredKey("");
      setKrakenKey("");
      setKrakenSecret("");
      refresh(); // re-fetch /status so the configured dots update
    } catch {
      setSaveError("couldn't save keys — is the backend running?");
    } finally {
      setSaving(false);
    }
  };

  return (
    <WidgetFrame title="Settings" onRefresh={refresh} busy={state.kind === "loading"}>
      <Section title="Appearance">
        <Row label="Color theme">
          <select
            value={settings.theme}
            onChange={(e) => update(setTheme(settings, e.target.value as ThemeName))}
            style={selectStyle}
          >
            {(Object.keys(THEME_LABELS) as ThemeName[]).map((k) => (
              <option key={k} value={k}>
                {THEME_LABELS[k]}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Text size">
          <select
            value={settings.textSize}
            onChange={(e) => update(setTextSize(settings, e.target.value as TextSize))}
            style={selectStyle}
          >
            {(Object.keys(TEXT_SIZE_LABELS) as TextSize[]).map((k) => (
              <option key={k} value={k}>
                {TEXT_SIZE_LABELS[k]}
              </option>
            ))}
          </select>
        </Row>
      </Section>

      <Section title="Chart defaults">
        <Row label="Default span">
          <select
            value={settings.defaultSpan}
            onChange={(e) => update(setDefaultSpan(settings, e.target.value as Span))}
            style={selectStyle}
          >
            {SPANS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Default interval">
          <select
            value={settings.defaultInterval}
            onChange={(e) => update(setDefaultInterval(settings, e.target.value as Interval))}
            style={selectStyle}
          >
            {INTERVALS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </Row>
      </Section>

      <Section title="Connections">
        {state.kind === "loading" && <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>checking…</p>}
        {state.kind === "transport_error" && (
          <p style={{ color: "var(--error)", fontSize: "0.85rem" }}>{state.message}</p>
        )}
        {state.kind === "ok" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
            {state.data.sources.map((s) => {
              const isIbkr = s.source === "ibkr";
              const dotColor = isIbkr
                ? ibkrDotColor(ibkr.state)
                : s.configured
                  ? "var(--accent)"
                  : "var(--muted)";
              const detail = isIbkr ? ibkr.detail ?? s.detail : s.detail;
              return (
                <div
                  key={s.source}
                  style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}
                >
                  <span
                    title={isIbkr ? ibkr.state ?? "checking" : s.configured ? "configured" : "not configured"}
                    style={{ width: 9, height: 9, borderRadius: 999, background: dotColor, display: "inline-block" }}
                  />
                  <strong style={{ textTransform: "uppercase", fontSize: "0.78rem", width: "4.5rem" }}>
                    {s.source}
                  </strong>
                  <span style={{ color: "var(--muted)", fontSize: "0.82rem", flex: 1, minWidth: "10rem" }}>
                    {detail}
                  </span>
                  {isIbkr && (
                    <>
                      {ibkrLoginActionable(ibkr.state) && <IbkrLoginButton loginUrl={ibkr.loginUrl} />}
                      <IbkrRecheckButton onClick={ibkr.recheck} loading={ibkr.loading} />
                    </>
                  )}
                </div>
              );
            })}
            <div style={{ marginTop: "0.8rem", display: "flex", flexDirection: "column", gap: "0.45rem" }}>
              <KeyInput label="FRED key" value={fredKey} onChange={setFredKey} />
              <KeyInput label="Kraken key" value={krakenKey} onChange={setKrakenKey} />
              <KeyInput label="Kraken secret" value={krakenSecret} onChange={setKrakenSecret} />
              <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", marginTop: "0.2rem" }}>
                <button
                  onClick={saveAllKeys}
                  disabled={!dirty || saving}
                  style={{
                    background: "var(--accent)",
                    color: "#0b0e14",
                    border: "none",
                    borderRadius: 6,
                    padding: "0.3rem 0.9rem",
                    cursor: dirty && !saving ? "pointer" : "default",
                    opacity: dirty && !saving ? 1 : 0.5,
                    fontFamily: "inherit",
                    fontSize: "0.82rem",
                  }}
                >
                  {saving ? "saving…" : "Save keys"}
                </button>
                {saveError && <span style={{ color: "var(--error)", fontSize: "0.78rem" }}>{saveError}</span>}
              </div>
              <p style={{ color: "var(--muted)", fontSize: "0.72rem" }}>
                Saved to <code>api/.env</code> on this machine and never shown back — no restart needed.
              </p>
            </div>
          </div>
        )}
      </Section>
    </WidgetFrame>
  );
}
