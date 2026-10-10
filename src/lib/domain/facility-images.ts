/**
 * Facility images (P0-E9-3D-S2): optional agency-uploaded photos of a client
 * site, shown to workers with an active assignment there. JPEG / PNG only,
 * 2 MB, private bucket; the server verifies the stored bytes' signature.
 */
export const FACILITY_IMAGE_BUCKET = "facility-images";
export const MAX_FACILITY_IMAGE_BYTES = 2 * 1024 * 1024;
/** Signed image URLs for page renders (seconds). Never stored. */
export const FACILITY_IMAGE_URL_TTL_SECONDS = 60 * 60;

export const FACILITY_IMAGE_TYPES = ["image/jpeg", "image/png"] as const;
export type FacilityImageType = (typeof FACILITY_IMAGE_TYPES)[number];

export function isFacilityImageType(value: string): value is FacilityImageType {
  return (FACILITY_IMAGE_TYPES as readonly string[]).includes(value);
}

/** Magic-byte check of the stored image (server-side). */
export function imageMatchesType(bytes: Uint8Array, type: FacilityImageType): boolean {
  const startsWith = (signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  return type === "image/png"
    ? startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : startsWith([0xff, 0xd8, 0xff]);
}

/** `<agency>/<facility>/<object>`: the only shape the bucket policies accept. */
export function facilityImagePath(agencyId: string, facilityId: string, objectId: string): string {
  return `${agencyId}/${facilityId}/${objectId}`;
}
