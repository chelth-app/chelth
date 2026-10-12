# Chelth production smoke test (after every deployment)

Target time: 15–20 minutes. Use only the **controlled pilot test records**:
one test agency, one test facility organisation linked to a test facility
record, and test users for an agency admin and scheduler, a facility admin and
a worker. Never change real customer data to run this test.

Record: deployment commit ______ Operator ______ Date/time (UTC) ______

| #   | Step                                                                                                                                                         | Expected                                                                                                                                               | Pass |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| 0   | `curl -s https://app.chelth.com/api/health`                                                                                                                  | `{"status":"ok"}`                                                                                                                                      | [ ]  |
| 1   | **Agency login** (test agency admin). Verify with the authenticator app when asked.                                                                          | Lands on the agency Overview; sidebar shows Operations, Shifts, Attendance, Timesheets, Messages, Workforce, Facilities, Compliance, Finance, Settings | [ ]  |
| 2   | **Facility login** (test facility admin) in a private window                                                                                                 | `/app` opens the facility Overview directly; nav: Overview, Staffing requests, Coverage, Attendance, Compliance, Sign-off, Messages, Settings          | [ ]  |
| 3   | **Worker login** (test worker) on a phone                                                                                                                    | Opens My Shifts (Today / Upcoming / Past)                                                                                                              | [ ]  |
| 4   | **Request a shift**: facility → Request staff → choose the test location, CNA, a date 3+ days ahead, 07:00–15:00 → Submit request                            | Request shows "Requested"; the agency sees it on Shifts                                                                                                | [ ]  |
| 5   | **Assign**: agency → open the request → Accept and open request → assign the test worker                                                                     | Fill shows "1 of 1"; the facility request shows the worker in "Who is coming"                                                                          | [ ]  |
| 6   | **Email**: the worker's inbox                                                                                                                                | "You have a new shift" email arrives within ~2 minutes. "View shift" opens the shift in the app.                                                       | [ ]  |
| 7   | **Worker sees the shift**: My Shifts → Upcoming → open it                                                                                                    | Facility, local date and time in the facility timezone, arrival guidance, photo or fallback                                                            | [ ]  |
| 8   | **Message**: worker → Messages → send to the agency; agency replies                                                                                          | Agency sees the unread count, then the reply arrives; a "You have a new Chelth message regarding your shift" email arrives without the message text    | [ ]  |
| 9   | **Compliance**: agency → Compliance                                                                                                                          | Register loads; test worker Ready (or the expected state). Facility → Compliance shows the shared worker without documents.                            | [ ]  |
| 10  | **Facility coverage**: facility → Coverage → Next 14 days                                                                                                    | Test worker listed on the request, "Accepted"                                                                                                          | [ ]  |
| 11  | **Isolation**: as the facility admin, open `/app/organisations/<test-agency-id>/workforce`, `/rates` and `/payroll`, then another organisation's `/coverage` | Each is "Page not found" (404)                                                                                                                         | [ ]  |
| 12  | **Clean up**: agency cancels the test shift (reason: other)                                                                                                  | Worker gets "Your shift has been canceled" (do not attend); the shift shows Canceled / Cancelled by workspace spelling                                 | [ ]  |
| 13  | **Back end**: `PILOT_OPERATIONS.md` §2–§4 queries                                                                                                            | Jobs succeeded; nothing stuck in `pending`/`retry`; no `scanning` documents older than 1 h                                                             | [ ]  |

If any step fails: stop. Check `PILOT_OPERATIONS.md` §7. If the failure is in
the new deployment, roll back (§8) and record it.

## Add-ons (not every deployment)

**Geofence (after any attendance or geofence change, or a new location)**, on
Android Chrome and iOS Safari standalone:
A outside → refused · B inside → allowed · C near the boundary → matches the
radius · D permission denied → refused with a clear message · E weak accuracy
→ refused · G clock-out with location off → succeeds · H geofence disabled
while required → configuration message. The worker UI never shows coordinates.

**Credential upload (after any credential or scanner change)**: the worker adds
a test credential, uploads a PDF → "Checking document…" → "Document ready"
within a few minutes → submit → the agency verifies → Ready.

**Finance (when finance changes)**: a controlled rate card; for example
$30/h × 457 min, Exact Minutes → $228.50.
