/**
 * Healthcare-domain vocabulary (P0-E3-S3).
 *
 * - Lifecycle states are Postgres enums; their TypeScript types and value
 *   lists come from the generated database types (no duplication).
 * - Facility types are migration-managed reference rows, mirrored here and
 *   drift-tested against the database (tests/integration/vocabulary-drift).
 * - Allowed transitions mirror the database RPCs. They drive UI affordances
 *   only; the database is the authority.
 */
import { Constants, type Database } from "@/types/database.types";

type Enums = Database["public"]["Enums"];

export type WorkerStatus = Enums["worker_status"];
export type FacilityStatus = Enums["facility_status"];
export type FacilityLocationStatus = Enums["facility_location_status"];
export type RelationshipStatus = Enums["relationship_status"];
export type InviteDeliveryStatus = Enums["invite_delivery_status"];

export const WORKER_STATUSES = Constants.public.Enums.worker_status;
export const FACILITY_STATUSES = Constants.public.Enums.facility_status;
export const RELATIONSHIP_STATUSES = Constants.public.Enums.relationship_status;

export const WORKER_STATUS_LABELS: Record<WorkerStatus, string> = {
  onboarding: "Onboarding",
  active: "Active",
  inactive: "Inactive",
  suspended: "Suspended",
  terminated: "Terminated",
};

export const WORKER_STATUS_TRANSITIONS: Record<WorkerStatus, readonly WorkerStatus[]> = {
  onboarding: ["active", "terminated"],
  active: ["inactive", "suspended", "terminated"],
  inactive: ["active", "suspended", "terminated"],
  suspended: ["active", "inactive", "terminated"],
  terminated: [],
};

export const FACILITY_STATUS_LABELS: Record<FacilityStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};

export const FACILITY_STATUS_TRANSITIONS: Record<FacilityStatus, readonly FacilityStatus[]> = {
  active: ["inactive", "archived"],
  inactive: ["active", "archived"],
  archived: [],
};

export const RELATIONSHIP_STATUS_LABELS: Record<RelationshipStatus, string> = {
  pending: "Pending",
  active: "Active",
  suspended: "Suspended",
  ended: "Ended",
};

export const RELATIONSHIP_STATUS_TRANSITIONS: Record<
  RelationshipStatus,
  readonly RelationshipStatus[]
> = {
  pending: ["active", "ended"],
  active: ["suspended", "ended"],
  suspended: ["active", "ended"],
  ended: [],
};

export const FACILITY_TYPES = {
  HOSPITAL: "hospital",
  SKILLED_NURSING: "skilled_nursing",
  ASSISTED_LIVING: "assisted_living",
  REHABILITATION: "rehabilitation",
  HOME_HEALTH: "home_health",
  HOSPICE: "hospice",
  CLINIC: "clinic",
  BEHAVIORAL_HEALTH: "behavioral_health",
  OTHER: "other",
} as const;

export type FacilityTypeKey = (typeof FACILITY_TYPES)[keyof typeof FACILITY_TYPES];
export const ALL_FACILITY_TYPE_KEYS: readonly FacilityTypeKey[] = Object.values(FACILITY_TYPES);
