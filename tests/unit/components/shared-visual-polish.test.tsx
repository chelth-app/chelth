// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { buttonSizes } from "@/components/ui/button";
import { ReadinessPanel } from "@/features/compliance/components/readiness-panel";
import { StepUpNotice } from "@/features/organisations/components/step-up-notice";

/*
 * P0-E8-QA-F3 final shared visual polish: guards for the shared fixes so the
 * locked system does not drift back.
 */

const ROOT = join(__dirname, "../../..");
const WORKSPACE = join(ROOT, "src/app/app/organisations/[organisationId]/(workspace)");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const read = (path: string) => readFileSync(path, "utf8");

describe("shared visual polish (P0-E8-QA-F3)", () => {
  it("uses only the canonical vertical row-action glyph", () => {
    const offenders = sourceFiles(join(ROOT, "src")).filter((file) => read(file).includes("⋯"));
    expect(offenders).toEqual([]);
  });

  it("gives small actions a 44 px target on phones and keeps 36 px from sm", () => {
    expect(buttonSizes.sm).toContain("h-11");
    expect(buttonSizes.sm).toContain("sm:h-9");
  });

  it("keeps every locked filter control at 46 px on phones (44 px inner control)", () => {
    const offenders = sourceFiles(WORKSPACE).flatMap((file) =>
      read(file)
        .split("\n")
        .filter((line) => /flex h-11\b[^"]*focus-within:outline-2/.test(line))
        .map((line) => `${file}: ${line.trim().slice(0, 80)}`),
    );
    expect(offenders).toEqual([]);
  });

  it("renders Recalculate from attendance as the outlined secondary", () => {
    const source = read(join(WORKSPACE, "timesheets/[timesheetId]/page.tsx"));
    expect(source).toMatch(/label="Recalculate from attendance"\s+variant="outline"/);
  });

  it("puts the attendance evidence page on the locked record family", () => {
    const source = read(join(WORKSPACE, "attendance/[attendanceId]/evidence/page.tsx"));
    expect(source).toContain("<RecordPage>");
    expect(source).toContain('variant="reference"');
    expect(source).not.toContain("StatusChip");
  });

  it("uses the locked section heading for the sign-up success state", () => {
    const source = read(join(ROOT, "src/features/identity/components/sign-up-form.tsx"));
    expect(source).not.toContain('className="text-lg font-semibold"');
    expect(source).toMatch(/text-\[20px\][^"]*font-semibold[^"]*">\s*Check your email/);
  });

  it("formats readiness expiry dates for people, never as ISO", () => {
    render(
      <ReadinessPanel
        title="Agency baseline"
        headingId="baseline"
        readiness={{
          status: "action_required",
          blocking: 0,
          warnings: 1,
          items: [
            {
              requirementId: "r1",
              scope: "agency",
              credentialTypeKey: "bls",
              credentialTypeName: "Basic Life Support (BLS)",
              reason: "EXPIRING_SOON",
              severity: "warning",
              effectiveExpiryDate: "2027-11-11",
            },
            {
              requirementId: "r2",
              scope: "agency",
              credentialTypeKey: "tb",
              credentialTypeName: "TB test",
              reason: "MET",
              severity: "ok",
              effectiveExpiryDate: "2028-01-05",
            },
          ],
        }}
      />,
    );
    const panel = screen.getByRole("region", { name: "Agency baseline" });
    expect(panel).toHaveTextContent("expires Nov 11, 2027");
    expect(panel).toHaveTextContent("valid to Jan 5, 2028");
    expect(panel.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("renders the step-up prompt as the locked note with the same route and text", () => {
    render(<StepUpNotice returnTo="/app/organisations/x/payroll">Payroll needs it.</StepUpNotice>);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Payroll needs it.");
    expect(screen.getByRole("link", { name: "Verify now" })).toHaveAttribute(
      "href",
      "/app/security/verify?next=%2Fapp%2Forganisations%2Fx%2Fpayroll",
    );
    // Locked note anatomy: hairline border and the semantic glyph.
    expect(note.firstElementChild).toHaveClass("rounded-[10px]", "border");
    expect(note.querySelector("svg")).not.toBeNull();
  });
});
