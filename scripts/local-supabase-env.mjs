#!/usr/bin/env node
/**
 * Prints KEY=value lines for the LOCAL Supabase stack, for CI ($GITHUB_ENV)
 * or local shells. Emits only what the app and tests need:
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY (anon only),
 *   SUPABASE_DB_URL (local owner connection for operator test steps),
 *   MAILPIT_URL.
 * Service-role / secret keys are deliberately never emitted.
 * Refuses to run if the stack is not local.
 */
import { execFileSync } from "node:child_process";

const status = JSON.parse(
  execFileSync("supabase", ["status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
);

const local = (url) => ["127.0.0.1", "localhost"].includes(new URL(url).hostname);
if (!local(status.API_URL) || !local(status.DB_URL)) {
  console.error("local-supabase-env: refusing to export a non-local stack");
  process.exit(1);
}

const env = {
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_DB_URL: status.DB_URL,
  MAILPIT_URL: status.MAILPIT_URL ?? status.INBUCKET_URL,
};

for (const [key, value] of Object.entries(env)) {
  if (!value) {
    console.error(`local-supabase-env: ${key} unavailable from supabase status`);
    process.exit(1);
  }
  console.log(`${key}=${value}`);
}
