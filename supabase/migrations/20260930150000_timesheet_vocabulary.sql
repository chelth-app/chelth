-- =============================================================================
-- Migration: timesheet_vocabulary
-- Stage:     P0-E6-S2 (timesheets & attendance review hardening)
--
-- Purpose
--   Capabilities (least privilege):
--     timesheet.view              see agency timesheets and their entries
--     timesheet.approve           approve / reject / reopen timesheets; resolve disputes
--     timesheet.facility_signoff  sign off or dispute entries at the caller's facility,
--                                 effective only through a linked relationship
--
--       agency.admin               view, approve
--       agency.operations_manager  view, approve
--       agency.scheduler           view
--       agency.finance             view   (later payroll/billing consume approved timesheets)
--       facility.admin             facility_signoff
--       facility.supervisor        facility_signoff (the person who knows who was on the floor)
--       recruiter / credentialing / healthcare worker / facility.scheduler: none
--       (a worker submits their OWN timesheet by identity, not by capability)
--
--   None are AAL2-privileged: timesheets carry no money in this stage, every
--   decision is separated from the worker (no self-approval), each approval
--   is an immutable snapshot, and time itself can only change through the
--   attendance correction workflow. Revisit when pay/bill amounts arrive.
--
--   Vocabularies: breaks (break_start/break_end + corrected variants and the
--   on_break clock state), reviewer-adjusted corrections, timesheet lifecycle,
--   facility sign-off/dispute, evidence retention. New notification events.
--
--   Enum values are added here, in their own migration, because PostgreSQL
--   cannot use a new enum value in the transaction that adds it.
-- =============================================================================

insert into public.capabilities (key, description, is_privileged) values
  ('timesheet.view',             'View timesheets and their derived entries.',                              false),
  ('timesheet.approve',          'Approve, reject or reopen timesheets; resolve facility discrepancies.',   false),
  ('timesheet.facility_signoff', 'Sign off or dispute timesheet entries for work at this facility.',        false);

insert into public.role_capabilities (role_key, capability_key)
select role_key, capability_key
from (values
  ('agency.admin', 'timesheet.view'), ('agency.admin', 'timesheet.approve'),
  ('agency.operations_manager', 'timesheet.view'), ('agency.operations_manager', 'timesheet.approve'),
  ('agency.scheduler', 'timesheet.view'),
  ('agency.finance', 'timesheet.view'),
  ('facility.admin', 'timesheet.facility_signoff'),
  ('facility.supervisor', 'timesheet.facility_signoff')
) as mapping (role_key, capability_key);

-- Attendance: breaks, reviewer adjustments, not-worked outcome.
alter type public.attendance_event_type add value if not exists 'break_start';
alter type public.attendance_event_type add value if not exists 'break_end';
alter type public.attendance_event_type add value if not exists 'corrected_break_start';
alter type public.attendance_event_type add value if not exists 'corrected_break_end';
alter type public.attendance_clock_state add value if not exists 'on_break' after 'clocked_in';
alter type public.attendance_correction_resolution add value if not exists 'approved_with_adjustment' after 'approved_as_requested';
alter type public.attendance_exception_resolution add value if not exists 'not_worked';

create type public.attendance_correction_origin as enum ('worker_request', 'reviewer_adjustment');
create type public.attendance_adjustment_reason as enum (
  'facility_reported_time', 'supervisor_observation', 'device_or_app_problem', 'worker_statement',
  'break_not_recorded', 'other'
);

-- Timesheets.
create type public.timesheet_status as enum ('open', 'submitted', 'rejected', 'agency_approved', 'locked');
create type public.timesheet_facility_state as enum ('not_required', 'pending', 'signed_off', 'disputed');
create type public.timesheet_rejection_reason as enum (
  'attendance_incorrect', 'missing_information', 'facility_discrepancy', 'other'
);
create type public.timesheet_dispute_reason as enum (
  'worker_not_present', 'time_incorrect', 'break_incorrect', 'assignment_not_worked', 'other'
);
create type public.timesheet_dispute_resolution as enum ('times_confirmed', 'timesheet_revised');
create type public.timesheet_history_action as enum (
  'submitted', 'rejected', 'agency_approved', 'facility_signed_off', 'facility_disputed',
  'dispute_resolved', 'locked', 'reopened', 'revised'
);
create type public.timesheet_reopen_reason as enum (
  'facility_discrepancy', 'attendance_changed', 'approved_in_error', 'other'
);

-- Location evidence retention.
create type public.location_evidence_state as enum ('retained', 'purged', 'on_hold');

alter type internal.notification_event add value if not exists 'timesheet_submitted';
alter type internal.notification_event add value if not exists 'timesheet_rejected';
alter type internal.notification_event add value if not exists 'timesheet_facility_signoff_required';
alter type internal.notification_event add value if not exists 'timesheet_disputed';
alter type internal.notification_event add value if not exists 'attendance_time_adjusted';

-- Composite targets for timesheet integrity.
alter table public.agency_facilities
  add constraint agency_facilities_link_key unique (id, linked_facility_organisation_id);
alter table public.shifts
  add constraint shifts_relationship_site_key
  unique (id, agency_organisation_id, relationship_id, agency_facility_id, facility_location_id);
