#!/usr/bin/env node
/**
 * Generates src/types/database.types.ts from the LOCAL database.
 *
 * The Supabase CLI can print non-TypeScript diagnostics (e.g. telemetry
 * shutdown errors) to stdout after the generated module. Everything after the
 * module's final `} as const` is discarded so generation is reproducible.
 *
 *   node scripts/generate-db-types.mjs            write the file
 *   node scripts/generate-db-types.mjs --stdout   print instead (CI drift check)
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const raw = execFileSync(
  "supabase",
  ["gen", "types", "typescript", "--local", "--schema", "public"],
  {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, DO_NOT_TRACK: "1" },
  },
);

const end = raw.lastIndexOf("} as const");
if (end === -1) {
  console.error("generate-db-types: unexpected generator output");
  process.exit(1);
}
const output = `${raw.slice(0, end + "} as const".length)}\n`;

if (process.argv.includes("--stdout")) process.stdout.write(output);
else writeFileSync("src/types/database.types.ts", output);
