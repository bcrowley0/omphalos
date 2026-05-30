import { parseCommand } from "./command/parser";
import { commandToTab } from "./command/tabs";
import type { Tab } from "./command/types";

// Terminal UI state, persisted to localStorage (NON-secret UI state only:
// watchlist + open tabs + active tab — CLAUDE.md). Implemented as an external
// store consumed via useSyncExternalStore so persistence and SSR work without
// setState-in-effect.

export type TerminalState = {
  tabs: Tab[];
  activeId: string | null;
  watchlist: string[];
  history: string[]; // recent raw command inputs (in-memory; not persisted)
  error: string | null; // last inline parse error (transient)
};

const STORAGE_KEY = "omphalos.terminal.v1";

// Stable references for SSR / empty state (useSyncExternalStore requires
// getServerSnapshot to be referentially stable).
const SERVER_STATE: TerminalState = {
  tabs: [],
  activeId: null,
  watchlist: [],
  history: [],
  error: null,
};

type Persisted = Pick<TerminalState, "tabs" | "activeId" | "watchlist">;

function loadPersisted(): Persisted {
  if (typeof window === "undefined") return { tabs: [], activeId: null, watchlist: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { tabs: [], activeId: null, watchlist: [] };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      tabs: Array.isArray(parsed.tabs) ? parsed.tabs : [],
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
    };
  } catch {
    return { tabs: [], activeId: null, watchlist: [] };
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
      const { tabs, activeId, watchlist } = this.state;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeId, watchlist }));
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

    const tab = commandToTab(cmd);
    let tabs = this.state.tabs;
    let activeId = this.state.activeId;
    if (tab) {
      const exists = tabs.some((t) => t.id === tab.id);
      tabs = exists ? tabs.map((t) => (t.id === tab.id ? tab : t)) : [...tabs, tab];
      activeId = tab.id;
    }

    this.set({ tabs, activeId, watchlist, history, error: null });
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
}

export const terminalStore = new TerminalStore();
