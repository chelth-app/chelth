import "server-only";

/* P0-E9-3I: the resolver lives in src/lib/i18n/request-terms.ts (no feature cycles). */
export {
  currentTerms,
  getDeviceTerminology,
  getPersonalTerminology,
  getRequestTerminology,
  getWorkspaceTerminology,
  localizeForRequest,
  spell,
} from "@/lib/i18n/request-terms";
