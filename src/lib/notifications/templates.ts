import { z } from "zod";

import { formatShiftDate, formatShiftTimeRange } from "@/lib/domain/shifts";
import { escapeHtml } from "@/lib/email/html";

import { isNotificationEvent, type NotificationEvent } from "./vocabulary";

/**
 * Template data resolved by the database at claim time
 * (internal.notification_template). Display strings only — never ids in
 * visible text, never credentials, notes or compliance detail.
 */
export const notificationTemplateSchema = z.object({
  event: z.string().refine(isNotificationEvent),
  audience: z.enum(["worker", "agency", "facility"]),
  path: z.string().regex(/^\/app\/organisations\/[0-9a-f-]{36}(\/[a-z-]+(\/[0-9a-f-]{36})?)?$/),
  recipientName: z.string().nullish(),
  agencyName: z.string().nullish(),
  facilityName: z.string().nullish(),
  locationName: z.string().nullish(),
  disciplineName: z.string().nullish(),
  startAt: z.string().nullish(),
  endAt: z.string().nullish(),
  timezone: z.string().nullish(),
  workerName: z.string().nullish(),
  offerExpiresAt: z.string().nullish(),
  upcomingShifts: z.number().int().nullish(),
  cancelledShifts: z.number().int().nullish(),
  flaggedAssignments: z.number().int().nullish(),
  periodStart: z.iso.date().nullish(),
  periodEnd: z.iso.date().nullish(),
  reopened: z.boolean().nullish(),
  // P0-E9-3G (worker shift emails)
  unitLabel: z.string().nullish(),
  arrivalInstructions: z.string().max(280).nullish(),
  changes: z.array(z.enum(["date", "time", "location", "role", "unit"])).nullish(),
  previousStartAt: z.string().nullish(),
  previousEndAt: z.string().nullish(),
  previousUnitLabel: z.string().nullish(),
  previousLocationName: z.string().nullish(),
  previousDisciplineName: z.string().nullish(),
});
export type NotificationTemplateData = z.infer<typeof notificationTemplateSchema>;

export type RenderedNotification = { subject: string; html: string; text: string };

type Content = {
  subject: string;
  heading: string;
  paragraphs: string[];
  details: [string, string][];
  cta: string;
};

function shiftDetails(data: NotificationTemplateData): [string, string][] {
  const rows: [string, string][] = [];
  if (data.facilityName) rows.push(["Facility", data.facilityName]);
  if (data.locationName) rows.push(["Location", data.locationName]);
  if (data.startAt && data.endAt && data.timezone) {
    const times = { startAt: data.startAt, endAt: data.endAt, timezone: data.timezone };
    rows.push(["Date", formatShiftDate(times)]);
    rows.push(["Time", formatShiftTimeRange(times)]);
    rows.push(["Timezone", data.timezone]);
  }
  if (data.disciplineName) rows.push(["Role", data.disciplineName]);
  if (data.unitLabel) rows.push(["Unit", data.unitLabel]);
  return rows;
}

function timeRange(startAt: string, endAt: string, timezone: string): string {
  return `${formatShiftDate({ startAt, timezone })}, ${formatShiftTimeRange({ startAt, endAt, timezone })}`;
}

/** P0-E9-3G: only the fields that changed, previous → updated. */
function changeDetails(data: NotificationTemplateData): [string, string][] {
  const rows: [string, string][] = [];
  const changes = data.changes ?? [];
  const tz = data.timezone;
  if ((changes.includes("time") || changes.includes("date")) && tz) {
    if (data.previousStartAt && data.previousEndAt) {
      rows.push(["Previous", timeRange(data.previousStartAt, data.previousEndAt, tz)]);
    }
    if (data.startAt && data.endAt) rows.push(["Updated", timeRange(data.startAt, data.endAt, tz)]);
  }
  if (changes.includes("location")) {
    rows.push(["Previous location", data.previousLocationName ?? "—"]);
    rows.push(["Updated location", data.locationName ?? "—"]);
  }
  if (changes.includes("role")) {
    rows.push(["Previous role", data.previousDisciplineName ?? "—"]);
    rows.push(["Updated role", data.disciplineName ?? "—"]);
  }
  if (changes.includes("unit")) {
    rows.push(["Previous unit", data.previousUnitLabel ?? "Not set"]);
    rows.push(["Updated unit", data.unitLabel ?? "Not set"]);
  }
  return rows;
}

const CHANGE_LABELS: Record<string, string> = {
  date: "date",
  time: "time",
  location: "location",
  role: "role",
  unit: "unit",
};

function changeSummary(data: NotificationTemplateData): string {
  const changes = (data.changes ?? []).filter(
    (change) => !(change === "date" && data.changes?.includes("time")),
  );
  const labels = changes.map((change) => CHANGE_LABELS[change] ?? change);
  if (labels.length === 0) return "The shift details were updated.";
  const list =
    labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
  return `Shift ${list} changed.`;
}

/** "tomorrow" / "today" / "on Tue, Oct 13" in the FACILITY's calendar (never the device's). */
function relativeDay(data: NotificationTemplateData, now: Date): string {
  if (!data.startAt || !data.timezone) return "soon";
  const day = (instant: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: data.timezone ?? "UTC" }).format(instant);
  const start = day(new Date(data.startAt));
  const today = day(now);
  const tomorrow = day(new Date(now.getTime() + 86_400_000));
  if (start === today) return "today";
  if (start === tomorrow) return "tomorrow";
  return `on ${formatShiftDate({ startAt: data.startAt, timezone: data.timezone })}`;
}

function arrival(data: NotificationTemplateData): string[] {
  return data.arrivalInstructions ? [`Arrival: ${data.arrivalInstructions}`] : [];
}

function shortDate(data: NotificationTemplateData): string {
  return data.startAt && data.timezone
    ? formatShiftDate({ startAt: data.startAt, timezone: data.timezone })
    : "an upcoming date";
}

function expiry(data: NotificationTemplateData): string | null {
  if (!data.offerExpiresAt || !data.timezone) return null;
  // P0-E9-3G fix: dateStyle / timeStyle cannot be combined with timeZoneName
  // (Intl throws), which made every offer email with an expiry fail to render.
  return new Intl.DateTimeFormat("en-US", {
    timeZone: data.timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(data.offerExpiresAt));
}

/** "Mar 2 – Mar 8, 2030" for a timesheet week (dates are calendar dates, not instants). */
function period(data: NotificationTemplateData): string {
  if (!data.periodStart || !data.periodEnd) return "a recent week";
  const format = (value: string, withYear: boolean) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" } : {}),
    }).format(new Date(`${value}T00:00:00Z`));
  return `${format(data.periodStart, false)} – ${format(data.periodEnd, true)}`;
}

function content(event: NotificationEvent, data: NotificationTemplateData, now: Date): Content {
  const agency = data.agencyName ?? "Your agency";
  const facility = data.facilityName ?? "the facility";
  const date = shortDate(data);
  const worker = data.workerName ?? "A worker";
  switch (event) {
    case "worker_assigned":
      return {
        subject: "You have a new shift",
        heading: "You have a new shift",
        paragraphs: [
          `${agency} has assigned you to the shift below.`,
          "Open Chelth to confirm you can work it.",
          ...arrival(data),
        ],
        details: shiftDetails(data),
        cta: "View shift",
      };
    case "assignment_cancelled":
      return {
        subject: "Your shift has been cancelled",
        heading: "Your shift has been cancelled",
        paragraphs: [
          `${agency} has cancelled your assignment to the shift below.`,
          "You do not need to attend.",
        ],
        details: shiftDetails(data),
        cta: "View my shifts",
      };
    case "shift_cancelled":
      return data.audience === "facility"
        ? {
            subject: `Staffing request cancelled: ${date}`,
            heading: "A staffing request was cancelled",
            paragraphs: [`The shift below with ${agency} has been cancelled.`],
            details: shiftDetails(data),
            cta: "View request",
          }
        : {
            subject: "Your shift has been cancelled",
            heading: "Your shift has been cancelled",
            paragraphs: [`${agency} has cancelled the shift below.`, "You do not need to attend."],
            details: shiftDetails(data),
            cta: "View my shifts",
          };
    case "shift_changed":
      return {
        subject: "Your shift has been updated",
        heading: "Your shift has been updated",
        paragraphs: [`${agency} updated your shift at ${facility}.`, changeSummary(data)],
        details: [...changeDetails(data), ...shiftDetails(data)],
        cta: "Review updated shift",
      };
    case "shift_reminder": {
      const when = relativeDay(data, now);
      return {
        subject: `Reminder: your shift is ${when}`,
        heading: `Your shift is ${when}`,
        paragraphs: [`A reminder of your shift at ${facility} with ${agency}.`, ...arrival(data)],
        details: shiftDetails(data),
        cta: "View shift",
      };
    }
    case "shift_offered": {
      const until = expiry(data);
      return {
        subject: "New shift available",
        heading: "A new shift is available",
        paragraphs: [
          `${agency} is offering you the shift below. It is not yours until you accept it.`,
          until
            ? `Review it in Chelth before ${until}. Shifts are filled on a first-come basis.`
            : "Review it in Chelth. Shifts are filled on a first-come basis.",
        ],
        details: shiftDetails(data),
        cta: "Review shift",
      };
    }
    case "assignment_declined":
      return {
        subject: `${worker} declined a shift: ${facility}, ${date}`,
        heading: "An assignment was declined",
        paragraphs: [`${worker} declined the shift below. It may need another worker.`],
        details: shiftDetails(data),
        cta: "Open shift",
      };
    case "facility_request_submitted":
      return {
        subject: `New staffing request from ${facility}: ${date}`,
        heading: "New staffing request",
        paragraphs: [
          `${facility} has requested staff. Review and open the request to start filling it.`,
        ],
        details: shiftDetails(data),
        cta: "Review request",
      };
    case "facility_request_opened":
      return {
        subject: `${agency} is filling your staffing request: ${date}`,
        heading: "Your staffing request was accepted",
        paragraphs: [`${agency} has opened your request and is assigning staff.`],
        details: shiftDetails(data),
        cta: "View request",
      };
    case "assignment_non_compliant":
      return {
        subject: `Assignment needs attention: ${facility}, ${date}`,
        heading: "An upcoming assignment needs attention",
        paragraphs: [
          `${worker} no longer meets the requirements for the shift below.`,
          "Review the assignment in CHELTH before the shift starts.",
        ],
        details: shiftDetails(data),
        cta: "Review assignment",
      };
    case "attendance_clock_in_late":
      return {
        subject: `Late clock-in: ${worker}, ${facility}, ${date}`,
        heading: "A worker clocked in late",
        paragraphs: [`${worker} clocked in after the late threshold for the shift below.`],
        details: shiftDetails(data),
        cta: "Review attendance",
      };
    case "attendance_clock_in_blocked":
      return {
        subject: `Clock-in refused: ${worker}, ${facility}, ${date}`,
        heading: "A clock-in was refused",
        paragraphs: [
          `${worker} tried to clock in for the shift below, but Chelth could not record it.`,
          "Review the attendance exception in Chelth.",
        ],
        details: shiftDetails(data),
        cta: "Review attendance",
      };
    case "attendance_missed_clock_in":
      return {
        subject: `No clock-in yet: ${worker}, ${facility}, ${date}`,
        heading: "An assigned worker has not clocked in",
        paragraphs: [`${worker} has not clocked in for the shift below, which has started.`],
        details: shiftDetails(data),
        cta: "Review attendance",
      };
    case "attendance_missed_clock_out":
      return data.audience === "worker"
        ? {
            subject: `Clock-out missing: ${facility}, ${date}`,
            heading: "You did not clock out",
            paragraphs: [
              "Your shift below has ended but no clock-out was recorded.",
              "Sign in to CHELTH and request a correction with the time you finished.",
            ],
            details: shiftDetails(data),
            cta: "View my shifts",
          }
        : {
            subject: `No clock-out: ${worker}, ${facility}, ${date}`,
            heading: "A worker has not clocked out",
            paragraphs: [`${worker} has not clocked out for the shift below, which has ended.`],
            details: shiftDetails(data),
            cta: "Review attendance",
          };
    case "attendance_correction_requested":
      return {
        subject: `Attendance correction requested: ${worker}, ${date}`,
        heading: "An attendance correction needs review",
        paragraphs: [`${worker} asked to correct a clock time for the shift below.`],
        details: shiftDetails(data),
        cta: "Review correction",
      };
    case "attendance_correction_approved":
    case "attendance_correction_rejected": {
      const approved = event === "attendance_correction_approved";
      return {
        subject: `Attendance correction ${approved ? "approved" : "not approved"}: ${facility}, ${date}`,
        heading: `Your attendance correction was ${approved ? "approved" : "not approved"}`,
        paragraphs: [
          approved
            ? "Your corrected clock time has been recorded."
            : "Your agency did not approve the requested time. Contact them if you have questions.",
        ],
        details: shiftDetails(data),
        cta: "View my shifts",
      };
    }
    case "attendance_time_adjusted":
      return {
        subject: `Attendance time adjusted: ${facility}, ${date}`,
        heading: "Your attendance time was adjusted",
        paragraphs: [
          `${agency} recorded a different time for the shift below, with a reason.`,
          "Sign in to CHELTH to see the original time, the change and the reason.",
        ],
        details: shiftDetails(data),
        cta: "View my shifts",
      };
    case "timesheet_submitted":
      return {
        subject: `Timesheet submitted: ${worker}, ${period(data)}`,
        heading: "A timesheet is ready for review",
        paragraphs: [`${worker} submitted their timesheet for ${period(data)}.`],
        details: [],
        cta: "Review timesheet",
      };
    case "timesheet_rejected":
      return {
        subject: `Timesheet returned: ${period(data)}`,
        heading: data.reopened ? "Your timesheet was reopened" : "Your timesheet was returned",
        paragraphs: [
          `${agency} returned your timesheet for ${period(data)}.`,
          "Sign in to CHELTH to see why, fix any times with a correction request, and submit it again.",
        ],
        details: [],
        cta: "Open timesheet",
      };
    case "timesheet_facility_signoff_required":
      return {
        subject: `Timesheet entries to sign off: ${agency}, ${period(data)}`,
        heading: "Timesheet entries need your sign-off",
        paragraphs: [
          `${agency} approved worked time at your facility for ${period(data)}.`,
          "Sign in to CHELTH to sign off each entry or raise a discrepancy.",
        ],
        details: [],
        cta: "Review entries",
      };
    case "timesheet_disputed":
      return {
        subject: `Timesheet discrepancy: ${worker}, ${period(data)}`,
        heading: "A facility raised a timesheet discrepancy",
        paragraphs: [
          `A facility did not sign off an entry on ${worker}'s timesheet for ${period(data)}.`,
          "Review the discrepancy in CHELTH.",
        ],
        details: [],
        cta: "Review timesheet",
      };
    case "message_received":
      // P0-E9-3D-S3: never the message body — only that there is one, and where.
      return {
        subject: "You have a new Chelth message regarding your shift",
        heading: "You have a new message",
        paragraphs: [
          `${agency} sent you a message in Chelth.`,
          "Sign in to read and reply. For your privacy, the message itself is not included in this e-mail.",
        ],
        details: data.startAt ? shiftDetails(data) : [],
        cta: "Open message",
      };
    case "pricing_blocked_missing_rate":
      return {
        subject: `Pricing blocked: ${worker}, ${period(data)}`,
        heading: "A locked timesheet could not be priced",
        paragraphs: [
          `${worker}'s timesheet for ${period(data)} needs a rate that is not configured.`,
          "Open pricing in CHELTH to see which work is missing a rate.",
        ],
        details: [],
        cta: "Open pricing",
      };
    case "relationship_suspended":
    case "relationship_ended": {
      const verb = event === "relationship_ended" ? "ended" : "suspended";
      const lines = [
        `The relationship with ${facility} was ${verb}. No new shifts or assignments can be created.`,
      ];
      if (data.upcomingShifts) lines.push(`${data.upcomingShifts} upcoming shift(s) are affected.`);
      if (data.cancelledShifts)
        lines.push(`${data.cancelledShifts} not-yet-started shift(s) were cancelled.`);
      if (data.flaggedAssignments)
        lines.push(`${data.flaggedAssignments} assignment(s) need attention.`);
      return {
        subject: `Relationship ${verb}: ${facility}`,
        heading: `Relationship ${verb}`,
        paragraphs: lines,
        details: [],
        cta: "Open operations",
      };
    }
  }
}

const FONT = "font-family:Arial,Helvetica,sans-serif";

/** Branded, restrained, accessible HTML with a plain-text alternative. All values escaped. */
export function renderNotification(
  data: NotificationTemplateData,
  baseUrl: string,
  now: Date = new Date(),
): RenderedNotification {
  if (!isNotificationEvent(data.event)) throw new Error("unknown notification event");
  const c = content(data.event, data, now);
  const url = `${baseUrl}${data.path}`;
  const greeting = data.recipientName ? `Hello ${data.recipientName},` : "Hello,";

  const detailsHtml =
    c.details.length === 0
      ? ""
      : `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;border-collapse:collapse">${c.details
          .map(
            ([label, value]) =>
              `<tr><td style="${FONT};padding:6px 12px 6px 0;color:#475569;font-size:14px;width:110px;vertical-align:top">${escapeHtml(label)}</td><td style="${FONT};padding:6px 0;color:#0f172a;font-size:14px">${escapeHtml(value)}</td></tr>`,
          )
          .join("")}</table>`;

  const html = [
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(c.subject)}</title></head>`,
    `<body style="margin:0;padding:0;background:#f1f5f9">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:24px 12px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden">`,
    `<tr><td><img src="${escapeHtml(`${baseUrl}/email/chelth-email-banner.png`)}" width="600" alt="CHELTH" style="display:block;width:100%;height:auto;border:0"></td></tr>`,
    `<tr><td style="padding:24px">`,
    `<h1 style="${FONT};font-size:20px;line-height:28px;color:#126B67;margin:0 0 16px">${escapeHtml(c.heading)}</h1>`,
    `<p style="${FONT};font-size:15px;line-height:22px;color:#0f172a;margin:0 0 12px">${escapeHtml(greeting)}</p>`,
    ...c.paragraphs.map(
      (paragraph) =>
        `<p style="${FONT};font-size:15px;line-height:22px;color:#0f172a;margin:0 0 12px">${escapeHtml(paragraph)}</p>`,
    ),
    detailsHtml,
    `<p style="margin:20px 0"><a href="${escapeHtml(url)}" style="${FONT};display:inline-block;background:#126B67;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 20px;border-radius:6px">${escapeHtml(c.cta)}</a></p>`,
    `<p style="${FONT};font-size:13px;line-height:20px;color:#475569;margin:16px 0 0">This is a required operational notification from CHELTH. Sign in to CHELTH to see full details and respond.</p>`,
    `</td></tr></table></td></tr></table></body></html>`,
  ].join("");

  const text = [
    c.heading,
    "",
    greeting,
    "",
    ...c.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    ...c.details.map(([label, value]) => `${label}: ${value}`),
    ...(c.details.length > 0 ? [""] : []),
    `${c.cta}: ${url}`,
    "",
    "This is a required operational notification from CHELTH.",
  ].join("\n");

  return { subject: c.subject, html, text };
}
