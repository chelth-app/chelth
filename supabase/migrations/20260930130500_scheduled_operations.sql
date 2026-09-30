-- =============================================================================
-- Migration: scheduled_operations
-- Stage:     P0-E5-S2
--
-- Purpose
--   Migration-driven schedules (pg_cron). Every job is idempotent and bounded.
--
--   chelth-readiness-scan      hourly     internal.run_assignment_readiness_scan()
--                                          (horizon: internal.operations_settings)
--   chelth-offer-expiry        every 5 min internal.expire_shift_offers()
--   chelth-notification-kick   every min  internal.request_notification_dispatch():
--                              when due notifications exist, POSTs to the
--                              application's dispatch route via pg_net with a
--                              bearer secret. URL and secret come from Supabase
--                              Vault (operator configuration, never a
--                              migration). Missing configuration ⇒ no-op.
--
-- Verified by: supabase/tests/security/140_notification_delivery.test.sql
-- =============================================================================

create extension if not exists pg_cron;

create function internal.run_offer_expiry()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run bigint;
  v_count integer;
begin
  insert into internal.scheduled_job_runs (job) values ('offer_expiry') returning id into v_run;
  v_count := internal.expire_shift_offers();
  update internal.scheduled_job_runs set finished_at = now(), result = jsonb_build_object('expired', v_count)
   where id = v_run;
  return v_count;
end;
$$;

-- Returns: 'not_configured' | 'idle' | 'requested'
create function internal.request_notification_dispatch()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (
    select 1 from internal.notification_outbox o
    where (o.state in ('pending', 'retry') and o.next_attempt_at <= now())
       or (o.state = 'processing' and o.claimed_until < now())
  ) then
    return 'idle';
  end if;

  select max(case when s.name = 'chelth_notification_dispatch_url' then s.decrypted_secret end),
         max(case when s.name = 'chelth_notification_dispatch_secret' then s.decrypted_secret end)
    into v_url, v_secret
  from vault.decrypted_secrets s
  where s.name in ('chelth_notification_dispatch_url', 'chelth_notification_dispatch_secret');

  if v_url is null or v_secret is null or v_url !~ '^https://' then
    return 'not_configured';
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  return 'requested';
end;
$$;

revoke all on function
  internal.run_offer_expiry(),
  internal.request_notification_dispatch()
from public, anon, authenticated, service_role;

-- cron.schedule upserts by job name, so re-applying is safe.
select cron.schedule('chelth-readiness-scan', '7 * * * *', 'select internal.run_assignment_readiness_scan()');
select cron.schedule('chelth-offer-expiry', '*/5 * * * *', 'select internal.run_offer_expiry()');
select cron.schedule('chelth-notification-kick', '* * * * *', 'select internal.request_notification_dispatch()');
