import "server-only";

import type { GeofenceResult } from "@/lib/domain/attendance";
import type {
  TimesheetDisputeReason,
  TimesheetFacilityState,
  TimesheetHistoryAction,
  TimesheetRejectionReason,
  TimesheetStatus,
} from "@/lib/domain/timesheets";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";

/* Reads run as the signed-in user; the projections decide what each audience sees. */

export type TimesheetBreak = {
  segment: number | null;
  startAt: string | null;
  endAt: string | null;
};

function breaks(value: Json): TimesheetBreak[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const text = (key: string) => {
      const raw = item[key];
      return typeof raw === "string" ? raw : null;
    };
    const segment = typeof item.segment === "number" ? item.segment : null;
    return [{ segment, startAt: text("start_at"), endAt: text("end_at") }];
  });
}

export type MyTimesheetRow = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: TimesheetStatus;
  revision: number;
  entryCount: number;
  totalWorkedMinutes: number;
  incompleteCount: number;
  blockingReasons: string[];
  canSubmit: boolean;
};

export async function listMyTimesheets(organisationId: string): Promise<MyTimesheetRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_my_timesheets", {
    p_organisation_id: organisationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.timesheet_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status,
    revision: row.revision,
    entryCount: row.entry_count,
    totalWorkedMinutes: row.total_worked_minutes,
    incompleteCount: row.incomplete_count,
    blockingReasons: row.blocking_reasons,
    canSubmit: row.can_submit,
  }));
}

export type TimesheetHeader = {
  id: string;
  organisationId: string;
  workerName: string | null;
  periodStart: string;
  periodEnd: string;
  status: TimesheetStatus;
  revision: number;
  submittedAt: string | null;
  agencyApprovedAt: string | null;
  approvedByName: string | null;
  lockedAt: string | null;
  rejectionReason: TimesheetRejectionReason | null;
  returnNote: string | null;
  entryCount: number;
  totalWorkedMinutes: number;
  totalBreakMinutes: number;
  submitBlockingReasons: string[];
  approvalBlockingReasons: string[];
  viewerIsWorker: boolean;
};

/** null ⇒ not visible to the caller (rendered as 404). */
export async function getTimesheet(timesheetId: string): Promise<TimesheetHeader | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_timesheet", { p_timesheet_id: timesheetId });
  if (error) {
    if (error.code === "CHP04") return null;
    throw error;
  }
  const row = data[0];
  return row
    ? {
        id: row.timesheet_id,
        organisationId: row.agency_organisation_id,
        workerName: row.worker_name,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        status: row.status,
        revision: row.revision,
        submittedAt: row.submitted_at,
        agencyApprovedAt: row.agency_approved_at,
        approvedByName: row.approved_by_name,
        lockedAt: row.locked_at,
        rejectionReason: row.rejection_reason,
        returnNote: row.return_note,
        entryCount: row.entry_count,
        totalWorkedMinutes: row.total_worked_minutes,
        totalBreakMinutes: row.total_break_minutes,
        submitBlockingReasons: row.submit_blocking_reasons,
        approvalBlockingReasons: row.approval_blocking_reasons,
        viewerIsWorker: row.viewer_is_worker,
      }
    : null;
}

export type TimesheetEntryRow = {
  id: string;
  assignmentId: string;
  attendanceId: string | null;
  shiftId: string;
  localDate: string;
  timezone: string;
  facilityName: string;
  locationName: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  effectiveStartAt: string | null;
  effectiveEndAt: string | null;
  breaks: TimesheetBreak[];
  breakMinutes: number | null;
  workedMinutes: number | null;
  notWorked: boolean;
  included: boolean;
  complete: boolean;
  blockingReasons: string[];
  openExceptionTypes: string[];
  pendingCorrections: number;
  approvedCorrections: number;
  clockInLocation: GeofenceResult | null;
  clockOutLocation: GeofenceResult | null;
  facilityState: TimesheetFacilityState;
};

export async function listTimesheetEntries(timesheetId: string): Promise<TimesheetEntryRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_timesheet_entries", {
    p_timesheet_id: timesheetId,
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.entry_id,
    assignmentId: row.assignment_id,
    attendanceId: row.attendance_id,
    shiftId: row.shift_id,
    localDate: row.local_date,
    timezone: row.timezone,
    facilityName: row.facility_name,
    locationName: row.location_name,
    scheduledStartAt: row.scheduled_start_at,
    scheduledEndAt: row.scheduled_end_at,
    effectiveStartAt: row.effective_start_at,
    effectiveEndAt: row.effective_end_at,
    breaks: breaks(row.breaks),
    breakMinutes: row.break_minutes,
    workedMinutes: row.worked_minutes,
    notWorked: row.not_worked,
    included: row.included,
    complete: row.complete,
    blockingReasons: row.blocking_reasons,
    openExceptionTypes: row.open_exception_types,
    pendingCorrections: row.pending_corrections,
    approvedCorrections: row.approved_corrections,
    clockInLocation: row.clock_in_location,
    clockOutLocation: row.clock_out_location,
    facilityState: row.facility_state,
  }));
}

export type TimesheetHistoryRow = {
  action: TimesheetHistoryAction;
  revision: number;
  occurredAt: string;
  entryId: string | null;
  reasonCode: string | null;
  note: string | null;
  actorName: string | null;
  actorSide: string;
};

export async function listTimesheetHistory(timesheetId: string): Promise<TimesheetHistoryRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_timesheet_history", {
    p_timesheet_id: timesheetId,
  });
  if (error) throw error;
  return data.map((row) => ({
    action: row.action,
    revision: row.revision,
    occurredAt: row.occurred_at,
    entryId: row.entry_id,
    reasonCode: row.reason_code,
    note: row.note,
    actorName: row.actor_name,
    actorSide: row.actor_side,
  }));
}

export type AgencyTimesheetRow = {
  id: string;
  workerName: string | null;
  periodStart: string;
  periodEnd: string;
  status: TimesheetStatus;
  revision: number;
  entryCount: number;
  totalWorkedMinutes: number;
  issueCount: number;
  pendingFacilityCount: number;
  disputedCount: number;
  facilities: string[];
  submittedAt: string | null;
};

export async function listAgencyTimesheets(
  organisationId: string,
  filter: { period?: string | undefined; status?: TimesheetStatus | undefined },
): Promise<AgencyTimesheetRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_agency_timesheets", {
    p_organisation_id: organisationId,
    ...(filter.period ? { p_period_start: filter.period } : {}),
    ...(filter.status ? { p_status: filter.status } : {}),
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.timesheet_id,
    workerName: row.worker_name,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status,
    revision: row.revision,
    entryCount: row.entry_count,
    totalWorkedMinutes: row.total_worked_minutes,
    issueCount: row.issue_count,
    pendingFacilityCount: row.pending_facility_count,
    disputedCount: row.disputed_count,
    facilities: row.facilities,
    submittedAt: row.submitted_at,
  }));
}

export type FacilityTimesheetEntryRow = {
  id: string;
  revision: number;
  agencyName: string;
  workerName: string | null;
  facilityName: string;
  locationName: string;
  localDate: string;
  timezone: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  effectiveStartAt: string | null;
  effectiveEndAt: string | null;
  breaks: TimesheetBreak[];
  breakMinutes: number | null;
  workedMinutes: number | null;
  hadAttendanceException: boolean;
  facilityState: TimesheetFacilityState;
  decidedAt: string | null;
  disputeReason: TimesheetDisputeReason | null;
};

/** Facility side: only entries at this facility, after agency approval. Audited (deduplicated). */
export async function listFacilityTimesheetEntries(
  facilityOrganisationId: string,
): Promise<FacilityTimesheetEntryRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_facility_timesheet_entries", {
    p_facility_organisation_id: facilityOrganisationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.entry_id,
    revision: row.timesheet_revision,
    agencyName: row.agency_name,
    workerName: row.worker_display_name,
    facilityName: row.facility_name,
    locationName: row.location_name,
    localDate: row.local_date,
    timezone: row.timezone,
    scheduledStartAt: row.scheduled_start_at,
    scheduledEndAt: row.scheduled_end_at,
    effectiveStartAt: row.effective_start_at,
    effectiveEndAt: row.effective_end_at,
    breaks: breaks(row.breaks),
    breakMinutes: row.break_minutes,
    workedMinutes: row.worked_minutes,
    hadAttendanceException: row.had_attendance_exception,
    facilityState: row.facility_state,
    decidedAt: row.decided_at,
    disputeReason: row.dispute_reason,
  }));
}

export async function getTimesheetWeekStart(organisationId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agency_timesheet_settings")
    .select("week_starts_on")
    .eq("agency_organisation_id", organisationId)
    .maybeSingle();
  if (error) throw error;
  return data?.week_starts_on ?? 1;
}
