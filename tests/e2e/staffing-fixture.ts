import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";

import type { Database } from "@/types/database.types";

import { uniqueEmail, waitForEmailLink } from "../support/mailpit";
import { generateTotp } from "../support/totp";
import { PASSWORD } from "./support";

/**
 * Arranges a staffing world through the PUBLIC API (real sign-up, real RPCs)
 * so the E2E flows can concentrate on the shift/assignment UI. Owner-role
 * access is limited to the local operator procedures (platform-admin grant,
 * malware-scan result), exactly as in the integration suite. Local only.
 */

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // CI exports the local stack environment instead.
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:55321";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const PDF = new TextEncoder().encode("%PDF-1.4\n% Chelth E2E shift fixture\n%%EOF\n");

type Client = SupabaseClient<Database>;
export type Person = {
  client: Client;
  email: string;
  userId: string;
  name: string;
  /** Set for people enrolled in TOTP by the fixture (used for browser step-up). */
  totpSecret?: string;
};

function assertLocal() {
  for (const url of [SUPABASE_URL, DB_URL]) {
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost")
      throw new Error("Staffing fixture is local-only");
  }
}

async function owner<T>(query: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(DB_URL, { max: 1 });
  try {
    return await query(sql);
  } finally {
    await sql.end();
  }
}

async function run(promise: PromiseLike<{ error: unknown }>): Promise<void> {
  const { error } = await promise;
  if (error) throw error;
}

async function must<T>(promise: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const { data, error } = await promise;
  if (error) throw error;
  if (data === null || data === undefined) throw new Error("no data");
  return data;
}

export function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function person(label: string, name: string, email = uniqueEmail(label)): Promise<Person> {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  await run(
    client.auth.signUp({ email, password: PASSWORD, options: { data: { display_name: name } } }),
  );
  const link = await waitForEmailLink(email, "Confirm your CHELTH account");
  const { data, error } = await client.auth.verifyOtp({
    token_hash: link.searchParams.get("token_hash") ?? "",
    type: "email",
  });
  if (error || !data.user) throw error ?? new Error("verification failed");
  return { client, email, userId: data.user.id, name };
}

async function stepUp(who: Person) {
  const enrolled = await must(
    who.client.auth.mfa.enroll({ factorType: "totp", friendlyName: "e2e" }),
  );
  await run(
    who.client.auth.mfa.challengeAndVerify({
      factorId: enrolled.id,
      code: generateTotp(enrolled.totp.secret),
    }),
  );
  who.totpSecret = enrolled.totp.secret;
}

async function join(admin: Client, organisationId: string, role: string, who: Person) {
  const issued = await must(
    admin.rpc("create_organisation_invite", {
      p_organisation_id: organisationId,
      p_email: who.email,
      p_role_key: role,
    }),
  );
  await run(
    who.client.rpc("accept_organisation_invite", { p_token: issued[0]?.invite_token ?? "" }),
  );
}

async function activeCnaWorker(
  admin: Client,
  organisationId: string,
  who: Person,
): Promise<string> {
  await join(admin, organisationId, "agency.healthcare_worker", who);
  const rows = await must(
    who.client.from("agency_workers").select("id").eq("agency_organisation_id", organisationId),
  );
  const workerId = rows[0]?.id ?? "";
  await run(admin.rpc("set_agency_worker_status", { p_worker_id: workerId, p_status: "active" }));
  await run(
    admin.rpc("set_agency_worker_discipline", {
      p_agency_worker_id: workerId,
      p_discipline_key: "cna",
      p_assigned: true,
    }),
  );
  return workerId;
}

/** Credential with clean evidence, submitted, shared with and verified by the agency. */
async function verifiedCredential(
  who: Person,
  admin: Client,
  organisationId: string,
  type: string,
  expiry: string | null,
  facilityId?: string,
) {
  const created = await must(
    who.client.rpc("create_credential", {
      p_credential_type_key: type,
      p_issuing_authority: "Issuing Board",
      p_issue_date: isoDay(-30),
      ...(expiry ? { p_expiry_date: expiry } : {}),
    }),
  );
  const credentialId = created[0]?.credential_id ?? "";
  const versionId = created[0]?.credential_version_id ?? "";
  const begun = await must(
    who.client.rpc("begin_credential_document_upload", {
      p_credential_version_id: versionId,
      p_mime_type: "application/pdf",
      p_size_bytes: PDF.byteLength,
    }),
  );
  const documentId = begun[0]?.document_id ?? "";
  const ticket = await must(
    who.client.storage
      .from("credential-documents")
      .createSignedUploadUrl(begun[0]?.object_path ?? ""),
  );
  await run(
    who.client.storage
      .from("credential-documents")
      .uploadToSignedUrl(ticket.path, ticket.token, PDF, { contentType: "application/pdf" }),
  );
  await run(
    who.client.rpc("complete_credential_document_upload", {
      p_document_id: documentId,
      p_sha256: "c".repeat(64),
      p_content_valid: true,
    }),
  );
  await owner(
    (sql) => sql`select internal.record_document_scan_result(${documentId}::uuid, 'clean')`,
  );
  await run(who.client.rpc("submit_credential_version", { p_credential_version_id: versionId }));
  await run(
    who.client.rpc("share_credential", {
      p_credential_id: credentialId,
      p_agency_organisation_id: organisationId,
    }),
  );
  await run(
    admin.rpc("record_credential_verification", {
      p_credential_version_id: versionId,
      p_agency_organisation_id: organisationId,
      p_outcome: "verified",
      ...(facilityId ? { p_agency_facility_id: facilityId } : {}),
    }),
  );
}

export type StaffingWorld = {
  agencyName: string;
  agencyId: string;
  facilityOrgName: string;
  facilityOrgId: string;
  betaId: string;
  scheduler: Person;
  wendy: Person; // ready for Mercy
  nina: Person; // missing Mercy's facility requirement
  facilityAdmin: Person;
  betaAdmin: Person;
  /** API client of the agency owner (AAL2) for arranging state outside the UI under test. */
  admin: Person;
  facilityId: string;
  relationshipId: string;
  /** Extra ready workers (BLS + Mercy orientation), by key. */
  extra: Record<string, Person & { workerId: string }>;
};

export type ExtraWorker = { key: string; name: string; blsExpiryDays: number };

export async function createStaffingWorld(
  tag: string,
  extraWorkers: ExtraWorker[] = [],
): Promise<StaffingWorld> {
  assertLocal();
  const agencyName = `Shift Agency ${tag}`;
  const facilityOrgName = `Mercy Health ${tag}`;
  const [admin, betaAdmin, scheduler, wendy, nina, operator] = await Promise.all([
    person("e2e-shift-admin", "Ada Admin"),
    person("e2e-shift-beta", "Bea Beta"),
    person("e2e-scheduler", "Sam Scheduler"),
    person("e2e-wendy", "Wendy Ready"),
    person("e2e-nina", "Nina Missing"),
    person("e2e-operator", "Oscar Operator"),
  ]);
  const agencyId = await must(
    admin.client.rpc("create_organisation", {
      p_type: "agency",
      p_name: agencyName,
      p_slug: `shift-agency-${tag}-${Date.now().toString(36)}`,
    }),
  );
  const betaId = await must(
    betaAdmin.client.rpc("create_organisation", {
      p_type: "agency",
      p_name: `Beta Agency ${tag}`,
      p_slug: `beta-agency-${tag}-${Date.now().toString(36)}`,
    }),
  );
  await Promise.all([stepUp(admin), stepUp(operator)]);
  await owner(
    (sql) =>
      sql`select internal.grant_platform_admin(${operator.userId}::uuid, 'E2E Operator', 'e2e fixture')`,
  );

  await join(admin.client, agencyId, "agency.scheduler", scheduler);
  await activeCnaWorker(admin.client, agencyId, wendy);
  await activeCnaWorker(admin.client, agencyId, nina);

  const facilityId = await must(
    admin.client.rpc("create_agency_facility", {
      p_agency_organisation_id: agencyId,
      p_name: "Mercy Rehab",
      p_facility_type: "rehabilitation",
      p_timezone: "America/New_York",
    }),
  );
  await run(
    admin.client.rpc("create_facility_location", {
      p_facility_id: facilityId,
      p_name: "Mercy Main",
    }),
  );
  const relationshipId = await must(
    admin.client.rpc("create_facility_relationship", { p_facility_id: facilityId }),
  );
  await run(
    admin.client.rpc("set_facility_relationship_status", {
      p_relationship_id: relationshipId,
      p_status: "active",
    }),
  );
  for (const [type, facility] of [
    ["bls_certification", undefined],
    ["facility_orientation", facilityId],
  ] as const) {
    await run(
      admin.client.rpc("create_credential_requirement", {
        p_effective_from: isoDay(-30),
        p_agency_organisation_id: agencyId,
        p_credential_type_key: type,
        ...(facility ? { p_agency_facility_id: facility } : {}),
      }),
    );
  }
  await verifiedCredential(wendy, admin.client, agencyId, "bls_certification", isoDay(400));
  await verifiedCredential(wendy, admin.client, agencyId, "facility_orientation", null, facilityId);
  await verifiedCredential(nina, admin.client, agencyId, "bls_certification", isoDay(400));

  const extra: StaffingWorld["extra"] = {};
  for (const spec of extraWorkers) {
    const who = await person(`e2e-${spec.key}`, spec.name);
    const workerId = await activeCnaWorker(admin.client, agencyId, who);
    await verifiedCredential(
      who,
      admin.client,
      agencyId,
      "bls_certification",
      isoDay(spec.blsExpiryDays),
    );
    await verifiedCredential(who, admin.client, agencyId, "facility_orientation", null, facilityId);
    extra[spec.key] = { ...who, workerId };
  }

  const facilityAdminEmail = uniqueEmail("e2e-facility-admin");
  const created = await must(
    operator.client.rpc("platform_create_organisation", {
      p_type: "facility",
      p_name: facilityOrgName,
      p_slug: `mercy-health-${tag}-${Date.now().toString(36)}`,
      p_owner_email: facilityAdminEmail,
    }),
  );
  const facilityOrgId = created[0]?.organisation_id ?? "";
  const facilityAdmin = await person("e2e-facility-admin", "Fiona Facility", facilityAdminEmail);
  await run(
    facilityAdmin.client.rpc("accept_organisation_invite", {
      p_token: created[0]?.invite_token ?? "",
    }),
  );
  await run(
    operator.client.rpc("platform_link_agency_facility", {
      p_agency_facility_id: facilityId,
      p_facility_organisation_id: facilityOrgId,
    }),
  );

  return {
    agencyName,
    agencyId,
    facilityOrgName,
    facilityOrgId,
    betaId,
    scheduler,
    wendy,
    nina,
    facilityAdmin,
    betaAdmin,
    admin,
    facilityId,
    relationshipId,
    extra,
  };
}

export type PastEvent = {
  type: "clock_in" | "clock_out" | "break_start" | "break_end";
  at: string;
  segment?: number;
};

/**
 * Owner arrangement of work that happened in the PAST (the public API refuses
 * to schedule or clock the past): a draft shift moved into the past and
 * opened, an accepted assignment, device events whose recorded time equals
 * their occurred time, then the one trusted projection refresh (which also
 * derives the timesheet). Local only; never used to test authorization.
 */
export async function arrangePastWork(
  world: StaffingWorld,
  options: {
    worker: Person & { workerId: string };
    facilityId: string;
    locationId: string;
    startAt: string;
    endAt: string;
    events: PastEvent[];
  },
): Promise<{ shiftId: string; assignmentId: string }> {
  assertLocal();
  const future = isoDay(5);
  const shiftId = await must(
    world.scheduler.client.rpc("create_shift", {
      p_agency_facility_id: options.facilityId,
      p_facility_location_id: options.locationId,
      p_discipline_key: "cna",
      p_shift_date: future,
      p_start_time: "07:00",
      p_end_time: "15:00",
      p_requested_headcount: 2,
      p_open: false,
    }),
  );
  const assignmentId = await owner(async (sql) => {
    await sql`update public.shifts set start_at = ${options.startAt}, end_at = ${options.endAt} where id = ${shiftId}`;
    await sql`update public.shifts set status = 'open', opened_at = now() where id = ${shiftId}`;
    const [membership] = await sql<{ id: string }[]>`
      select id from public.organisation_memberships
      where organisation_id = ${world.agencyId} and profile_id = ${world.scheduler.userId}`;
    const [row] = await sql<{ id: string }[]>`
      insert into public.shift_assignments
        (shift_id, agency_organisation_id, agency_worker_id, profile_id, start_at, end_at, assigned_by_membership_id)
      values (${shiftId}, ${world.agencyId}, ${options.worker.workerId}, ${options.worker.userId},
              ${options.startAt}, ${options.endAt}, ${membership?.id ?? null})
      returning id`;
    const id = row?.id ?? "";
    await sql`update public.shift_assignments set status = 'accepted', accepted_at = now() where id = ${id}`;
    for (const event of options.events) {
      const [attendance] = await sql<{ id: string }[]>`
        select (internal.ensure_attendance(${id}::uuid)).id as id`;
      await sql`
        insert into public.attendance_events
          (attendance_id, assignment_id, agency_organisation_id, event_type, segment, occurred_at, recorded_at, source)
        values (${attendance?.id ?? ""}, ${id}, ${world.agencyId}, ${event.type}::public.attendance_event_type,
                ${event.segment ?? 1}, ${event.at}, ${event.at}, 'worker_device')`;
      await sql`select internal.refresh_attendance(${attendance?.id ?? ""}::uuid)`;
    }
    return id;
  });
  return { shiftId, assignmentId };
}

/** Owner: device location evidence for an assignment's existing clock-in event. */
export async function attachClockInEvidence(assignmentId: string): Promise<string> {
  assertLocal();
  return owner(async (sql) => {
    const [row] = await sql<
      { id: string; attendance_id: string; agency_organisation_id: string }[]
    >`
      select id, attendance_id, agency_organisation_id from public.attendance_events
      where assignment_id = ${assignmentId} and event_type = 'clock_in'`;
    await sql`
      insert into public.attendance_location_evidence
        (event_id, attendance_id, agency_organisation_id, latitude, longitude, accuracy_meters,
         device_captured_at, distance_meters, radius_meters, result)
      values (${row?.id ?? ""}, ${row?.attendance_id ?? ""}, ${row?.agency_organisation_id ?? ""},
              40.7128, -74.006, 12, now(), 10, 200, 'inside')`;
    return row?.attendance_id ?? "";
  });
}

/** A fresh password-only (AAL1) API session for an existing person — no step-up. */
export async function passwordOnlyClient(email: string): Promise<Client> {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  await run(client.auth.signInWithPassword({ email, password: PASSWORD }));
  return client;
}

/** A new member of the world's agency with one role; optionally enrolled for step-up (TOTP). */
export async function agencyMember(
  world: StaffingWorld,
  label: string,
  name: string,
  role: string,
  withAuthenticator = false,
): Promise<Person> {
  const who = await person(label, name);
  await join(world.admin.client, world.agencyId, role, who);
  if (withAuthenticator) await stepUp(who);
  return who;
}

/** A new member of the world's facility organisation with one role (invited by the facility admin). */
export async function facilityMember(
  world: StaffingWorld,
  label: string,
  name: string,
  role: string,
  existing?: Person,
): Promise<Person> {
  const who = existing ?? (await person(label, name));
  // Inviting is privileged: the facility admin steps up once.
  if (!world.facilityAdmin.totpSecret) await stepUp(world.facilityAdmin);
  await join(world.facilityAdmin.client, world.facilityOrgId, role, who);
  return who;
}

/**
 * A healthcare worker of the world's agency and/or the Beta agency (P0-E9-3B app entry).
 * Pass `existing` to add another agency to the same person.
 */
export async function agencyWorker(
  world: StaffingWorld,
  label: string,
  name: string,
  agency: "primary" | "beta",
  existing?: Person,
): Promise<Person> {
  const who = existing ?? (await person(label, name));
  if (agency === "primary") {
    await join(world.admin.client, world.agencyId, "agency.healthcare_worker", who);
    return who;
  }
  // Inviting is privileged: the Beta owner steps up once.
  if (!world.betaAdmin.totpSecret) await stepUp(world.betaAdmin);
  await join(world.betaAdmin.client, world.betaId, "agency.healthcare_worker", who);
  return who;
}
