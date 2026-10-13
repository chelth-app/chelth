import "server-only";

import {
  FACILITY_IMAGE_BUCKET,
  FACILITY_IMAGE_URL_TTL_SECONDS,
} from "@/lib/domain/facility-images";
import type {
  FacilityLocationStatus,
  FacilityStatus,
  RelationshipStatus,
} from "@/lib/domain/vocabulary";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/* All reads run as the signed-in user; RLS decides visibility. */

export type FacilityType = { key: string; name: string };

export async function listFacilityTypes(): Promise<FacilityType[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("facility_types")
    .select("key, name")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  return data;
}

export type FacilitySummary = {
  id: string;
  name: string;
  facilityTypeKey: string;
  status: FacilityStatus;
  timezone: string;
  locality: string | null;
  linked: boolean;
};

export async function listFacilities(organisationId: string): Promise<FacilitySummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agency_facilities")
    .select(
      "id, name, facility_type_key, status, timezone, locality, linked_facility_organisation_id",
    )
    .eq("agency_organisation_id", organisationId)
    .order("name");
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    facilityTypeKey: row.facility_type_key,
    status: row.status,
    timezone: row.timezone,
    locality: row.locality,
    linked: row.linked_facility_organisation_id !== null,
  }));
}

export type FacilityDetail = FacilitySummary & {
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  externalReference: string | null;
  /** Worker-facing context (P0-E9-3D-S2). */
  parkingInstructions: string | null;
  arrivalInstructions: string | null;
  workerContactLabel: string | null;
  workerContactPhone: string | null;
  /** Short-lived signed URL of the facility image, or null. Never stored. */
  imageUrl: string | null;
};

export async function getFacility(
  organisationId: string,
  facilityId: string,
): Promise<FacilityDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agency_facilities")
    .select("*")
    .eq("agency_organisation_id", organisationId)
    .eq("id", facilityId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    facilityTypeKey: data.facility_type_key,
    status: data.status,
    timezone: data.timezone,
    locality: data.locality,
    linked: data.linked_facility_organisation_id !== null,
    phone: data.phone,
    email: data.email,
    addressLine1: data.address_line1,
    addressLine2: data.address_line2,
    region: data.region,
    postalCode: data.postal_code,
    countryCode: data.country_code,
    externalReference: data.external_reference,
    parkingInstructions: data.parking_instructions,
    arrivalInstructions: data.arrival_instructions,
    workerContactLabel: data.worker_contact_label,
    workerContactPhone: data.worker_contact_phone,
    imageUrl: data.image_path ? await facilityImageUrl(data.image_path) : null,
  };
}

/** A short-lived signed URL for a facility image the caller may read (Storage re-checks). */
export async function facilityImageUrl(path: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from(FACILITY_IMAGE_BUCKET)
    .createSignedUrl(path, FACILITY_IMAGE_URL_TTL_SECONDS);
  return error ? null : data.signedUrl;
}

export type FacilityLocation = {
  id: string;
  name: string;
  timezone: string;
  status: FacilityLocationStatus;
};

export async function listLocations(facilityId: string): Promise<FacilityLocation[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("facility_locations")
    .select("id, name, timezone, status")
    .eq("agency_facility_id", facilityId)
    .order("name");
  if (error) throw error;
  return data;
}

export type Relationship = {
  id: string;
  status: RelationshipStatus;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
};

export async function listRelationships(facilityId: string): Promise<Relationship[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agency_facility_relationships")
    .select("id, status, started_at, ended_at, created_at")
    .eq("agency_facility_id", facilityId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  }));
}

export type PartnerRelationship = {
  relationshipId: string;
  agencyName: string;
  status: RelationshipStatus;
  startedAt: string | null;
};

/** Facility-organisation side: the narrow shared projection only. */
export async function listPartnerRelationships(
  facilityOrganisationId: string,
): Promise<PartnerRelationship[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_partner_agency_relationships", {
    p_facility_organisation_id: facilityOrganisationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    relationshipId: row.relationship_id,
    agencyName: row.agency_name,
    status: row.relationship_status,
    startedAt: row.relationship_started_at,
  }));
}

/** IANA timezones offered in pickers (runtime list; the database re-validates). */
export function listTimezones(): string[] {
  return Intl.supportedValuesOf("timeZone");
}

export type ActiveRelationship = {
  relationshipId: string;
  facilityId: string;
  facilityName: string;
};

/** The agency's ACTIVE facility relationships (names need facility.view via RLS). */
export async function listActiveRelationships(
  organisationId: string,
): Promise<ActiveRelationship[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agency_facility_relationships")
    .select("id, agency_facility_id, facility:agency_facilities(name)")
    .eq("agency_organisation_id", organisationId)
    .eq("status", "active");
  if (error) throw error;
  return data.map((row) => ({
    relationshipId: row.id,
    facilityId: row.agency_facility_id,
    facilityName: row.facility?.name ?? "Facility",
  }));
}

/* P0-E9-4A.1: agency-initiated facility connection. */

export type FacilityConnectionInvite = {
  id: string;
  maskedEmail: string | null;
  contactName: string | null;
  status: "pending" | "accepted" | "revoked";
  expired: boolean;
  sendCount: number;
  lastSentAt: string;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  deliveryStatus: string;
  facilityOrganisationName: string | null;
};

/** The agency's own invitations for one facility record (masked emails; never tokens). */
export async function listFacilityConnectionInvites(
  facilityId: string,
): Promise<FacilityConnectionInvite[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_facility_connection_invites", {
    p_facility_id: facilityId,
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.invite_id,
    maskedEmail: row.masked_email ?? null,
    contactName: row.contact_name ?? null,
    status:
      row.status === "accepted" ? "accepted" : row.status === "revoked" ? "revoked" : "pending",
    expired: row.expired,
    sendCount: row.send_count,
    lastSentAt: row.last_sent_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at ?? null,
    deliveryStatus: row.delivery_status,
    facilityOrganisationName: row.facility_organisation_name ?? null,
  }));
}

export type FacilityConnectionPreview = {
  agencyName: string;
  facilityName: string;
  contactName: string | null;
  expiresAt: string;
  /** Only facility organisations the signed-in person already belongs to. */
  options: {
    organisationId: string;
    name: string;
    canApprove: boolean;
    alreadyConnected: boolean;
  }[];
};

/** The invitation for the signed-in person's verified email, or null (no oracle). */
export async function previewFacilityConnection(
  token: string,
): Promise<FacilityConnectionPreview | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("preview_facility_connection_invite", {
    p_token: token,
  });
  if (error || !data) return null;
  const value = data as {
    agency_name: string;
    facility_name: string;
    contact_name: string | null;
    expires_at: string;
    options: {
      organisation_id: string;
      name: string;
      can_approve: boolean;
      already_connected: boolean;
    }[];
  };
  return {
    agencyName: value.agency_name,
    facilityName: value.facility_name,
    contactName: value.contact_name,
    expiresAt: value.expires_at,
    options: value.options.map((option) => ({
      organisationId: option.organisation_id,
      name: option.name,
      canApprove: option.can_approve,
      alreadyConnected: option.already_connected,
    })),
  };
}
