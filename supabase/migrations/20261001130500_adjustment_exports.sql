-- =============================================================================
-- Migration: adjustment_exports
-- Stage:     P0-E7-S3
--
-- Purpose
--   Adjustment exports reuse the S2 export infrastructure unchanged:
--   financial_exports metadata + internal.financial_export_files bytes,
--   database-rendered deterministic content, SHA-256 at generation, insert and
--   download, csv_text formula neutralisation, the audited download RPC.
--
--   * financial_exports accepts source types payroll_adjustment and
--     invoice_adjustment (composite FKs to agency, period and currency) and a
--     SIGNED total for adjustments (net delta).
--   * Payroll adjustment CSV, invoice adjustment CSV (bill side only) and an
--     invoice adjustment PDF titled "DRAFT INVOICE ADJUSTMENT" stating
--     "Additional charge" or "Credit".
--     Numeric columns are database integers (negative deltas keep their
--     sign); only text columns pass through csv_text.
--   * download_financial_export now audits denials (financial_authorize) and
--     returns them as a row with denied_reason instead of raising.
-- =============================================================================

alter table public.financial_exports
  add column payroll_adjustment_id uuid,
  add column invoice_adjustment_id uuid,
  drop constraint financial_exports_source_type_check,
  drop constraint financial_exports_check2,
  drop constraint financial_exports_total_minor_check,
  add constraint financial_exports_source_type_check
    check (source_type in ('payroll_batch', 'invoice_draft', 'payroll_adjustment', 'invoice_adjustment')),
  add constraint financial_exports_payroll_adjustment_check
    check ((source_type = 'payroll_adjustment') = (payroll_adjustment_id is not null)),
  add constraint financial_exports_invoice_adjustment_check
    check ((source_type = 'invoice_adjustment') = (invoice_adjustment_id is not null)),
  add constraint financial_exports_pdf_check
    check (source_type in ('invoice_draft', 'invoice_adjustment') or format = 'csv'),
  -- Documents carry non-negative totals; adjustments a signed net delta.
  add constraint financial_exports_total_minor_check
    check (source_type in ('payroll_adjustment', 'invoice_adjustment') or total_minor >= 0),
  add constraint financial_exports_payroll_adjustment_fkey
    foreign key (payroll_adjustment_id, agency_organisation_id, period_start, period_end, currency)
    references public.payroll_adjustments (id, agency_organisation_id, period_start, period_end, currency)
    on delete restrict,
  add constraint financial_exports_invoice_adjustment_fkey
    foreign key (invoice_adjustment_id, agency_organisation_id, period_start, period_end, currency)
    references public.invoice_adjustments (id, agency_organisation_id, period_start, period_end, currency)
    on delete restrict,
  add constraint financial_exports_payroll_adjustment_number_key unique (payroll_adjustment_id, format, export_number),
  add constraint financial_exports_invoice_adjustment_number_key unique (invoice_adjustment_id, format, export_number);

create index financial_exports_payroll_adjustment_idx on public.financial_exports (payroll_adjustment_id, generated_at desc);
create index financial_exports_invoice_adjustment_idx on public.financial_exports (invoice_adjustment_id, generated_at desc);

drop policy financial_exports_select on public.financial_exports;
create policy financial_exports_select on public.financial_exports for select to authenticated
  using (case when source_type in ('payroll_batch', 'payroll_adjustment')
              then authz.has_capability(agency_organisation_id, 'payroll.view')
              else authz.has_capability(agency_organisation_id, 'invoice.view') end);

-- -----------------------------------------------------------------------------
-- Renderers
-- -----------------------------------------------------------------------------
-- Exact signed decimal of a minor-unit amount: "+12.50", "-3.00", "0.00".
create function internal.signed_minor_to_decimal(p_amount bigint, p_digits smallint)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_amount > 0 then '+' when p_amount < 0 then '-' else '' end
         || internal.minor_to_decimal(abs(p_amount), p_digits)
$$;

create function internal.csv_int(p_value bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_value::text, '')
$$;

create function internal.render_payroll_adjustment_csv(p_adjustment_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'adjustment_reference,original_batch_reference,previous_adjustment_reference,worker_reference,worker_name,'
         || 'work_date,facility,discipline,original_revision,revised_revision,original_regular_minutes,'
         || 'revised_regular_minutes,original_overtime_minutes,revised_overtime_minutes,original_pay_amount_minor,'
         || 'revised_pay_amount_minor,delta_pay_amount_minor,currency' || E'\r\n'
         || coalesce(string_agg(
              internal.csv_text(a.reference) || ',' ||
              internal.csv_text(b.reference) || ',' ||
              internal.csv_text(pa.reference) || ',' ||
              internal.csv_text(l.worker_reference) || ',' ||
              internal.csv_text(l.worker_name) || ',' ||
              l.work_date::text || ',' ||
              internal.csv_text(l.facility_name) || ',' ||
              internal.csv_text(l.discipline_name) || ',' ||
              a.from_revision::text || ',' ||
              a.to_revision::text || ',' ||
              internal.csv_int(l.old_regular_minutes) || ',' ||
              internal.csv_int(l.new_regular_minutes) || ',' ||
              internal.csv_int(l.old_overtime_minutes) || ',' ||
              internal.csv_int(l.new_overtime_minutes) || ',' ||
              internal.csv_int(l.old_pay_amount_minor) || ',' ||
              internal.csv_int(l.new_pay_amount_minor) || ',' ||
              l.delta_pay_amount_minor::text || ',' ||
              internal.csv_text(l.currency) || E'\r\n',
              '' order by l.line_number), '')
  from public.payroll_adjustments a
  join public.payroll_batches b on b.id = a.original_payroll_batch_id
  left join public.payroll_adjustments pa on pa.id = a.previous_adjustment_id
  join public.payroll_adjustment_lines l on l.payroll_adjustment_id = a.id
  where a.id = p_adjustment_id
$$;

create function internal.render_invoice_adjustment_csv(p_adjustment_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'adjustment_reference,original_invoice_draft_reference,previous_adjustment_reference,direction,facility,'
         || 'relationship_reference,work_date,worker_reference,worker_name,discipline,original_revision,'
         || 'revised_revision,original_priced_minutes,revised_priced_minutes,original_bill_amount_minor,'
         || 'revised_bill_amount_minor,delta_bill_amount_minor,currency' || E'\r\n'
         || coalesce(string_agg(
              internal.csv_text(a.reference) || ',' ||
              internal.csv_text(d.reference) || ',' ||
              internal.csv_text(pa.reference) || ',' ||
              internal.csv_text(a.direction) || ',' ||
              internal.csv_text(a.facility_name) || ',' ||
              internal.csv_text(a.relationship_id::text) || ',' ||
              l.work_date::text || ',' ||
              internal.csv_text(l.worker_reference) || ',' ||
              internal.csv_text(l.worker_name) || ',' ||
              internal.csv_text(l.discipline_name) || ',' ||
              a.from_revision::text || ',' ||
              a.to_revision::text || ',' ||
              internal.csv_int(l.old_priced_minutes) || ',' ||
              internal.csv_int(l.new_priced_minutes) || ',' ||
              internal.csv_int(l.old_bill_amount_minor) || ',' ||
              internal.csv_int(l.new_bill_amount_minor) || ',' ||
              l.delta_bill_amount_minor::text || ',' ||
              internal.csv_text(l.currency) || E'\r\n',
              '' order by l.line_number), '')
  from public.invoice_adjustments a
  join public.invoice_drafts d on d.id = a.original_invoice_draft_id
  left join public.invoice_adjustments pa on pa.id = a.previous_adjustment_id
  join public.invoice_adjustment_lines l on l.invoice_adjustment_id = a.id
  where a.id = p_adjustment_id
$$;

-- Assemble a text-only PDF 1.4 from page content streams (built-in Helvetica only).
create function internal.pdf_document(p_pages text[])
returns bytea
language plpgsql
stable
set search_path = ''
as $$
declare
  v_objects text[] := array[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  v_kids text := '';
  v_doc text := E'%PDF-1.4\n';
  v_offsets integer[] := array[]::integer[];
  v_xref text;
begin
  for v_page_index in 1 .. cardinality(p_pages) loop
    v_kids := v_kids || (5 + (v_page_index - 1) * 2)::text || ' 0 R ';
    v_objects := v_objects || ('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R '
                               || '/F2 4 0 R >> >> /Contents ' || (6 + (v_page_index - 1) * 2)::text || ' 0 R >>');
    v_objects := v_objects || ('<< /Length ' || octet_length(p_pages[v_page_index]) || ' >>' || E'\nstream\n'
                               || p_pages[v_page_index] || 'endstream');
  end loop;
  v_objects[2] := '<< /Type /Pages /Kids [ ' || v_kids || '] /Count ' || cardinality(p_pages) || ' >>';
  for v_object_index in 1 .. cardinality(v_objects) loop
    v_offsets := v_offsets || octet_length(v_doc);
    v_doc := v_doc || v_object_index::text || E' 0 obj\n' || v_objects[v_object_index] || E'\nendobj\n';
  end loop;
  v_xref := 'xref' || E'\n' || '0 ' || (cardinality(v_objects) + 1)::text || E'\n' || E'0000000000 65535 f \n';
  for v_object_index in 1 .. cardinality(v_offsets) loop
    v_xref := v_xref || lpad(v_offsets[v_object_index]::text, 10, '0') || E' 00000 n \n';
  end loop;
  return convert_to(v_doc || v_xref || 'trailer' || E'\n' || '<< /Size ' || (cardinality(v_objects) + 1)::text
                    || ' /Root 1 0 R >>' || E'\nstartxref\n' || octet_length(v_doc)::text || E'\n%%EOF\n', 'UTF8');
end;
$$;

create function internal.render_invoice_adjustment_pdf(p_adjustment_id uuid, p_status_at_export text)
returns bytea
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.invoice_adjustments;
  v_draft_reference text;
  v_previous_reference text;
  v_digits smallint;
  v_rows_per_page constant integer := 36;
  v_page_count integer;
  v_pages text[] := array[]::text[];
  v_stream text;
  v_direction text;
  v_y integer;
  l record;
begin
  select * into a from public.invoice_adjustments x where x.id = p_adjustment_id;
  select d.reference into v_draft_reference from public.invoice_drafts d where d.id = a.original_invoice_draft_id;
  select p.reference into v_previous_reference from public.invoice_adjustments p where p.id = a.previous_adjustment_id;
  select c.minor_unit_digits into v_digits from public.currencies c where c.code = a.currency;
  v_page_count := greatest(1, ceil(a.line_count::numeric / v_rows_per_page)::integer);
  v_direction := case a.direction when 'additional_charge' then 'Additional charge'
                                  when 'credit' then 'Credit' else 'No net change' end;

  for v_page_index in 1 .. v_page_count loop
    v_stream := internal.pdf_line('F2', 18, 40, 750, 'DRAFT INVOICE ADJUSTMENT')
      || internal.pdf_line('F2', 11, 40, 732, v_direction)
      || internal.pdf_line('F1', 8, 40, 718, 'Internal draft for review. Not a tax invoice, credit note or request for '
                                             || 'payment. No tax has been calculated.')
      || internal.pdf_line('F1', 9, 40, 700, 'Reference: ' || internal.pdf_text(a.reference)
                                             || '    Status at export: ' || internal.pdf_text(p_status_at_export))
      || internal.pdf_line('F1', 9, 40, 687, 'Adjusts draft invoice: ' || internal.pdf_text(v_draft_reference)
                                             || case when v_previous_reference is not null
                                                     then '    Follows: ' || internal.pdf_text(v_previous_reference)
                                                     else '' end)
      || internal.pdf_line('F1', 9, 40, 674, 'Agency: ' || internal.pdf_text(a.agency_name, 90))
      || internal.pdf_line('F1', 9, 40, 661, 'Facility: ' || internal.pdf_text(a.facility_name, 90))
      || internal.pdf_line('F1', 9, 40, 648, 'Week: ' || a.period_start::text || ' to ' || a.period_end::text
                                             || '    Timesheet revision ' || a.from_revision || ' to ' || a.to_revision
                                             || '    Currency: ' || internal.pdf_text(a.currency))
      || internal.pdf_line('F2', 8, 40, 624, 'Work date')
      || internal.pdf_line('F2', 8, 100, 624, 'Worker')
      || internal.pdf_line('F2', 8, 250, 624, 'Discipline')
      || internal.pdf_line('F2', 8, 350, 624, 'Minutes')
      || internal.pdf_line('F2', 8, 410, 624, 'Original')
      || internal.pdf_line('F2', 8, 470, 624, 'Revised')
      || internal.pdf_line('F2', 8, 530, 624, 'Change');
    v_y := 610;
    for l in
      select x.* from public.invoice_adjustment_lines x
      where x.invoice_adjustment_id = p_adjustment_id
      order by x.line_number
      offset (v_page_index - 1) * v_rows_per_page limit v_rows_per_page
    loop
      v_stream := v_stream
        || internal.pdf_line('F1', 8, 40, v_y, l.work_date::text)
        || internal.pdf_line('F1', 8, 100, v_y, internal.pdf_text(l.worker_name, 30))
        || internal.pdf_line('F1', 8, 250, v_y, internal.pdf_text(l.discipline_name, 20))
        || internal.pdf_line('F1', 8, 350, v_y, coalesce(l.old_priced_minutes, 0) || ' to ' || coalesce(l.new_priced_minutes, 0))
        || internal.pdf_line('F1', 8, 410, v_y, internal.minor_to_decimal(coalesce(l.old_bill_amount_minor, 0), v_digits))
        || internal.pdf_line('F1', 8, 470, v_y, internal.minor_to_decimal(coalesce(l.new_bill_amount_minor, 0), v_digits))
        || internal.pdf_line('F1', 8, 530, v_y, internal.signed_minor_to_decimal(l.delta_bill_amount_minor, v_digits));
      v_y := v_y - 13;
    end loop;
    if v_page_index = v_page_count then
      v_stream := v_stream
        || internal.pdf_line('F2', 9, 40, v_y - 12, 'Net adjustment (bill side, before any tax): '
                             || internal.signed_minor_to_decimal(a.net_delta_minor, v_digits) || ' '
                             || internal.pdf_text(a.currency) || '    ' || v_direction);
    end if;
    v_stream := v_stream
      || internal.pdf_line('F1', 8, 40, 30, 'DRAFT INVOICE ADJUSTMENT ' || internal.pdf_text(a.reference)
                                            || ' - page ' || v_page_index || ' of ' || v_page_count);
    v_pages := v_pages || v_stream;
  end loop;
  return internal.pdf_document(v_pages);
end;
$$;

-- -----------------------------------------------------------------------------
-- Export RPCs
-- -----------------------------------------------------------------------------
create function public.create_payroll_adjustment_export(p_adjustment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.payroll_adjustments := internal.payroll_adjustment_for_write(p_adjustment_id, 'payroll.export');
  v_content bytea;
  v_sha text;
  v_id uuid;
begin
  if a.status not in ('locked', 'exported') then
    raise exception 'only a locked adjustment can be exported' using errcode = 'CHY04';
  end if;
  if not internal.consume_rate_limit('financial.export:' || a.agency_organisation_id::text, 120, interval '1 hour') then
    raise exception 'too many exports' using errcode = 'CH429';
  end if;
  v_content := convert_to(internal.render_payroll_adjustment_csv(a.id), 'UTF8');
  v_sha := encode(extensions.digest(v_content, 'sha256'), 'hex');
  insert into public.financial_exports
    (agency_organisation_id, source_type, payroll_adjustment_id, source_reference, source_status, format,
     export_version, export_number, file_name, content_type, row_count, total_minor, currency, period_start,
     period_end, sha256, byte_size, generated_by_membership_id)
  values (a.agency_organisation_id, 'payroll_adjustment', a.id, a.reference, a.status::text, 'csv', 1,
          (select count(*) + 1 from public.financial_exports e where e.payroll_adjustment_id = a.id and e.format = 'csv'),
          a.reference || '.csv', 'text/csv; charset=utf-8', a.line_count, a.net_delta_minor, a.currency,
          a.period_start, a.period_end, v_sha, octet_length(v_content),
          internal.active_membership_id(a.agency_organisation_id))
  returning id into v_id;
  insert into internal.financial_export_files (export_id, agency_organisation_id, content)
  values (v_id, a.agency_organisation_id, v_content);
  if a.status = 'locked' then
    update public.payroll_adjustments x set status = 'exported', exported_at = now() where x.id = a.id;
    perform internal.record_payroll_adjustment_history(a, 'exported', 'exported');
    perform internal.record_audit_event('payroll.adjustment_exported', a.agency_organisation_id, 'payroll_adjustment',
      a.id, jsonb_build_object('reference', a.reference));
  end if;
  perform internal.record_audit_event('payroll.export_created', a.agency_organisation_id, 'financial_export', v_id,
    jsonb_build_object('payroll_adjustment_id', a.id, 'reference', a.reference, 'source_type', 'payroll_adjustment',
                       'format', 'csv', 'sha256', v_sha, 'row_count', a.line_count));
  return v_id;
end;
$$;

create function public.create_invoice_adjustment_export(p_adjustment_id uuid, p_format text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.invoice_adjustments := internal.invoice_adjustment_for_write(p_adjustment_id, 'invoice.export');
  v_content bytea;
  v_sha text;
  v_id uuid;
begin
  if p_format is null or p_format not in ('csv', 'pdf') then
    raise exception 'unknown export format' using errcode = 'CH400';
  end if;
  if a.status not in ('locked', 'exported') then
    raise exception 'only a locked adjustment can be exported' using errcode = 'CHY04';
  end if;
  if not internal.consume_rate_limit('financial.export:' || a.agency_organisation_id::text, 120, interval '1 hour') then
    raise exception 'too many exports' using errcode = 'CH429';
  end if;
  v_content := case p_format
    when 'csv' then convert_to(internal.render_invoice_adjustment_csv(a.id), 'UTF8')
    else internal.render_invoice_adjustment_pdf(a.id, a.status::text) end;
  v_sha := encode(extensions.digest(v_content, 'sha256'), 'hex');
  insert into public.financial_exports
    (agency_organisation_id, source_type, invoice_adjustment_id, source_reference, source_status, format,
     export_version, export_number, file_name, content_type, row_count, total_minor, currency, period_start,
     period_end, sha256, byte_size, generated_by_membership_id)
  values (a.agency_organisation_id, 'invoice_adjustment', a.id, a.reference, a.status::text, p_format, 1,
          (select count(*) + 1 from public.financial_exports e where e.invoice_adjustment_id = a.id and e.format = p_format),
          a.reference || '-DRAFT-INVOICE-ADJUSTMENT.' || p_format,
          case p_format when 'csv' then 'text/csv; charset=utf-8' else 'application/pdf' end,
          a.line_count, a.net_delta_minor, a.currency, a.period_start, a.period_end, v_sha, octet_length(v_content),
          internal.active_membership_id(a.agency_organisation_id))
  returning id into v_id;
  insert into internal.financial_export_files (export_id, agency_organisation_id, content)
  values (v_id, a.agency_organisation_id, v_content);
  if a.status = 'locked' then
    update public.invoice_adjustments x set status = 'exported', exported_at = now() where x.id = a.id;
    perform internal.record_invoice_adjustment_history(a, 'exported', 'exported');
    perform internal.record_audit_event('invoice.adjustment_exported', a.agency_organisation_id, 'invoice_adjustment',
      a.id, jsonb_build_object('reference', a.reference));
  end if;
  perform internal.record_audit_event('invoice.export_created', a.agency_organisation_id, 'financial_export', v_id,
    jsonb_build_object('invoice_adjustment_id', a.id, 'reference', a.reference, 'source_type', 'invoice_adjustment',
                       'format', p_format, 'sha256', v_sha, 'row_count', a.line_count));
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Download: audited denials, returned (not raised) so the audit row commits.
-- -----------------------------------------------------------------------------
drop function public.download_financial_export(uuid);
create function public.download_financial_export(p_export_id uuid)
returns table (
  file_name text,
  content_type text,
  content_base64 text,
  sha256 text,
  byte_size integer,
  denied_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  e public.financial_exports;
  v_content bytea;
  v_side text;
  v_reason text;
begin
  perform internal.require_identity();
  select * into e from public.financial_exports x where x.id = p_export_id;
  v_side := case when e.source_type in ('payroll_batch', 'payroll_adjustment') then 'payroll' else 'invoice' end;
  v_reason := internal.financial_authorize(e.agency_organisation_id, v_side || '.export', 'financial.export_download',
                                           'financial_export', p_export_id);
  if v_reason is not null then
    return query select null::text, null::text, null::text, null::text, null::integer, v_reason;
    return;
  end if;
  if not internal.consume_rate_limit('financial.download:' || auth.uid()::text, 300, interval '1 hour') then
    raise exception 'too many downloads' using errcode = 'CH429';
  end if;
  select f.content into v_content from internal.financial_export_files f
  where f.export_id = e.id and f.agency_organisation_id = e.agency_organisation_id;
  if v_content is null or encode(extensions.digest(v_content, 'sha256'), 'hex') <> e.sha256 then
    raise exception 'the stored export failed its integrity check' using errcode = 'CHY03';
  end if;
  perform internal.record_audit_event(v_side || '.export_downloaded', e.agency_organisation_id, 'financial_export',
    e.id, jsonb_build_object('source_reference', e.source_reference, 'source_type', e.source_type,
                             'format', e.format, 'sha256', e.sha256));
  return query select e.file_name, e.content_type, encode(v_content, 'base64'), e.sha256, e.byte_size, null::text;
end;
$$;

create or replace function public.list_financial_exports(p_source_type text, p_source_id uuid)
returns table (
  financial_export_id uuid,
  source_reference text,
  source_status_at_export text,
  source_status_now text,
  source_attention text,
  format text,
  export_version smallint,
  export_number integer,
  file_name text,
  row_count integer,
  total_minor bigint,
  currency text,
  sha256 text,
  byte_size integer,
  file_ref text,
  generated_at timestamptz,
  generated_by_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_status text;
  v_attention text;
begin
  perform internal.require_identity();
  if p_source_type = 'payroll_batch' then
    select x.agency_organisation_id, x.status::text, internal.payroll_batch_attention(x.id)
      into v_org, v_status, v_attention from public.payroll_batches x where x.id = p_source_id;
  elsif p_source_type = 'invoice_draft' then
    select x.agency_organisation_id, x.status::text, internal.invoice_draft_attention(x.id)
      into v_org, v_status, v_attention from public.invoice_drafts x where x.id = p_source_id;
  elsif p_source_type = 'payroll_adjustment' then
    select x.agency_organisation_id, x.status::text, internal.payroll_adjustment_attention(x.id)
      into v_org, v_status, v_attention from public.payroll_adjustments x where x.id = p_source_id;
  elsif p_source_type = 'invoice_adjustment' then
    select x.agency_organisation_id, x.status::text, internal.invoice_adjustment_attention(x.id)
      into v_org, v_status, v_attention from public.invoice_adjustments x where x.id = p_source_id;
  else
    raise exception 'unknown export source' using errcode = 'CH400';
  end if;
  if v_org is null or not authz.has_capability(v_org,
       case when p_source_type in ('payroll_batch', 'payroll_adjustment') then 'payroll.view' else 'invoice.view' end) then
    raise exception 'source not found' using errcode = case p_source_type
      when 'payroll_batch' then 'CHY06' when 'invoice_draft' then 'CHY07' else 'CHY19' end;
  end if;
  return query
    select e.id, e.source_reference, e.source_status, v_status, v_attention, e.format, e.export_version,
           e.export_number, e.file_name, e.row_count, e.total_minor, e.currency, e.sha256, e.byte_size, e.file_ref,
           e.generated_at, internal.membership_display_name(e.generated_by_membership_id)
    from public.financial_exports e
    where e.source_type = p_source_type
      and p_source_id = coalesce(e.payroll_batch_id, e.invoice_draft_id, e.payroll_adjustment_id, e.invoice_adjustment_id)
    order by e.generated_at desc, e.id;
end;
$$;

revoke all on function
  internal.signed_minor_to_decimal(bigint, smallint),
  internal.csv_int(bigint),
  internal.render_payroll_adjustment_csv(uuid),
  internal.render_invoice_adjustment_csv(uuid),
  internal.pdf_document(text[]),
  internal.render_invoice_adjustment_pdf(uuid, text)
from public, anon, authenticated, service_role;

revoke all on function
  public.create_payroll_adjustment_export(uuid),
  public.create_invoice_adjustment_export(uuid, text),
  public.download_financial_export(uuid)
from public, anon;
grant execute on function
  public.create_payroll_adjustment_export(uuid),
  public.create_invoice_adjustment_export(uuid, text),
  public.download_financial_export(uuid)
to authenticated;
