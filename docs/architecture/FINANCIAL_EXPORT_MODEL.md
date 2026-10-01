# Financial Export Model

Status: P0-E7-S2. This is the reusable export infrastructure for payroll
batches and invoice drafts.

## 1. Generation is server-side and deterministic

`create_payroll_export(batch)` and `create_invoice_export(draft, 'csv' |
'pdf')` render the file **in the database** from the locked document's
immutable lines. The browser never supplies content, amounts, row counts or
checksums.

Rendering is a pure function of the locked lines:

- rows ordered by the stored line number;
- no timestamps inside the file;
- no BOM.

The same document therefore always produces byte-identical output. pgTAP and
integration tests show that a re-export has the same SHA-256.

## 2. Export record (`financial_exports`, append-only)

| Field                                 | Meaning                                                    |
| ------------------------------------- | ---------------------------------------------------------- |
| source type + id, source reference    | the payroll batch or invoice draft (composite FK)          |
| source_status                         | document status at export (`locked` or `exported`)         |
| format, export_version                | `csv` / `pdf`; format version `1`                          |
| export_number                         | nth export of that document and format                     |
| file_name, content_type               | generated from the reference; `[A-Z0-9-]` + extension only |
| row_count, total_minor, currency      | copied from the document                                   |
| period_start, period_end              | composite FK to the document                               |
| sha256, byte_size                     | computed over the stored bytes                             |
| file_ref                              | `financial-exports/<agency>/<export id>` (logical ref)     |
| generated_at, generated_by_membership | who generated it                                           |

## 3. Storage

The bytes live in `internal.financial_export_files`:

- in a private schema, with RLS on and **no grant to any API role**;
- checksum and size are re-verified by trigger on insert;
- append-only.

See [../security/FINANCIAL_EXPORT_SECURITY.md](../security/FINANCIAL_EXPORT_SECURITY.md).

## 4. CSV format (version 1)

- RFC 4180, UTF-8 without BOM, CRLF line endings, one header row.
- Every text field is double-quoted, with embedded quotes doubled. Commas,
  newlines and non-ASCII are preserved. An empty value is `""`.
- Integers and ISO dates are unquoted.
- **Formula-injection neutralisation** (`internal.csv_text`), following the
  OWASP CSV-injection guidance:
  - Trigger: the field's first non-whitespace character is `=`, `+`, `-` or
    `@` (or their full-width forms `＝ ＋ － ＠`), or the field begins with
    TAB or CR.
  - Action: the field is prefixed with a single quote `'`, then quoted.
  - Spreadsheets display the value as text; nothing is lost.
  - Tested: pgTAP W, with a name of `=HYPERLINK("http://x","Wendy, ""W""")`
    and a reference of `+W-001`.

## 5. PDF format (invoice drafts)

- Minimal PDF 1.4 built by `internal.render_invoice_pdf`.
- Only the built-in Helvetica fonts are used (WinAnsiEncoding).
- No images, links, annotations, JavaScript, forms, embedded files or remote
  resources. pgTAP checks for the absence of `/URI`, `/JavaScript`,
  `/Launch`, `/EmbeddedFile`, `/XObject`, `/Annots` and `/AA`.
- Every text item is escaped:
  - `\`, `(` and `)` are backslash-escaped;
  - Latin-1 characters become octal escapes;
  - control characters become spaces;
  - anything else becomes `?`.
  - Non-Latin names therefore degrade in the PDF; the CSV keeps them exactly
    (a known limitation).
- Every page is titled **DRAFT INVOICE**, states that it is not a tax invoice
  or a request for payment, and gives the page number.

## 6. Download

`download_financial_export(export)` is the only path to the bytes. It:

1. re-checks `payroll.export` / `invoice.export` for the export's agency
   (AAL2);
2. rate-limits the caller;
3. re-verifies the checksum, failing closed;
4. writes the `payroll.export_downloaded` / `invoice.export_downloaded`
   audit row;
5. returns the content.

The route `POST /app/exports/[exportId]/download` streams the content as an
attachment. It is same-origin only and signed-in only, and it re-verifies the
SHA-256 again before sending. No signed URL is minted.

## 7. Adjustment exports (P0-E7-S3)

Adjustment exports use the same infrastructure, with no weaker path:
database rendering, `financial_exports` plus the private byte store, SHA-256
at generation, insert, download RPC and route, the audited same-origin
download, `csv_text` neutralisation, the content-type allow-list and the
file-name validation.

- **Source types:** `payroll_adjustment` and `invoice_adjustment`, each with
  composite FKs for agency, period and currency. `total_minor` is the
  **signed net delta** (documents stay ≥ 0).
- **Payroll adjustment CSV:**

  ```
  adjustment_reference, original_batch_reference, previous_adjustment_reference,
  worker_reference, worker_name, work_date, facility, discipline,
  original_revision, revised_revision, original_regular_minutes,
  revised_regular_minutes, original_overtime_minutes, revised_overtime_minutes,
  original_pay_amount_minor, revised_pay_amount_minor, delta_pay_amount_minor,
  currency
  ```

- **Invoice adjustment CSV:**

  ```
  adjustment_reference, original_invoice_draft_reference, previous_adjustment_reference,
  direction, facility, relationship_reference, work_date, worker_reference,
  worker_name, discipline, original_revision, revised_revision,
  original_priced_minutes, revised_priced_minutes, original_bill_amount_minor,
  revised_bill_amount_minor, delta_bill_amount_minor, currency
  ```

  It has no pay columns.

- **Numeric columns:** these are database integers. Negative deltas keep
  their `-` sign; a missing side is an empty field. Only text columns are
  formula-neutralised: a quote would corrupt a number, and integers cannot
  carry formulas.
- **Invoice adjustment PDF:** titled **DRAFT INVOICE ADJUSTMENT**, followed
  by "Additional charge" or "Credit". It states "Not a tax invoice, credit
  note or request for payment" and shows the original draft reference, the
  previous adjustment and the revision change. It is text only, escaped,
  with no links, scripts or remote assets. It is built by
  `internal.pdf_document`.
- **Download:** refusals are audited and returned (`denied_reason`); see
  [../security/FINANCIAL_DENIAL_AUDIT.md](../security/FINANCIAL_DENIAL_AUDIT.md).
