import path from "node:path";

import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Integration tests run against the LOCAL Supabase stack only
 * (`npm run db:start`). They must never target a hosted project:
 * tests/integration/global-setup.ts refuses non-local hosts.
 */
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/support/empty-module.ts"),
    },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    // .env.local (git-ignored) supplies the local anon key during development;
    // CI exports the same variables from `supabase status`.
    env: loadEnv(mode, process.cwd(), ""),
    globalSetup: ["tests/integration/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
}));
