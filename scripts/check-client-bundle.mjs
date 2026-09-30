#!/usr/bin/env node
/**
 * Post-build guard: fails if browser-delivered build output contains anything
 * that looks like a server secret. Run after `next build`.
 *
 * Checks .next/static (everything shipped to browsers) for:
 * - server-only environment variable names
 * - Supabase secret keys (sb_secret_…) and service-role JWTs
 * - the literal values of any server-only env vars set in this environment
 * - private key material and published source maps
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const STATIC_DIR = path.resolve(".next/static");

const SERVER_ONLY_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SENTRY_AUTH_TOKEN",
  "DATABASE_URL",
  "SENTRY_DSN",
  "RESEND_API_KEY",
];
const PATTERNS = [
  { name: "Supabase secret key", regex: /sb_secret_[A-Za-z0-9_-]{8,}/ },
  { name: "Private key block", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "Resend API key", regex: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/ },
  {
    name: "Postgres connection string with password",
    regex: /postgres(ql)?:\/\/[^:\s"']+:[^@\s"']+@/,
  },
];
const SERVER_VALUES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "RESEND_API_KEY",
  "SENTRY_AUTH_TOKEN",
  "DATABASE_URL",
  "SENTRY_DSN",
]
  .map((name) => process.env[name])
  .filter((value) => typeof value === "string" && value.length >= 8);

function decodeJwtRole(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role;
  } catch {
    return undefined;
  }
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

let files;
try {
  files = [...walk(STATIC_DIR)];
} catch {
  console.error(`check-client-bundle: ${STATIC_DIR} not found. Run \`npm run build\` first.`);
  process.exit(1);
}

const findings = [];
for (const file of files) {
  const relative = path.relative(process.cwd(), file);
  if (file.endsWith(".map")) {
    findings.push(`${relative}: source map published to the browser`);
    continue;
  }
  if (!/\.(js|css|html|json|txt)$/.test(file)) continue;
  const content = readFileSync(file, "utf8");

  for (const name of SERVER_ONLY_NAMES) {
    if (content.includes(name))
      findings.push(`${relative}: references server-only variable name ${name}`);
  }
  for (const { name, regex } of PATTERNS) {
    if (regex.test(content)) findings.push(`${relative}: contains ${name}`);
  }
  for (const value of SERVER_VALUES) {
    if (content.includes(value))
      findings.push(`${relative}: contains the value of a server-only variable`);
  }
  for (const match of content.matchAll(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g)) {
    if (decodeJwtRole(match[0]) === "service_role") {
      findings.push(`${relative}: contains a service_role JWT`);
    }
  }
}

if (findings.length > 0) {
  // Findings name the file and the kind of secret only — never the value.
  console.error("check-client-bundle: FAILED");
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}
console.log(`check-client-bundle: OK (${files.length} browser files scanned, no secrets found)`);
