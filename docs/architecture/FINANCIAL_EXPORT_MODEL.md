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
