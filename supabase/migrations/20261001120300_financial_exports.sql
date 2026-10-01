-- =============================================================================
-- Migration: financial_exports
-- Stage:     P0-E7-S2
--
-- Purpose
--   Reusable, deterministic financial export infrastructure.
--
--   financial_exports                metadata snapshot per generated file:
--                                    source, source status at export, format,
--                                    export (format) version, row count, total,
--                                    currency, SHA-256, byte size, file ref,
--                                    generated at/by. Append-only.
--   internal.financial_export_files  the bytes. PRIVATE storage: a table in a
--                                    private schema with RLS on and NO grant to
--                                    any API role. Reachable only through the
--                                    audited download RPC (server stream).
--
--   Generation happens HERE, in the database, from the locked document's
--   immutable lines: the browser never supplies content, amounts or checksums.
--   The checksum is computed by the database over the exact stored bytes and
--   re-verified on insert and on download.
--
--   CSV (export version 1): RFC 4180, UTF-8 without BOM, CRLF line endings,
--   header row, every text field double-quoted (embedded quotes doubled),
--   integers and ISO dates unquoted. Formula-injection neutralisation: a text
--   field whose first non-whitespace character is = + - @ (or the full-width
--   forms), or which starts with TAB or CR, is prefixed with a single quote '
--   (OWASP CSV-injection guidance). Rows are ordered by the document's line
--   number, fixed when the document was prepared ⇒ identical bytes and
--   checksum on every re-export.
--
--   PDF (invoice drafts only): minimal PDF 1.4, built-in Helvetica only
--   (WinAnsiEncoding), no images, links, scripts, forms or remote resources.
--   Every text item is escaped (\ ( ) escaped; Latin-1 as octal escapes;
--   anything else replaced by ?). Every page is titled "DRAFT INVOICE".
-- =============================================================================

create table public.financial_exports (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null,
  source_type text not null check (source_type in ('payroll_batch', 'invoice_draft')),
  payroll_batch_id uuid,
  invoice_draft_id uuid,
  source_reference text not null,
  source_status text not null check (source_status in ('locked', 'exported')),
  format text not null check (format in ('csv', 'pdf')),
  export_version smallint not null check (export_version = 1),
  export_number integer not null check (export_number >= 1),
  file_name text not null check (file_name ~ '^[A-Z0-9][A-Z0-9-]{0,80}\.(csv|pdf)$'),
  content_type text not null check (content_type in ('text/csv; charset=utf-8', 'application/pdf')),
  row_count integer not null check (row_count >= 1),
  total_minor bigint not null check (total_minor >= 0),
  currency text not null,
  period_start date not null,
  period_end date not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer not null check (byte_size between 1 and 52428800),
  file_ref text generated always as ('financial-exports/' || agency_organisation_id::text || '/' || id::text) stored,
  generated_at timestamptz not null default now(),
  generated_by_membership_id uuid not null,
  foreign key (payroll_batch_id, agency_organisation_id, period_start, period_end, currency)
    references public.payroll_batches (id, agency_organisation_id, period_start, period_end, currency)
    on delete restrict,
  foreign key (invoice_draft_id, agency_organisation_id, period_start, period_end, currency)
    references public.invoice_drafts (id, agency_organisation_id, period_start, period_end, currency)
    on delete restrict,
  foreign key (generated_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  unique (payroll_batch_id, format, export_number),
  unique (invoice_draft_id, format, export_number),
  unique (id, agency_organisation_id),
  check ((source_type = 'payroll_batch') = (payroll_batch_id is not null)),
  check ((source_type = 'invoice_draft') = (invoice_draft_id is not null)),
  check (source_type = 'invoice_draft' or format = 'csv'),
  check ((format = 'csv') = (content_type = 'text/csv; charset=utf-8'))
);

comment on table public.financial_exports is
  'Metadata of generated financial export files (append-only). The bytes live in internal.financial_export_files.';

create index financial_exports_payroll_idx on public.financial_exports (payroll_batch_id, generated_at desc);
create index financial_exports_invoice_idx on public.financial_exports (invoice_draft_id, generated_at desc);

create trigger financial_exports_immutable
  before update or delete on public.financial_exports
  for each row execute function internal.refuse_update_delete();
create trigger financial_exports_no_truncate
  before truncate on public.financial_exports
  for each statement execute function internal.refuse_update_delete();

create table internal.financial_export_files (
  export_id uuid primary key,
  agency_organisation_id uuid not null,
  content bytea not null,
  foreign key (export_id, agency_organisation_id)
    references public.financial_exports (id, agency_organisation_id) on delete restrict
);
alter table internal.financial_export_files enable row level security;
-- No policies and no grants: unreachable from any API role.

create function internal.verify_financial_export_file()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  e public.financial_exports;
begin
  select * into e from public.financial_exports x where x.id = new.export_id;
  if e.id is null
     or encode(extensions.digest(new.content, 'sha256'), 'hex') <> e.sha256
     or octet_length(new.content) <> e.byte_size then
    raise exception 'export file does not match its checksum' using errcode = 'CHY03';
  end if;
  return new;
end;
$$;

create trigger financial_export_files_verify
  before insert on internal.financial_export_files
  for each row execute function internal.verify_financial_export_file();
create trigger financial_export_files_immutable
  before update or delete on internal.financial_export_files
  for each row execute function internal.refuse_update_delete();
create trigger financial_export_files_no_truncate
  before truncate on internal.financial_export_files
  for each statement execute function internal.refuse_update_delete();

alter table public.financial_exports enable row level security;
grant select on public.financial_exports to authenticated;
create policy financial_exports_select on public.financial_exports for select to authenticated
  using (case source_type
           when 'payroll_batch' then authz.has_capability(agency_organisation_id, 'payroll.view')
           else authz.has_capability(agency_organisation_id, 'invoice.view') end);

-- -----------------------------------------------------------------------------
-- CSV
-- -----------------------------------------------------------------------------
-- One quoted, formula-neutralised text field.
create function internal.csv_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '"' || replace(
           case when coalesce(p_value, '') ~ ('^([[:space:]]*[=+@＝＋－＠-]|[' || E'\t\r' || '])')
                then '''' || p_value else coalesce(p_value, '') end,
           '"', '""') || '"'
$$;

create function internal.render_payroll_csv(p_batch_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'batch_reference,worker_reference,worker_name,period_start,period_end,work_date,facility,discipline,'
         || 'regular_minutes,overtime_minutes,pay_rate_minor,pay_amount_minor,currency' || E'\r\n'
         || coalesce(string_agg(
              internal.csv_text(b.reference) || ',' ||
              internal.csv_text(l.worker_reference) || ',' ||
              internal.csv_text(l.worker_name) || ',' ||
              l.period_start::text || ',' ||
              l.period_end::text || ',' ||
              l.work_date::text || ',' ||
              internal.csv_text(l.facility_name) || ',' ||
              internal.csv_text(l.discipline_name) || ',' ||
              l.regular_minutes::text || ',' ||
              l.overtime_minutes::text || ',' ||
              l.pay_rate_minor::text || ',' ||
              l.pay_amount_minor::text || ',' ||
              internal.csv_text(l.currency) || E'\r\n',
              '' order by l.line_number), '')
  from public.payroll_batches b
  join public.payroll_batch_lines l on l.payroll_batch_id = b.id
  where b.id = p_batch_id
$$;

create function internal.render_invoice_csv(p_draft_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'invoice_draft_reference,facility,relationship_reference,period_start,period_end,work_date,'
         || 'worker_reference,worker_name,discipline,priced_minutes,bill_rate_minor,bill_amount_minor,currency' || E'\r\n'
         || coalesce(string_agg(
              internal.csv_text(d.reference) || ',' ||
              internal.csv_text(d.facility_name) || ',' ||
              internal.csv_text(d.relationship_id::text) || ',' ||
              l.period_start::text || ',' ||
              l.period_end::text || ',' ||
              l.work_date::text || ',' ||
              internal.csv_text(l.worker_reference) || ',' ||
              internal.csv_text(l.worker_name) || ',' ||
              internal.csv_text(l.discipline_name) || ',' ||
              l.priced_minutes::text || ',' ||
              l.bill_rate_minor::text || ',' ||
              l.bill_amount_minor::text || ',' ||
              internal.csv_text(l.currency) || E'\r\n',
              '' order by l.line_number), '')
  from public.invoice_drafts d
  join public.invoice_draft_lines l on l.invoice_draft_id = d.id
  where d.id = p_draft_id
$$;

-- -----------------------------------------------------------------------------
-- PDF (invoice drafts)
-- -----------------------------------------------------------------------------
-- Escaped content of a PDF literal string; the result is pure ASCII.
create function internal.pdf_text(p_value text, p_max integer default 200)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out text := '';
  v_char text;
  v_code integer;
  v_value text := coalesce(p_value, '');
begin
  if v_value = '' then
    return '';
  end if;
  if char_length(v_value) > p_max then
    v_value := left(v_value, p_max - 3) || '...';
  end if;
  foreach v_char in array regexp_split_to_array(v_value, '') loop
    v_code := ascii(v_char);
    if v_char in ('\', '(', ')') then
      v_out := v_out || '\' || v_char;
    elsif v_code between 32 and 126 then
      v_out := v_out || v_char;
    elsif v_code between 160 and 255 then
      v_out := v_out || '\' || (v_code / 64)::text || ((v_code / 8) % 8)::text || (v_code % 8)::text;
    elsif v_code < 32 then
      v_out := v_out || ' ';
    else
      v_out := v_out || '?';
    end if;
  end loop;
  return v_out;
end;
$$;

-- Exact decimal text of a non-negative minor-unit amount.
create function internal.minor_to_decimal(p_amount bigint, p_digits smallint)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_digits = 0 then p_amount::text
              else (p_amount / (10 ^ p_digits)::bigint)::text || '.'
                   || lpad((p_amount % (10 ^ p_digits)::bigint)::text, p_digits, '0') end
$$;

create function internal.pdf_line(p_font text, p_size integer, p_x integer, p_y integer, p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'BT /' || p_font || ' ' || p_size || ' Tf ' || p_x || ' ' || p_y || ' Td (' || p_text || ') Tj ET' || E'\n'
$$;

create function internal.render_invoice_pdf(p_draft_id uuid, p_status_at_export text)
returns bytea
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.invoice_drafts;
  v_digits smallint;
  v_rows_per_page constant integer := 40;
  v_pages integer;
  v_y integer;
  v_stream text;
  v_objects text[] := array[]::text[];
  v_kids text := '';
  v_doc text;
  v_offsets integer[] := array[]::integer[];
  v_xref text;
  l record;
begin
  select * into d from public.invoice_drafts x where x.id = p_draft_id;
  select c.minor_unit_digits into v_digits from public.currencies c where c.code = d.currency;
  v_pages := greatest(1, ceil(d.line_count::numeric / v_rows_per_page)::integer);

  v_objects := v_objects || '<< /Type /Catalog /Pages 2 0 R >>'::text;
  v_objects := v_objects || ''::text; -- page tree, filled below
  v_objects := v_objects || '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'::text;
  v_objects := v_objects || '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'::text;

  for v_page_index in 1 .. v_pages loop
    v_stream := internal.pdf_line('F2', 18, 40, 750, 'DRAFT INVOICE')
      || internal.pdf_line('F1', 8, 40, 736, 'Internal draft for review. Not a tax invoice. Not a request for payment. '
                                             || 'No tax has been calculated.')
      || internal.pdf_line('F1', 9, 40, 716, 'Reference: ' || internal.pdf_text(d.reference)
                                             || '    Status at export: ' || internal.pdf_text(p_status_at_export))
      || internal.pdf_line('F1', 9, 40, 703, 'Agency: ' || internal.pdf_text(d.agency_name, 90))
      || internal.pdf_line('F1', 9, 40, 690, 'Facility: ' || internal.pdf_text(d.facility_name, 90))
      || internal.pdf_line('F1', 9, 40, 677, 'Relationship: ' || d.relationship_id::text)
      || internal.pdf_line('F1', 9, 40, 664, 'Period: ' || d.period_start::text || ' to ' || d.period_end::text
                                             || '    Currency: ' || internal.pdf_text(d.currency))
      || internal.pdf_line('F2', 8, 40, 640, 'Work date')
      || internal.pdf_line('F2', 8, 100, 640, 'Worker')
      || internal.pdf_line('F2', 8, 250, 640, 'Worker ref')
      || internal.pdf_line('F2', 8, 330, 640, 'Discipline')
      || internal.pdf_line('F2', 8, 430, 640, 'Minutes')
      || internal.pdf_line('F2', 8, 475, 640, 'Rate / hour')
      || internal.pdf_line('F2', 8, 530, 640, 'Amount');
    v_y := 626;
    for l in
      select x.* from public.invoice_draft_lines x
      where x.invoice_draft_id = p_draft_id
      order by x.line_number
      offset (v_page_index - 1) * v_rows_per_page limit v_rows_per_page
    loop
      v_stream := v_stream
        || internal.pdf_line('F1', 8, 40, v_y, l.work_date::text)
        || internal.pdf_line('F1', 8, 100, v_y, internal.pdf_text(l.worker_name, 30))
        || internal.pdf_line('F1', 8, 250, v_y, internal.pdf_text(l.worker_reference, 14))
        || internal.pdf_line('F1', 8, 330, v_y, internal.pdf_text(l.discipline_name, 20))
        || internal.pdf_line('F1', 8, 430, v_y, l.priced_minutes::text)
        || internal.pdf_line('F1', 8, 475, v_y, internal.minor_to_decimal(l.bill_rate_minor, v_digits))
        || internal.pdf_line('F1', 8, 530, v_y, internal.minor_to_decimal(l.bill_amount_minor, v_digits));
      v_y := v_y - 13;
    end loop;
    if v_page_index = v_pages then
      v_stream := v_stream
        || internal.pdf_line('F2', 9, 40, v_y - 12, 'Draft total (bill side, before any tax): '
                             || internal.minor_to_decimal(d.total_bill_minor, v_digits) || ' '
                             || internal.pdf_text(d.currency) || '    Lines: ' || d.line_count::text
                             || '    Minutes: ' || d.total_priced_minutes::text);
    end if;
    v_stream := v_stream
      || internal.pdf_line('F1', 8, 40, 30, 'DRAFT INVOICE ' || internal.pdf_text(d.reference)
                                            || ' - page ' || v_page_index || ' of ' || v_pages);
    -- page object, then its content stream
    v_kids := v_kids || (5 + (v_page_index - 1) * 2)::text || ' 0 R ';
    v_objects := v_objects || ('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R '
                               || '/F2 4 0 R >> >> /Contents ' || (6 + (v_page_index - 1) * 2)::text || ' 0 R >>');
    v_objects := v_objects || ('<< /Length ' || octet_length(v_stream) || ' >>' || E'\nstream\n' || v_stream
                               || 'endstream');
  end loop;
  v_objects[2] := '<< /Type /Pages /Kids [ ' || v_kids || '] /Count ' || v_pages || ' >>';

  v_doc := E'%PDF-1.4\n';
  for v_object_index in 1 .. cardinality(v_objects) loop
    v_offsets := v_offsets || octet_length(v_doc);
    v_doc := v_doc || v_object_index::text || E' 0 obj\n' || v_objects[v_object_index] || E'\nendobj\n';
  end loop;
  v_xref := 'xref' || E'\n' || '0 ' || (cardinality(v_objects) + 1)::text || E'\n' || E'0000000000 65535 f \n';
  for v_offset_index in 1 .. cardinality(v_offsets) loop
    v_xref := v_xref || lpad(v_offsets[v_offset_index]::text, 10, '0') || E' 00000 n \n';
  end loop;
  return convert_to(v_doc || v_xref || 'trailer' || E'\n' || '<< /Size ' || (cardinality(v_objects) + 1)::text
                    || ' /Root 1 0 R >>' || E'\nstartxref\n' || octet_length(v_doc)::text || E'\n%%EOF\n', 'UTF8');
end;
$$;

revoke all on function
  internal.verify_financial_export_file(),
  internal.csv_text(text),
  internal.render_payroll_csv(uuid),
  internal.render_invoice_csv(uuid),
  internal.pdf_text(text, integer),
  internal.minor_to_decimal(bigint, smallint),
  internal.pdf_line(text, integer, integer, integer, text),
  internal.render_invoice_pdf(uuid, text)
from public, anon, authenticated, service_role;
