import { StepUpNotice } from "@/features/organisations";

/**
 * Facility workspace step-up prompt (P0-E8-QA-F1). Since QA-F3 the shared
 * StepUpNotice renders the same locked note, so this delegates to it —
 * one notice component, same verify route and safe `returnTo`.
 */
export function FacilityStepUpNotice({
  returnTo,
  children,
}: {
  returnTo: string;
  children?: string;
}) {
  return <StepUpNotice returnTo={returnTo}>{children}</StepUpNotice>;
}
