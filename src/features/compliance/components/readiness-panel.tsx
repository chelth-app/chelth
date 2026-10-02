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
      className="flex flex-col gap-3 rounded-md bg-surface-muted p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="font-semibold">
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
              <span>{item.credentialTypeName ?? "Worker"}</span>
              {item.effectiveExpiryDate ? (
                <span className="text-muted-foreground">expires {item.effectiveExpiryDate}</span>
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
          className="flex flex-col gap-1 text-sm text-muted-foreground"
          aria-label={`${title} requirements met`}
        >
          {met.map((item, index) => (
            <li key={`${item.requirementId}-${index}`}>
              ✓ {item.credentialTypeName}
              {item.effectiveExpiryDate ? ` — valid to ${item.effectiveExpiryDate}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
