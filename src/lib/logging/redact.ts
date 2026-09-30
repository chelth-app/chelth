/**
 * Redaction applied to every log payload before it leaves the process.
 *
 * Default-deny for sensitive-looking keys: when in doubt, redact. Healthcare
 * workforce data (identifiers, credentials, documents, health information)
 * must never appear in logs or error monitoring.
 */

export const REDACTED = "[REDACTED]";

const SENSITIVE_KEY_PATTERN = new RegExp(
  [
    "pass(word|code|phrase)?",
    "secret",
    "token",
    "authori[sz]ation",
    "cookie",
    "session",
    "api[-_]?key",
    "service[-_]?role",
    "private[-_]?key",
    "jwt",
    "mfa",
    "totp",
    "email",
    "phone",
    "mobile",
    "address",
    "postcode",
    "dob",
    "date[-_]?of[-_]?birth",
    "birth",
    "ssn",
    "card[-_]?number",
    "pin[-_]?code",
    "one[-_]?time[-_]?code",
    "national[-_]?insurance",
    "tax[-_]?id",
    "bank",
    "iban",
    "sort[-_]?code",
    "account[-_]?number",
    "licen[cs]e",
    "registration[-_]?number",
    "npi",
    "credential",
    "document",
    "file[-_]?(content|data|body|name)",
    "attachment",
    "health",
    "medical",
    "diagnosis",
    "signature",
    "ip[-_]?address",
    "latitude",
    "longitude",
    "geo",
  ].join("|"),
  "i",
);

const JWT_PATTERN = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const BEARER_PATTERN = /\bBearer\s+[\w.~+/-]+=*/gi;
const SUPABASE_KEY_PATTERN = /\bsb_(secret|publishable)_[\w-]+/g;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

const MAX_DEPTH = 6;
const MAX_STRING_LENGTH = 2000;

/** Short identifiers that would over-match as substrings ("mapping", "warning"). */
const SENSITIVE_EXACT_KEYS = new Set(["pin", "nin", "nino", "otp", "zip", "card", "cvv", "cvc"]);

export function isSensitiveKey(key: string): boolean {
  return (
    SENSITIVE_EXACT_KEYS.has(key.toLowerCase().replace(/[-_]/g, "")) ||
    SENSITIVE_KEY_PATTERN.test(key)
  );
}

export function redactString(value: string): string {
  const scrubbed = value
    .replace(JWT_PATTERN, REDACTED)
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(SUPABASE_KEY_PATTERN, REDACTED)
    .replace(EMAIL_PATTERN, REDACTED);
  return scrubbed.length > MAX_STRING_LENGTH
    ? `${scrubbed.slice(0, MAX_STRING_LENGTH)}…[truncated]`
    : scrubbed;
}

export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (depth >= MAX_DEPTH) return "[MaxDepth]";

  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    if (value instanceof Error) {
      return {
        name: value.name,
        message: redactString(value.message),
        ...(value.cause !== undefined ? { cause: redact(value.cause, depth + 1, seen) } : {}),
      };
    }
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1, seen));

    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = isSensitiveKey(key) ? REDACTED : redact(item, depth + 1, seen);
    }
    return output;
  }
  return undefined;
}
