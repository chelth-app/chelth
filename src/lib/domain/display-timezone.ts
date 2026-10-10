/**
 * Personal DISPLAY timezone (P0-E9-3F).
 *
 * Authority (never mixed):
 * - device / user timezone: how a person sees non-operational timestamps
 *   (audit times, message times). It is a preference, nothing more.
 * - facility / shift timezone: the authoritative operational calendar. Shift
 *   times, attendance, Today / Upcoming / Past and pricing dates always use it
 *   (src/lib/domain/shifts.ts, attendance.ts), whatever the device says.
 *
 * Modes: 'automatic' follows the device (re-detected on use); 'manual' keeps an
 * explicitly chosen zone and is never overwritten by a device change.
 */
import type { Database } from "@/types/database.types";

export type TimezoneMode = Database["public"]["Enums"]["timezone_mode"];

/** Used only when nothing valid is known yet. */
export const DISPLAY_TIMEZONE_FALLBACK = "UTC";

/** A real IANA zone the runtime can format with (rejects "", "Mars/Base", offsets like "+01:00"). */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The device's zone from Intl, or null when the runtime reports nothing usable. */
export function detectDeviceTimeZone(
  resolve: () => string | undefined = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
): string | null {
  try {
    const zone = resolve();
    return isValidTimeZone(zone) ? zone : null;
  } catch {
    return null;
  }
}

/**
 * Whether a detected device zone should be saved: automatic mode only, a valid
 * zone, and a change. A manual choice is never overwritten.
 */
export function shouldSyncDeviceTimeZone(
  profile: { timezoneMode: TimezoneMode; timezone: string | null },
  detected: string | null,
): detected is string {
  return profile.timezoneMode === "automatic" && detected !== null && detected !== profile.timezone;
}

/** The zone to format personal (non-operational) timestamps in. */
export function resolveDisplayTimeZone(profile: {
  timezoneMode: TimezoneMode;
  timezone: string | null;
}): string {
  return isValidTimeZone(profile.timezone) ? profile.timezone : DISPLAY_TIMEZONE_FALLBACK;
}

/** Every IANA zone the runtime knows (for the searchable manual picker). */
export function listTimeZones(): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf?.("timeZone");
  return supported && supported.length > 0 ? supported : ["UTC"];
}
