import type { Metadata } from "next";

import { DataTableRegion } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { getSystemHealth } from "@/features/platform";

import { PLATFORM_TABLE, platformDateTime, PlatformStat } from "../_components/platform-ui";

export const metadata: Metadata = { title: "System" };

/**
 * Platform system health (P0-E9-4A): database, notification queue, scanner,
 * scheduled jobs and storage buckets. Names, counts and statuses only —
 * never secrets, Vault values, API keys or recipients.
 */
export default async function PlatformSystemPage() {
  const health = await getSystemHealth();
  const { notifications, scanner } = health;
  return (
    <>
      <PageHeader
        variant="reference"
        title="System"
        description={<p>Background services that keep Chelth running.</p>}
      />
      <Panel
        titleId="database-heading"
        title={<>Application and database</>}
        description={<>The database answered at {platformDateTime(health.database.now)}.</>}
        variant="reference"
      >
        <p className="text-sm text-slate-700">
          This page loaded through the application and the database, so both are reachable.
        </p>
      </Panel>
      <Panel titleId="notifications-heading" title={<>Email notifications</>} variant="reference">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <PlatformStat label="Queued" value={notifications.pending + notifications.processing} />
          <PlatformStat label="Retrying" value={notifications.retry} />
          <PlatformStat label="Sent" value={notifications.sent} />
          <PlatformStat
            label="Failed"
            value={notifications.failed}
            note={`${notifications.failed_24h} in the last 24 h`}
          />
        </dl>
        <p className="mt-3 text-[12.5px] text-slate-600">
          Oldest waiting: {platformDateTime(notifications.oldest_waiting)}
        </p>
        {health.notification_failures.length > 0 ? (
          <ul
            aria-label="Recent notification failures"
            className="mt-3 flex flex-col divide-y divide-border text-sm"
          >
            {health.notification_failures.map((failure) => (
              <li
                key={`${failure.event}-${failure.code}`}
                className="flex justify-between gap-2 py-2"
              >
                <span>
                  {failure.event} · <code>{failure.code}</code>
                </span>
                <span className="tabular-nums">{failure.count}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>
      <Panel titleId="scanner-heading" title={<>Document scanner</>} variant="reference">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <PlatformStat label="Scanning now" value={scanner.scanning} />
          <PlatformStat label="Stuck (over 1 h)" value={scanner.stuck} />
          <PlatformStat label="Cleared" value={scanner.clean} />
          <PlatformStat
            label="Last upload"
            value={<span className="text-[15px]">{platformDateTime(scanner.last_document)}</span>}
          />
        </dl>
      </Panel>
      <Panel titleId="cron-heading" title={<>Scheduled jobs</>} variant="reference">
        {health.cron.length === 0 ? (
          <p className="text-sm text-slate-700">
            The scheduler is not available in this environment.
          </p>
        ) : (
          <DataTableRegion aria-label="Scheduled jobs table">
            <table className={PLATFORM_TABLE}>
              <caption className="sr-only">Scheduled jobs</caption>
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Schedule</th>
                  <th scope="col">Last run</th>
                  <th scope="col">Last success</th>
                  <th scope="col">Failures (24 h)</th>
                </tr>
              </thead>
              <tbody>
                {health.cron.map((job) => (
                  <tr key={job.name}>
                    <td>
                      {job.name}
                      {!job.active ? (
                        <span className="block text-[12.5px] text-slate-600">Paused</span>
                      ) : null}
                    </td>
                    <td>
                      <code>{job.schedule}</code>
                    </td>
                    <td>
                      {job.last_status ? (
                        <StatusChip tone={job.last_status === "succeeded" ? "success" : "danger"}>
                          {job.last_status === "succeeded" ? "Succeeded" : job.last_status}
                        </StatusChip>
                      ) : (
                        "Not run yet"
                      )}
                    </td>
                    <td>{platformDateTime(job.last_success)}</td>
                    <td className="tabular-nums">{job.failed_24h}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTableRegion>
        )}
      </Panel>
      <Panel titleId="storage-heading" title={<>Storage</>} variant="reference">
        <ul className="flex flex-col divide-y divide-border text-sm">
          {health.buckets.map((bucket) => (
            <li key={bucket.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span>{bucket.id}</span>
              <span className="text-slate-600">
                {bucket.public ? "Public" : "Private"}
                {bucket.file_size_limit
                  ? ` · up to ${Math.round(bucket.file_size_limit / 1048576)} MB`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
