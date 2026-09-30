import { PageContainer } from "@/components/layout/page-container";
import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { BrandMark } from "@/components/shared/brand-mark";

/**
 * Foundation landing page. Intentionally minimal: product surfaces (agency,
 * facility and worker experiences) are built in later stages.
 */
export default function HomePage() {
  return (
    <main id={MAIN_CONTENT_ID} className="flex min-h-dvh items-center">
      <PageContainer className="flex flex-col gap-6 py-16">
        <BrandMark />
        <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Reliable workforce operations for healthcare staffing.
        </h1>
        <p className="max-w-xl text-base text-muted-foreground">
          The Chelth platform is being established. Operational modules will be introduced in
          upcoming releases.
        </p>
      </PageContainer>
    </main>
  );
}
