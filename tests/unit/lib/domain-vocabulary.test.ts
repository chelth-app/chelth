import { describe, expect, it } from "vitest";

import {
  FACILITY_STATUS_TRANSITIONS,
  RELATIONSHIP_STATUS_TRANSITIONS,
  WORKER_STATUS_TRANSITIONS,
  WORKER_STATUSES,
} from "@/lib/domain/vocabulary";

describe("domain lifecycle vocabulary", () => {
  it("terminal states have no outgoing transitions", () => {
    expect(WORKER_STATUS_TRANSITIONS.terminated).toEqual([]);
    expect(FACILITY_STATUS_TRANSITIONS.archived).toEqual([]);
    expect(RELATIONSHIP_STATUS_TRANSITIONS.ended).toEqual([]);
  });

  it("covers every worker status from the database enum", () => {
    expect(Object.keys(WORKER_STATUS_TRANSITIONS).sort()).toEqual([...WORKER_STATUSES].sort());
  });

  it("never allows a transition to the same state", () => {
    for (const table of [
      WORKER_STATUS_TRANSITIONS,
      FACILITY_STATUS_TRANSITIONS,
      RELATIONSHIP_STATUS_TRANSITIONS,
    ]) {
      for (const [from, targets] of Object.entries(table)) {
        expect(targets).not.toContain(from);
      }
    }
  });
});
