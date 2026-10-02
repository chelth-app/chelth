import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import {
  FACILITY_STATE_LABELS,
  TIMESHEET_STATUS_LABELS,
  type TimesheetFacilityState,
  type TimesheetStatus,
} from "@/lib/domain/timesheets";

const STATUS_TONE: Record<TimesheetStatus, StatusTone> = {
  open: "neutral",
  submitted: "info",
  rejected: "warning",
  agency_approved: "info",
  locked: "success",
};

const FACILITY_TONE: Record<TimesheetFacilityState, StatusTone> = {
  not_required: "neutral",
  pending: "info",
  signed_off: "success",
  disputed: "danger",
};

export function TimesheetStatusBadge({ status }: { status: TimesheetStatus }) {
  return <StatusChip tone={STATUS_TONE[status]}>{TIMESHEET_STATUS_LABELS[status]}</StatusChip>;
}

export function FacilityStateBadge({ state }: { state: TimesheetFacilityState }) {
  return <StatusChip tone={FACILITY_TONE[state]}>{FACILITY_STATE_LABELS[state]}</StatusChip>;
}
