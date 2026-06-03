// Which curated "suggested" news sources the user has enabled. Non-secret UI
// state, so it lives in localStorage (same pattern as the watchlist / open tabs,
// per CLAUDE.md) — the backend feed registry is in-memory and resets on restart,
// so this list is the durable source of truth and is re-registered on load.
//
// Pure helpers (withSource/withoutSource) + impure load/save, mirroring appSettings.

const STORAGE_KEY = "omphalos.news.enabledSources.v1";

const norm = (name: string): string => name.trim().toUpperCase();

function uniq(names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

export function withSource(list: string[], name: string): string[] {
  return uniq([...list.map(norm), norm(name)]);
}

export function withoutSource(list: string[], name: string): string[] {
  const drop = norm(name);
  return list.map(norm).filter((n) => n !== drop);
}

export function loadEnabledSources(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return uniq(parsed.filter((x): x is string => typeof x === "string").map(norm));
  } catch {
    return [];
  }
}

export function saveEnabledSources(names: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(uniq(names.map(norm))));
  } catch {
    /* storage unavailable / quota — non-fatal for a local-first prototype */
  }
}
