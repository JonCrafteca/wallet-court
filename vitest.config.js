import { defineConfig } from "vitest/config";

// Standalone vitest config for the shared-logic test suite (base44/shared/*).
// The base44 vite plugin is intentionally NOT loaded here — the tests import
// pure TypeScript modules that have no platform-runtime dependency, so a plain
// vitest environment is sufficient and avoids pulling in the app build pipeline.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    pool: "threads"
  }
});