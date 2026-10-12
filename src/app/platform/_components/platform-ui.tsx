import type { ReactNode } from "react";

import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { CUSTOMER_ACCOUNT_STATUS_LABELS, type CustomerAccountStatus } from "@/features/platform";

/** "Oct 12, 2026" (UTC calendar date; platform records are not facility-local). */
export function platformDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = value.length === 10 ? new Date(`${value}T00:00:00Z`) : new Date(value);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "medium" }).format(date);
}

export function platformDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))} UTC`;
}

const ACCOUNT_TONE: Record<CustomerAccountStatus, StatusTone> = {
  trial: "info",
  active: "success",
  past_due: "warning",
  suspended: "danger",
  cancelled: "neutral",
};

/** Commercial state; no account yet ⇒ "Commercial setup required" (never an assumed plan). */
export function AccountStatusChip({ status }: { status: CustomerAccountStatus | null }) {
  if (!status) return <StatusChip tone="warning">Commercial setup required</StatusChip>;
  return (
    <StatusChip tone={ACCOUNT_TONE[status]}>{CUSTOMER_ACCOUNT_STATUS_LABELS[status]}</StatusChip>
  );
}

export function OrganisationStatusChip({
  status,
}: {
  status: "active" | "suspended" | "archived";
}) {
  const tone: StatusTone =
    status === "active" ? "success" : status === "suspended" ? "danger" : "neutral";
  const label = status === "active" ? "Active" : status === "suspended" ? "Suspended" : "Archived";
  return <StatusChip tone={tone}>{label}</StatusChip>;
}

/** A labelled count on the overview (real projections only). */
export function PlatformStat({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[12px] border border-[rgba(18,107,103,0.10)] bg-white p-4 shadow-[0_1px_2px_rgba(13,47,66,0.04)]">
      <dt className="text-[13px] font-medium text-slate-600">{label}</dt>
      <dd className="font-display text-[26px] leading-8 font-bold text-chelth-navy tabular-nums">
        {value}
      </dd>
      {note ? <dd className="text-[12.5px] text-slate-600">{note}</dd> : null}
    </div>
  );
}

export const PLATFORM_TABLE =
  "w-full min-w-[44rem] text-left text-sm [&_td]:border-t [&_td]:border-border [&_td]:px-3 [&_td]:py-2.5 [&_th]:px-3 [&_th]:py-2 [&_th]:text-[13px] [&_th]:font-medium [&_th]:text-slate-600 [&_thead]:bg-surface-muted";
