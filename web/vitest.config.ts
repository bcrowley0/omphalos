import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure-function unit tests (parser, router). Node env is enough — no DOM.
    environment: "node",
    include: ["app/**/*.test.ts"],
  },
});
