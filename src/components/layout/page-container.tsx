import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

type PageContainerProps = HTMLAttributes<HTMLDivElement> & {
  /**
   * `default`: centred `max-w-6xl` column (personal pages, public pages).
   * `wide`: operational workspace beside the fixed sidebar — 100% of the
   * remaining width, no max-width, no auto margins; responsive gutters only.
   */
  size?: "default" | "wide";
};

/** Mobile-first content width + gutters shared by every page. */
export function PageContainer({ className, size = "default", ...props }: PageContainerProps) {
  return (
    <div
      className={cn(
        "w-full px-4 sm:px-6",
        // Wide: fluid operational workspace — the locked P1 gutters beside the
        // 214 px sidebar (30 px / 19 px) and nothing else. Default: a centred
        // reading column for personal and public pages.
        size === "wide" ? "lg:pr-[19px] lg:pl-[30px]" : "mx-auto max-w-6xl lg:px-8",
        className,
      )}
      {...props}
    />
  );
}
