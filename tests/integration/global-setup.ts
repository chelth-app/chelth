/**
 * Guard: integration tests may only run against a local Supabase instance.
 * This prevents a mis-set environment from pointing tests (which create and
 * delete data) at a hosted project.
 */
export default function setup(): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("Integration tests require NEXT_PUBLIC_SUPABASE_URL (run `npm run db:start`).");
  }
  const { hostname } = new URL(url);
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(`Refusing to run integration tests against non-local Supabase host.`);
  }
}
