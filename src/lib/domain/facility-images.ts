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

/** What a phone or desktop picker may report for a JPEG / PNG. */
const IMAGE_TYPE_ALIASES: Record<string, FacilityImageType> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/png": "image/png",
  "image/x-png": "image/png",
};
const IMAGE_EXTENSIONS: Record<string, FacilityImageType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export type FacilityImageFileCheck =
  | { ok: true; mimeType: FacilityImageType; needsResize: boolean }
  | { ok: false; reason: "type" | "empty" };

/**
 * Client pre-check (P0-E9-3F; the E9-3C evidence rules applied to facility
 * photos). Android / iOS pickers may report "image/jpg", an empty type or
 * application/octet-stream, or omit the extension: the type is taken from
 * whichever is known, and a contradiction is refused. A photo over the 2 MB
 * limit is NOT refused here — it is resized in the browser before upload.
 * The server still verifies the stored bytes' signature and size.
 */
export function checkFacilityImageFile(file: {
  name: string;
  type: string;
  size: number;
}): FacilityImageFileCheck {
  const dot = file.name.lastIndexOf(".");
  const extension = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  const fromExtension = IMAGE_EXTENSIONS[extension];
  const declared = IMAGE_TYPE_ALIASES[file.type.trim().toLowerCase()];
  const generic = file.type === "" || file.type === "application/octet-stream";
  let mimeType: FacilityImageType;
  if (declared) {
    // A known extension that contradicts the declared type is refused; an unknown
    // one (e.g. a converted ".heic" the browser now reports as JPEG) is left to
    // the server's signature check.
    if (fromExtension && fromExtension !== declared) return { ok: false, reason: "type" };
    mimeType = declared;
  } else if (generic && fromExtension) {
    mimeType = fromExtension;
  } else {
    return { ok: false, reason: "type" };
  }
  if (file.size <= 0) return { ok: false, reason: "empty" };
  return { ok: true, mimeType, needsResize: file.size > MAX_FACILITY_IMAGE_BYTES };
}

/** Longest edge after an in-browser resize (plenty for a facility hero image). */
export const FACILITY_IMAGE_MAX_EDGE = 2000;

/** Scaled dimensions that fit within `maxEdge`, never enlarged. */
export function fitWithin(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
