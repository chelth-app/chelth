# Chelth pilot setup checklist (per pilot agency)

Copy this checklist for each pilot agency. Tick an item only when it has been
checked in production. Write who checked it and when. Routes are relative to
`https://app.chelth.com/app/organisations/<agency-id>`.

Agency: ______________________ Operator: ______________ Date: __________

## Platform (once, before the first agency)

- [ ] Production backup taken and recorded (`PILOT_OPERATIONS.md` §9); PITR decision made
- [ ] All migrations applied: `supabase migration list --linked` shows no local-only or remote-only rows
- [ ] `main` deployed to Production and smoke test passed (`PILOT_SMOKE_TEST.md`)
- [ ] Platform administrator granted to a named operator with the authenticator app enrolled (`PILOT_OPERATIONS.md` §10)
- [ ] Scheduled jobs healthy (`PILOT_OPERATIONS.md` §2)
- [ ] Email: Resend sender domain verified, and a test email received (§3)
- [ ] Scanner: provider configured, and a test PDF scans clean (§4)

## Organization

- [ ] Workspace language set (Settings → Organization → Language & Region)
- [ ] Workspace currency set and saved (cannot change once rates or financial records exist)
- [ ] Agency users invited with the right roles (Settings → Team & Permissions); each admin has enrolled the authenticator app
- [ ] Worker users invited (Workforce → Add Professional), invitations accepted, workers set Active, disciplines assigned

## Facilities

- [ ] Facility records created (Facilities → Add Facility) with the correct timezone
- [ ] Facility relationships active
- [ ] Facility locations added (the check-in sites)
- [ ] Facility photo uploaded and shown to workers on a shift
- [ ] Arrival guidance and worker contact filled in (facility record → worker context)
- [ ] Facility organisation created and linked by the platform administrator, if the facility will use Chelth
- [ ] Facility users invited (Facility Admin, Scheduler, Supervisor as needed); a Facility Admin lands on the facility Overview

## Attendance

- [ ] Geofence configured for every check-in location: enabled, centre, radius, maximum accuracy, outside policy `block`
- [ ] "Require geofencing" switched ON (Settings → Attendance & Geofencing)
- [ ] Every pilot location shows readiness READY
- [ ] Real-device check-in tested inside and outside on Android and iPhone (`PILOT_SMOKE_TEST.md` geofence add-on)

## Compliance

- [ ] Agency baseline requirements set (Compliance → Add a baseline requirement)
- [ ] Facility-specific requirements set (facility record → requirements)
- [ ] Custom requirements created if needed (Settings → Credentials & Compliance → Custom Credential Types)
- [ ] Each pilot worker's credentials submitted, scanned, verified; readiness Ready
- [ ] Workers serving a facility have their compliance shared with it, if the facility uses Chelth

## Rates and time

- [ ] Rate cards created for each discipline/facility in scope (Finance → Rates)
- [ ] Rate versions activated (status Active) with the right effective dates
- [ ] Rounding policy set (Settings → Timesheets & Payroll)
- [ ] Overtime policy reviewed (Settings → Timesheets & Payroll)

## Communication

- [ ] Messaging tested: worker ↔ agency and agency ↔ facility, with unread counts
- [ ] Notification delivery confirmed for assignment, offer, cancellation and reminder
- [ ] Workers know to install the app (Add to Home Screen) and allow location

## Sign-off

- [ ] Smoke test passed for this agency
- [ ] Pilot contacts and escalation path agreed (who to tell, how fast)
