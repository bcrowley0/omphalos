import { parseCommand } from "./command/parser";
import { commandToTab } from "./command/tabs";
import { classifyFeedUrl } from "./feedUrl";
import type { ContentType, Person, Tab } from "./command/types";

// Terminal UI state, persisted to localStorage (NON-secret UI state only:
// watchlist + open tabs + active tab — CLAUDE.md). Implemented as an external
// store consumed via useSyncExternalStore so persistence and SSR work without
// setState-in-effect.

export type TerminalState = {
  tabs: Tab[];
  activeId: string | null;
  watchlist: string[];
  following: Person[];
  history: string[]; // recent raw command inputs (in-memory; not persisted)
  error: string | null; // last inline parse error (transient)
};

const STORAGE_KEY = "omphalos.terminal.v1";

const mkPerson = (name: string): Person => ({
  name,
  lastSeenTs: 0,
  enabled: { news: true, videos: true, podcasts: true, speeches: true, writing: false },
  anchors: { writing: [] },
});

const DEFAULT_FOLLOWING: Person[] = [
  "Paul Tudor Jones", "Stanley Druckenmiller", "Andrej Karpathy", "Boris Cherny",
].map(mkPerson);

// Stable references for SSR / empty state (useSyncExternalStore requires
// getServerSnapshot to be referentially stable).
const SERVER_STATE: TerminalState = {
  tabs: [],
  activeId: null,
  watchlist: [],
  following: [],
  history: [],
  error: null,
};

type Persisted = Pick<TerminalState, "tabs" | "activeId" | "watchlist" | "following">;

function migratePerson(raw: unknown): Person {
  const p = (raw ?? {}) as Record<string, unknown>;
  const name = String(p.name ?? "");
  const lastSeenTs = typeof p.lastSeenTs === "number" ? p.lastSeenTs : 0;
  // Already-new shape: pass through.
  if (p.enabled && p.anchors) {
    return { name, lastSeenTs, enabled: p.enabled as Person["enabled"], anchors: p.anchors as Person["anchors"] };
  }
  const feeds = Array.isArray(p.feeds) ? (p.feeds as string[]) : [];
  const anchors: Person["anchors"] = { writing: [] };
  for (const url of feeds) {
    const kind = classifyFeedUrl(url);
    if (kind === "youtube" && !anchors.youtube) anchors.youtube = url;
    else if (kind === "podcast" && !anchors.podcast) anchors.podcast = url;
    else anchors.writing.push(url);
  }
  return {
    name,
    lastSeenTs,
    enabled: { news: true, videos: true, podcasts: true, speeches: true, writing: anchors.writing.length > 0 },
    anchors,
  };
}

function loadPersisted(): Persisted {
  if (typeof window === "undefined")
    return { tabs: [], activeId: null, watchlist: [], following: DEFAULT_FOLLOWING };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { tabs: [], activeId: null, watchlist: [], following: DEFAULT_FOLLOWING };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      tabs: Array.isArray(parsed.tabs) ? parsed.tabs : [],
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
      following: Array.isArray(parsed.following) ? (parsed.following as unknown[]).map(migratePerson) : DEFAULT_FOLLOWING,
    };
  } catch {
    return { tabs: [], activeId: null, watchlist: [], following: DEFAULT_FOLLOWING };
  }
}

export class TerminalStore {
  private state: TerminalState;
  private listeners = new Set<() => void>();

  constructor() {
    const p = loadPersisted();
    this.state = { ...SERVER_STATE, ...p };
  }

  // --- useSyncExternalStore wiring ------------------------------------- #
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): TerminalState => this.state;

  getServerSnapshot = (): TerminalState => SERVER_STATE;

  private set(next: TerminalState) {
    this.state = next;
    this.persist();
    this.listeners.forEach((l) => l());
  }

  private persist() {
    if (typeof window === "undefined") return;
    try {
      const { tabs, activeId, watchlist, following } = this.state;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeId, watchlist, following }));
    } catch {
      /* storage unavailable / quota — non-fatal for a local-first prototype */
    }
  }

  // --- actions ---------------------------------------------------------- #
  /** Parse and act on a raw command-bar line. */
  dispatch(input: string) {
    const cmd = parseCommand(input);
    const history = input.trim() ? [...this.state.history, input.trim()] : this.state.history;

    if (cmd.kind === "error") {
      this.set({ ...this.state, history, error: cmd.message });
      return;
    }

    let watchlist = this.state.watchlist;
    if (cmd.kind === "watch") {
      watchlist = watchlist.includes(cmd.symbol) ? watchlist : [...watchlist, cmd.symbol];
    } else if (cmd.kind === "unwatch") {
      watchlist = watchlist.filter((s) => s !== cmd.symbol);
    }

    let following = this.state.following;
    if (cmd.kind === "follow") {
      following = following.some((p) => p.name === cmd.name)
        ? following
        : [...following, mkPerson(cmd.name)];
    } else if (cmd.kind === "unfollow") {
      following = following.filter((p) => p.name !== cmd.name);
    }

    const tab = commandToTab(cmd);
    let tabs = this.state.tabs;
    let activeId = this.state.activeId;
    if (tab) {
      const exists = tabs.some((t) => t.id === tab.id);
      tabs = exists ? tabs.map((t) => (t.id === tab.id ? tab : t)) : [...tabs, tab];
      activeId = tab.id;
    }

    this.set({ tabs, activeId, watchlist, following, history, error: null });
  }

  focus(id: string) {
    if (this.state.activeId === id) return;
    this.set({ ...this.state, activeId: id });
  }

  close(id: string) {
    const idx = this.state.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const tabs = this.state.tabs.filter((t) => t.id !== id);
    let activeId = this.state.activeId;
    if (activeId === id) {
      const neighbor = tabs[idx] ?? tabs[idx - 1] ?? null;
      activeId = neighbor ? neighbor.id : null;
    }
    this.set({ ...this.state, tabs, activeId });
  }

  clearError() {
    if (this.state.error === null) return;
    this.set({ ...this.state, error: null });
  }

  followPerson(name: string) {
    this.dispatch(`follow ${name}`);
  }

  unfollowPerson(name: string) {
    this.dispatch(`unfollow ${name}`);
  }

  /** Move a watched symbol one position up or down. No-op at the ends / unknown symbol. */
  moveWatchlistSymbol(symbol: string, dir: "up" | "down") {
    const list = this.state.watchlist;
    const i = list.indexOf(symbol);
    if (i === -1) return;
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    this.set({ ...this.state, watchlist: next });
  }

  setPersonEnabled(name: string, type: ContentType, on: boolean) {
    const following = this.state.following.map((p) =>
      p.name === name ? { ...p, enabled: { ...p.enabled, [type]: on } } : p,
    );
    this.set({ ...this.state, following });
  }

  setPersonAnchor(name: string, type: "youtube" | "podcast", value: string | null) {
    const following = this.state.following.map((p) =>
      p.name === name ? { ...p, anchors: { ...p.anchors, [type]: value ?? undefined } } : p,
    );
    this.set({ ...this.state, following });
  }

  addWritingFeed(name: string, url: string) {
    const following = this.state.following.map((p) =>
      p.name === name && !p.anchors.writing.includes(url)
        ? { ...p, anchors: { ...p.anchors, writing: [...p.anchors.writing, url] }, enabled: { ...p.enabled, writing: true } }
        : p,
    );
    this.set({ ...this.state, following });
  }

  removeWritingFeed(name: string, url: string) {
    const following = this.state.following.map((p) =>
      p.name === name
        ? { ...p, anchors: { ...p.anchors, writing: p.anchors.writing.filter((u) => u !== url) } }
        : p,
    );
    this.set({ ...this.state, following });
  }

  // Mark a person (or "*" for all) as seen now; drives the "new" badge.
  markSeen(name: string) {
    const now = Date.now();
    const following = this.state.following.map((p) =>
      name === "*" || p.name === name ? { ...p, lastSeenTs: now } : p,
    );
    this.set({ ...this.state, following });
  }
}

export const terminalStore = new TerminalStore();
