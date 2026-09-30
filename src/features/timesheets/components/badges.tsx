import { Badge, type BadgeProps } from "@/components/ui/badge";
import {
  FACILITY_STATE_LABELS,
  TIMESHEET_STATUS_LABELS,
  type TimesheetFacilityState,
  type TimesheetStatus,
} from "@/lib/domain/timesheets";

const STATUS_TONE: Record<TimesheetStatus, NonNullable<BadgeProps["tone"]>> = {
  open: "neutral",
  submitted: "info",
  rejected: "warning",
  agency_approved: "info",
  locked: "success",
};

const FACILITY_TONE: Record<TimesheetFacilityState, NonNullable<BadgeProps["tone"]>> = {
  not_required: "neutral",
  pending: "info",
  signed_off: "success",
  disputed: "danger",
};

export function TimesheetStatusBadge({ status }: { status: TimesheetStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{TIMESHEET_STATUS_LABELS[status]}</Badge>;
}

export function FacilityStateBadge({ state }: { state: TimesheetFacilityState }) {
  return <Badge tone={FACILITY_TONE[state]}>{FACILITY_STATE_LABELS[state]}</Badge>;
}
