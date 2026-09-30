import Link from "next/link";
import type { ReactNode } from "react";

import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { BrandLogo } from "@/components/shared/brand-logo";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

type AuthCardProps = {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
};

/** Centred card layout shared by the authentication pages. */
export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <main
      id={MAIN_CONTENT_ID}
      className="flex min-h-dvh items-start justify-center px-4 py-12 sm:items-center"
    >
      <div className="flex w-full max-w-md flex-col gap-6">
        <Link href="/" className="w-fit rounded-sm">
          <BrandLogo height={48} priority />
        </Link>
        <Card>
          <CardHeader>
            <h1 className="text-xl font-semibold text-foreground">{title}</h1>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">{children}</CardContent>
        </Card>
        {footer ? <div className="text-sm text-muted-foreground">{footer}</div> : null}
      </div>
    </main>
  );
}
