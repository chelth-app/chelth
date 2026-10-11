-- =============================================================================
-- P0-E9-3F: exact-minute arithmetic, workspace locale, personal display timezone
-- M money (engine formula, integers only) · L locale · Z timezone · K keys
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql

select plan(31);

-- ---------------------------------------------------------------------------
-- M. Exact minutes: amount = round-half-up(rate_minor × minutes / 60)
--    (the engine's own function; calculation version 1)
-- ---------------------------------------------------------------------------
select is(internal.round_half_up_div(3000::numeric * 60, 60), 3000::bigint, 'M. $30/h × 60 min = $30.00');
select is(internal.round_half_up_div(3000::numeric * 30, 60), 1500::bigint, 'M. $30/h × 30 min = $15.00');
select is(internal.round_half_up_div(3000::numeric * 457, 60), 22850::bigint, 'M. $30/h × 457 min (7h 37m) = $228.50');
select is(internal.round_half_up_div(3125::numeric * 457, 60), 23802::bigint, 'M. decimal rate $31.25/h × 457 min = $238.02 (half up)');
select is(internal.round_half_up_div(3000::numeric * 0, 60), 0::bigint, 'M. zero minutes = $0.00');
select is(internal.round_half_up_div(2999::numeric * 1, 60), 50::bigint, 'M. $29.99/h × 1 min = 49.98¢ → 50¢ (half up, cents only at the end)');
-- Rounding mode "nearest 15" applied to the same 457 minutes ⇒ 450 priced minutes.
select is(internal.round_half_up_div(457, 15) * 15, 450::bigint, 'M. nearest 15: 457 → 450 minutes');
select is(internal.round_half_up_div(3000::numeric * 450, 60), 22500::bigint, 'M. … $225.00 under nearest-15 rounding');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'priced_timesheet_lines'
              and column_name in ('rounding_mode', 'rounding_increment_minutes', 'rounding_policy_version_id', 'raw_minutes', 'priced_minutes')),
  5, 'M. every priced line snapshots its method (mode, increment, policy version) and raw vs priced minutes');

-- ---------------------------------------------------------------------------
-- L. Workspace locale (organisation.manage, AAL2, audited)
-- ---------------------------------------------------------------------------
select is((select locale from public.organisations where id = (select alpha from orgs)), null,
  'L. existing workspaces have no locale (fallback chain applies)');
select lives_ok(pg_temp.as_sql((select alice from ids), format('select public.set_organisation_locale(%L, ''en-GB'')', (select alpha from orgs)), 'aal2'),
  'L. an admin sets en-GB');
select is((select locale from public.organisations where id = (select alpha from orgs)), 'en-GB', 'L. … stored');
select throws_ok(pg_temp.as_sql((select alice from ids), format('select public.set_organisation_locale(%L, ''fr-FR'')', (select alpha from orgs)), 'aal2'),
  'CH400', null, 'L. an unsupported locale is refused (no guessing)');
select throws_ok(pg_temp.as_sql((select alice from ids), format('select public.set_organisation_locale(%L, ''en-US'')', (select alpha from orgs))),
  'CH402', null, 'L. AAL1: step-up required');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select public.set_organisation_locale(%L, ''en-US'')', (select alpha from orgs)), 'aal2'),
  'CH403', null, 'L. a scheduler cannot change the workspace locale');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select public.set_organisation_locale(%L, ''en-US'')', (select alpha from orgs)), 'aal2'),
  'CH403', null, 'L. another agency cannot (cross-tenant)');
select lives_ok(pg_temp.as_sql((select alice from ids), format('select public.set_organisation_locale(%L)', (select alpha from orgs)), 'aal2'),
  'L. the locale can be cleared');
select is((select string_agg(coalesce(metadata ->> 'to', 'null'), ',' order by coalesce(metadata ->> 'to', 'null')) from public.audit_events
            where action = 'organisation.locale_updated' and organisation_id = (select alpha from orgs)),
  'en-GB,null', 'L. locale changes are audited');

-- ---------------------------------------------------------------------------
-- Z. Personal display timezone
-- ---------------------------------------------------------------------------
select is((select timezone_mode::text || '/' || coalesce(timezone, 'null') from public.profiles where id = (select wendy from ids)),
  'automatic/null', 'Z. new profiles: automatic, nothing detected yet');
select is(pg_temp.scalar_as((select wendy from ids), 'aal1', 'select public.sync_my_device_timezone(''Africa/Lagos'')'), 'true',
  'Z. automatic: the device zone is stored');
select is(pg_temp.scalar_as((select wendy from ids), 'aal1', 'select public.sync_my_device_timezone(''Mars/Olympus'')'), 'false',
  'Z. an invalid detected zone is ignored');
select is((select timezone from public.profiles where id = (select wendy from ids)), 'Africa/Lagos', 'Z. … and not stored');
select is(pg_temp.scalar_as((select wendy from ids), 'aal1', 'select public.sync_my_device_timezone(''Europe/London'')'), 'true',
  'Z. automatic: a device zone change updates it');
select lives_ok(pg_temp.as_sql((select wendy from ids), 'select public.set_my_display_preferences(''manual'', null, ''America/New_York'')'),
  'Z. manual choice');
select is(pg_temp.scalar_as((select wendy from ids), 'aal1', 'select public.sync_my_device_timezone(''Asia/Tokyo'')'), 'false',
  'Z. manual: a device change never overwrites the choice');
select is((select timezone_mode::text || '/' || timezone from public.profiles where id = (select wendy from ids)),
  'manual/America/New_York', 'Z. … the manual zone is kept');
select throws_ok(pg_temp.as_sql((select wendy from ids), 'select public.set_my_display_preferences(''manual'', null, null)'),
  'CH400', null, 'Z. manual mode needs a zone');
select throws_ok(pg_temp.as_sql((select wendy from ids), 'select public.set_my_display_preferences(''manual'', null, ''+01:00'')'),
  'CH400', null, 'Z. an offset is not an IANA zone');
select lives_ok(pg_temp.as_sql((select wendy from ids), 'select public.set_my_display_preferences(''automatic'', ''en-GB'', ''Europe/London'')'),
  'Z. back to the device timezone (with a personal locale)');
select is((select format('%s/%s', timezone_mode, timezone) from public.profiles where id = (select walt from ids)),
  'automatic/', 'Z. one person''s preference never changes another''s');

-- ---------------------------------------------------------------------------
-- K. Identifiers never change with spelling or vocabulary
-- ---------------------------------------------------------------------------
select is((select string_agg(key, ',' order by key) from public.credential_types where key in ('rn_license', 'lpn_lvn_license')),
  'lpn_lvn_license,rn_license', 'K. credential type keys keep their stored spelling');

select * from finish();
rollback;
