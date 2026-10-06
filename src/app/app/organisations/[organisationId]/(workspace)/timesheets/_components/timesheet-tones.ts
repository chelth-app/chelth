import type { StatusTone } from "@/components/ui/status-chip";
import type {
  TimesheetFacilityState,
  TimesheetHistoryAction,
  TimesheetStatus,
} from "@/lib/domain/timesheets";

/** Same tones as TimesheetStatusBadge (features/timesheets). */
export const TIMESHEET_TONE: Record<TimesheetStatus, StatusTone> = {
  open: "neutral",
  submitted: "info",
  rejected: "warning",
  agency_approved: "info",
  locked: "success",
};

/** Same tones as FacilityStateBadge (features/timesheets). */
export const FACILITY_STATE_TONE: Record<TimesheetFacilityState, StatusTone> = {
  not_required: "neutral",
  pending: "info",
  signed_off: "success",
  disputed: "danger",
};

/** Timeline dot per history event (append-only; nothing is ever removed). */
export const HISTORY_TONE: Record<TimesheetHistoryAction, StatusTone> = {
  submitted: "info",
  rejected: "warning",
  agency_approved: "success",
  facility_signed_off: "success",
  facility_disputed: "danger",
  dispute_resolved: "info",
  locked: "success",
  reopened: "warning",
  revised: "neutral",
  facility_signoff_not_required: "neutral",
};
