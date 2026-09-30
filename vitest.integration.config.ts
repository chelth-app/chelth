import path from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Integration tests run against the LOCAL Supabase stack only
 * (`npm run db:start`). They must never target a hosted project.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/support/empty-module.ts"),
    },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/integration/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    passWithNoTests: true,
  },
});
