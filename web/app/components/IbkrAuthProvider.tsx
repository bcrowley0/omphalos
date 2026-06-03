"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { loadIbkrAuth, type IbkrAuthState } from "../lib/ibkrAuth";

type IbkrAuthValue = {
  state: IbkrAuthState | null; // null = unknown (initial load, or backend down)
  loginUrl: string | null;
  detail: string | null;
  loading: boolean;
  recheck: () => void;
};

const IbkrAuthContext = createContext<IbkrAuthValue | null>(null);

export function useIbkrAuth(): IbkrAuthValue {
  const ctx = useContext(IbkrAuthContext);
  if (ctx === null) throw new Error("useIbkrAuth must be used within IbkrAuthProvider");
  return ctx;
}

export function IbkrAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<IbkrAuthState | null>(null);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const lastRun = useRef(0);

  // First statement is `await` — no synchronous setState, so this is safe to call
  // from an effect (mirrors the useResource pattern).
  const run = useCallback(async () => {
    try {
      const data = await loadIbkrAuth();
      setState(data.state);
      setLoginUrl(data.loginUrl ?? null);
      setDetail(data.detail);
    } catch {
      // Backend unreachable → unknown; never show a false "log in" prompt.
      setState(null);
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const recheck = useCallback(() => {
    lastRun.current = Date.now();
    setLoading(true);
    void run();
  }, [run]);

  // Fetch the snapshot when the app loads.
  useEffect(() => {
    lastRun.current = Date.now();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
  }, [run]);

  // Re-check when the user returns to this tab (e.g. after logging in at the
  // gateway). Debounced so rapid refocus doesn't refetch. On-demand, never a
  // background poll (CLAUDE.md hard rule #5).
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastRun.current < 3000) return;
      lastRun.current = Date.now();
      void run();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [run]);

  return (
    <IbkrAuthContext.Provider value={{ state, loginUrl, detail, loading, recheck }}>
      {children}
    </IbkrAuthContext.Provider>
  );
}
