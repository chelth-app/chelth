import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

type PageContainerProps = HTMLAttributes<HTMLDivElement> & {
  /**
   * `default`: centred `max-w-6xl` column (personal pages, public pages).
   * `wide`: workspace shell content beside the sidebar — operational tables
   * get the width the shell leaves (up to `max-w-screen-2xl`).
   */
  size?: "default" | "wide";
};

/** Mobile-first content width + gutters shared by every page. */
export function PageContainer({ className, size = "default", ...props }: PageContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 sm:px-6",
        // Wide: the locked P1 content gutters beside the 214 px sidebar (30 px / 19 px).
        size === "wide" ? "max-w-screen-2xl lg:pr-[19px] lg:pl-[30px]" : "max-w-6xl lg:px-8",
        className,
      )}
      {...props}
    />
  );
}
