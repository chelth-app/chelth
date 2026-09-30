import "server-only";

import { requireAuthIdentity } from "@/lib/auth/session";
import type { WorkerStatus } from "@/lib/domain/vocabulary";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/* All reads run as the signed-in user; RLS decides visibility. */

export type WorkerSummary = {
  id: string;
  displayName: string | null;
  status: WorkerStatus;
  workerReference: string | null;
  startDate: string | null;
  endDate: string | null;
};

const WORKER_COLUMNS =
  "id, status, worker_reference, start_date, end_date, profile:profiles(display_name)";

type WorkerRow = {
  id: string;
  status: WorkerStatus;
  worker_reference: string | null;
  start_date: string | null;
  end_date: string | null;
  profile: { display_name: string | null } | null;
};

function toSummary(row: WorkerRow): WorkerSummary {
  return {
    id: row.id,
    displayName: row.profile?.display_name ?? null,
    status: row.status,
    workerReference: row.worker_reference,
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

export async function listWorkers(organisationId: string): Promise<WorkerSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agency_workers")
    .select(WORKER_COLUMNS)
    .eq("agency_organisation_id", organisationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data.map(toSummary);
}

export async function getWorker(
  organisationId: string,
  workerId: string,
): Promise<WorkerSummary | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agency_workers")
    .select(WORKER_COLUMNS)
    .eq("agency_organisation_id", organisationId)
    .eq("id", workerId)
    .maybeSingle();
  if (error) throw error;
  return data ? toSummary(data) : null;
}

/** The caller's own current worker record in this agency (self-access). */
export async function getMyWorkerRecord(organisationId: string): Promise<WorkerSummary | null> {
  const identity = await requireAuthIdentity();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agency_workers")
    .select(WORKER_COLUMNS)
    .eq("agency_organisation_id", organisationId)
    .eq("profile_id", identity.userId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data[0];
  return row ? toSummary(row) : null;
}

export type WorkerNote = { id: string; body: string; createdAt: string; authorName: string | null };

export async function listWorkerNotes(workerId: string): Promise<WorkerNote[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agency_worker_notes")
    .select("id, body, created_at, author:profiles(display_name)")
    .eq("worker_id", workerId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    authorName: row.author?.display_name ?? null,
  }));
}
