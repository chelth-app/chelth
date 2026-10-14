import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

/*
 * P0-E9-4A: Platform control-plane projections. Each RPC requires an active
 * platform grant and AAL2 and is audited; none returns tenant operational
 * data (no contact details, documents, messages, locations, pay or finance).
 */

type Enums = Database["public"]["Enums"];
export type CustomerAccountStatus = Enums["customer_account_status"];
export type OrganisationStatus = Enums["organisation_status"];
export type OrganisationType = Enums["organisation_type"];

export const CUSTOMER_ACCOUNT_STATUSES: readonly CustomerAccountStatus[] = [
  "trial",
  "active",
  "past_due",
  "suspended",
  "cancelled",
];

export const CUSTOMER_ACCOUNT_STATUS_LABELS: Record<CustomerAccountStatus, string> = {
  trial: "Trial",
  active: "Active",
  past_due: "Past due",
  suspended: "Suspended",
  cancelled: "Canceled",
};

export type PlatformOverview = {
  agencies: { total: number; active: number; suspended: number };
  facilities: { total: number; linked: number; unlinked: number };
  accounts: {
    trial: number;
    active: number;
    past_due: number;
    suspended: number;
    cancelled: number;
    setup_required: number;
  };
  health: {
    notifications_waiting: number;
    notifications_failed_24h: number;
    scans_stuck: number;
    cron: { failed_24h: number; last_success: string | null } | null;
  };
  attention: { facility_owner_pending: number; facility_unlinked: number };
};

async function rpcJson<T>(
  name: "platform_get_overview" | "platform_get_system_health",
): Promise<T> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(name);
  if (error) throw error;
  return data as T;
}

export function getPlatformOverview(): Promise<PlatformOverview> {
  return rpcJson<PlatformOverview>("platform_get_overview");
}

export type PlatformCustomer = {
  id: string;
  type: OrganisationType;
  name: string;
  slug: string;
  status: OrganisationStatus;
  createdAt: string;
  locale: string | null;
  currency: string | null;
  activeMembers: number;
  staffSeats: number;
  facilityRecords: number | null;
  linkedFacilities: number;
  accountStatus: CustomerAccountStatus | null;
  planKey: string | null;
  planName: string | null;
  trialEndsOn: string | null;
  currentPeriodEndsOn: string | null;
  ownerInvitePending: boolean;
};

export async function listPlatformCustomers(): Promise<PlatformCustomer[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("platform_list_customers");
  if (error) throw error;
  return data.map((row) => ({
    id: row.organisation_id,
    type: row.organisation_type,
    name: row.name,
    slug: row.slug,
    status: row.status,
    createdAt: row.created_at,
    locale: row.locale ?? null,
    currency: row.default_currency ?? null,
    activeMembers: row.active_members,
    staffSeats: row.staff_seats,
    facilityRecords: row.facility_records ?? null,
    linkedFacilities: row.linked_facilities,
    accountStatus: row.account_status ?? null,
    planKey: row.plan_key ?? null,
    planName: row.plan_name ?? null,
    trialEndsOn: row.trial_ends_on ?? null,
    currentPeriodEndsOn: row.current_period_ends_on ?? null,
    ownerInvitePending: row.owner_invite_pending,
  }));
}

export type PlatformCustomerDetail = {
  identity: {
    id: string;
    type: OrganisationType;
    name: string;
    slug: string;
    status: OrganisationStatus;
    locale: string | null;
    default_currency: string | null;
    created_at: string;
  };
  account: {
    status: CustomerAccountStatus;
    plan_key: string | null;
    plan_name: string | null;
    billing_name: string | null;
    billing_email: string | null;
    provider: string;
    provider_customer_id: string | null;
    provider_subscription_id: string | null;
    trial_started_at: string | null;
    trial_ends_on: string | null;
    subscription_started_at: string | null;
    current_period_ends_on: string | null;
    cancel_at_period_end: boolean;
    suspended_at: string | null;
    updated_at: string;
  } | null;
  provisioning: {
    active_members: number;
    staff_seats: number;
    workers: number;
    facility_records: number;
  };
  links: {
    agency_facility_id: string;
    facility_record_name: string;
    timezone: string;
    record_status: string;
    agency_id: string;
    agency_name: string;
    facility_organisation_id: string | null;
    facility_organisation_name: string | null;
    relationship_status: string | null;
  }[];
  invites: {
    id: string;
    email: string;
    role_key: string;
    status: "pending" | "accepted" | "revoked";
    expired: boolean;
    expires_at: string;
    send_count: number;
    delivery_status: string | null;
    created_at: string;
  }[];
  system: { notifications_failed_30d: number; scans_stuck: number };
  events: { occurred_at: string; action: string }[];
};

/** null when the organisation does not exist. */
export async function getPlatformCustomer(
  organisationId: string,
): Promise<PlatformCustomerDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("platform_get_customer", {
    p_organisation_id: organisationId,
  });
  if (error) {
    if (error.code === "CH404") return null;
    throw error;
  }
  return data as unknown as PlatformCustomerDetail;
}

export type AgencyFacilityRecord = {
  id: string;
  name: string;
  timezone: string;
  status: string;
  linkedOrganisationId: string | null;
  linkedOrganisationName: string | null;
};

export async function listAgencyFacilityRecords(
  agencyOrganisationId: string,
): Promise<AgencyFacilityRecord[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("platform_list_agency_facility_records", {
    p_agency_organisation_id: agencyOrganisationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.agency_facility_id,
    name: row.name,
    timezone: row.timezone,
    status: row.status,
    linkedOrganisationId: row.linked_facility_organisation_id ?? null,
    linkedOrganisationName: row.linked_facility_organisation_name ?? null,
  }));
}

export type SubscriptionPlan = {
  key: string;
  name: string;
  status: "active" | "retired";
  monthlyPriceMinor: number | null;
  currency: string | null;
  includedSeats: number | null;
  includedFacilities: number | null;
  accounts: number;
};

export async function listSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("platform_list_plans");
  if (error) throw error;
  return data.map((row) => ({
    key: row.key,
    name: row.name,
    status: row.status === "retired" ? "retired" : "active",
    monthlyPriceMinor: row.monthly_price_minor ?? null,
    currency: row.currency ?? null,
    includedSeats: row.included_seats ?? null,
    includedFacilities: row.included_facilities ?? null,
    accounts: row.accounts,
  }));
}

export type SystemHealth = {
  database: { now: string };
  notifications: {
    pending: number;
    processing: number;
    retry: number;
    sent: number;
    failed: number;
    failed_24h: number;
    oldest_waiting: string | null;
  };
  notification_failures: { event: string; code: string; count: number }[];
  scanner: { scanning: number; stuck: number; clean: number; last_document: string | null };
  cron: {
    name: string;
    schedule: string;
    active: boolean;
    last_status: string | null;
    last_run: string | null;
    last_success: string | null;
    failed_24h: number;
  }[];
  buckets: { id: string; public: boolean; file_size_limit: number | null }[];
};

export function getSystemHealth(): Promise<SystemHealth> {
  return rpcJson<SystemHealth>("platform_get_system_health");
}

export type PlatformAdmin = {
  grantId: string;
  displayName: string | null;
  email: string | null;
  grantedAt: string;
  grantedBy: string;
  revokedAt: string | null;
  revokedBy: string | null;
  active: boolean;
};

export async function listPlatformAdmins(): Promise<PlatformAdmin[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("platform_list_admins");
  if (error) throw error;
  return data.map((row) => ({
    grantId: row.grant_id,
    displayName: row.display_name ?? null,
    email: row.email ?? null,
    grantedAt: row.granted_at,
    grantedBy: row.granted_by,
    revokedAt: row.revoked_at ?? null,
    revokedBy: row.revoked_by ?? null,
    active: row.active,
  }));
}

export type PlatformActivityEvent = {
  id: string;
  occurredAt: string;
  action: string;
  actorName: string | null;
  organisationId: string | null;
  organisationName: string | null;
  details: Record<string, unknown>;
};

export async function listPlatformActivity(limit = 100): Promise<PlatformActivityEvent[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("platform_list_activity", { p_limit: limit });
  if (error) throw error;
  return data.map((row) => ({
    id: row.event_id,
    occurredAt: row.occurred_at,
    action: row.action,
    actorName: row.actor_name ?? null,
    organisationId: row.organisation_id ?? null,
    organisationName: row.organisation_name ?? null,
    details: (row.details ?? {}) as Record<string, unknown>,
  }));
}

export type PlatformConnectionInvite = {
  id: string;
  agencyName: string;
  facilityRecordName: string;
  maskedEmail: string | null;
  status: "pending" | "accepted" | "revoked";
  expired: boolean;
  sendCount: number;
  createdAt: string;
  acceptedAt: string | null;
  facilityOrganisationName: string | null;
};

/** P0-E9-4A.1: agency-initiated facility connection invitations (masked; support only). */
export async function listPlatformConnectionInvites(
  organisationId?: string,
): Promise<PlatformConnectionInvite[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(
    "platform_list_connection_invites",
    organisationId ? { p_organisation_id: organisationId } : {},
  );
  if (error) throw error;
  return data.map((row) => ({
    id: row.invite_id,
    agencyName: row.agency_name,
    facilityRecordName: row.facility_record_name,
    maskedEmail: row.masked_email ?? null,
    status:
      row.status === "accepted" ? "accepted" : row.status === "revoked" ? "revoked" : "pending",
    expired: row.expired,
    sendCount: row.send_count,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at ?? null,
    facilityOrganisationName: row.facility_organisation_name ?? null,
  }));
}

export type BusinessRequest = {
  id: string;
  businessName: string;
  billingEmail: string;
  note: string | null;
  status: "pending" | "fulfilled" | "declined" | "withdrawn";
  createdAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
  requesterName: string | null;
  requesterEmail: string | null;
  requesterOwns: string | null;
  organisationId: string | null;
};

/** P0-E9-4A.2: additional-business requests (an owner's separate, separately billed business). */
export async function listBusinessRequests(): Promise<BusinessRequest[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("platform_list_business_requests");
  if (error) throw error;
  return data.map((row) => ({
    id: row.request_id,
    businessName: row.business_name,
    billingEmail: row.billing_email,
    note: row.note ?? null,
    status:
      (["pending", "fulfilled", "declined", "withdrawn"] as const).find(
        (status) => status === row.status,
      ) ?? "pending",
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? null,
    decisionReason: row.decision_reason ?? null,
    requesterName: row.requester_name ?? null,
    requesterEmail: row.requester_email ?? null,
    requesterOwns: row.requester_owned_agencies ?? null,
    organisationId: row.organisation_id ?? null,
  }));
}
