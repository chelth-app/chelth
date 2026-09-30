"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
};

/**
 * Modal dialog built on the native <dialog> element.
 *
 * `showModal()` gives us, from the browser itself: a focus trap, Escape to
 * close, an inert background, top-layer rendering and focus restoration —
 * with no third-party runtime and no injected inline styles (CSP-friendly).
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={() => onOpenChange(false)}
      className={cn(
        "m-auto w-[calc(100%-2rem)] max-w-lg rounded-lg border border-border bg-surface p-0 text-foreground shadow-lg",
        "backdrop:bg-foreground/40",
        className,
      )}
    >
      <div className="flex flex-col gap-4 p-6">
        <header className="flex flex-col gap-1">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </header>
        {children}
        {footer ? <footer className="flex flex-wrap justify-end gap-2">{footer}</footer> : null}
      </div>
    </dialog>
  );
}
