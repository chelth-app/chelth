import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthCard, SignUpForm } from "@/features/identity";
import { getAuthIdentity } from "@/lib/auth/session";
import { getDeviceTerminology } from "@/lib/i18n/request-terms";
import { localizeTerms } from "@/lib/i18n/terminology";

export const metadata: Metadata = { title: "Create account" };

/**
 * Sign-up creates an IDENTITY only. It never grants a role in any
 * organisation: people join organisations by invitation, or create a new
 * agency explicitly afterwards.
 */
export default async function SignUpPage() {
  if (await getAuthIdentity()) redirect("/app");
  // P0-E9-3I: signed out — the browser's language (en-US fallback).
  const terms = await getDeviceTerminology();
  return (
    <AuthCard
      title="Create your account"
      description={localizeTerms(
        "Your account is personal to you. You can join organizations by invitation.",
        terms,
      )}
      footer={
        <p>
          Already have an account?{" "}
          <Link
            href="/sign-in"
            className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <SignUpForm />
    </AuthCard>
  );
}
