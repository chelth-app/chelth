import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageContainer } from "@/components/layout/page-container";
import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { BrandLogo } from "@/components/shared/brand-logo";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ErrorState,
  FormField,
  Input,
  LoadingState,
} from "@/components/ui";
import { isProduction } from "@/config/env.public";

import { DialogDemo } from "./dialog-demo";

export const metadata: Metadata = { title: "Design system" };

/**
 * Internal reference for UI primitives. Not available in production.
 */
export default function DesignSystemPage() {
  if (isProduction) notFound();

  return (
    <main id={MAIN_CONTENT_ID} className="py-10">
      <PageContainer className="flex flex-col gap-10">
        <header className="flex flex-col gap-2">
          <BrandLogo />
          <h1 className="text-2xl font-semibold">Design system foundation</h1>
          <p className="text-sm text-muted-foreground">
            Internal reference. Not available in production.
          </p>
        </header>

        <section aria-labelledby="buttons-heading" className="flex flex-col gap-3">
          <h2 id="buttons-heading" className="text-lg font-semibold">
            Buttons
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button loading>Saving</Button>
            <Button disabled>Disabled</Button>
          </div>
        </section>

        <section aria-labelledby="badges-heading" className="flex flex-col gap-3">
          <h2 id="badges-heading" className="text-lg font-semibold">
            Badges
          </h2>
          <div className="flex flex-wrap gap-2">
            <Badge>Neutral</Badge>
            <Badge tone="brand">Brand</Badge>
            <Badge tone="info">Info</Badge>
            <Badge tone="success">Success</Badge>
            <Badge tone="warning">Warning</Badge>
            <Badge tone="danger">Danger</Badge>
          </div>
        </section>

        <section aria-labelledby="forms-heading" className="flex max-w-md flex-col gap-4">
          <h2 id="forms-heading" className="text-lg font-semibold">
            Form fields
          </h2>
          <FormField id="ds-email" label="Email address" description="We never share it." required>
            <Input type="email" autoComplete="email" />
          </FormField>
          <FormField id="ds-invalid" label="Reference" errors={["Enter a reference."]}>
            <Input />
          </FormField>
        </section>

        <section aria-labelledby="cards-heading" className="flex flex-col gap-3">
          <h2 id="cards-heading" className="text-lg font-semibold">
            Card and dialog
          </h2>
          <Card className="max-w-md">
            <CardHeader>
              <CardTitle>Card title</CardTitle>
              <CardDescription>Supporting description text.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm">Card body content.</p>
            </CardContent>
            <CardFooter>
              <DialogDemo />
            </CardFooter>
          </Card>
        </section>

        <section aria-labelledby="states-heading" className="flex flex-col gap-3">
          <h2 id="states-heading" className="text-lg font-semibold">
            States
          </h2>
          <Card>
            <LoadingState label="Loading example…" />
          </Card>
          <ErrorState message="This is a safe, user-facing error message." reference="ref-123" />
        </section>
      </PageContainer>
    </main>
  );
}
