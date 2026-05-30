import type { NextConfig } from "next";

// Backend base URL. The browser NEVER calls the backend (or any third party)
// directly — it calls same-origin /api/* and Next rewrites to FastAPI. This
// keeps secrets in the backend and avoids scattered CORS config (CLAUDE.md).
const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
