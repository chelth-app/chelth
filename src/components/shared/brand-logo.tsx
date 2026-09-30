import { cn } from "@/lib/utils/cn";

/**
 * Canonical Chelth logo (locked Shift Mark). Renders ONLY the approved files
 * in public/brand/chelth/ — never a typeset wordmark or a redrawn mark
 * (docs/brand/CLAUDE-CHELTH-BRAND-RULES.md).
 *
 * primary     full lockup (mark + wordmark + descriptor), light backgrounds
 * reverse     full lockup for Navy / Deep Teal surfaces
 * monochrome  one-colour contexts
 * mark        Shift Mark only: app shell, compact and mobile headers
 */
const LOGOS = {
  primary: { src: "/brand/chelth/logo-primary.svg", width: 770, height: 264 },
  reverse: { src: "/brand/chelth/logo-reverse.svg", width: 770, height: 264 },
  monochrome: { src: "/brand/chelth/logo-monochrome.svg", width: 770, height: 264 },
  mark: { src: "/brand/chelth/logo-mark.svg", width: 200, height: 221 },
} as const;

/** Brand minimum digital sizes: lockups 140 px wide, Shift Mark 20 px. */
const MIN_HEIGHT = { primary: 48, reverse: 48, monochrome: 48, mark: 20 } as const;

type BrandLogoProps = {
  variant?: keyof typeof LOGOS;
  /** Rendered height in px (clamped to the brand minimum). */
  height?: number;
  className?: string;
  /** Set when the logo sits inside a link or next to text that already names Chelth. */
  decorative?: boolean;
  priority?: boolean;
};

export function BrandLogo({
  variant = "primary",
  height,
  className,
  decorative = false,
  priority = false,
}: BrandLogoProps) {
  const logo = LOGOS[variant];
  const renderedHeight = Math.max(height ?? (variant === "mark" ? 32 : 56), MIN_HEIGHT[variant]);
  const renderedWidth = Math.round((renderedHeight * logo.width) / logo.height);
  const alt = decorative
    ? ""
    : variant === "mark"
      ? "Chelth"
      : "Chelth — Healthcare Workforce Operations";
  return (
    // A plain <img>: next/image emits an inline style attribute, which the
    // strict nonce-based CSP (style-src without 'unsafe-inline') blocks, and
    // SVG logos need no optimisation pipeline.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logo.src}
      alt={alt}
      width={renderedWidth}
      height={renderedHeight}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
      className={cn("block h-auto max-w-full shrink-0", className)}
    />
  );
}
