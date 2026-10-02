import type { ReactNode } from "react";

import { AuthCanvas } from "@/components/layout/auth-canvas";

type AuthCardProps = {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
};

/** P9 auth card on the brand canvas, shared by every authentication page. */
export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <AuthCanvas>
      <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-card sm:p-8">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-2xl leading-8 font-semibold text-chelth-navy">
            {title}
          </h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        <div className="flex flex-col gap-4">{children}</div>
      </div>
      {footer ? <div className="text-center text-sm text-muted-foreground">{footer}</div> : null}
    </AuthCanvas>
  );
}
