#!/usr/bin/env node
/**
 * Migration discipline checks (docs/architecture/DATABASE_MIGRATION_POLICY.md).
 *
 * Always:
 *   - every file in supabase/migrations is named <14-digit UTC timestamp>_<snake_case>.sql
 *   - timestamps are unique
 *   - supabase/seed.sql defines no grants, policies, functions, triggers or schema
 *
 * With --base <git ref> (pull requests):
 *   - no existing migration was modified, renamed or deleted (migrations are immutable
 *     once merged; fix forward with a new migration)
 *   - new migrations sort after every migration already on the base branch
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const MIGRATIONS_DIR = "supabase/migrations";
const NAME_PATTERN = /^(\d{14})_[a-z0-9]+(_[a-z0-9]+)*\.sql$/;
const SEED_FORBIDDEN =
  /\b(grant|revoke|create\s+(or\s+replace\s+)?(policy|function|procedure|trigger|table|view|schema|type|role)|alter\s+(table|default\s+privileges|policy|function|schema|role)|drop\s+\w+|security\s+definer)\b/i;

const errors = [];
const files = readdirSync(MIGRATIONS_DIR).filter((name) => !name.startsWith("."));
const seen = new Map();

for (const file of files) {
  const match = NAME_PATTERN.exec(file);
  if (!match) {
    errors.push(`${file}: name must match <YYYYMMDDHHMMSS>_<snake_case>.sql`);
    continue;
  }
  const timestamp = match[1];
  if (seen.has(timestamp)) errors.push(`${file}: duplicate timestamp with ${seen.get(timestamp)}`);
  seen.set(timestamp, file);
}

const seed = readFileSync("supabase/seed.sql", "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
if (SEED_FORBIDDEN.test(seed)) {
  errors.push("supabase/seed.sql: contains schema/security DDL — move it to a migration");
}

const baseIndex = process.argv.indexOf("--base");
if (baseIndex !== -1) {
  const base = process.argv[baseIndex + 1];
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const changed = git("diff", "--name-status", `${base}...HEAD`, "--", MIGRATIONS_DIR);
  const baseFiles = git("ls-tree", "--name-only", `${base}`, `${MIGRATIONS_DIR}/`)
    .split("\n")
    .filter(Boolean)
    .map((path) => path.split("/").pop());
  const latestBase = baseFiles.sort().at(-1);

  for (const line of changed.split("\n").filter(Boolean)) {
    const [status, ...paths] = line.split("\t");
    const file = paths.at(-1)?.split("/").pop() ?? "";
    if (status !== "A") {
      errors.push(
        `${paths.join(" -> ")}: existing migrations are immutable (status ${status}); add a new migration instead`,
      );
    } else if (latestBase && file < latestBase) {
      errors.push(
        `${file}: sorts before ${latestBase} already on ${base}; regenerate with \`npm run db:new\``,
      );
    }
  }
}

if (errors.length > 0) {
  console.error("check-migrations: FAILED");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`check-migrations: OK (${files.length} migration file(s))`);
