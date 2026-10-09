/**
 * Credential & compliance vocabulary (P0-E4-S1).
 *
 * Enum-backed types and value lists come from the generated database types.
 * Credential type keys and disciplines are migration reference rows, mirrored
 * here and drift-tested (tests/integration/vocabulary-drift.test.ts).
 * Labels are presentation only; the database decides compliance.
 */
import { Constants, type Database } from "@/types/database.types";

type Enums = Database["public"]["Enums"];

export type ComplianceReason = Enums["compliance_reason"];
export type ComplianceSeverity = Enums["compliance_severity"];
export type ReadinessStatus = Enums["readiness_status"];
export type VerificationOutcome = Enums["verification_outcome"];
export type RejectionReason = Enums["verification_rejection_reason"];
export type DocumentStatus = Enums["document_status"];
export type CredentialVersionStatus = Enums["credential_version_status"];
export type CredentialStatus = Enums["credential_status"];
export type RequirementStatus = Enums["requirement_status"];

export const REJECTION_REASONS = Constants.public.Enums.verification_rejection_reason;
export const VERIFICATION_OUTCOMES = Constants.public.Enums.verification_outcome;
export const REQUIREMENT_STATUSES = Constants.public.Enums.requirement_status;

export const READINESS_LABELS: Record<ReadinessStatus, string> = {
  ready: "Ready",
  action_required: "Action required",
  not_eligible: "Not eligible",
};

/** Plain-language explanation of each engine reason code. */
export const COMPLIANCE_REASON_LABELS: Record<ComplianceReason, string> = {
  MET: "Requirement met",
  EXPIRING_SOON: "Expires soon",
  MISSING_CREDENTIAL: "Missing",
  CREDENTIAL_NOT_SHARED: "Not shared with this agency",
  WRONG_JURISDICTION: "Held in a different jurisdiction",
  NOT_SUBMITTED: "Not yet submitted",
  DOCUMENT_MISSING: "Document missing",
  DOCUMENT_NOT_CLEARED: "Document awaiting security scan",
  UNVERIFIED_CREDENTIAL: "Awaiting verification",
  VERIFICATION_REJECTED: "Verification rejected",
  EXPIRED_CREDENTIAL: "Expired",
  INSUFFICIENT_VALIDITY: "Does not remain valid long enough",
  WORKER_NOT_ACTIVE: "Worker is not active",
  DISCIPLINE_NOT_SET: "Discipline not recorded",
};

export const VERIFICATION_LABELS: Record<VerificationOutcome, string> = {
  under_review: "Under review",
  verified: "Verified",
  rejected: "Rejected",
};

export const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
  document_illegible: "Document illegible",
  details_mismatch: "Details do not match",
  expired: "Expired",
  wrong_credential_type: "Wrong credential type",
  not_authentic: "Not authentic",
  incomplete: "Incomplete",
  other: "Other",
};

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  upload_pending: "Uploading",
  scanning: "Awaiting security scan",
  clean: "Cleared",
  rejected: "Rejected",
  quarantined: "Quarantined",
};

export const CREDENTIAL_TYPES = {
  RN_LICENSE: "rn_license",
  LPN_LVN_LICENSE: "lpn_lvn_license",
  CNA_CERTIFICATION: "cna_certification",
  BLS_CERTIFICATION: "bls_certification",
  ACLS_CERTIFICATION: "acls_certification",
  PALS_CERTIFICATION: "pals_certification",
  CPR_CERTIFICATION: "cpr_certification",
  TB_SCREENING: "tb_screening",
  BACKGROUND_CHECK: "background_check",
  DRUG_SCREENING: "drug_screening",
  FACILITY_ORIENTATION: "facility_orientation",
} as const;
export type CredentialTypeKey = (typeof CREDENTIAL_TYPES)[keyof typeof CREDENTIAL_TYPES];
export const ALL_CREDENTIAL_TYPE_KEYS: readonly CredentialTypeKey[] =
  Object.values(CREDENTIAL_TYPES);

export const DISCIPLINES = {
  RN: "rn",
  LPN_LVN: "lpn_lvn",
  CNA: "cna",
  MA: "ma",
  HHA: "hha",
  PT: "pt",
  OT: "ot",
  RT: "rt",
} as const;
export type DisciplineKey = (typeof DISCIPLINES)[keyof typeof DISCIPLINES];
export const ALL_DISCIPLINE_KEYS: readonly DisciplineKey[] = Object.values(DISCIPLINES);

// -----------------------------------------------------------------------------
// Documents
// -----------------------------------------------------------------------------
export const CREDENTIAL_DOCUMENT_BUCKET = "credential-documents";
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
/** Signed download URLs live this long (seconds). Never persisted or logged. */
export const SIGNED_URL_TTL_SECONDS = 60;

export const DOCUMENT_TYPES = {
  "application/pdf": { extensions: ["pdf"], label: "PDF" },
  "image/jpeg": { extensions: ["jpg", "jpeg"], label: "JPEG" },
  "image/png": { extensions: ["png"], label: "PNG" },
} as const;
export type DocumentMimeType = keyof typeof DOCUMENT_TYPES;
export const ALLOWED_DOCUMENT_MIME_TYPES = Object.keys(DOCUMENT_TYPES) as DocumentMimeType[];

export function isAllowedDocumentMimeType(value: string): value is DocumentMimeType {
  return Object.hasOwn(DOCUMENT_TYPES, value);
}

/** The file name's extension must match the declared type (defence against type confusion). */
export function extensionMatchesMimeType(fileName: string, mimeType: DocumentMimeType): boolean {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  return (DOCUMENT_TYPES[mimeType].extensions as readonly string[]).includes(extension);
}

export type DocumentFileCheck =
  | { ok: true; mimeType: DocumentMimeType; uploadName: string }
  | { ok: false; reason: "type" | "size" | "empty" };

/** Spellings some mobile document providers report for the allowed types. */
const MIME_ALIASES: Record<string, DocumentMimeType> = {
  "application/pdf": "application/pdf",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/png": "image/png",
};

/**
 * Client pre-check of a picked file (fast feedback only: the server re-checks the
 * declared type, and the stored bytes are verified by signature, size and hash).
 *
 * Mobile pickers (Android Chrome document providers, Photos) can report an empty
 * or generic MIME type, or a display name without an extension. The missing half
 * is then taken from the half that is present; nothing is guessed from neither,
 * and an extension that contradicts the type is still refused.
 */
export function checkDocumentFile(file: {
  name: string;
  type: string;
  size: number;
}): DocumentFileCheck {
  const dot = file.name.lastIndexOf(".");
  const extension = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  const fromExtension = ALLOWED_DOCUMENT_MIME_TYPES.find((type) =>
    (DOCUMENT_TYPES[type].extensions as readonly string[]).includes(extension),
  );
  const declared = MIME_ALIASES[file.type.trim().toLowerCase()];
  const generic = file.type === "" || file.type === "application/octet-stream";

  let mimeType: DocumentMimeType;
  if (declared) {
    if (extension && fromExtension !== declared) return { ok: false, reason: "type" };
    mimeType = declared;
  } else if (generic && fromExtension) {
    mimeType = fromExtension;
  } else {
    return { ok: false, reason: "type" };
  }
  if (file.size <= 0) return { ok: false, reason: "empty" };
  if (file.size > MAX_DOCUMENT_BYTES) return { ok: false, reason: "size" };
  const uploadName = extension
    ? file.name
    : `${file.name || "document"}.${DOCUMENT_TYPES[mimeType].extensions[0]}`;
  return { ok: true, mimeType, uploadName };
}

/** Magic-byte signature check of the stored content (server-side). */
export function contentMatchesMimeType(bytes: Uint8Array, mimeType: DocumentMimeType): boolean {
  const startsWith = (signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  switch (mimeType) {
    case "application/pdf":
      return startsWith([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    case "image/png":
      return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith([0xff, 0xd8, 0xff]);
  }
}

/**
 * The calendar date (YYYY-MM-DD) at `at` in an IANA timezone. Used to default
 * date fields for facility-scoped requirements to the facility's local "today".
 * Agency-wide requirements have no timezone in Chelth, so no default is derived.
 */
export function localCalendarDate(timezone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** "Mar 11, 2030" for a calendar date, without shifting it through any timezone. */
export function formatCalendarDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "medium" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}
