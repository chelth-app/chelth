"use server";

/**
 * Attendance Server Actions. Every decision (eligibility, timing, geofence,
 * duplicates, review rights) is made by the database; these actions validate
 * input shape only. No action sends a time for clock events.
 */
import { revalidatePath } from "next/cache";

import { type ActionState, runAction } from "@/lib/actions/run-action";
import { requireAuthIdentity } from "@/lib/auth/session";
import { zonedLocalToInstant } from "@/lib/domain/attendance";
import { AppError, type ErrorCode } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formDataToObject, parseInput } from "@/lib/validation";

import {
  attendanceSettingsSchema,
  clockSchema,
  correctionRequestSchema,
  correctionReviewSchema,
  exceptionReviewSchema,
  geofenceSchema,
} from "./schemas";

export type ClockOutcome = { recordedAt: string | null; exceptionCodes: string[] };

const REFUSAL_ERROR: Record<string, ErrorCode> = {
  OUTSIDE_GEOFENCE: "OUTSIDE_GEOFENCE",
  WORKER_NOT_ELIGIBLE: "WORKER_NOT_ELIGIBLE",
  WORKER_NOT_ACTIVE: "WORKER_NOT_ACTIVE",
};

function myShiftsPath(organisationId: string) {
  return `/app/organisations/${organisationId}/my-shifts` as const;
}

function locationArgs(input: {
  latitude?: number | undefined;
  longitude?: number | undefined;
  accuracy?: number | undefined;
  capturedAt?: string | undefined;
}) {
  return {
    ...(input.latitude !== undefined ? { p_latitude: input.latitude } : {}),
    ...(input.longitude !== undefined ? { p_longitude: input.longitude } : {}),
    ...(input.accuracy !== undefined ? { p_accuracy_meters: input.accuracy } : {}),
    ...(input.capturedAt ? { p_device_captured_at: input.capturedAt } : {}),
  };
}

export async function clockInAction(
  _state: ActionState<ClockOutcome>,
  formData: FormData,
): Promise<ActionState<ClockOutcome>> {
  return runAction("attendance.clockIn", async () => {
    const input = parseInput(clockSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("clock_in_assignment", {
      p_assignment_id: input.assignmentId,
      ...locationArgs(input),
    });
    if (error) throw error;
    revalidatePath(myShiftsPath(input.organisationId));
    const row = data[0];
    if (!row) throw new AppError("INTERNAL", { internalMessage: "no clock-in result" });
    if (row.outcome === "refused") {
      throw new AppError(REFUSAL_ERROR[row.refusal_code ?? ""] ?? "FORBIDDEN", {
        internalMessage: `clock-in refused: ${row.refusal_code ?? "unknown"}`,
      });
    }
    return { recordedAt: row.recorded_at, exceptionCodes: row.exception_codes };
  });
}

export async function clockOutAction(
  _state: ActionState<ClockOutcome>,
  formData: FormData,
): Promise<ActionState<ClockOutcome>> {
  return runAction("attendance.clockOut", async () => {
    const input = parseInput(clockSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("clock_out_assignment", {
      p_assignment_id: input.assignmentId,
      ...locationArgs(input),
    });
    if (error) throw error;
    revalidatePath(myShiftsPath(input.organisationId));
    const row = data[0];
    return { recordedAt: row?.recorded_at ?? null, exceptionCodes: row?.exception_codes ?? [] };
  });
}

export async function requestCorrectionAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("attendance.requestCorrection", async () => {
    const input = parseInput(correctionRequestSchema, formDataToObject(formData));
    const instant = zonedLocalToInstant(input.date, input.time, input.timezone);
    if (!instant) {
      throw new AppError("VALIDATION_FAILED", {
        fieldErrors: { time: ["That local time does not exist (clock change)."] },
      });
    }
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("request_attendance_correction", {
      p_assignment_id: input.assignmentId,
      p_event_type: input.eventType,
      p_requested_time: instant,
      p_reason: input.reason,
      ...(input.note ? { p_note: input.note } : {}),
    });
    if (error) throw error;
    revalidatePath(myShiftsPath(input.organisationId));
    return null;
  });
}

export async function reviewCorrectionAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("attendance.reviewCorrection", async () => {
    const input = parseInput(correctionReviewSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("review_attendance_correction", {
      p_correction_id: input.correctionId,
      p_approve: input.decision === "approve",
      p_resolution: input.resolution,
    });
    if (error) throw error;
    revalidatePath(`/app/organisations/${input.organisationId}/attendance`);
    return null;
  });
}

export async function reviewExceptionAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("attendance.reviewException", async () => {
    const input = parseInput(exceptionReviewSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("review_attendance_exception", {
      p_exception_id: input.exceptionId,
      p_status: input.status,
      ...(input.resolution ? { p_resolution: input.resolution } : {}),
    });
    if (error) throw error;
    revalidatePath(`/app/organisations/${input.organisationId}/attendance`);
    return null;
  });
}

export async function saveAttendanceSettingsAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("attendance.saveSettings", async () => {
    const input = parseInput(attendanceSettingsSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_agency_attendance_settings", {
      p_organisation_id: input.organisationId,
      p_early_clock_in_minutes: input.earlyClockInMinutes,
      p_late_clock_in_minutes: input.lateClockInMinutes,
      p_early_clock_out_minutes: input.earlyClockOutMinutes,
      p_late_clock_out_minutes: input.lateClockOutMinutes,
      p_missed_clock_in_minutes: input.missedClockInMinutes,
      p_missed_clock_out_minutes: input.missedClockOutMinutes,
      p_clock_out_cutoff_minutes: input.clockOutCutoffMinutes,
    });
    if (error) throw error;
    revalidatePath(`/app/organisations/${input.organisationId}/attendance`);
    return null;
  });
}

export async function saveGeofenceAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("attendance.saveGeofence", async () => {
    const input = parseInput(geofenceSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_location_geofence", {
      p_facility_location_id: input.locationId,
      p_enabled: input.enabled,
      p_latitude: input.latitude,
      p_longitude: input.longitude,
      p_radius_meters: input.radiusMeters,
      p_max_accuracy_meters: input.maxAccuracyMeters,
      p_outside_policy: input.outsidePolicy,
    });
    if (error) throw error;
    revalidatePath(`/app/organisations/${input.organisationId}/facilities/${input.facilityId}`);
    return null;
  });
}
