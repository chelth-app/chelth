import "server-only";

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
  };
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
