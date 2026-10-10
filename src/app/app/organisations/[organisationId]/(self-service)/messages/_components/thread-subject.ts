import type { ThreadSummary } from "@/features/messaging";
import { formatShiftDate } from "@/lib/domain/shifts";

/** The thread's subject line from its context (never copied truth). */
export function threadSubject(thread: ThreadSummary): string {
  if (thread.shift) {
    return `${thread.facilityName ?? "Shift"} · ${formatShiftDate(thread.shift)}`;
  }
  return thread.kind === "facility" ? (thread.facilityName ?? "Facility") : "General";
}
