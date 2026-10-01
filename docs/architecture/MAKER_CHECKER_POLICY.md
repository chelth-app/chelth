# Maker / Checker Policy

Status: P0-E7-S3.

## Setting

`agency_financial_settings.financial_maker_checker_required` is a boolean,
**default `false`**.

- Existing agencies keep the S2 workflow unchanged.
- Changing it uses `set_financial_maker_checker(agency, required)`, which
  requires `payroll.approve` **and** `invoice.approve` at **AAL2**. The
  change is audited as `financial.maker_checker_updated`.
- The UI control is on `/payroll` → Payroll settings ("Require a second
  approver").

## Rule

When the setting is on, **the membership that prepared a document may not
approve it** (preparer ≠ approver). This applies to:

- payroll batches (`approve_payroll_batch`);
- invoice drafts (`approve_invoice_draft`);
- payroll adjustments (`approve_payroll_adjustment`);
- invoice adjustments (`approve_invoice_adjustment`).

Lock and export are not restricted further: the second person's approval is
the control point. Requiring a third person was judged unnecessary for this
stage.

The rule is enforced in the database by `internal.financial_authorize`,
comparing `created_by_membership_id` with the caller's active membership. A
refused approval is audited (`financial.action_denied`, reason
`MAKER_CHECKER`) and returned as `(outcome 'denied', reason_code)`. The UI
hides Approve from the preparer and explains why. Approval audit metadata
records whether maker/checker was in force.
