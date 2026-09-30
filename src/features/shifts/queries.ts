import "server-only";

import type { ComplianceReason, ReadinessStatus } from "@/lib/domain/credentials";
import {
  type AssignmentBlockReason,
  type AssignmentCancellationReason,
  type AssignmentDecisionOutcome,
  type AssignmentStatus,
  type FillState,
  isFillState,
  type ShiftCancellationReason,
  type ShiftSource,
  type ShiftStatus,
} from "@/lib/domain/shifts";
import type { RelationshipStatus, WorkerStatus } from "@/lib/domain/vocabulary";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Constants, type Json } from "@/types/database.types";

import type { ShiftFilters } from "./schemas";

/* All reads run as the signed-in user; RLS and the projections decide visibility. */

function fillState(value: string): FillState {
  return isFillState(value) ? value : "unfilled";
}

export type ComplianceFinding = {
  scope: string;
  credentialTypeKey: string | null;
  reason: ComplianceReason;
  severity: string;
  evaluationDate: string;
  effectiveExpiryDate: string | null;
};

function isRecord(value: Json): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: Json | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function complianceReason(value: Json | undefined): ComplianceReason | undefined {
  return Constants.public.Enums.compliance_reason.find((reason) => reason === value);
}

/** Findings are produced by the database; parse defensively. */
export function parseFindings(value: Json): ComplianceFinding[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((item) => {
    const reason = complianceReason(item.reason);
    return reason
      ? [
          {
            scope: text(item.scope) ?? "agency",
            credentialTypeKey: text(item.credential_type_key),
            reason,
            severity: text(item.severity) ?? "blocking",
            evaluationDate: text(item.evaluation_date) ?? "",
            effectiveExpiryDate: text(item.effective_expiry_date),
          },
        ]
      : [];
  });
}

// -----------------------------------------------------------------------------
// Agency
// -----------------------------------------------------------------------------
export type AgencyShiftSummary = {
  id: string;
  facilityId: string;
  facilityName: string;
  locationName: string;
  disciplineKey: string;
  disciplineName: string;
  startAt: string;
  endAt: string;
  timezone: string;
  requestedHeadcount: number;
  activeCount: number;
  acceptedCount: number;
  fillState: FillState;
  status: ShiftStatus;
  source: ShiftSource;
  relationshipStatus: RelationshipStatus;
  externalReference: string | null;
};

export async function listAgencyShifts(
  organisationId: string,
  filters: ShiftFilters = {},
): Promise<AgencyShiftSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_agency_shifts", {
    p_organisation_id: organisationId,
    ...(filters.status ? { p_status: filters.status } : {}),
    ...(filters.facilityId ? { p_agency_facility_id: filters.facilityId } : {}),
    ...(filters.from ? { p_from: filters.from } : {}),
    ...(filters.to ? { p_to: filters.to } : {}),
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.shift_id,
    facilityId: row.agency_facility_id,
    facilityName: row.facility_name,
    locationName: row.location_name,
    disciplineKey: row.discipline_key,
    disciplineName: row.discipline_name,
    startAt: row.start_at,
    endAt: row.end_at,
    timezone: row.timezone,
    requestedHeadcount: row.requested_headcount,
    activeCount: row.active_count,
    acceptedCount: row.accepted_count,
    fillState: fillState(row.fill_state),
    status: row.status,
    source: row.source,
    relationshipStatus: row.relationship_status,
    externalReference: row.external_reference,
  }));
}

export type AgencyShiftDetail = {
  id: string;
  facilityId: string;
  facilityName: string;
  locationId: string;
  locationName: string;
  disciplineKey: string;
  disciplineName: string;
  startAt: string;
  endAt: string;
  timezone: string;
  requestedHeadcount: number;
  status: ShiftStatus;
  source: ShiftSource;
  relationshipStatus: RelationshipStatus;
  externalReference: string | null;
  instructions: string | null;
  cancellationReason: ShiftCancellationReason | null;
};

export async function getAgencyShift(
  organisationId: string,
  shiftId: string,
): Promise<AgencyShiftDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data: shift, error } = await supabase
    .from("shifts")
    .select(
      "id, agency_facility_id, facility_location_id, relationship_id, discipline_key, start_at, end_at, timezone, requested_headcount, status, source, external_reference, instructions, cancellation_reason",
    )
    .eq("agency_organisation_id", organisationId)
    .eq("id", shiftId)
    .maybeSingle();
  if (error) throw error;
  if (!shift) return null;

  const [facility, location, discipline, relationship] = await Promise.all([
    supabase
      .from("agency_facilities")
      .select("name")
      .eq("id", shift.agency_facility_id)
      .maybeSingle(),
    supabase
      .from("facility_locations")
      .select("name")
      .eq("id", shift.facility_location_id)
      .maybeSingle(),
    supabase.from("disciplines").select("name").eq("key", shift.discipline_key).maybeSingle(),
    supabase
      .from("agency_facility_relationships")
      .select("status")
      .eq("id", shift.relationship_id)
      .maybeSingle(),
  ]);
  return {
    id: shift.id,
    facilityId: shift.agency_facility_id,
    facilityName: facility.data?.name ?? "Facility",
    locationId: shift.facility_location_id,
    locationName: location.data?.name ?? "Location",
    disciplineKey: shift.discipline_key,
    disciplineName: discipline.data?.name ?? shift.discipline_key,
    startAt: shift.start_at,
    endAt: shift.end_at,
    timezone: shift.timezone,
    requestedHeadcount: shift.requested_headcount,
    status: shift.status,
    source: shift.source,
    relationshipStatus: relationship.data?.status ?? "ended",
    externalReference: shift.external_reference,
    instructions: shift.instructions,
    cancellationReason: shift.cancellation_reason,
  };
}

export type ShiftAssignment = {
  id: string;
  workerId: string;
  workerName: string;
  status: AssignmentStatus;
  assignedAt: string;
  acceptedAt: string | null;
  declinedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: AssignmentCancellationReason | null;
};

export async function listShiftAssignments(shiftId: string): Promise<ShiftAssignment[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("shift_assignments")
    .select(
      "id, agency_worker_id, status, assigned_at, accepted_at, declined_at, cancelled_at, cancellation_reason",
    )
    .eq("shift_id", shiftId)
    .order("assigned_at");
  if (error) throw error;
  const workerIds = [...new Set(data.map((row) => row.agency_worker_id))];
  const names = new Map<string, string>();
  if (workerIds.length > 0) {
    const { data: workers, error: workerError } = await supabase
      .from("agency_workers")
      .select("id, profile:profiles(display_name)")
      .in("id", workerIds);
    if (workerError) throw workerError;
    for (const worker of workers) names.set(worker.id, worker.profile?.display_name ?? "Worker");
  }
  return data.map((row) => ({
    id: row.id,
    workerId: row.agency_worker_id,
    workerName: names.get(row.agency_worker_id) ?? "Worker",
    status: row.status,
    assignedAt: row.assigned_at,
    acceptedAt: row.accepted_at,
    declinedAt: row.declined_at,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
  }));
}

export type AssignmentReadiness = {
  assignmentId: string;
  eligible: boolean;
  relationshipActive: boolean;
  readiness: ReadinessStatus;
  blockReasons: AssignmentBlockReason[];
  findings: ComplianceFinding[];
};

/** Live re-evaluation of the shift's active assignments. */
export async function listAssignmentReadiness(
  organisationId: string,
  shiftId: string,
): Promise<AssignmentReadiness[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_assignment_readiness", {
    p_organisation_id: organisationId,
    p_shift_id: shiftId,
  });
  if (error) throw error;
  return data.map((row) => ({
    assignmentId: row.assignment_id,
    eligible: row.eligible,
    relationshipActive: row.relationship_active,
    readiness: row.readiness,
    blockReasons: row.block_reasons,
    findings: parseFindings(row.compliance_findings),
  }));
}

export type ShiftCandidate = {
  workerId: string;
  displayName: string | null;
  workerStatus: WorkerStatus;
  assignable: boolean;
  primaryReason: AssignmentBlockReason | null;
  blockReasons: AssignmentBlockReason[];
  readiness: ReadinessStatus;
  findings: ComplianceFinding[];
};

/** Every non-assigned worker with eligibility flags. No ranking. */
export async function listShiftCandidates(shiftId: string): Promise<ShiftCandidate[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_shift_candidates", { p_shift_id: shiftId });
  if (error) throw error;
  return data.map((row) => ({
    workerId: row.agency_worker_id,
    displayName: row.display_name,
    workerStatus: row.worker_status,
    assignable: row.assignable,
    primaryReason: row.primary_reason,
    blockReasons: row.block_reasons,
    readiness: row.readiness,
    findings: parseFindings(row.compliance_findings),
  }));
}

export type AssignmentDecision = {
  id: string;
  workerId: string;
  outcome: AssignmentDecisionOutcome;
  blockReasons: AssignmentBlockReason[];
  complianceReasons: ComplianceReason[];
  evaluationDates: string[];
  decidedAt: string;
};

export async function listShiftDecisions(shiftId: string): Promise<AssignmentDecision[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("assignment_eligibility_decisions")
    .select(
      "id, agency_worker_id, outcome, block_reasons, compliance_reasons, evaluation_dates, decided_at",
    )
    .eq("shift_id", shiftId)
    .order("sequence", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    workerId: row.agency_worker_id,
    outcome: row.outcome,
    blockReasons: row.block_reasons,
    complianceReasons: row.compliance_reasons,
    evaluationDates: row.evaluation_dates,
    decidedAt: row.decided_at,
  }));
}

export type ShiftNote = { id: string; body: string; createdAt: string };

export async function listShiftNotes(shiftId: string): Promise<ShiftNote[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("shift_internal_notes")
    .select("id, body, created_at")
    .eq("shift_id", shiftId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map((row) => ({ id: row.id, body: row.body, createdAt: row.created_at }));
}

export type SchedulableLocation = {
  facilityId: string;
  facilityName: string;
  locationId: string;
  locationName: string;
  timezone: string;
};

/** Active locations of active facilities with an ACTIVE relationship (UI hint; the RPC re-checks). */
export async function listSchedulableLocations(
  organisationId: string,
): Promise<SchedulableLocation[]> {
  const supabase = await createSupabaseServerClient();
  const [relationships, facilities] = await Promise.all([
    supabase
      .from("agency_facility_relationships")
      .select("agency_facility_id")
      .eq("agency_organisation_id", organisationId)
      .eq("status", "active"),
    supabase
      .from("agency_facilities")
      .select("id, name")
      .eq("agency_organisation_id", organisationId)
      .eq("status", "active")
      .order("name"),
  ]);
  if (relationships.error) throw relationships.error;
  if (facilities.error) throw facilities.error;
  const related = new Set(relationships.data.map((row) => row.agency_facility_id));
  const eligible = facilities.data.filter((facility) => related.has(facility.id));
  if (eligible.length === 0) return [];
  const { data: locations, error } = await supabase
    .from("facility_locations")
    .select("id, name, timezone, agency_facility_id")
    .in(
      "agency_facility_id",
      eligible.map((facility) => facility.id),
    )
    .eq("status", "active")
    .order("name");
  if (error) throw error;
  const facilityName = new Map(eligible.map((facility) => [facility.id, facility.name]));
  return locations
    .map((location) => ({
      facilityId: location.agency_facility_id,
      facilityName: facilityName.get(location.agency_facility_id) ?? "Facility",
      locationId: location.id,
      locationName: location.name,
      timezone: location.timezone,
    }))
    .sort((a, b) =>
      `${a.facilityName} ${a.locationName}`.localeCompare(`${b.facilityName} ${b.locationName}`),
    );
}

export async function listFacilityFilterOptions(
  organisationId: string,
): Promise<{ id: string; name: string }[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agency_facilities")
    .select("id, name")
    .eq("agency_organisation_id", organisationId)
    .order("name");
  if (error) throw error;
  return data;
}

export async function listCredentialTypeNames(): Promise<Map<string, string>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("credential_types").select("key, name");
  if (error) throw error;
  return new Map(data.map((row) => [row.key, row.name]));
}

// -----------------------------------------------------------------------------
// Facility (narrow projections only)
// -----------------------------------------------------------------------------
export type FacilityShift = {
  id: string;
  relationshipId: string;
  agencyName: string;
  locationName: string;
  disciplineName: string;
  startAt: string;
  endAt: string;
  timezone: string;
  requestedHeadcount: number;
  activeCount: number;
  acceptedCount: number;
  fillState: FillState;
  status: ShiftStatus;
  source: ShiftSource;
  instructions: string | null;
  externalReference: string | null;
  cancellationReason: ShiftCancellationReason | null;
  relationshipStatus: RelationshipStatus;
};

export async function listFacilityShifts(
  facilityOrganisationId: string,
  shiftId?: string,
): Promise<FacilityShift[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_facility_shifts", {
    p_facility_organisation_id: facilityOrganisationId,
    ...(shiftId ? { p_shift_id: shiftId } : {}),
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.shift_id,
    relationshipId: row.relationship_id,
    agencyName: row.agency_name,
    locationName: row.location_name,
    disciplineName: row.discipline_name,
    startAt: row.start_at,
    endAt: row.end_at,
    timezone: row.timezone,
    requestedHeadcount: row.requested_headcount,
    activeCount: row.active_count,
    acceptedCount: row.accepted_count,
    fillState: fillState(row.fill_state),
    status: row.status,
    source: row.source,
    instructions: row.instructions,
    externalReference: row.external_reference,
    cancellationReason: row.cancellation_reason,
    relationshipStatus: row.relationship_status,
  }));
}

export type FacilityAssignedWorker = {
  assignmentId: string;
  displayName: string | null;
  disciplineName: string;
  status: AssignmentStatus;
  readiness: ReadinessStatus;
};

export async function listFacilityShiftAssignments(
  shiftId: string,
): Promise<FacilityAssignedWorker[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_facility_shift_assignments", {
    p_shift_id: shiftId,
  });
  if (error) throw error;
  return data.map((row) => ({
    assignmentId: row.assignment_id,
    displayName: row.worker_display_name,
    disciplineName: row.discipline_name,
    status: row.status,
    readiness: row.readiness,
  }));
}

export type RequestLocation = { locationId: string; name: string; timezone: string };

export async function listRequestLocations(relationshipId: string): Promise<RequestLocation[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_facility_request_options", {
    p_relationship_id: relationshipId,
  });
  if (error) throw error;
  return data.map((row) => ({
    locationId: row.facility_location_id,
    name: row.location_name,
    timezone: row.timezone,
  }));
}

// -----------------------------------------------------------------------------
// Worker (own assignments only)
// -----------------------------------------------------------------------------
export type MyShiftAssignment = {
  id: string;
  shiftId: string;
  facilityName: string;
  locationName: string;
  disciplineName: string;
  startAt: string;
  endAt: string;
  timezone: string;
  status: AssignmentStatus;
  shiftStatus: ShiftStatus;
  instructions: string | null;
  cancellationReason: AssignmentCancellationReason | null;
  canRespond: boolean;
};

export async function listMyShiftAssignments(organisationId: string): Promise<MyShiftAssignment[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_my_shift_assignments", {
    p_organisation_id: organisationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.assignment_id,
    shiftId: row.shift_id,
    facilityName: row.facility_name,
    locationName: row.location_name,
    disciplineName: row.discipline_name,
    startAt: row.start_at,
    endAt: row.end_at,
    timezone: row.timezone,
    status: row.status,
    shiftStatus: row.shift_status,
    instructions: row.instructions,
    cancellationReason: row.cancellation_reason,
    canRespond: row.can_respond,
  }));
}
