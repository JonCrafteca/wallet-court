import { defineConfig } from "vitest/config";
import path from "path";

// Standalone vitest config. Pure-logic tests (base44/shared/*) use the default
// "node" environment. Component/integration tests (*.test.tsx) override with
// // @vitest-environment jsdom at the top of the file. esbuild's automatic JSX
// runtime (react/jsx-runtime) avoids needing React in scope; the @ alias
// mirrors the app's import resolution.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    globals: true,
    pool: "threads"
  }
});