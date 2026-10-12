import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { listPlatformActivity } from "@/features/platform";

import { platformDateTime } from "../_components/platform-ui";

export const metadata: Metadata = { title: "Activity" };

const LABELS: Record<string, string> = {
  "organisation.created": "Organization created",
  "organisation.status_changed": "Organization status changed",
  "facility.linked": "Facility linked",
  "invite.created": "Owner invitation created",
  "invite.resent": "Owner invitation resent",
  "invite.revoked": "Owner invitation revoked",
  "profile.status_changed": "Account status changed",
  "platform.admin_granted": "Platform admin granted",
  "platform.admin_revoked": "Platform admin revoked",
  "platform.customer_account_created": "Commercial account set up",
  "platform.plan_changed": "Plan changed",
  "platform.trial_changed": "Trial changed",
  "platform.subscription_changed": "Subscription changed",
  "platform.billing_contact_changed": "Billing contact changed",
  "platform.plan_saved": "Plan saved",
};

function describe(details: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof details.from === "string" || typeof details.to === "string") {
    parts.push(`${String(details.from ?? "—")} → ${String(details.to ?? "—")}`);
  }
  if (Array.isArray(details.changes)) parts.push(`changed: ${details.changes.join(", ")}`);
  if (typeof details.plan_key === "string") parts.push(`plan ${details.plan_key}`);
  if (typeof details.type === "string") parts.push(details.type);
  if (typeof details.reason === "string") parts.push(`reason: ${details.reason}`);
  return parts.join(" · ");
}

/**
 * Platform activity (P0-E9-4A): an explicit allow-list of platform-level
 * events (provisioning, lifecycle, links, commercial changes, admin grants),
 * with safe detail keys only. Tenant operational audit is never listed.
 */
export default async function PlatformActivityPage() {
  const events = await listPlatformActivity(150);
  return (
    <>
      <PageHeader
        variant="reference"
        title="Activity"
        description={<p>Platform-level changes, newest first.</p>}
      />
      <Panel titleId="activity-heading" title={<>Recent activity</>} variant="reference">
        {events.length === 0 ? (
          <EmptyState headingLevel={3} title="No platform activity yet." />
        ) : (
          <ul
            aria-label="Platform activity"
            className="flex flex-col divide-y divide-border text-sm"
          >
            {events.map((event) => (
              <li key={event.id} className="flex flex-col gap-0.5 py-2.5">
                <span className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium text-chelth-navy">
                    {LABELS[event.action] ?? event.action}
                    {event.organisationName && event.organisationId ? (
                      <>
                        {" · "}
                        <Link
                          href={`/platform/organisations/${event.organisationId}` as Route}
                          className="text-primary underline underline-offset-4"
                        >
                          {event.organisationName}
                        </Link>
                      </>
                    ) : null}
                  </span>
                  <span className="text-slate-600">{platformDateTime(event.occurredAt)}</span>
                </span>
                <span className="text-slate-600">
                  {[event.actorName ? `by ${event.actorName}` : null, describe(event.details)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
