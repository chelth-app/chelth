import { StatusChip } from "@/components/ui/status-chip";
import { COMPLIANCE_REASON_LABELS } from "@/lib/domain/credentials";

import type { Readiness } from "../queries";
import { ReadinessBadge } from "./readiness-badge";

type ReadinessPanelProps = { title: string; readiness: Readiness; headingId: string };

/**
 * Explains a DERIVED readiness result: the status and every reason behind it.
 * Nothing here decides eligibility — it renders the database's evaluation.
 */
export function ReadinessPanel({ title, readiness, headingId }: ReadinessPanelProps) {
  const issues = readiness.items.filter((item) => item.severity !== "ok");
  const met = readiness.items.filter((item) => item.severity === "ok");
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-md bg-surface-muted p-4 in-[.chelth-locked]:rounded-[10px] in-[.chelth-locked]:border in-[.chelth-locked]:border-[rgba(18,107,103,0.10)] in-[.chelth-locked]:bg-[linear-gradient(180deg,#f6fbfa,#eef7f4)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id={headingId}
          className="font-semibold in-[.chelth-locked]:text-[16px] in-[.chelth-locked]:font-extrabold in-[.chelth-locked]:text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]"
        >
          {title}
        </h3>
        <ReadinessBadge status={readiness.status} />
      </div>
      {readiness.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No credential requirements apply.</p>
      ) : null}
      {issues.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm" aria-label={`${title} issues`}>
          {issues.map((item, index) => (
            <li
              key={`${item.requirementId ?? item.reason}-${index}`}
              className="flex flex-wrap items-center gap-2"
            >
              <StatusChip tone={item.severity === "blocking" ? "danger" : "warning"}>
                {COMPLIANCE_REASON_LABELS[item.reason]}
              </StatusChip>
              <span className="in-[.chelth-locked]:font-semibold in-[.chelth-locked]:text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]">
                {item.credentialTypeName ?? "Worker"}
              </span>
              {item.effectiveExpiryDate ? (
                <span className="text-muted-foreground in-[.chelth-locked]:text-slate-600">
                  expires {item.effectiveExpiryDate}
                </span>
              ) : null}
              {item.scope === "facility" ? (
                <span className="text-muted-foreground">(facility requirement)</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {met.length > 0 ? (
        <ul
          className="flex flex-col gap-1 text-sm text-muted-foreground in-[.chelth-locked]:gap-2"
          aria-label={`${title} requirements met`}
        >
          {met.map((item, index) => (
            <li
              key={`${item.requirementId}-${index}`}
              className="in-[.chelth-locked]:flex in-[.chelth-locked]:items-center in-[.chelth-locked]:gap-3"
            >
              {/* Locked credential glyph (C): solid green check with a soft halo. */}
              <span
                aria-hidden="true"
                className="hidden size-[22px] shrink-0 items-center justify-center rounded-full bg-success-indicator text-white ring-4 ring-success-soft in-[.chelth-locked]:inline-flex"
              >
                <svg
                  viewBox="0 0 16 16"
                  className="size-[13px]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3.8 8.4 6.7 11.2 12.2 5.2" />
                </svg>
              </span>
              <span className="in-[.chelth-locked]:hidden">✓ </span>
              <span className="in-[.chelth-locked]:font-semibold in-[.chelth-locked]:text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]">
                {item.credentialTypeName}
              </span>
              {item.effectiveExpiryDate ? (
                <span className="in-[.chelth-locked]:text-slate-600">
                  {" "}
                  — valid to {item.effectiveExpiryDate}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
