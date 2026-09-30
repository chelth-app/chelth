import postgres from "postgres";

/**
 * Test harness acting as the malware scanner (an operator role) against the
 * LOCAL database only. Production has no such shortcut: documents stay
 * `scanning` until a real scanner clears them.
 */
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";

export async function markUploadsClean(email: string): Promise<number> {
  const host = new URL(DB_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("Scanner helper is local-only");
  const sql = postgres(DB_URL, { max: 1 });
  try {
    const rows = await sql`
      select internal.record_document_scan_result(d.id, 'clean')
      from public.credential_documents d
      join auth.users u on u.id = d.profile_id
      where lower(u.email) = lower(${email}) and d.status = 'scanning'`;
    return rows.length;
  } finally {
    await sql.end();
  }
}
