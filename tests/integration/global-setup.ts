import { loadEnv } from "vite";

/**
 * Guard: integration tests create identities and organisations. They may only
 * run against a LOCAL Supabase instance and a LOCAL database.
 */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

export default function setup(): void {
  const env = { ...loadEnv("test", process.cwd(), ""), ...process.env };

  const apiUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!apiUrl) {
    throw new Error("Integration tests require NEXT_PUBLIC_SUPABASE_URL (run `npm run db:start`).");
  }
  if (!LOCAL_HOSTS.has(new URL(apiUrl).hostname)) {
    throw new Error("Refusing to run integration tests against a non-local Supabase API.");
  }

  const dbUrl = env.SUPABASE_DB_URL;
  if (dbUrl && !LOCAL_HOSTS.has(new URL(dbUrl).hostname)) {
    throw new Error("Refusing to run integration tests against a non-local database.");
  }
}
