# Claude Implementation — Chelth Facilities

## Primary instruction

**DO NOT REDESIGN.**

Implement the locked Facilities screen inside the canonical Chelth app shell.

Visual source:
`assets/chelth-facilities-locked.png`

Interaction source:
`FACILITIES-INTERACTIONS.md`

## Preserve exactly

- canonical sidebar
- top global search
- user/profile header
- typography
- brand colors
- spacing
- summary cards
- filter layout
- facility table
- status chips
- pagination
- Facility Details drawer
- drawer tabs
- drawer action hierarchy

## Data

Use real Chelth application data.

Each facility row must open its own facility record.

Do not hard-code the example facilities from the screenshot in production.

## Drawer responsiveness

Closed:
- table expands into the freed width;
- no empty reserved drawer column.

Open:
- drawer occupies the locked right-side position;
- table contracts naturally.

Selecting another facility:
- drawer opens if needed;
- content changes to the selected facility.

## Action routing

- Add Facility → canonical facility onboarding
- Create Request → Staffing Request creation pre-scoped to facility
- View Shifts → Shifts filtered to facility
- Message Facility → existing communication flow
- Drawer Request item → Staffing Requests selected request
- Drawer Shift item → Shifts selected shift

## No visual drift

Do not introduce:
- new navigation
- extra KPIs
- mini charts
- AI terminology
- alternate card system
- generic CRM functionality
- decorative animation
- new gradients/shadows outside the locked system

## QA gate

- [ ] canonical shell unchanged
- [ ] Facilities visual matched
- [ ] each facility row opens correct facility
- [ ] drawer close expands table
- [ ] drawer reopen contracts table
- [ ] Overview / Requests / Shifts / Activity tabs work
- [ ] summary shortcuts work
- [ ] filters and search work
- [ ] Add Facility works
- [ ] Create Request preserves facility context
- [ ] View Shifts applies facility filter
- [ ] Message Facility uses existing comms
- [ ] request/shift links preserve record context
- [ ] pagination preserves state
- [ ] keyboard accessibility works
- [ ] no brand drift

## Completion report

Save:
`docs/reports/CHELTH-B3-4-6-facilities-implementation.txt`
