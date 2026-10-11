export {
  currentTerms,
  getDeviceTerminology,
  getPersonalTerminology,
  getRequestTerminology,
  getWorkspaceTerminology,
  localizeForRequest,
  spell,
} from "./queries";
export { TerminologyProvider, useSpell, useTerminology } from "@/lib/i18n/terminology-context";
