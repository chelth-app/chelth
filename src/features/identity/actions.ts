"use server";

/**
 * Identity Server Actions (authentication, MFA, self-service profile).
 *
 * Pattern: parseInput → (identity) → Supabase Auth / RPC → ActionResult.
 * Responses that could reveal whether an account exists are uniform.
 */
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { type ActionState, runAction } from "@/lib/actions/run-action";
import { requireAuthIdentity } from "@/lib/auth/session";
import { isValidTimeZone } from "@/lib/domain/display-timezone";
import { AppError } from "@/lib/errors";
import { redirectToSafePath } from "@/lib/navigation";
import { getSafeRedirectPath } from "@/lib/security/safe-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formDataToObject, parseInput } from "@/lib/validation";

import {
  displayNameSchema,
  displayPreferencesSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  totpCodeSchema,
  totpEnrollmentVerifySchema,
} from "./schemas";

const DEFAULT_AFTER_SIGN_IN = "/app";

export async function signInAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  let destination = DEFAULT_AFTER_SIGN_IN;
  const result = await runAction("identity.signIn", async () => {
    const input = parseInput(signInSchema, formDataToObject(formData));
    destination = getSafeRedirectPath(input.next, DEFAULT_AFTER_SIGN_IN);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (error) throw error;
    return null;
  });
  if (result.ok) redirectToSafePath(destination);
  return result;
}

export type SignUpOutcome = { email: string };

export async function signUpAction(
  _state: ActionState<SignUpOutcome>,
  formData: FormData,
): Promise<ActionState<SignUpOutcome>> {
  return runAction("identity.signUp", async () => {
    const input = parseInput(signUpSchema, formDataToObject(formData));
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      // display_name is the ONLY metadata read by the profile trigger.
      options: { data: { display_name: input.displayName } },
    });
    // With email confirmation on, Supabase returns an obfuscated success for
    // already-registered emails, so this response never reveals account
    // existence. Only policy / rate-limit errors surface.
    if (error) throw error;
    return { email: input.email };
  });
}

export async function requestPasswordResetAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("identity.requestPasswordReset", async () => {
    const input = parseInput(forgotPasswordSchema, formDataToObject(formData));
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(input.email);
    // Uniform response: only rate limiting is surfaced; unknown emails look
    // exactly like known ones.
    if (error && error.status === 429) throw error;
    return null;
  });
}

export async function updatePasswordAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runAction("identity.updatePassword", async () => {
    const input = parseInput(resetPasswordSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.updateUser({ password: input.password });
    if (error) throw error;
    return null;
  });
  if (result.ok) redirect("/app?notice=password-updated");
  return result;
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  // scope "local": ends this device's session only.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/");
}

export async function updateDisplayNameAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("identity.updateDisplayName", async () => {
    const input = parseInput(displayNameSchema, formDataToObject(formData));
    const identity = await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    // Column-level grant + RLS restrict this to the caller's own display name.
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: input.displayName })
      .eq("id", identity.userId);
    if (error) throw error;
    return null;
  });
}

/** Personal language and display timezone (P0-E9-3F). Own profile only. */
export async function updateDisplayPreferencesAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction("identity.updateDisplayPreferences", async () => {
    const input = parseInput(displayPreferencesSchema, formDataToObject(formData));
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_my_display_preferences", {
      ...(input.locale ? { p_locale: input.locale } : {}),
      p_timezone_mode: input.timezoneMode,
      ...(input.timezone ? { p_timezone: input.timezone } : {}),
    });
    if (error) throw error;
    revalidatePath("/app", "layout");
    return null;
  });
}

/**
 * Saves the device's zone in AUTOMATIC mode only (the database refuses to
 * overwrite a manual choice). Invalid zones are ignored, never stored.
 */
export async function syncDeviceTimezoneAction(timezone: string): Promise<{ changed: boolean }> {
  if (!isValidTimeZone(timezone)) return { changed: false };
  await requireAuthIdentity();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("sync_my_device_timezone", { p_timezone: timezone });
  if (error) return { changed: false };
  return { changed: data === true };
}

// -----------------------------------------------------------------------------
// MFA (TOTP)
// -----------------------------------------------------------------------------

export type TotpEnrollment = { factorId: string; qrCode: string; secret: string };

export async function startTotpEnrollmentAction(): Promise<ActionState<TotpEnrollment>> {
  return runAction("identity.startTotpEnrollment", async () => {
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();

    // Discard abandoned, unverified factors so they cannot accumulate.
    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) throw listError;
    for (const factor of factors.all) {
      if (factor.status === "unverified") {
        const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
        if (error) throw error;
      }
    }

    const host = (await headers()).get("host") ?? "chelth";
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Authenticator (${new Date().toISOString().slice(0, 10)})`,
      issuer: `CHELTH ${host}`,
    });
    if (error) throw error;
    return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
  });
}

export async function verifyTotpEnrollmentAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let destination = "/app/security?notice=mfa-enabled";
  const result = await runAction("identity.verifyTotpEnrollment", async () => {
    const input = parseInput(totpEnrollmentVerifySchema, formDataToObject(formData));
    if (input.next) destination = getSafeRedirectPath(input.next, destination);
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: input.factorId,
      code: input.code,
    });
    if (error) throw error;
    return null;
  });
  if (result.ok) redirectToSafePath(destination);
  return result;
}

/** Step-up: raise the current session to AAL2 with an already-verified factor. */
export async function verifyMfaChallengeAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let destination = "/app";
  const result = await runAction("identity.verifyMfaChallenge", async () => {
    const input = parseInput(totpCodeSchema, formDataToObject(formData));
    destination = getSafeRedirectPath(input.next, destination);
    await requireAuthIdentity();
    const supabase = await createSupabaseServerClient();
    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) throw listError;
    const factor = factors.totp.find((candidate) => candidate.status === "verified");
    if (!factor) throw new AppError("MFA_REQUIRED", { internalMessage: "No verified TOTP factor" });
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: input.code,
    });
    if (error) throw error;
    return null;
  });
  if (result.ok) redirectToSafePath(destination);
  return result;
}
