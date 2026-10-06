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
  if (data.disciplineName) rows.push(["Discipline", data.disciplineName]);
  return rows;
}

function shortDate(data: NotificationTemplateData): string {
  return data.startAt && data.timezone
    ? formatShiftDate({ startAt: data.startAt, timezone: data.timezone })
    : "an upcoming date";
}

function expiry(data: NotificationTemplateData): string | null {
  if (!data.offerExpiresAt || !data.timezone) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: data.timezone,
    dateStyle: "medium",
    timeStyle: "short",
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

function content(event: NotificationEvent, data: NotificationTemplateData): Content {
  const agency = data.agencyName ?? "Your agency";
  const facility = data.facilityName ?? "the facility";
  const date = shortDate(data);
  const worker = data.workerName ?? "A worker";
  switch (event) {
    case "worker_assigned":
      return {
        subject: `New shift assignment: ${facility}, ${date}`,
        heading: "You have been assigned a shift",
        paragraphs: [
          `${agency} has assigned you the shift below.`,
          "Please sign in to CHELTH to accept or decline it.",
        ],
        details: shiftDetails(data),
        cta: "Review assignment",
      };
    case "assignment_cancelled":
      return {
        subject: `Shift assignment cancelled: ${facility}, ${date}`,
        heading: "Your shift assignment was cancelled",
        paragraphs: [`${agency} has cancelled your assignment to the shift below.`],
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
            subject: `Shift cancelled: ${facility}, ${date}`,
            heading: "A shift you were assigned to was cancelled",
            paragraphs: [`${agency} has cancelled the shift below. You do not need to attend.`],
            details: shiftDetails(data),
            cta: "View my shifts",
          };
    case "shift_offered": {
      const until = expiry(data);
      return {
        subject: `Shift offer: ${facility}, ${date}`,
        heading: "You have been offered a shift",
        paragraphs: [
          `${agency} is offering you the shift below.`,
          until
            ? `Sign in to CHELTH to accept or decline before ${until}. The shift is filled on a first-come basis.`
            : "Sign in to CHELTH to accept or decline. The shift is filled on a first-come basis.",
        ],
        details: shiftDetails(data),
        cta: "Review offer",
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
): RenderedNotification {
  if (!isNotificationEvent(data.event)) throw new Error("unknown notification event");
  const c = content(data.event, data);
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
