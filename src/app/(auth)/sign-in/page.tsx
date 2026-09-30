import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthCard, SignInForm } from "@/features/identity";
import { getAuthIdentity } from "@/lib/auth/session";
import { getSafeRedirectPath } from "@/lib/security/safe-redirect";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  if (await getAuthIdentity()) redirect("/app");
  const { next } = await searchParams;
  const safeNext = getSafeRedirectPath(typeof next === "string" ? next : undefined, "/app");

  return (
    <AuthCard
      title="Sign in"
      description="Access your CHELTH account."
      footer={
        <div className="flex flex-col gap-2">
          <Link href="/forgot-password" className="text-primary underline underline-offset-4">
            Forgotten your password?
          </Link>
          <p>
            New to CHELTH?{" "}
            <Link href="/sign-up" className="text-primary underline underline-offset-4">
              Create an account
            </Link>
          </p>
        </div>
      }
    >
      <SignInForm next={safeNext} />
    </AuthCard>
  );
}
