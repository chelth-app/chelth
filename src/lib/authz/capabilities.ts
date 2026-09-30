import type { CapabilityKey } from "./vocabulary";

/**
 * Result of `my_capabilities(org)`. Used ONLY to shape the UI (hide controls,
 * prompt for MFA step-up). Every operation is re-authorised by the database.
 */
export type CapabilityGrant = {
  capabilityKey: string;
  isPrivileged: boolean;
  isSatisfied: boolean;
};

export type CapabilityState = "granted" | "step_up_required" | "not_held";

export function capabilityState(
  grants: readonly CapabilityGrant[],
  capability: CapabilityKey,
): CapabilityState {
  const grant = grants.find((candidate) => candidate.capabilityKey === capability);
  if (!grant) return "not_held";
  return grant.isSatisfied ? "granted" : "step_up_required";
}
