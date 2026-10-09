import type { ReactNode } from "react";

import { AuthCanvas } from "@/components/layout/auth-canvas";
import { StateIcon, type StateIconName } from "@/components/ui/state-icon";
import { SYSTEM_CARD } from "@/components/ui/system-state";
import { cn } from "@/lib/utils/cn";

type AuthPanelProps = {
  title: string;
  description?: ReactNode;
  /** Optional semantic tile (mail, key, shield…) above the heading. */
  icon?: StateIconName;
  children: ReactNode;
};

/**
 * The locked auth panel (P9 on the locked system): card surface, optional
 * luminous icon tile, Manrope 26 / 700 heading, one supporting line and the
 * form. `.chelth-locked` gives buttons the locked primary / outline treatment.
 * Used on the auth canvas (AuthCard) and inside the personal frame (step-up).
 */
export function AuthPanel({ title, description, icon, children }: AuthPanelProps) {
  return (
    <div className={cn("chelth-locked flex flex-col gap-5 p-6 sm:p-8", SYSTEM_CARD)}>
      <div className="flex flex-col items-start gap-3">
        {icon ? <StateIcon name={icon} variant="luminous" /> : null}
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-[26px] leading-8 font-bold tracking-[-0.02em] text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]">
            {title}
          </h1>
          {description ? (
            <p className="text-[14.5px] leading-[22px] text-slate-600">{description}</p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

type AuthCardProps = {
  title: string;
  description?: string;
  icon?: StateIconName;
  children: ReactNode;
  footer?: ReactNode;
};

/** P9 auth card on the brand canvas, shared by every authentication page. */
export function AuthCard({ title, description, icon, children, footer }: AuthCardProps) {
  return (
    <AuthCanvas>
      <AuthPanel title={title} description={description} icon={icon}>
        {children}
      </AuthPanel>
      {footer ? <div className="text-center text-sm text-slate-600">{footer}</div> : null}
    </AuthCanvas>
  );
}
