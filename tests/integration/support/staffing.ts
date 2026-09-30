import { CREDENTIAL_DOCUMENT_BUCKET } from "@/lib/domain/credentials";

import { ownerQuery, signUpVerified, slug, type TestClient, type TestIdentity } from "./identities";

/** Shared staffing fixtures for integration tests (real public API; operator steps via ownerQuery). */
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n% Chelth shift test\n%%EOF\n");

export function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

export async function run(promise: PromiseLike<{ error: unknown }>): Promise<void> {
  const { error } = await promise;
  if (error) throw error;
}

export async function must<T>(
  promise: PromiseLike<{ data: T; error: unknown }>,
): Promise<NonNullable<T>> {
  const { data, error } = await promise;
  if (error) throw error;
  if (data === null || data === undefined) throw new Error("no data");
  return data;
}

export async function createAgency(owner: TestIdentity, name: string): Promise<string> {
  return must(
    owner.client.rpc("create_organisation", {
      p_type: "agency",
      p_name: name,
      p_slug: slug("agency"),
    }),
  );
}

export async function invite(
  admin: TestClient,
  organisationId: string,
  role: string,
  invitee: TestIdentity | string,
): Promise<TestIdentity> {
  const email = typeof invitee === "string" ? invitee : invitee.email;
  const issued = await must(
    admin.rpc("create_organisation_invite", {
      p_organisation_id: organisationId,
      p_email: email,
      p_role_key: role,
    }),
  );
  const identity =
    typeof invitee === "string"
      ? await signUpVerified(role.split(".")[1] ?? "member", email)
      : invitee;
  await run(
    identity.client.rpc("accept_organisation_invite", { p_token: issued[0]?.invite_token ?? "" }),
  );
  return identity;
}

export async function workerIdAt(worker: TestIdentity, organisationId: string): Promise<string> {
  const rows = await must(
    worker.client.from("agency_workers").select("id").eq("agency_organisation_id", organisationId),
  );
  return rows[0]?.id ?? "";
}

export async function activateCna(admin: TestClient, workerId: string) {
  await run(admin.rpc("set_agency_worker_status", { p_worker_id: workerId, p_status: "active" }));
  await run(
    admin.rpc("set_agency_worker_discipline", {
      p_agency_worker_id: workerId,
      p_discipline_key: "cna",
      p_assigned: true,
    }),
  );
}

/** A BLS credential with a clean document, submitted, shared and verified by each agency. */
export async function blsEvidence(
  worker: TestIdentity,
  expiryOffsetDays: number,
  verifiers: { client: TestClient; organisationId: string }[],
) {
  const created = await must(
    worker.client.rpc("create_credential", {
      p_credential_type_key: "bls_certification",
      p_issuing_authority: "American Heart Association",
      p_issue_date: isoDay(-300),
      p_expiry_date: isoDay(expiryOffsetDays),
    }),
  );
  const credentialId = created[0]?.credential_id ?? "";
  const versionId = created[0]?.credential_version_id ?? "";
  const begun = await must(
    worker.client.rpc("begin_credential_document_upload", {
      p_credential_version_id: versionId,
      p_mime_type: "application/pdf",
      p_size_bytes: PDF_BYTES.byteLength,
    }),
  );
  const documentId = begun[0]?.document_id ?? "";
  const path = begun[0]?.object_path ?? "";
  const ticket = await worker.client.storage
    .from(CREDENTIAL_DOCUMENT_BUCKET)
    .createSignedUploadUrl(path);
  if (ticket.error) throw ticket.error;
  const uploaded = await worker.client.storage
    .from(CREDENTIAL_DOCUMENT_BUCKET)
    .uploadToSignedUrl(ticket.data.path, ticket.data.token, PDF_BYTES, {
      contentType: "application/pdf",
    });
  if (uploaded.error) throw uploaded.error;
  await run(
    worker.client.rpc("complete_credential_document_upload", {
      p_document_id: documentId,
      p_sha256: "b".repeat(64),
      p_content_valid: true,
    }),
  );
  await ownerQuery(
    (sql) => sql`select internal.record_document_scan_result(${documentId}::uuid, 'clean')`,
  );
  await run(worker.client.rpc("submit_credential_version", { p_credential_version_id: versionId }));
  for (const verifier of verifiers) {
    await run(
      worker.client.rpc("share_credential", {
        p_credential_id: credentialId,
        p_agency_organisation_id: verifier.organisationId,
      }),
    );
    await run(
      verifier.client.rpc("record_credential_verification", {
        p_credential_version_id: versionId,
        p_agency_organisation_id: verifier.organisationId,
        p_outcome: "verified",
      }),
    );
  }
}

export async function facilityWithRelationship(
  admin: TestClient,
  organisationId: string,
  name: string,
  timezone: string,
) {
  const facilityId = await must(
    admin.rpc("create_agency_facility", {
      p_agency_organisation_id: organisationId,
      p_name: name,
      p_facility_type: "rehabilitation",
      p_timezone: timezone,
    }),
  );
  const locationId = await must(
    admin.rpc("create_facility_location", { p_facility_id: facilityId, p_name: `${name} Main` }),
  );
  const relationshipId = await must(
    admin.rpc("create_facility_relationship", { p_facility_id: facilityId }),
  );
  await run(
    admin.rpc("set_facility_relationship_status", {
      p_relationship_id: relationshipId,
      p_status: "active",
    }),
  );
  return { facilityId, locationId, relationshipId };
}

export type Decision = {
  outcome: string;
  assignment_id: string | null;
  primary_reason: string | null;
  compliance_reasons: string[];
};

export async function assign(
  client: TestClient,
  shiftId: string,
  workerId: string,
): Promise<Decision> {
  const rows = await must(
    client.rpc("assign_worker_to_shift", { p_shift_id: shiftId, p_agency_worker_id: workerId }),
  );
  const row = rows[0];
  if (!row) throw new Error("no decision");
  return row;
}
