import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` / `client-only` throw outside the Next.js bundler; the
      // boundaries themselves are enforced by `next build`, not by unit tests.
      "server-only": path.resolve(import.meta.dirname, "tests/support/empty-module.ts"),
      "client-only": path.resolve(import.meta.dirname, "tests/support/empty-module.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    environment: "node",
    setupFiles: ["tests/support/setup-unit.ts"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/types/database.types.ts", "src/app/**"],
      reporter: ["text", "html"],
    },
  },
});
