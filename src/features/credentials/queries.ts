import "server-only";

import { requireAuthIdentity } from "@/lib/auth/session";
import type {
  CredentialStatus,
  CredentialVersionStatus,
  DocumentStatus,
  RejectionReason,
  VerificationOutcome,
} from "@/lib/domain/credentials";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/* All reads run as the signed-in user; RLS decides visibility. */

export type CredentialTypeOption = {
  key: string;
  name: string;
  scope: "person" | "facility";
  jurisdictionRule: "none" | "country" | "subdivision";
  requiresIssueDate: boolean;
  requiresExpiryDate: boolean;
  requiresCredentialNumber: boolean;
  requiresDocument: boolean;
};

export async function listCredentialTypes(): Promise<CredentialTypeOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("credential_types")
    .select(
      "key, name, scope, jurisdiction_rule, requires_issue_date, requires_expiry_date, requires_credential_number, requires_document",
    )
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  return data.map((row) => ({
    key: row.key,
    name: row.name,
    scope: row.scope,
    jurisdictionRule: row.jurisdiction_rule,
    requiresIssueDate: row.requires_issue_date,
    requiresExpiryDate: row.requires_expiry_date,
    requiresCredentialNumber: row.requires_credential_number,
    requiresDocument: row.requires_document,
  }));
}

export type JurisdictionOption = { code: string; name: string; level: "country" | "subdivision" };

export async function listJurisdictions(): Promise<JurisdictionOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("jurisdictions")
    .select("code, name, level")
    .eq("is_active", true)
    .order("code");
  if (error) throw error;
  return data;
}

export type DisciplineOption = { key: string; name: string };

export async function listDisciplines(): Promise<DisciplineOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("disciplines")
    .select("key, name")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  return data;
}

// -----------------------------------------------------------------------------
// Worker self-service
// -----------------------------------------------------------------------------

export type MyCredentialSummary = {
  id: string;
  typeKey: string;
  typeName: string;
  jurisdictionCode: string | null;
  status: CredentialStatus;
  latestVersion: {
    number: number;
    status: CredentialVersionStatus;
    expiryDate: string | null;
  } | null;
  sharedWithAgency: boolean;
};

export async function listMyCredentials(
  agencyOrganisationId: string,
): Promise<MyCredentialSummary[]> {
  const identity = await requireAuthIdentity();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("credentials")
    .select(
      "id, credential_type_key, jurisdiction_code, status, created_at, type:credential_types(name, sort_order), versions:credential_versions(version_number, status, expiry_date), shares:credential_shares(agency_organisation_id, status)",
    )
    .eq("profile_id", identity.userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data.map((row) => {
    const latest = [...row.versions].sort((a, b) => b.version_number - a.version_number)[0];
    return {
      id: row.id,
      typeKey: row.credential_type_key,
      typeName: row.type?.name ?? row.credential_type_key,
      jurisdictionCode: row.jurisdiction_code,
      status: row.status,
      latestVersion: latest
        ? { number: latest.version_number, status: latest.status, expiryDate: latest.expiry_date }
        : null,
      sharedWithAgency: row.shares.some(
        (share) =>
          share.agency_organisation_id === agencyOrganisationId && share.status === "active",
      ),
    };
  });
}

export type CredentialDocument = {
  id: string;
  mimeType: string;
  status: DocumentStatus;
  /** The security check could not be finished (still untrusted; operator retry pending). */
  scanFailed: boolean;
  createdAt: string;
};

export type CredentialVersion = {
  id: string;
  number: number;
  status: CredentialVersionStatus;
  issueDate: string | null;
  expiryDate: string | null;
  submittedAt: string | null;
  documents: CredentialDocument[];
};

export type CredentialVerification = {
  id: string;
  versionId: string;
  agencyOrganisationId: string;
  agencyFacilityId: string | null;
  outcome: VerificationOutcome;
  rejectionReason: RejectionReason | null;
  createdAt: string;
};

export type CredentialShare = {
  id: string;
  agencyOrganisationId: string;
  status: "active" | "revoked";
  sharedAt: string;
};

export type CredentialDetail = {
  id: string;
  profileId: string;
  typeKey: string;
  typeName: string;
  scope: "person" | "facility";
  requiresDocument: boolean;
  requiresIssueDate: boolean;
  requiresExpiryDate: boolean;
  jurisdictionCode: string | null;
  issuingAuthority: string | null;
  status: CredentialStatus;
  /** Only present when RLS allows it (owner, or reviewer at AAL2). */
  credentialNumber: string | null;
  versions: CredentialVersion[];
  verifications: CredentialVerification[];
  shares: CredentialShare[];
};

/** A credential as the caller may see it (owner or authorised agency), or null. */
export async function getCredential(credentialId: string): Promise<CredentialDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("credentials")
    .select(
      "id, profile_id, credential_type_key, jurisdiction_code, issuing_authority, status, type:credential_types(name, scope, requires_document, requires_issue_date, requires_expiry_date), versions:credential_versions(id, version_number, status, issue_date, expiry_date, submitted_at, documents:credential_documents(id, mime_type, status, status_reason, created_at)), shares:credential_shares(id, agency_organisation_id, status, shared_at)",
    )
    .eq("id", credentialId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  // Separate reads: numbers live in a restricted table, and verification events
  // are keyed by version (no direct credential FK). RLS applies to each.
  const [identifier, verifications] = await Promise.all([
    supabase
      .from("credential_identifiers")
      .select("credential_number")
      .eq("credential_id", credentialId)
      .maybeSingle(),
    supabase
      .from("credential_verifications")
      .select(
        "id, credential_version_id, agency_organisation_id, agency_facility_id, outcome, rejection_reason, created_at",
      )
      .eq("credential_id", credentialId)
      .order("sequence", { ascending: false }),
  ]);
  if (identifier.error) throw identifier.error;
  if (verifications.error) throw verifications.error;

  return {
    id: data.id,
    profileId: data.profile_id,
    typeKey: data.credential_type_key,
    typeName: data.type?.name ?? data.credential_type_key,
    scope: data.type?.scope ?? "person",
    requiresDocument: data.type?.requires_document ?? true,
    requiresIssueDate: data.type?.requires_issue_date ?? false,
    requiresExpiryDate: data.type?.requires_expiry_date ?? false,
    jurisdictionCode: data.jurisdiction_code,
    issuingAuthority: data.issuing_authority,
    status: data.status,
    credentialNumber: identifier.data?.credential_number ?? null,
    versions: [...data.versions]
      .sort((a, b) => b.version_number - a.version_number)
      .map((version) => ({
        id: version.id,
        number: version.version_number,
        status: version.status,
        issueDate: version.issue_date,
        expiryDate: version.expiry_date,
        submittedAt: version.submitted_at,
        documents: version.documents.map((document) => ({
          id: document.id,
          mimeType: document.mime_type,
          status: document.status,
          scanFailed: document.status === "scanning" && document.status_reason === "scan_failed",
          createdAt: document.created_at,
        })),
      })),
    verifications: verifications.data.map((verification) => ({
      id: verification.id,
      versionId: verification.credential_version_id,
      agencyOrganisationId: verification.agency_organisation_id,
      agencyFacilityId: verification.agency_facility_id,
      outcome: verification.outcome,
      rejectionReason: verification.rejection_reason,
      createdAt: verification.created_at,
    })),
    shares: data.shares.map((share) => ({
      id: share.id,
      agencyOrganisationId: share.agency_organisation_id,
      status: share.status,
      sharedAt: share.shared_at,
    })),
  };
}

// -----------------------------------------------------------------------------
// Agency view
// -----------------------------------------------------------------------------

export type AgencyWorkerCredential = {
  credentialId: string;
  typeName: string;
  jurisdictionCode: string | null;
  latestVersionNumber: number | null;
  latestVersionStatus: CredentialVersionStatus | null;
  effectiveExpiryDate: string | null;
  documentsCleared: boolean;
  agencyVerification: VerificationOutcome | null;
};

export async function listAgencyWorkerCredentials(
  workerId: string,
): Promise<AgencyWorkerCredential[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_agency_worker_credentials", {
    p_agency_worker_id: workerId,
  });
  if (error) throw error;
  return data.map((row) => ({
    credentialId: row.credential_id,
    typeName: row.credential_type_name,
    jurisdictionCode: row.jurisdiction_code,
    latestVersionNumber: row.latest_version_number,
    latestVersionStatus: row.latest_version_status,
    effectiveExpiryDate: row.effective_expiry_date,
    documentsCleared: row.documents_cleared,
    agencyVerification: row.agency_verification,
  }));
}
