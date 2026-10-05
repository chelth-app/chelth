"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

const WIDTHS = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-xl",
  /**
   * Locked P3 "Shift Details" card (reference px / 0.87): 374 px wide, 110 px
   * from the top, 11 px from the right, 8 px from the bottom, 18 px radius.
   * Still the same modal dialog; phones keep the full-height sheet.
   */
  panel: "sm:max-w-[385px]",
  /** Locked Workforce "Professional Details" card (reference px / 0.888): 387 px wide, 178 px from the top. */
  profile: "sm:max-w-[397px]",
} as const;

type DetailDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /** Action stack pinned to the bottom (primary full width, then secondary). */
  footer?: ReactNode;
  width?: keyof typeof WIDTHS;
};

/**
 * Details drawer (P5) for quick inspection beside a table. It never replaces
 * the record's own route: put a link to the full page inside it.
 *
 * Desktop: right-hand panel over the still-visible page. Phones: full-height,
 * full-width sheet. Built on the native modal <dialog> like `Dialog`:
 * focus trap, Escape, inert background, focus returns to the trigger, and no
 * injected inline styles (strict CSP).
 */
export function DetailDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = "md",
}: DetailDrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const panel = width === "panel" || width === "profile";
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // A click on the <dialog> element itself (outside the panel) is the backdrop.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    function onBackdropClick(event: MouseEvent) {
      if (event.target === dialog) onOpenChange(false);
    }
    dialog.addEventListener("click", onBackdropClick);
    return () => dialog.removeEventListener("click", onBackdropClick);
  }, [onOpenChange]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={() => onOpenChange(false)}
      className={cn(
        // text-left: the dialog may be rendered inside a right-aligned table cell.
        "m-0 ml-auto h-dvh max-h-none w-full max-w-none border-0 bg-transparent p-0 text-left text-foreground",
        "backdrop:bg-chelth-ink/30",
        // Locked P3: docked beside the contracted page on wide screens — no dim.
        panel && "min-[1536px]:backdrop:bg-transparent",
        WIDTHS[width],
      )}
    >
      <div
        className={cn(
          "flex h-full flex-col border-l border-border bg-surface shadow-elevated",
          panel &&
            (width === "profile"
              ? "sm:mt-[178px] sm:mr-2.5 sm:h-[calc(100%-188px)]"
              : "sm:mt-[110px] sm:mr-[11px] sm:h-[calc(100%-118px)]"),
          panel &&
            "sm:overflow-hidden sm:rounded-[18px] sm:border-chelth-border/70 sm:shadow-[0_10px_30px_rgba(21,45,49,0.10)]",
          // Locked Workforce profile surface: cool-white → mint luminosity, soft teal
          // border, diffused elevation that lifts it above the workspace.
          width === "profile" &&
            "bg-[linear-gradient(180deg,#ffffff_0%,#fbfefd_42%,#f2faf7_100%)] sm:border-[rgba(18,107,103,0.14)] sm:shadow-[0_24px_60px_-12px_rgba(9,40,52,0.22),0_8px_20px_rgba(9,40,52,0.08)]",
        )}
      >
        <header
          className={cn(
            "flex items-start justify-between gap-3",
            panel
              ? "items-center py-1.5 pr-[7px] pl-5 sm:min-h-16"
              : "border-b border-border px-5 py-4",
          )}
        >
          <div className="flex min-w-0 flex-col gap-1">
            <h2
              id={titleId}
              className={cn(
                "font-display text-lg leading-6 font-semibold text-chelth-navy",
                panel && "sm:text-[20px] sm:font-extrabold sm:tracking-[-0.02em]",
                width === "profile" &&
                  "text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)] [-webkit-text-stroke:0.2px_currentColor] sm:text-[20.5px]",
              )}
            >
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="text-sm text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              aria-hidden="true"
              focusable="false"
              className="size-5"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
            <span className="sr-only">Close details</span>
          </button>
        </header>
        {/* Named, focusable region so keyboard users can scroll long content (as DataTableRegion). */}
        <div
          role="region"
          aria-labelledby={titleId}
          tabIndex={0}
          className={cn(
            "flex flex-1 flex-col overflow-y-auto",
            panel ? "px-4 pb-4" : "gap-5 px-5 py-4",
          )}
        >
          {children}
        </div>
        {footer ? (
          <footer className="flex flex-col gap-2 border-t border-border px-5 py-4">{footer}</footer>
        ) : null}
      </div>
    </dialog>
  );
}

type DetailDrawerTriggerProps = Omit<DetailDrawerProps, "open" | "onOpenChange"> & {
  /** Visible button text, e.g. "Details". */
  triggerLabel: string;
  /** Accessible name when the visible text alone is ambiguous in a table. */
  triggerAccessibleLabel?: string;
  triggerClassName?: string;
};

/**
 * A button that opens a `DetailDrawer` with server-rendered content. The
 * drawer content is rendered by the server; this component only owns the
 * open state.
 */
export function DetailDrawerTrigger({
  triggerLabel,
  triggerAccessibleLabel,
  triggerClassName,
  ...drawer
}: DetailDrawerTriggerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={triggerAccessibleLabel}
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-primary underline underline-offset-4 hover:bg-surface-muted",
          triggerClassName,
        )}
      >
        {triggerLabel}
      </button>
      <DetailDrawer open={open} onOpenChange={setOpen} {...drawer} />
    </>
  );
}
