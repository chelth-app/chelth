import "server-only";

import type {
  ComplianceReason,
  ComplianceSeverity,
  ReadinessStatus,
  RequirementStatus,
} from "@/lib/domain/credentials";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/* The database derives compliance; nothing here computes eligibility. */

export type ComplianceItem = {
  requirementId: string | null;
  scope: string;
  credentialTypeKey: string | null;
  credentialTypeName: string | null;
  reason: ComplianceReason;
  severity: ComplianceSeverity;
  effectiveExpiryDate: string | null;
};

export type Readiness = {
  status: ReadinessStatus;
  blocking: number;
  warnings: number;
  items: ComplianceItem[];
};

export async function getReadiness(workerId: string, facilityId?: string): Promise<Readiness> {
  const supabase = await createSupabaseServerClient();
  const args = {
    p_agency_worker_id: workerId,
    ...(facilityId ? { p_agency_facility_id: facilityId } : {}),
  };
  const [summary, items] = await Promise.all([
    supabase.rpc("worker_readiness", args),
    supabase.rpc("evaluate_worker_compliance", args),
  ]);
  if (summary.error) throw summary.error;
  if (items.error) throw items.error;
  const row = summary.data[0];
  return {
    status: row?.readiness ?? "not_eligible",
    blocking: row?.blocking_count ?? 0,
    warnings: row?.warning_count ?? 0,
    items: items.data.map((item) => ({
      requirementId: item.requirement_id,
      scope: item.requirement_scope,
      credentialTypeKey: item.credential_type_key,
      credentialTypeName: item.credential_type_name,
      reason: item.reason,
      severity: item.severity,
      effectiveExpiryDate: item.effective_expiry_date,
    })),
  };
}

export type Requirement = {
  id: string;
  facilityId: string | null;
  credentialTypeKey: string;
  disciplineKey: string | null;
  mustBeVerified: boolean;
  minimumValidityDays: number;
  expiryWarningDays: number;
  jurisdictionCode: string | null;
  status: RequirementStatus;
};

/** Baseline (facilityId omitted) or one facility's requirements. */
export async function listRequirements(
  organisationId: string,
  facilityId?: string,
): Promise<Requirement[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("credential_requirements")
    .select(
      "id, agency_facility_id, credential_type_key, discipline_key, must_be_verified, minimum_validity_days, expiry_warning_days, jurisdiction_code, status",
    )
    .eq("agency_organisation_id", organisationId)
    .order("status")
    .order("credential_type_key");
  query = facilityId
    ? query.eq("agency_facility_id", facilityId)
    : query.is("agency_facility_id", null);
  const { data, error } = await query;
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    facilityId: row.agency_facility_id,
    credentialTypeKey: row.credential_type_key,
    disciplineKey: row.discipline_key,
    mustBeVerified: row.must_be_verified,
    minimumValidityDays: row.minimum_validity_days,
    expiryWarningDays: row.expiry_warning_days,
    jurisdictionCode: row.jurisdiction_code,
    status: row.status,
  }));
}

export async function listWorkerDisciplines(workerId: string): Promise<string[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agency_worker_disciplines")
    .select("discipline_key")
    .eq("agency_worker_id", workerId);
  if (error) throw error;
  return data.map((row) => row.discipline_key);
}

export type ComplianceShare = { id: string; relationshipId: string; sharedAt: string };

export async function listComplianceShares(workerId: string): Promise<ComplianceShare[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("relationship_worker_compliance_shares")
    .select("id, relationship_id, shared_at")
    .eq("agency_worker_id", workerId)
    .eq("status", "active");
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    relationshipId: row.relationship_id,
    sharedAt: row.shared_at,
  }));
}

export type SharedWorkerCompliance = {
  workerId: string;
  workerName: string | null;
  readiness: ReadinessStatus;
  items: {
    credentialTypeName: string;
    reason: ComplianceReason;
    severity: ComplianceSeverity;
    effectiveExpiryDate: string | null;
  }[];
};

/** Facility side: the narrow, audited projection for one relationship. */
export async function listSharedWorkerCompliance(
  relationshipId: string,
): Promise<SharedWorkerCompliance[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_shared_worker_compliance", {
    p_relationship_id: relationshipId,
  });
  if (error) throw error;
  const byWorker = new Map<string, SharedWorkerCompliance>();
  for (const row of data) {
    const entry = byWorker.get(row.agency_worker_id) ?? {
      workerId: row.agency_worker_id,
      workerName: row.worker_display_name,
      readiness: row.readiness,
      items: [],
    };
    entry.items.push({
      credentialTypeName: row.credential_type_name,
      reason: row.reason,
      severity: row.severity,
      effectiveExpiryDate: row.effective_expiry_date,
    });
    byWorker.set(row.agency_worker_id, entry);
  }
  return [...byWorker.values()];
}
