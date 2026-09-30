function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is required for integration tests (see tests/integration/README.md)`);
  return value;
}

export const SUPABASE_URL = required("NEXT_PUBLIC_SUPABASE_URL");
export const SUPABASE_ANON_KEY = required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
/** Local database only — used solely for operator procedures (platform admin grants). */
export const SUPABASE_DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
