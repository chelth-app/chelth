import {
  DISPUTE_REASON_LABELS,
  REJECTION_REASON_LABELS,
  REOPEN_REASON_LABELS,
} from "@/lib/domain/timesheets";

/** Reason codes on history events, in product wording. */
export function reasonLabel(code: string | null): string | null {
  if (!code) return null;
  return (
    (REJECTION_REASON_LABELS as Record<string, string>)[code] ??
    (REOPEN_REASON_LABELS as Record<string, string>)[code] ??
    (DISPUTE_REASON_LABELS as Record<string, string>)[code] ??
    (code === "times_confirmed" ? "Times confirmed" : code)
  );
}

export const historyWhen = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** Compact event time for activity rows: "Oct 5, 1:05 PM". */
export const activityWhen = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
