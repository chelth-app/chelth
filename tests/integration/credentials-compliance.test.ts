import { beforeAll, describe, expect, it } from "vitest";

import { CREDENTIAL_DOCUMENT_BUCKET } from "@/lib/domain/credentials";

import { uniqueEmail } from "../support/mailpit";
import {
  ownerQuery,
  signUpVerified,
  slug,
  stepUpToAal2,
  type TestClient,
  type TestIdentity,
} from "./support/identities";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n% Chelth integration test document\n%%EOF\n");

async function createAgency(owner: TestIdentity, name: string): Promise<string> {
  const { data, error } = await owner.client.rpc("create_organisation", {
    p_type: "agency",
    p_name: name,
    p_slug: slug("agency"),
  });
  if (error) throw error;
  return data;
}

async function inviteAndAccept(
  admin: TestClient,
  organisationId: string,
  role: string,
  invitee: TestIdentity | string,
) {
  const email = typeof invitee === "string" ? invitee : invitee.email;
  const issued = await admin.rpc("create_organisation_invite", {
    p_organisation_id: organisationId,
    p_email: email,
    p_role_key: role,
  });
  if (issued.error) throw issued.error;
  const identity =
    typeof invitee === "string"
      ? await signUpVerified(role.split(".")[1] ?? "member", email)
      : invitee;
  const accepted = await identity.client.rpc("accept_organisation_invite", {
    p_token: issued.data[0]?.invite_token ?? "",
  });
  if (accepted.error || !accepted.data[0]) throw accepted.error ?? new Error("invite not accepted");
  return identity;
}

/** Worker uploads through a signed upload URL, exactly as the browser does. */
async function uploadDocument(
  owner: TestIdentity,
  versionId: string,
): Promise<{ documentId: string; path: string }> {
  const begun = await owner.client.rpc("begin_credential_document_upload", {
    p_credential_version_id: versionId,
    p_mime_type: "application/pdf",
    p_size_bytes: PDF_BYTES.byteLength,
  });
  if (begun.error) throw begun.error;
  const { document_id: documentId, object_path: path } = begun.data[0] ?? {
    document_id: "",
    object_path: "",
  };
  const ticket = await owner.client.storage
    .from(CREDENTIAL_DOCUMENT_BUCKET)
    .createSignedUploadUrl(path);
  if (ticket.error) throw ticket.error;
  const uploaded = await owner.client.storage
    .from(CREDENTIAL_DOCUMENT_BUCKET)
    .uploadToSignedUrl(ticket.data.path, ticket.data.token, PDF_BYTES, {
      contentType: "application/pdf",
    });
  if (uploaded.error) throw uploaded.error;
  const completed = await owner.client.rpc("complete_credential_document_upload", {
    p_document_id: documentId,
    p_sha256: "a".repeat(64),
    p_content_valid: true,
  });
  if (completed.error) throw completed.error;
  return { documentId, path };
}

/** The malware scanner (operator role) clears a document. */
async function scanClean(documentId: string) {
  await ownerQuery(
    (sql) => sql`select internal.record_document_scan_result(${documentId}::uuid, 'clean')`,
  );
}

describe("credentials & compliance (P0-E4-S1)", () => {
  let admin: TestIdentity;
  let officer: TestIdentity;
  let betaAdmin: TestIdentity;
  let worker: TestIdentity;
  let alphaId: string;
  let betaId: string;
  let alphaWorkerId: string;
  let betaWorkerId: string;
  let credentialId: string;
  let versionId: string;
  let document: { documentId: string; path: string };

  beforeAll(async () => {
    [admin, betaAdmin] = await Promise.all([
      signUpVerified("cred-admin"),
      signUpVerified("cred-beta"),
    ]);
    [alphaId, betaId] = await Promise.all([
      createAgency(admin, "Alpha Care Staffing"),
      createAgency(betaAdmin, "Beta Care Staffing"),
    ]);
    await Promise.all([stepUpToAal2(admin), stepUpToAal2(betaAdmin)]);

    officer = await inviteAndAccept(
      admin.client,
      alphaId,
      "agency.credentialing_officer",
      uniqueEmail("officer"),
    );
    await stepUpToAal2(officer);
    worker = await inviteAndAccept(
      admin.client,
      alphaId,
      "agency.healthcare_worker",
      uniqueEmail("cred-worker"),
    );
    await inviteAndAccept(betaAdmin.client, betaId, "agency.healthcare_worker", worker);

    const workers = await worker.client.from("agency_workers").select("id, agency_organisation_id");
    alphaWorkerId = workers.data?.find((row) => row.agency_organisation_id === alphaId)?.id ?? "";
    betaWorkerId = workers.data?.find((row) => row.agency_organisation_id === betaId)?.id ?? "";
    for (const [client, id] of [
      [admin.client, alphaWorkerId],
      [betaAdmin.client, betaWorkerId],
    ] as const) {
      const activated = await client.rpc("set_agency_worker_status", {
        p_worker_id: id,
        p_status: "active",
      });
      if (activated.error) throw activated.error;
    }

    const requirement = await admin.client.rpc("create_credential_requirement", {
      p_agency_organisation_id: alphaId,
      p_credential_type_key: "bls_certification",
    });
    if (requirement.error) throw requirement.error;
    const betaRequirement = await betaAdmin.client.rpc("create_credential_requirement", {
      p_agency_organisation_id: betaId,
      p_credential_type_key: "bls_certification",
    });
    if (betaRequirement.error) throw betaRequirement.error;

    const created = await worker.client.rpc("create_credential", {
      p_credential_type_key: "bls_certification",
      p_issuing_authority: "American Heart Association",
      p_issue_date: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
      p_expiry_date: new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10),
    });
    if (created.error) throw created.error;
    credentialId = created.data[0]?.credential_id ?? "";
    versionId = created.data[0]?.credential_version_id ?? "";
  });

  it("a person-owned credential is invisible to agencies until shared", async () => {
    const before = await officer.client.from("credentials").select("id").eq("id", credentialId);
    expect(before.data).toEqual([]);
    const readiness = await admin.client.rpc("evaluate_worker_compliance", {
      p_agency_worker_id: alphaWorkerId,
    });
    expect(readiness.data?.map((row) => row.reason)).toEqual(["CREDENTIAL_NOT_SHARED"]);

    const shared = await worker.client.rpc("share_credential", {
      p_credential_id: credentialId,
      p_agency_organisation_id: alphaId,
    });
    expect(shared.error).toBeNull();
    const after = await officer.client.from("credentials").select("id").eq("id", credentialId);
    expect(after.data).toHaveLength(1);
  });

  it("uploads go to private storage via a signed upload URL and are untrusted until scanned", async () => {
    document = await uploadDocument(worker, versionId);
    const { data } = await worker.client
      .from("credential_documents")
      .select("status")
      .eq("id", document.documentId)
      .single();
    expect(data?.status).toBe("scanning");

    const publicUrl = worker.client.storage
      .from(CREDENTIAL_DOCUMENT_BUCKET)
      .getPublicUrl(document.path).data.publicUrl;
    expect((await fetch(publicUrl)).ok).toBe(false);

    const reviewerBeforeScan = await officer.client.storage
      .from(CREDENTIAL_DOCUMENT_BUCKET)
      .createSignedUrl(document.path, 60);
    expect(reviewerBeforeScan.error).not.toBeNull();

    await scanClean(document.documentId);
    const submitted = await worker.client.rpc("submit_credential_version", {
      p_credential_version_id: versionId,
    });
    expect(submitted.error).toBeNull();
  });

  it("Storage issues signed URLs only to authorised reviewers, and they expire", async () => {
    const gate = await officer.client.rpc("authorize_credential_document_access", {
      p_document_id: document.documentId,
      p_organisation_id: alphaId,
    });
    expect(gate.data?.[0]?.object_path).toBe(document.path);

    const signed = await officer.client.storage
      .from(CREDENTIAL_DOCUMENT_BUCKET)
      .createSignedUrl(document.path, 2);
    expect(signed.error).toBeNull();
    const fetched = await fetch(signed.data?.signedUrl ?? "");
    expect(fetched.ok).toBe(true);
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(PDF_BYTES);

    await new Promise((resolve) => setTimeout(resolve, 3_500));
    expect((await fetch(signed.data?.signedUrl ?? "")).ok).toBe(false);

    const outsider = await betaAdmin.client.storage
      .from(CREDENTIAL_DOCUMENT_BUCKET)
      .createSignedUrl(document.path, 60);
    expect(outsider.error).not.toBeNull();
  });

  it("verification by Agency A makes the worker ready at A, but not at B", async () => {
    const verified = await officer.client.rpc("record_credential_verification", {
      p_credential_version_id: versionId,
      p_agency_organisation_id: alphaId,
      p_outcome: "verified",
    });
    expect(verified.error).toBeNull();
    const alpha = await admin.client.rpc("worker_readiness", { p_agency_worker_id: alphaWorkerId });
    expect(alpha.data?.[0]?.readiness).toBe("ready");

    await worker.client.rpc("share_credential", {
      p_credential_id: credentialId,
      p_agency_organisation_id: betaId,
    });
    const beta = await betaAdmin.client.rpc("evaluate_worker_compliance", {
      p_agency_worker_id: betaWorkerId,
    });
    expect(beta.data?.map((row) => row.reason)).toEqual(["UNVERIFIED_CREDENTIAL"]);
    const betaSeesAlphaDecision = await betaAdmin.client
      .from("credential_verifications")
      .select("id");
    expect(betaSeesAlphaDecision.data).toEqual([]);
  });

  it("expiry is evaluated by date; renewal keeps history and needs its own verification", async () => {
    const future = new Date(Date.now() + 420 * 86_400_000).toISOString().slice(0, 10);
    const expired = await admin.client.rpc("evaluate_worker_compliance", {
      p_agency_worker_id: alphaWorkerId,
      p_as_of: future,
    });
    expect(expired.data?.map((row) => row.reason)).toEqual(["EXPIRED_CREDENTIAL"]);

    const renewal = await worker.client.rpc("create_credential_version", {
      p_credential_id: credentialId,
      p_issue_date: new Date().toISOString().slice(0, 10),
      p_expiry_date: new Date(Date.now() + 800 * 86_400_000).toISOString().slice(0, 10),
    });
    expect(renewal.error).toBeNull();
    const renewedDocument = await uploadDocument(worker, renewal.data ?? "");
    await scanClean(renewedDocument.documentId);
    await worker.client.rpc("submit_credential_version", {
      p_credential_version_id: renewal.data ?? "",
    });

    const versions = await worker.client
      .from("credential_versions")
      .select("version_number")
      .eq("credential_id", credentialId);
    expect(versions.data?.map((row) => row.version_number).sort()).toEqual([1, 2]);

    const stillPending = await admin.client.rpc("evaluate_worker_compliance", {
      p_agency_worker_id: alphaWorkerId,
      p_as_of: future,
    });
    expect(stillPending.data?.map((row) => row.reason)).toEqual(["UNVERIFIED_CREDENTIAL"]);
  });

  it("a facility requirement makes facility readiness differ from agency readiness", async () => {
    const facility = await admin.client.rpc("create_agency_facility", {
      p_agency_organisation_id: alphaId,
      p_name: "Mercy Rehab",
      p_facility_type: "rehabilitation",
      p_timezone: "America/New_York",
    });
    if (facility.error) throw facility.error;
    const requirement = await admin.client.rpc("create_credential_requirement", {
      p_agency_organisation_id: alphaId,
      p_credential_type_key: "facility_orientation",
      p_agency_facility_id: facility.data,
    });
    expect(requirement.error).toBeNull();

    const agency = await admin.client.rpc("worker_readiness", {
      p_agency_worker_id: alphaWorkerId,
    });
    const atMercy = await admin.client.rpc("evaluate_worker_compliance", {
      p_agency_worker_id: alphaWorkerId,
      p_agency_facility_id: facility.data,
    });
    expect(agency.data?.[0]?.readiness).toBe("ready");
    expect(atMercy.data?.find((row) => row.requirement_scope === "facility")?.reason).toBe(
      "MISSING_CREDENTIAL",
    );
  });

  it("revoking the share removes agency access in both the table and Storage", async () => {
    const shares = await worker.client
      .from("credential_shares")
      .select("id")
      .eq("agency_organisation_id", alphaId)
      .eq("status", "active");
    const revoked = await worker.client.rpc("revoke_credential_share", {
      p_share_id: shares.data?.[0]?.id ?? "",
    });
    expect(revoked.error).toBeNull();

    const table = await officer.client.from("credentials").select("id").eq("id", credentialId);
    const storage = await officer.client.storage
      .from(CREDENTIAL_DOCUMENT_BUCKET)
      .createSignedUrl(document.path, 60);
    expect(table.data).toEqual([]);
    expect(storage.error).not.toBeNull();
  });
});
