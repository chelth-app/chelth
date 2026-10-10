-- =============================================================================
-- Migration: messaging_vocabulary
-- Stage:     P0-E9-3D-S3 (designed in P0-E9-3D-S1 §3 D5–D8, §4 M2/M3)
--
-- Purpose
--   Vocabulary for operational messaging, in its own migration because a new
--   enum value cannot be used in the transaction that adds it:
--   - internal.notification_event 'message_received';
--   - public.conversation_kind (worker | facility) and
--     public.message_sender_side (worker | agency | facility);
--   - capabilities message.view / message.send and their role mappings.
--
-- Workers hold no messaging capability: a worker is authorised as the worker
-- of their own thread (derived from the thread, not from a grant).
-- =============================================================================

alter type internal.notification_event add value if not exists 'message_received';

create type public.conversation_kind as enum ('worker', 'facility');
create type public.message_sender_side as enum ('worker', 'agency', 'facility');

insert into public.capabilities (key, description, is_privileged) values
  ('message.view', 'Read operational message threads of the organisation.', false),
  ('message.send', 'Reply in and start operational message threads.',       false);

insert into public.role_capabilities (role_key, capability_key)
select role_key, capability_key
from (values
  ('agency.admin', 'message.view'),                 ('agency.admin', 'message.send'),
  ('agency.operations_manager', 'message.view'),    ('agency.operations_manager', 'message.send'),
  ('agency.scheduler', 'message.view'),             ('agency.scheduler', 'message.send'),
  ('agency.recruiter', 'message.view'),             ('agency.recruiter', 'message.send'),
  ('agency.credentialing_officer', 'message.view'), ('agency.credentialing_officer', 'message.send'),
  ('facility.admin', 'message.view'),               ('facility.admin', 'message.send'),
  ('facility.scheduler', 'message.view'),           ('facility.scheduler', 'message.send')
) as grants(role_key, capability_key);
