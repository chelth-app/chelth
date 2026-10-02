import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard, ForgotPasswordForm } from "@/features/identity";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email address and we will send you a reset link."
      footer={
        <Link
          href="/sign-in"
          className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
        >
          Back to sign in
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
