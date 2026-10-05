import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

import { Spinner } from "./spinner";

export const buttonVariants = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary-hover in-[.chelth-locked]:bg-[linear-gradient(180deg,#00666c,#004f55)] in-[.chelth-locked]:font-semibold in-[.chelth-locked]:shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_6px_14px_-4px_rgba(0,58,64,0.45)] in-[.chelth-locked]:hover:brightness-110",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary-hover",
  outline:
    "border border-input-border bg-surface text-foreground hover:bg-surface-muted in-[.chelth-locked]:border-[rgba(0,90,96,0.35)] in-[.chelth-locked]:font-semibold in-[.chelth-locked]:text-chelth-navy in-[.chelth-locked]:hover:border-chelth-teal-dark",
  ghost: "bg-transparent text-foreground hover:bg-surface-muted",
  // Locked scope: the richer scoped coral is an indicator; buttons use the deeper
  // coral so white labels stay >= 4.5:1 (#B42318: 6.5:1).
  danger:
    "bg-danger text-danger-foreground hover:bg-danger-hover in-[.chelth-locked]:bg-[#b42318] in-[.chelth-locked]:font-semibold in-[.chelth-locked]:hover:bg-[#9a1e14]",
} as const;

export const buttonSizes = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm", // 44px: comfortable touch target on mobile
  lg: "h-12 px-6 text-base",
} as const;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
  /** Shows a spinner, disables the button and sets aria-busy. */
  loading?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-60",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner size="sm" decorative /> : null}
      {children}
    </button>
  );
}
