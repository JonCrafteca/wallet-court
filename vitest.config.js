import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// Standalone vitest config. Pure-logic tests (base44/shared/*) use the default
// "node" environment. Component/integration tests (*.test.tsx) override with
// // @vitest-environment jsdom at the top of the file. The React plugin enables
// JSX in .tsx test files; the @ alias mirrors the app's import resolution.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    globals: false,
    pool: "threads"
  }
});