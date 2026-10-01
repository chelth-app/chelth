-- =============================================================================
-- Migration: financial_export_rpcs
-- Stage:     P0-E7-S2
--
-- Purpose
--   * create_payroll_export / create_invoice_export — generate a file from a
--     LOCKED (or already exported) document, store bytes + metadata, move the
--     document to `exported` on its first export. payroll.export /
--     invoice.export (privileged ⇒ AAL2). Audited.
--   * download_financial_export — the ONLY path to the bytes. Re-checks the
--     capability for the export's source type (AAL2), re-verifies the stored
--     checksum (fail closed), audits *.export_downloaded and returns the
--     content for the server to stream. No URL is minted, so there is nothing
--     to leak, replay or expire: every download is a fresh authorised request.
--   * list_financial_exports — metadata for the export download UX.
--   * financial_reconciliation — unprepared / adjustment_required / drafted /
--     approved / exported counts and amounts per currency, per side.
--
--   Errors: CHY03 FINANCIAL_DOCUMENT_LOCKED (checksum mismatch) ·
--           CHY04 INVALID_FINANCIAL_TRANSITION · CHY06/CHY07 not found ·
--           CHY08 FINANCIAL_EXPORT_NOT_FOUND
-- =============================================================================

create function public.create_payroll_export(p_batch_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.payroll_batches := internal.payroll_batch_for_write(p_batch_id, 'payroll.export');
  v_content bytea;
  v_id uuid;
  v_sha text;
begin
  if b.status not in ('locked', 'exported') then
    raise exception 'only a locked payroll batch can be exported' using errcode = 'CHY04';
  end if;
  if not internal.consume_rate_limit('financial.export:' || b.agency_organisation_id::text, 120, interval '1 hour') then
    raise exception 'too many exports' using errcode = 'CH429';
  end if;
  v_content := convert_to(internal.render_payroll_csv(b.id), 'UTF8');
  v_sha := encode(extensions.digest(v_content, 'sha256'), 'hex');
  insert into public.financial_exports
    (agency_organisation_id, source_type, payroll_batch_id, source_reference, source_status, format, export_version,
     export_number, file_name, content_type, row_count, total_minor, currency, period_start, period_end, sha256,
     byte_size, generated_by_membership_id)
  values (b.agency_organisation_id, 'payroll_batch', b.id, b.reference, b.status::text, 'csv', 1,
          (select count(*) + 1 from public.financial_exports e where e.payroll_batch_id = b.id and e.format = 'csv'),
          b.reference || '.csv', 'text/csv; charset=utf-8', b.line_count, b.total_pay_minor, b.currency,
          b.period_start, b.period_end, v_sha, octet_length(v_content),
          internal.active_membership_id(b.agency_organisation_id))
  returning id into v_id;
  insert into internal.financial_export_files (export_id, agency_organisation_id, content)
  values (v_id, b.agency_organisation_id, v_content);

  if b.status = 'locked' then
    update public.payroll_batches x set status = 'exported', exported_at = now() where x.id = b.id;
    perform internal.record_payroll_history(b, 'exported', 'exported');
  end if;
  perform internal.record_audit_event('payroll.export_created', b.agency_organisation_id, 'financial_export', v_id,
    jsonb_build_object('payroll_batch_id', b.id, 'reference', b.reference, 'format', 'csv', 'sha256', v_sha,
                       'row_count', b.line_count));
  return v_id;
end;
$$;

create function public.create_invoice_export(p_draft_id uuid, p_format text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.invoice_drafts := internal.invoice_draft_for_write(p_draft_id, 'invoice.export');
  v_content bytea;
  v_id uuid;
  v_sha text;
begin
  if p_format is null or p_format not in ('csv', 'pdf') then
    raise exception 'unknown export format' using errcode = 'CH400';
  end if;
  if d.status not in ('locked', 'exported') then
    raise exception 'only a locked invoice draft can be exported' using errcode = 'CHY04';
  end if;
  if not internal.consume_rate_limit('financial.export:' || d.agency_organisation_id::text, 120, interval '1 hour') then
    raise exception 'too many exports' using errcode = 'CH429';
  end if;
  v_content := case p_format
    when 'csv' then convert_to(internal.render_invoice_csv(d.id), 'UTF8')
    else internal.render_invoice_pdf(d.id, d.status::text) end;
  v_sha := encode(extensions.digest(v_content, 'sha256'), 'hex');
  insert into public.financial_exports
    (agency_organisation_id, source_type, invoice_draft_id, source_reference, source_status, format, export_version,
     export_number, file_name, content_type, row_count, total_minor, currency, period_start, period_end, sha256,
     byte_size, generated_by_membership_id)
  values (d.agency_organisation_id, 'invoice_draft', d.id, d.reference, d.status::text, p_format, 1,
          (select count(*) + 1 from public.financial_exports e where e.invoice_draft_id = d.id and e.format = p_format),
          d.reference || '-DRAFT-INVOICE.' || p_format,
          case p_format when 'csv' then 'text/csv; charset=utf-8' else 'application/pdf' end,
          d.line_count, d.total_bill_minor, d.currency, d.period_start, d.period_end, v_sha, octet_length(v_content),
          internal.active_membership_id(d.agency_organisation_id))
  returning id into v_id;
  insert into internal.financial_export_files (export_id, agency_organisation_id, content)
  values (v_id, d.agency_organisation_id, v_content);

  if d.status = 'locked' then
    update public.invoice_drafts x set status = 'exported', exported_at = now() where x.id = d.id;
    perform internal.record_invoice_history(d, 'exported', 'exported');
  end if;
  perform internal.record_audit_event('invoice.export_created', d.agency_organisation_id, 'financial_export', v_id,
    jsonb_build_object('invoice_draft_id', d.id, 'reference', d.reference, 'format', p_format, 'sha256', v_sha,
                       'row_count', d.line_count));
  return v_id;
end;
$$;

create function public.download_financial_export(p_export_id uuid)
returns table (
  file_name text,
  content_type text,
  content_base64 text,
  sha256 text,
  byte_size integer
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
begin
  perform internal.require_identity();
  select * into e from public.financial_exports x where x.id = p_export_id;
  v_side := case e.source_type when 'payroll_batch' then 'payroll' else 'invoice' end;
  if e.id is null or not authz.has_capability(e.agency_organisation_id, v_side || '.view') then
    raise exception 'export not found' using errcode = 'CHY08';
  end if;
  perform internal.require_capability(e.agency_organisation_id, v_side || '.export');
  if not internal.consume_rate_limit('financial.download:' || auth.uid()::text, 300, interval '1 hour') then
    raise exception 'too many downloads' using errcode = 'CH429';
  end if;
  select f.content into v_content from internal.financial_export_files f
  where f.export_id = e.id and f.agency_organisation_id = e.agency_organisation_id;
  if v_content is null or encode(extensions.digest(v_content, 'sha256'), 'hex') <> e.sha256 then
    raise exception 'the stored export failed its integrity check' using errcode = 'CHY03';
  end if;
  perform internal.record_audit_event(v_side || '.export_downloaded', e.agency_organisation_id, 'financial_export',
    e.id, jsonb_build_object('source_reference', e.source_reference, 'format', e.format, 'sha256', e.sha256));
  return query select e.file_name, e.content_type, encode(v_content, 'base64'), e.sha256, e.byte_size;
end;
$$;

create function public.list_financial_exports(p_source_type text, p_source_id uuid)
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
begin
  perform internal.require_identity();
  if p_source_type = 'payroll_batch' then
    select x.agency_organisation_id into v_org from public.payroll_batches x where x.id = p_source_id;
    if v_org is null or not authz.has_capability(v_org, 'payroll.view') then
      raise exception 'payroll batch not found' using errcode = 'CHY06';
    end if;
    return query
      select e.id, e.source_reference, e.source_status, b.status::text, internal.payroll_batch_attention(b.id),
             e.format, e.export_version, e.export_number, e.file_name, e.row_count, e.total_minor, e.currency,
             e.sha256, e.byte_size, e.file_ref, e.generated_at,
             internal.membership_display_name(e.generated_by_membership_id)
      from public.financial_exports e
      join public.payroll_batches b on b.id = e.payroll_batch_id
      where e.payroll_batch_id = p_source_id
      order by e.generated_at desc, e.id;
  elsif p_source_type = 'invoice_draft' then
    select x.agency_organisation_id into v_org from public.invoice_drafts x where x.id = p_source_id;
    if v_org is null or not authz.has_capability(v_org, 'invoice.view') then
      raise exception 'invoice draft not found' using errcode = 'CHY07';
    end if;
    return query
      select e.id, e.source_reference, e.source_status, d.status::text, internal.invoice_draft_attention(d.id),
             e.format, e.export_version, e.export_number, e.file_name, e.row_count, e.total_minor, e.currency,
             e.sha256, e.byte_size, e.file_ref, e.generated_at,
             internal.membership_display_name(e.generated_by_membership_id)
      from public.financial_exports e
      join public.invoice_drafts d on d.id = e.invoice_draft_id
      where e.invoice_draft_id = p_source_id
      order by e.generated_at desc, e.id;
  else
    raise exception 'unknown export source' using errcode = 'CH400';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reconciliation: where every current priced line stands, per side.
--   unprepared           current, locked, priced, not in a document
--   adjustment_required  current but held back: an earlier revision is in a document
--   drafted              in a draft / reviewed document
--   approved             in an approved / locked document
--   exported             in an exported document
-- Lines in a document are counted whether or not their revision is still
-- current (the document is the record); superseded unclaimed lines are not.
-- -----------------------------------------------------------------------------
create function public.financial_reconciliation(p_organisation_id uuid, p_side text)
returns table (state text, currency text, line_count integer, amount_minor bigint, minutes bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  if p_side = 'pay' then
    perform internal.require_capability(p_organisation_id, 'payroll.view');
    return query
      with rows_ as (
        select case when s.adjustment_required then 'adjustment_required' else 'unprepared' end as state,
               s.currency, s.pay_amount_minor as amount, (s.regular_minutes + s.overtime_minutes)::bigint as minutes
        from internal.payroll_source_lines(p_organisation_id) s
        union all
        select case when b.status in ('draft', 'reviewed') then 'drafted'
                    when b.status in ('approved', 'locked') then 'approved' else 'exported' end,
               l.currency, l.pay_amount_minor, (l.regular_minutes + l.overtime_minutes)::bigint
        from public.payroll_line_claims c
        join public.payroll_batch_lines l on l.id = c.payroll_batch_line_id
        join public.payroll_batches b on b.id = c.payroll_batch_id
        where c.agency_organisation_id = p_organisation_id
      )
      select r.state, r.currency, count(*)::integer, sum(r.amount)::bigint, sum(r.minutes)::bigint
      from rows_ r group by r.state, r.currency
      order by array_position(array['unprepared', 'adjustment_required', 'drafted', 'approved', 'exported'], r.state),
               r.currency;
  elsif p_side = 'bill' then
    perform internal.require_capability(p_organisation_id, 'invoice.view');
    return query
      with rows_ as (
        select case when s.adjustment_required then 'adjustment_required' else 'unprepared' end as state,
               s.currency, s.bill_amount_minor as amount, s.priced_minutes::bigint as minutes
        from internal.invoice_source_lines(p_organisation_id) s
        union all
        select case when d.status in ('draft', 'reviewed') then 'drafted'
                    when d.status in ('approved', 'locked') then 'approved' else 'exported' end,
               l.currency, l.bill_amount_minor, l.priced_minutes::bigint
        from public.invoice_line_claims c
        join public.invoice_draft_lines l on l.id = c.invoice_draft_line_id
        join public.invoice_drafts d on d.id = c.invoice_draft_id
        where c.agency_organisation_id = p_organisation_id
      )
      select r.state, r.currency, count(*)::integer, sum(r.amount)::bigint, sum(r.minutes)::bigint
      from rows_ r group by r.state, r.currency
      order by array_position(array['unprepared', 'adjustment_required', 'drafted', 'approved', 'exported'], r.state),
               r.currency;
  else
    raise exception 'side must be pay or bill' using errcode = 'CH400';
  end if;
end;
$$;

revoke all on function
  public.create_payroll_export(uuid),
  public.create_invoice_export(uuid, text),
  public.download_financial_export(uuid),
  public.list_financial_exports(text, uuid),
  public.financial_reconciliation(uuid, text)
from public, anon;

grant execute on function
  public.create_payroll_export(uuid),
  public.create_invoice_export(uuid, text),
  public.download_financial_export(uuid),
  public.list_financial_exports(text, uuid),
  public.financial_reconciliation(uuid, text)
to authenticated;
