import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { REF_TEXT } from "@/components/reference/locked-reference";

/*
 * Locked typography weight system (docs/ui-reference/CHELTH-LOCKED-VISUAL-
 * SYSTEM.md, D). Approved on Facilities: page titles 700, section titles 600,
 * KPI labels 600, KPI values 700, table headers 600, body 400–500. These
 * guards stop pages drifting back toward heavy headings.
 */

const ROOT = join(__dirname, "../../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

describe("locked typography weight system", () => {
  it("uses no 800/900 text weights or faux-bold strokes in app source", () => {
    const offenders = sourceFiles(join(ROOT, "src")).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          /font-extrabold|font-black|font-\[(?:8|9)00\]|-webkit-text-stroke/.test(line)
            ? [`${relative(ROOT, file)}:${index + 1}`]
            : [],
        ),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps the canonical reference scale", () => {
    expect(REF_TEXT.pageTitle).toContain("font-bold");
    expect(REF_TEXT.panelTitle).toContain("font-semibold");
    expect(REF_TEXT.kpiLabel).toContain("font-semibold");
    expect(REF_TEXT.kpiLabelMd).toContain("font-semibold");
    expect(REF_TEXT.kpiValue).toContain("font-bold");
    expect(REF_TEXT.kpiValueMd).toContain("font-bold");
    expect(REF_TEXT.tableHead).toContain("font-semibold");
  });
});
