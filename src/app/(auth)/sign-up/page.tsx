import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthCard, SignUpForm } from "@/features/identity";
import { getAuthIdentity } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Create account" };

/**
 * Sign-up creates an IDENTITY only. It never grants a role in any
 * organisation: people join organisations by invitation, or create a new
 * agency explicitly afterwards.
 */
export default async function SignUpPage() {
  if (await getAuthIdentity()) redirect("/app");
  return (
    <AuthCard
      title="Create your account"
      description="Your account is personal to you. You can join organisations by invitation."
      footer={
        <p>
          Already have an account?{" "}
          <Link href="/sign-in" className="text-primary underline underline-offset-4">
            Sign in
          </Link>
        </p>
      }
    >
      <SignUpForm />
    </AuthCard>
  );
}
