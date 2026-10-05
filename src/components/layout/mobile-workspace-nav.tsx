"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { ShellGlyph } from "./workspace-nav-icon";
import type { WorkspaceNavGroup } from "./workspace-navigation-model";
import { WorkspaceSidebar } from "./workspace-sidebar";

type MobileWorkspaceNavProps = {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: WorkspaceNavGroup[];
};

/**
 * The canonical sidebar as an overlay below the desktop breakpoint (no bottom
 * navigation for agency/facility users — decision G1).
 *
 * Built on the native modal <dialog> like `Dialog`: `showModal()` provides the
 * focus trap, Escape to close, an inert (blocked) background and focus return
 * to the trigger, with no injected inline styles (strict CSP).
 */
export function MobileWorkspaceNav({ id, open, onOpenChange, groups }: MobileWorkspaceNavProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // A click on the <dialog> element itself (not its content) is a click on the
  // backdrop: dismiss, as Escape and the close button do.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    function onBackdropClick(event: MouseEvent) {
      if (event.target === dialog) onOpenChange(false);
    }
    dialog.addEventListener("click", onBackdropClick);
    return () => dialog.removeEventListener("click", onBackdropClick);
  }, [onOpenChange]);

  // A completed navigation always dismisses the overlay.
  useEffect(() => {
    onOpenChange(false);
  }, [pathname, onOpenChange]);

  return (
    <dialog
      ref={ref}
      id={id}
      aria-label="Workspace navigation"
      onClose={() => onOpenChange(false)}
      className="m-0 h-dvh max-h-none w-72 max-w-[calc(100%-3rem)] border-0 bg-transparent p-0 backdrop:bg-chelth-ink/50 lg:hidden"
    >
      <div className="relative h-full">
        {/* First in focus order, so the trap opens on "Close navigation". */}
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute top-4 right-3 z-10 inline-flex size-11 items-center justify-center rounded-md text-shell-sidebar-foreground hover:bg-shell-sidebar-hover focus-visible:outline-shell-sidebar-focus"
        >
          <ShellGlyph name="close" />
          <span className="sr-only">Close navigation</span>
        </button>
        <WorkspaceSidebar groups={groups} onNavigate={() => onOpenChange(false)} />
      </div>
    </dialog>
  );
}
