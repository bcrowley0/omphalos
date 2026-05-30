import HealthPanel, { type HealthState } from "./HealthPanel";
import { BACKEND_URL } from "./lib/backend";

// no-store keeps this dynamic: the health snapshot is fetched on each request,
// server-side (the server may call the backend directly; the browser may not).
async function getInitialHealth(): Promise<HealthState> {
  try {
    const res = await fetch(`${BACKEND_URL}/health`, { cache: "no-store" });
    if (!res.ok) {
      return { kind: "error", message: `backend returned HTTP ${res.status}` };
    }
    const data = (await res.json()) as Record<string, string>;
    return { kind: "ok", data };
  } catch {
    return {
      kind: "error",
      message: "cannot reach backend (is the API running on :8000?)",
    };
  }
}

export default async function Home() {
  const initial = await getInitialHealth();
  return (
    <main style={{ padding: "2rem", maxWidth: 640 }}>
      <h1 style={{ fontSize: "1.4rem", marginBottom: "0.25rem" }}>Omphalos</h1>
      <p style={{ color: "var(--muted)", marginBottom: "1.5rem" }}>
        local-first finance terminal
      </p>
      <HealthPanel initial={initial} />
    </main>
  );
}
