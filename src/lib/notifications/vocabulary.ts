/**
 * Notification vocabulary (P0-E5-S2).
 *
 * Mirrors internal.notification_event / internal.notification_state (internal
 * schema enums are not part of the generated API types; the integration drift
 * test compares these lists with the database).
 */
export const NOTIFICATION_EVENTS = [
  "worker_assigned",
  "assignment_cancelled",
  "assignment_declined",
  "facility_request_submitted",
  "facility_request_opened",
  "shift_cancelled",
  "assignment_non_compliant",
  "shift_offered",
  "relationship_suspended",
  "relationship_ended",
  "attendance_clock_in_late",
  "attendance_clock_in_blocked",
  "attendance_missed_clock_in",
  "attendance_missed_clock_out",
  "attendance_correction_requested",
  "attendance_correction_approved",
  "attendance_correction_rejected",
  "timesheet_submitted",
  "timesheet_rejected",
  "timesheet_facility_signoff_required",
  "timesheet_disputed",
  "attendance_time_adjusted",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export function isNotificationEvent(value: unknown): value is NotificationEvent {
  return typeof value === "string" && (NOTIFICATION_EVENTS as readonly string[]).includes(value);
}

export const NOTIFICATION_STATES = ["pending", "processing", "sent", "retry", "failed"] as const;
export type NotificationState = (typeof NOTIFICATION_STATES)[number];

export const NOTIFICATION_STATE_LABELS: Record<NotificationState, string> = {
  pending: "Pending",
  processing: "Sending",
  sent: "Sent",
  retry: "Retrying",
  failed: "Failed",
};

/**
 * Every current event is a REQUIRED operational notification (no opt-out).
 * Optional categories (digests, reminders) arrive with a preference model.
 */
export const NOTIFICATION_CATEGORY: Record<NotificationEvent, "required" | "optional"> = {
  worker_assigned: "required",
  assignment_cancelled: "required",
  assignment_declined: "required",
  facility_request_submitted: "required",
  facility_request_opened: "required",
  shift_cancelled: "required",
  assignment_non_compliant: "required",
  shift_offered: "required",
  relationship_suspended: "required",
  relationship_ended: "required",
  attendance_clock_in_late: "required",
  attendance_clock_in_blocked: "required",
  attendance_missed_clock_in: "required",
  attendance_missed_clock_out: "required",
  attendance_correction_requested: "required",
  attendance_correction_approved: "required",
  attendance_correction_rejected: "required",
  timesheet_submitted: "required",
  timesheet_rejected: "required",
  timesheet_facility_signoff_required: "required",
  timesheet_disputed: "required",
  attendance_time_adjusted: "required",
};

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEvent, string> = {
  worker_assigned: "Worker assigned",
  assignment_cancelled: "Assignment cancelled",
  assignment_declined: "Assignment declined",
  facility_request_submitted: "Staffing request submitted",
  facility_request_opened: "Staffing request opened",
  shift_cancelled: "Shift cancelled",
  assignment_non_compliant: "Assignment needs attention",
  shift_offered: "Shift offered",
  relationship_suspended: "Relationship suspended",
  relationship_ended: "Relationship ended",
  attendance_clock_in_late: "Late clock-in",
  attendance_clock_in_blocked: "Clock-in refused",
  attendance_missed_clock_in: "Missed clock-in",
  attendance_missed_clock_out: "Missed clock-out",
  attendance_correction_requested: "Attendance correction requested",
  attendance_correction_approved: "Attendance correction approved",
  attendance_correction_rejected: "Attendance correction rejected",
  timesheet_submitted: "Timesheet submitted",
  timesheet_rejected: "Timesheet returned",
  timesheet_facility_signoff_required: "Timesheet sign-off needed",
  timesheet_disputed: "Timesheet discrepancy raised",
  attendance_time_adjusted: "Attendance time adjusted",
};

/**
 * Delivery error codes stored on the outbox (never provider text).
 * Provider codes come from src/lib/email; the rest are set by the database
 * or the dispatcher.
 */
export const DELIVERY_ERROR_CODES = [
  "provider_auth",
  "provider_rejected",
  "provider_rate_limited",
  "provider_unavailable",
  "provider_unreachable",
  "template_invalid",
  "dispatch_error",
  "recipient_unavailable",
  "subject_unavailable",
  "expired_before_delivery",
  "lease_expired",
  "unknown_error",
] as const;
export type DeliveryErrorCode = (typeof DELIVERY_ERROR_CODES)[number];

export const DELIVERY_ERROR_LABELS: Record<DeliveryErrorCode, string> = {
  provider_auth: "Email provider rejected our credentials",
  provider_rejected: "Email provider rejected the message",
  provider_rate_limited: "Email provider rate limit",
  provider_unavailable: "Email provider unavailable",
  provider_unreachable: "Email provider unreachable",
  template_invalid: "Notification could not be prepared",
  dispatch_error: "Delivery error",
  recipient_unavailable: "Recipient no longer active",
  subject_unavailable: "Shift or assignment no longer available",
  expired_before_delivery: "No longer relevant when delivery was attempted",
  lease_expired: "Delivery interrupted repeatedly",
  unknown_error: "Unknown delivery error",
};

export function deliveryErrorLabel(code: string | null): string {
  if (!code) return "";
  return (DELIVERY_ERROR_LABELS as Record<string, string>)[code] ?? code;
}
