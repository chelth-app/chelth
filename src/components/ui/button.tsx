import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

import { Spinner } from "./spinner";

export const buttonVariants = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary-hover",
  outline: "border border-input-border bg-surface text-foreground hover:bg-surface-muted",
  ghost: "bg-transparent text-foreground hover:bg-surface-muted",
  danger: "bg-danger text-danger-foreground hover:bg-danger-hover",
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
