// Per-tab auto-refresh toggle, persisted to localStorage (non-secret UI state,
// CLAUDE.md). One JSON object keyed by tab id; defaults to off. Mirrors the
// appSettings/yieldPrefs persistence pattern.
const STORAGE_KEY = "omphalos.autorefresh.v1";

type Prefs = Record<string, boolean>;

function loadAll(): Prefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Prefs;
    return {};
  } catch {
    return {};
  }
}

export function loadAutoRefresh(tabId: string): boolean {
  return loadAll()[tabId] === true;
}

export function saveAutoRefresh(tabId: string, on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    const all = loadAll();
    if (on) all[tabId] = true;
    else delete all[tabId];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable / quota — non-fatal for a local-first prototype */
  }
}
