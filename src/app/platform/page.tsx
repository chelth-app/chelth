import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { getPlatformOverview } from "@/features/platform";

import { platformDateTime, PlatformStat } from "./_components/platform-ui";

export const metadata: Metadata = { title: "Overview" };

/**
 * Platform overview (P0-E9-4A): customers, facility organisations,
 * commercial accounts, platform health and what needs attention. Every
 * figure is a count from the audited platform projection; no tenant records.
 */
export default async function PlatformOverviewPage() {
  const overview = await getPlatformOverview();
  const { agencies, facilities, accounts, health, attention } = overview;
  const healthy =
    health.notifications_waiting === 0 &&
    health.scans_stuck === 0 &&
    (health.cron?.failed_24h ?? 0) === 0;

  return (
    <>
      <PageHeader
        variant="reference"
        title="Customer administration"
        description={<p>Chelth customers, their commercial accounts and platform health.</p>}
      />
      <Panel titleId="customers-heading" title={<>Customers</>} variant="reference">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <PlatformStat
            label="Agencies"
            value={agencies.total}
            note={`${agencies.active} active · ${agencies.suspended} suspended`}
          />
          <PlatformStat
            label="Facility organizations"
            value={facilities.total}
            note={`${facilities.linked} linked · ${facilities.unlinked} not linked`}
          />
          <PlatformStat
            label="Accounts on trial"
            value={accounts.trial}
            note={`${accounts.active} active`}
          />
          <PlatformStat
            label="Commercial setup required"
            value={accounts.setup_required}
            note={`${accounts.past_due} past due · ${accounts.suspended} suspended · ${accounts.cancelled} canceled`}
          />
        </dl>
      </Panel>
      <Panel
        titleId="health-heading"
        title={<>Platform health</>}
        description={<>{healthy ? "No problems detected." : "Something needs a look."}</>}
        variant="reference"
        action={
          <Link
            href="/platform/system"
            className="text-sm font-medium text-primary underline underline-offset-4"
          >
            View system
          </Link>
        }
      >
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <PlatformStat label="Emails waiting > 10 min" value={health.notifications_waiting} />
          <PlatformStat label="Emails failed (24 h)" value={health.notifications_failed_24h} />
          <PlatformStat label="Document scans stuck" value={health.scans_stuck} />
          <PlatformStat
            label="Scheduled job failures (24 h)"
            value={health.cron ? health.cron.failed_24h : "—"}
            note={
              health.cron
                ? `Last success ${platformDateTime(health.cron.last_success)}`
                : "Scheduler not available"
            }
          />
        </dl>
      </Panel>
      <Panel titleId="attention-heading" title={<>Needs attention</>} variant="reference">
        <ul className="flex flex-col divide-y divide-border text-sm">
          <li className="flex items-center justify-between gap-3 py-2.5">
            <span>Agencies without a commercial account</span>
            <span className="font-semibold tabular-nums">{accounts.setup_required}</span>
          </li>
          <li className="flex items-center justify-between gap-3 py-2.5">
            <span>Facility organizations waiting for their owner to accept</span>
            <span className="font-semibold tabular-nums">{attention.facility_owner_pending}</span>
          </li>
          <li className="flex items-center justify-between gap-3 py-2.5">
            <span>Facility organizations not linked to an agency facility</span>
            <span className="font-semibold tabular-nums">{attention.facility_unlinked}</span>
          </li>
        </ul>
        <Link
          href="/platform/organisations"
          className="mt-3 inline-flex text-sm font-medium text-primary underline underline-offset-4"
        >
          Open the organization directory
        </Link>
      </Panel>
    </>
  );
}
