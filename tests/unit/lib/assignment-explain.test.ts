import { describe, expect, it } from "vitest";

import { explainBlockReasons } from "@/features/shifts/explain";

const TYPES = new Map([
  ["bls_certification", "Basic Life Support (BLS)"],
  ["facility_orientation", "Facility orientation"],
]);

describe("explainBlockReasons", () => {
  it("explains compliance refusals per credential, with scope and date", () => {
    expect(
      explainBlockReasons(
        ["WORKER_NOT_ELIGIBLE", "WORKER_SCHEDULE_CONFLICT"],
        [
          {
            scope: "agency",
            credentialTypeKey: "bls_certification",
            reason: "EXPIRED_CREDENTIAL",
            severity: "blocking",
            evaluationDate: "2026-11-14",
            effectiveExpiryDate: "2026-11-10",
          },
          {
            scope: "facility",
            credentialTypeKey: "facility_orientation",
            reason: "MISSING_CREDENTIAL",
            severity: "blocking",
            evaluationDate: "2026-11-14",
            effectiveExpiryDate: null,
          },
        ],
        TYPES,
      ),
    ).toEqual([
      "Basic Life Support (BLS): Expired (on 2026-11-14)",
      "Facility orientation (facility requirement): Missing",
      "Worker has a scheduling conflict",
    ]);
  });

  it("reports an inactive worker once", () => {
    expect(
      explainBlockReasons(
        ["WORKER_NOT_ACTIVE"],
        [
          {
            scope: "worker",
            credentialTypeKey: null,
            reason: "WORKER_NOT_ACTIVE",
            severity: "blocking",
            evaluationDate: "2026-11-14",
            effectiveExpiryDate: null,
          },
        ],
        TYPES,
      ),
    ).toEqual(["Worker is not active"]);
  });
});
