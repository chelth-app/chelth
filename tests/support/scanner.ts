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

async function withLocalDb<T>(run: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const host = new URL(DB_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("Scanner helper is local-only");
  const sql = postgres(DB_URL, { max: 1 });
  try {
    return await run(sql);
  } finally {
    await sql.end();
  }
}

/** The scanner gave up on the person's waiting documents (they stay `scanning`, untrusted). */
export async function failWaitingScans(email: string): Promise<number> {
  return withLocalDb(async (sql) => {
    const rows = await sql`
      select internal.fail_document_scan(d.id, 'provider_unavailable')
      from public.credential_documents d
      join auth.users u on u.id = d.profile_id
      where lower(u.email) = lower(${email}) and d.status = 'scanning'`;
    return rows.length;
  });
}

/** The scanner quarantined the person's waiting documents. */
export async function quarantineWaitingScans(email: string): Promise<number> {
  return withLocalDb(async (sql) => {
    const rows = await sql`
      select internal.record_document_scan_result(d.id, 'quarantined', 'malware_detected')
      from public.credential_documents d
      join auth.users u on u.id = d.profile_id
      where lower(u.email) = lower(${email}) and d.status = 'scanning'`;
    return rows.length;
  });
}

/** How many document rows the person has (any state). */
export async function documentCount(email: string): Promise<number> {
  return withLocalDb(async (sql) => {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n
      from public.credential_documents d
      join auth.users u on u.id = d.profile_id
      where lower(u.email) = lower(${email})`;
    return row?.n ?? 0;
  });
}
