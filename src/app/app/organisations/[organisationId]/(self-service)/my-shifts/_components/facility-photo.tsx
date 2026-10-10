"use client";

import { useState } from "react";

import { WorkspaceNavIcon } from "@/components/layout/workspace-nav-icon";
import { cn } from "@/lib/utils/cn";

/*
 * Facility imagery for the worker app (P0-E9-3D-S2): the agency's uploaded
 * photo through a short-lived signed URL, or the approved Chelth facility
 * artwork (the W1 luminous tile language) — never a generated or stock photo.
 */

export function FacilityThumb({ url, className }: { url: string | null; className?: string }) {
  // An image that cannot be shown (expired link, undecodable file) falls back to the artwork.
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, decorative
      <img
        src={url}
        alt=""
        onError={() => setFailed(true)}
        className={cn(
          "size-16 shrink-0 rounded-[12px] object-cover shadow-[0_4px_12px_rgba(13,47,66,0.14)]",
          className,
        )}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-16 shrink-0 items-center justify-center rounded-[12px] bg-[radial-gradient(circle_at_30%_25%,#f4fdfa_0%,#d3f2e8_45%,#a9e3d3_100%)] text-chelth-teal-dark shadow-[0_4px_12px_rgba(0,90,96,0.14),inset_0_1px_0_rgba(255,255,255,0.9)] [&>svg]:size-8",
        className,
      )}
    >
      <WorkspaceNavIcon name="facilities" strokeWidth={1.9} duotone />
    </span>
  );
}

export function FacilityHero({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
      <img
        src={url}
        alt={name}
        onError={() => setFailed(true)}
        className="h-44 w-full rounded-[14px] object-cover shadow-[0_8px_24px_rgba(13,47,66,0.10)]"
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className="relative flex h-36 w-full items-center justify-center overflow-hidden rounded-[14px] bg-[radial-gradient(120%_120%_at_20%_10%,#f4fdfa_0%,#d6f2ea_45%,#b4e6d8_100%)] shadow-[0_8px_24px_rgba(13,47,66,0.08)]"
    >
      <span className="inline-flex size-20 items-center justify-center rounded-[18px] bg-white/70 text-chelth-teal-dark shadow-[0_6px_18px_rgba(0,90,96,0.16),inset_0_1px_0_rgba(255,255,255,0.9)] [&>svg]:size-10">
        <WorkspaceNavIcon name="facilities" strokeWidth={1.8} duotone />
      </span>
    </div>
  );
}
