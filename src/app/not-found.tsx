import Link from "next/link";

import { PageContainer } from "@/components/layout/page-container";
import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";

export default function NotFound() {
  return (
    <main id={MAIN_CONTENT_ID}>
      <PageContainer className="flex flex-col gap-3 py-16">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="text-muted-foreground">The page you requested does not exist.</p>
        <Link href="/" className="w-fit text-primary underline underline-offset-4">
          Return home
        </Link>
      </PageContainer>
    </main>
  );
}
