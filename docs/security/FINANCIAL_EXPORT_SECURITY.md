# Financial Export Security

Status: P0-E7-S2.

## Threats and controls

| Threat                                   | Control                                                                                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading another agency's exports         | Metadata RLS: `payroll.view` / `invoice.view` for the export's agency. The download RPC returns `CHY08` (not found, no oracle) to non-viewers.                    |
| Workers / facilities / platform admins   | They hold no financial capability. There is no RLS path and no RPC path (pgTAP C–F, T, U, V, X; integration; E2E 5/6).                                            |
| Direct access to the bytes               | Bytes are in `internal.financial_export_files`: private schema, RLS on, no grants, no policies. pgTAP T and an integration test confirm direct reads fail.        |
| Tampered or corrupted files              | SHA-256 is computed by the database at generation, re-verified on insert, on download (RPC) and again by the route before streaming. Any mismatch fails closed.   |
| Leaked links / replay / expiry           | No signed URL or bearer link exists. Each download is a POST that is re-authorised at request time; a suspended member is refused immediately (integration test). |
| CSRF on the audited download             | POST only, same `Origin` (or `Sec-Fetch-Site: same-origin`) required (`403` otherwise). The auth cookie is SameSite=Lax.                                          |
| Header injection via file name           | File names are generated as `[A-Z0-9-]` + `.csv`/`.pdf`, re-validated before `Content-Disposition`.                                                               |
| Caching / sniffing                       | `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, attachment disposition, allow-listed content types.                                        |
| Spreadsheet formula injection            | `internal.csv_text` neutralises leading `= + - @` (and full-width forms), TAB and CR with a `'` prefix. See FINANCIAL_EXPORT_MODEL §4 (pgTAP W, unit tests).      |
| Malicious content in PDFs                | Text-only PDF with built-in fonts; all text escaped; no links, scripts, annotations, embedded files or remote assets (pgTAP).                                     |
| Pay data leaking into facility documents | Invoice tables have no pay or margin columns. Invoice CSV/PDF are rendered from them only (pgTAP K/U, integration, E2E 4).                                        |
| Bulk exfiltration / flooding             | Rate limits: 120 exports per agency per hour, 300 downloads per user per hour (`CH429`).                                                                          |
| Unaudited access                         | `*.export_created` and `*.export_downloaded` are audited with the checksum. Denials raise errors and are not audited (documented limitation).                     |

## AAL2 decision

`payroll.approve`, `payroll.export`, `invoice.approve` and `invoice.export`
are **privileged**, so they need AAL2.

- **Why:** approval freezes money that will be paid or billed, and exports
  move bulk personal and financial data out of the system.
- **Not AAL2:** viewing and preparing. Neither has an external effect, and
  both are reversible (cancel/void before lock).

## Retention

Export files and metadata are kept indefinitely (append-only), like the
documents they come from. A retention schedule for payroll and billing
records needs legal review per jurisdiction before production.
