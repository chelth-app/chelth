#!/usr/bin/env node
/**
 * Generates src/types/database.types.ts from the LOCAL database.
 *
 * The Supabase CLI can print non-TypeScript diagnostics (e.g. telemetry
 * shutdown errors) to stdout after the generated module. Everything after the
 * module's final `} as const` is discarded so generation is reproducible.
 *
 * If the CLI fails, its exit status and its own stderr are printed (stderr is
 * captured, never discarded) and this script exits non-zero, so CI shows the
 * real cause. The local stack uses non-secret development keys only.
 *
 *   node scripts/generate-db-types.mjs            write the file
 *   node scripts/generate-db-types.mjs --stdout   print instead (CI drift check)
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const args = ["gen", "types", "typescript", "--local", "--schema", "public"];
const result = spawnSync("supabase", args, {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, DO_NOT_TRACK: "1" },
  maxBuffer: 64 * 1024 * 1024,
});

function fail(reason) {
  console.error(`generate-db-types: ${reason}`);
  console.error(`  command: supabase ${args.join(" ")}`);
  if (result.error) console.error(`  spawn error: ${result.error.message}`);
  console.error(`  exit status: ${result.status ?? "none"}  signal: ${result.signal ?? "none"}`);
  const stderr = (result.stderr ?? "").trim();
  console.error(
    stderr ? `  --- supabase stderr ---\n${stderr}` : "  (supabase wrote nothing to stderr)",
  );
  const stdout = (result.stdout ?? "").trim();
  if (stdout) console.error(`  --- supabase stdout (last 2000 chars) ---\n${stdout.slice(-2000)}`);
  process.exit(typeof result.status === "number" && result.status !== 0 ? result.status : 1);
}

if (result.error || result.status !== 0) fail("supabase gen types failed");

const raw = result.stdout ?? "";
const end = raw.lastIndexOf("} as const");
if (end === -1) fail("unexpected generator output (no `} as const`)");
const output = `${raw.slice(0, end + "} as const".length)}\n`;

if (process.argv.includes("--stdout")) process.stdout.write(output);
else writeFileSync("src/types/database.types.ts", output);
