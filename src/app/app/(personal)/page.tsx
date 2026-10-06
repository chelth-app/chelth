import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyProfile } from "@/features/identity";
import {
  CreateOrganisationForm,
  listMyMemberships,
  readActiveOrganisationPreference,
  readPendingInviteToken,
  selectOrganisationAction,
} from "@/features/organisations";

export const metadata: Metadata = { title: "Your organisations" };

const NOTICES: Record<string, string> = {
  "password-updated": "Your password has been updated.",
};

export default async function AppHomePage({ searchParams }: PageProps<"/app">) {
  const [profile, memberships, preferredOrganisationId, pendingInvite, { notice }] =
    await Promise.all([
      getMyProfile(),
      listMyMemberships(),
      readActiveOrganisationPreference(),
      readPendingInviteToken(),
      searchParams,
    ]);
  const visible = memberships.filter((membership) => membership.organisation !== null);
  // The preference only reorders the list; nothing is selected automatically.
  const ordered = [...visible].sort(
    (a, b) =>
      Number(b.organisation?.id === preferredOrganisationId) -
      Number(a.organisation?.id === preferredOrganisationId),
  );
  const noticeText = typeof notice === "string" ? NOTICES[notice] : undefined;

  return (
    <>
      <PageHeader
        title={`Welcome${profile.displayName ? `, ${profile.displayName}` : ""}`}
        description={<p className="text-sm">Choose an organisation to work in.</p>}
      />

      {noticeText ? (
        <p
          role="status"
          className="rounded-md bg-success-soft p-3 text-sm text-success-soft-foreground"
        >
          {noticeText}
        </p>
      ) : null}

      {pendingInvite ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-info-soft p-4 text-sm text-info-soft-foreground"
        >
          <span>You have a pending invitation.</span>
          <Link href="/invite" className="font-medium underline underline-offset-4">
            Review invitation
          </Link>
        </div>
      ) : null}

      <section aria-labelledby="organisations-heading" className="flex flex-col gap-3">
        <h2 id="organisations-heading" className="text-lg font-semibold">
          Your organisations
        </h2>
        {ordered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You are not a member of any organisation yet. Ask an administrator to invite you, or
            create an agency below.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {ordered.map(({ membershipId, organisation, roleKeys }) =>
              organisation ? (
                <li key={membershipId}>
                  <Card className="h-full">
                    <CardHeader>
                      <CardTitle>{organisation.name}</CardTitle>
                      <CardDescription className="flex flex-wrap gap-2">
                        <Badge tone="brand">
                          {organisation.type === "agency" ? "Agency" : "Facility"}
                        </Badge>
                        {organisation.status !== "active" ? (
                          <StatusChip tone="warning">Suspended</StatusChip>
                        ) : null}
                        {organisation.id === preferredOrganisationId ? (
                          <Badge tone="info">Last used</Badge>
                        ) : null}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                      <p className="text-sm text-muted-foreground">{roleKeys.length} role(s)</p>
                      <form action={selectOrganisationAction}>
                        <input type="hidden" name="organisationId" value={organisation.id} />
                        <Button
                          type="submit"
                          variant="outline"
                          size="sm"
                          aria-label={`Open ${organisation.name}`}
                        >
                          Open
                        </Button>
                      </form>
                    </CardContent>
                  </Card>
                </li>
              ) : null,
            )}
          </ul>
        )}
      </section>

      <section aria-labelledby="create-heading" className="flex flex-col gap-3">
        <h2 id="create-heading" className="text-lg font-semibold">
          Create an agency
        </h2>
        <CreateOrganisationForm />
      </section>
    </>
  );
}
