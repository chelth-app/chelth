import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

/** Mobile-first content width + gutters shared by every page. */
export function PageContainer({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8", className)} {...props} />
  );
}
