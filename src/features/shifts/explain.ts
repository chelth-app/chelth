import { COMPLIANCE_REASON_LABELS } from "@/lib/domain/credentials";
import { ASSIGNMENT_BLOCK_REASON_LABELS, type AssignmentBlockReason } from "@/lib/domain/shifts";

import type { ComplianceFinding } from "./queries";

/**
 * Plain-language reasons a worker cannot be assigned, e.g.
 *   ["BLS certification: Expired (on 2026-11-14)", "Worker has a scheduling conflict"]
 * Only codes the caller is entitled to see reach this function; schedule
 * conflicts are always generic.
 */
export function explainBlockReasons(
  blockReasons: readonly AssignmentBlockReason[],
  findings: readonly ComplianceFinding[],
  typeNames: ReadonlyMap<string, string>,
): string[] {
  const lines: string[] = [];
  // WORKER_NOT_ACTIVE is reported once, as a block reason.
  const credentialFindings = findings.filter((finding) => finding.reason !== "WORKER_NOT_ACTIVE");
  for (const reason of blockReasons) {
    if (reason === "WORKER_NOT_ELIGIBLE" && credentialFindings.length > 0) {
      for (const finding of credentialFindings) {
        const subject = finding.credentialTypeKey
          ? (typeNames.get(finding.credentialTypeKey) ?? finding.credentialTypeKey)
          : "Worker";
        const scope = finding.scope === "facility" ? " (facility requirement)" : "";
        const when =
          finding.reason === "EXPIRED_CREDENTIAL" || finding.reason === "EXPIRING_SOON"
            ? ` (on ${finding.evaluationDate})`
            : "";
        lines.push(`${subject}${scope}: ${COMPLIANCE_REASON_LABELS[finding.reason]}${when}`);
      }
    } else {
      lines.push(ASSIGNMENT_BLOCK_REASON_LABELS[reason]);
    }
  }
  return [...new Set(lines)];
}
