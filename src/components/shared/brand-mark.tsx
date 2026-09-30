import { APP_DESCRIPTOR, APP_NAME } from "@/constants/app";
import { cn } from "@/lib/utils/cn";

type BrandMarkProps = { showDescriptor?: boolean; className?: string };

export function BrandMark({ showDescriptor = true, className }: BrandMarkProps) {
  return (
    <div className={cn("flex flex-col", className)}>
      <span className="text-xl font-semibold tracking-[0.2em] text-primary">{APP_NAME}</span>
      {showDescriptor ? (
        <span className="text-sm text-muted-foreground">{APP_DESCRIPTOR}</span>
      ) : null}
    </div>
  );
}
