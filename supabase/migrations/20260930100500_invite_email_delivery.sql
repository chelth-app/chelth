-- =============================================================================
-- Migration: invite_email_delivery
-- Stage:     P0-E3-S3
--
-- Purpose
--   Durable, observable invitation email delivery state.
--
--   Chosen pattern: POST-COMMIT DELIVERY WITH RECORDED OUTCOME (not an
--   outbox). The invite transaction commits first (invite + audit), the
--   server then sends the email with the raw token it holds only in memory,
--   and records the outcome here. Consequences:
--     - an email is never sent for a rolled-back invitation;
--     - a failed/skipped send is never silent: status + error code persist
--       and are shown to administrators, who can resend (token rotation);
--     - the raw token is never stored anywhere, not even in an outbox.
--   An outbox would require persisting the raw token (a secret at rest) or a
--   privileged background worker able to rotate tokens — rejected for now
--   (docs/architecture/TRANSACTIONAL_EMAIL.md).
--
--   Resending rotates the token, so the delivery state resets automatically.
--
-- Verified by: supabase/tests/security/040_invitations.test.sql (delivery)
-- =============================================================================

create type public.invite_delivery_status as enum ('not_attempted', 'sent', 'failed', 'skipped');

alter table public.organisation_invites
  add column delivery_status public.invite_delivery_status not null default 'not_attempted',
  add column delivery_provider text
    check (delivery_provider is null or delivery_provider ~ '^[a-z0-9_]{1,40}$'),
  add column delivery_message_id text
    check (delivery_message_id is null or char_length(delivery_message_id) <= 200),
  add column delivery_error_code text
    check (delivery_error_code is null or delivery_error_code ~ '^[a-z0-9_.]{1,60}$'),
  add column delivery_attempted_at timestamptz;

-- Token rotation (resend) resets delivery state.
create function internal.reset_invite_delivery_on_rotation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.token_hash is distinct from old.token_hash then
    new.delivery_status := 'not_attempted';
    new.delivery_provider := null;
    new.delivery_message_id := null;
    new.delivery_error_code := null;
    new.delivery_attempted_at := null;
  end if;
  return new;
end;
$$;

create trigger organisation_invites_reset_delivery
  before update on public.organisation_invites
  for each row execute function internal.reset_invite_delivery_on_rotation();

-- Recorded by the issuing server action right after the send attempt. Only
-- identifiers and codes are stored — never addresses, links or bodies.
create function public.record_organisation_invite_delivery(
  p_invite_id uuid,
  p_status public.invite_delivery_status,
  p_provider text,
  p_message_id text default null,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.organisation_invites;
begin
  perform internal.require_identity();
  v_invite := internal.require_invite_authority(p_invite_id);

  if p_status = 'not_attempted' then
    raise exception 'a delivery outcome is required' using errcode = 'CH400';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'only pending invitations record delivery' using errcode = 'CH409';
  end if;

  update public.organisation_invites i
     set delivery_status = p_status,
         delivery_provider = p_provider,
         delivery_message_id = p_message_id,
         delivery_error_code = p_error_code,
         delivery_attempted_at = now()
   where i.id = p_invite_id;
end;
$$;

-- list_organisation_invites gains the delivery status (return type change).
drop function public.list_organisation_invites(uuid);

create function public.list_organisation_invites(p_organisation_id uuid)
returns table (
  invite_id uuid,
  invitee_email text,
  invite_role_key text,
  invite_status public.invite_status,
  invite_expires_at timestamptz,
  invite_send_count integer,
  invited_at timestamptz,
  invite_delivery_status public.invite_delivery_status
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'membership.invite');

  return query
    select i.id, i.email, i.role_key, i.status, i.expires_at, i.send_count, i.created_at, i.delivery_status
    from public.organisation_invites i
    where i.organisation_id = p_organisation_id
      and (i.status = 'pending' or i.updated_at > now() - interval '30 days')
    order by i.created_at desc
    limit 200;
end;
$$;

revoke all on function internal.reset_invite_delivery_on_rotation() from public, anon, authenticated;
revoke all on function
  public.record_organisation_invite_delivery(uuid, public.invite_delivery_status, text, text, text),
  public.list_organisation_invites(uuid)
from public, anon;
grant execute on function
  public.record_organisation_invite_delivery(uuid, public.invite_delivery_status, text, text, text),
  public.list_organisation_invites(uuid)
to authenticated;
