// Backend base URL for SERVER-SIDE fetches (Server Components / route handlers).
// The browser never uses this — it calls same-origin /api/* which Next rewrites
// to the backend (see next.config.ts). Secrets stay server-side either way.
export const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";
