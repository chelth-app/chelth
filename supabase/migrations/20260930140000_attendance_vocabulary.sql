-- =============================================================================
-- Migration: attendance_vocabulary
-- Stage:     P0-E6-S1 (time & attendance foundations)
--
-- Purpose
--   Capabilities (least privilege):
--     attendance.view             see attendance, exceptions, corrections
--     attendance.review           approve/reject corrections; resolve exceptions
--     attendance.manage_settings  timing rules and location geofences   (AAL2)
--     attendance.location.view    raw location evidence (coordinates)  (AAL2)
--
--       agency.admin               all four
--       agency.operations_manager  view, review
--       agency.scheduler           view
--       recruiter / credentialing / finance / healthcare worker: none
--       (a worker's own attendance is an identity rule, not a capability)
--       facility.admin/.scheduler/.supervisor: attendance.view, effective only
--       through an explicitly linked relationship (narrow projection)
--
--   attendance.review is not AAL2: corrections change no pay in this stage
--   (no timesheets) and are separated from the requester (no self-approval);
--   revisit when timesheets derive from attendance.
--
--   Vocabularies (enums) and notification events. Composite keys that let
--   attendance rows bind assignment + shift + worker + person + facility +
--   location in one foreign key.
-- =============================================================================

insert into public.capabilities (key, description, is_privileged) values
  ('attendance.view',            'View attendance, attendance exceptions and correction requests.',  false),
  ('attendance.review',          'Approve or reject attendance corrections; resolve exceptions.',    false),
  ('attendance.manage_settings', 'Configure attendance timing rules and location geofences.',        true),
  ('attendance.location.view',   'View raw location evidence captured at clock actions.',            true);

insert into public.role_capabilities (role_key, capability_key)
select role_key, capability_key
from (values
  ('agency.admin', 'attendance.view'), ('agency.admin', 'attendance.review'),
  ('agency.admin', 'attendance.manage_settings'), ('agency.admin', 'attendance.location.view'),
  ('agency.operations_manager', 'attendance.view'), ('agency.operations_manager', 'attendance.review'),
  ('agency.scheduler', 'attendance.view'),
  ('facility.admin', 'attendance.view'),
  ('facility.scheduler', 'attendance.view'),
  ('facility.supervisor', 'attendance.view')
) as mapping (role_key, capability_key);

-- Clock state is a projection of events; "needs review" is derived from open exceptions.
create type public.attendance_clock_state as enum ('not_started', 'clocked_in', 'clocked_out');
create type public.attendance_event_type as enum (
  'clock_in', 'clock_out', 'corrected_clock_in', 'corrected_clock_out'
);
create type public.attendance_event_source as enum ('worker_device', 'approved_correction');
create type public.geofence_result as enum ('not_required', 'inside', 'outside', 'low_accuracy', 'unavailable');
create type public.geofence_outside_policy as enum ('block', 'allow_with_review');
create type public.attendance_exception_type as enum (
  'late_clock_in', 'early_clock_out', 'late_clock_out', 'missed_clock_in', 'missed_clock_out',
  'outside_geofence', 'poor_location_accuracy', 'location_unavailable', 'assignment_not_ready',
  'manual_correction_requested'
);
create type public.attendance_exception_status as enum ('open', 'under_review', 'resolved', 'dismissed');
create type public.attendance_exception_source as enum ('clock_action', 'scheduled_scan', 'correction');
create type public.attendance_exception_resolution as enum (
  'acknowledged', 'correction_approved', 'correction_rejected', 'clocked_in', 'clocked_out',
  'assignment_closed', 'not_applicable'
);
create type public.attendance_correction_reason as enum (
  'forgot_to_clock', 'device_or_app_problem', 'location_problem', 'recorded_wrong_time', 'other'
);
create type public.attendance_correction_status as enum ('pending', 'approved', 'rejected');
create type public.attendance_correction_resolution as enum (
  'approved_as_requested', 'rejected_time_not_supported', 'rejected_duplicate', 'rejected_other'
);

alter type internal.notification_event add value if not exists 'attendance_clock_in_late';
alter type internal.notification_event add value if not exists 'attendance_clock_in_blocked';
alter type internal.notification_event add value if not exists 'attendance_missed_clock_in';
alter type internal.notification_event add value if not exists 'attendance_missed_clock_out';
alter type internal.notification_event add value if not exists 'attendance_correction_requested';
alter type internal.notification_event add value if not exists 'attendance_correction_approved';
alter type internal.notification_event add value if not exists 'attendance_correction_rejected';

-- Composite targets for attendance integrity.
alter table public.shift_assignments
  add constraint shift_assignments_identity_key
  unique (id, agency_organisation_id, shift_id, agency_worker_id, profile_id);
alter table public.shifts
  add constraint shifts_site_key unique (id, agency_organisation_id, agency_facility_id, facility_location_id);
