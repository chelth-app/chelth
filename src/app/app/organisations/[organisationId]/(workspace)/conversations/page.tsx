import type { Metadata, Route } from "next";
import Link from "next/link";

import { RefChip } from "@/components/reference/locked-reference";
import {
  RECORD_ROW,
  RECORD_ROW_META,
  RECORD_ROW_TITLE,
  RecordList,
  RecordNote,
  RecordPage,
} from "@/components/reference/record-page";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { SectionTabs } from "@/components/ui/section-tabs";
import { listMyThreads, LocalTime, type ThreadSummary } from "@/features/messaging";
import { loadOrganisationPage, requireCapabilityOrNotFound } from "@/features/organisations";
import { CAPABILITIES } from "@/lib/authz";
import { formatShiftDate } from "@/lib/domain/shifts";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Messages" };

function counterpart(thread: ThreadSummary): string {
  if (thread.viewerSide === "facility") return thread.agencyName;
  if (thread.kind === "facility") return thread.facilityName ?? "Facility";
  return thread.workerName ?? "Worker";
}

function context(thread: ThreadSummary): string {
  const parts = [
    thread.kind === "facility" ? "Facility conversation" : "Worker conversation",
    thread.shift
      ? `${thread.kind === "worker" ? `${thread.facilityName ?? "Shift"} · ` : ""}${formatShiftDate(thread.shift)}`
      : "General",
  ];
  return parts.join(" · ");
}

/**
 * Operational messages for agency and facility staff (P0-E9-3D-S5). Lists
 * only the threads the caller may read (message.view; facility users only
 * their relationships' facility threads), newest first. Participant
 * messaging — never internal notes, which stay on their own records.
 */
export default async function ConversationsPage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/conversations">) {
  const context_ = await loadOrganisationPage((await params).organisationId);
  requireCapabilityOrNotFound(context_, CAPABILITIES.MESSAGE_VIEW);
  const { organisationId } = context_;
  const unreadOnly = (await searchParams).view === "unread";
  const threads = (await listMyThreads(organisationId, { unreadOnly, limit: 100 })).filter(
    (thread) => thread.viewerSide !== "worker",
  );
  const base = `/app/organisations/${organisationId}/conversations`;

  return (
    <RecordPage>
      <PageHeader
        variant="reference"
        title="Messages"
        description={
          <p>
            Conversations with workers and partner organisations about their shifts and requests.
          </p>
        }
      />
      <SectionTabs
        label="Message filter"
        tabs={[
          { label: "All", href: base as Route, current: !unreadOnly },
          { label: "Unread", href: `${base}?view=unread` as Route, current: unreadOnly },
        ]}
      />
      <Panel titleId="threads-heading" title={<>Conversations</>}>
        {threads.length === 0 ? (
          <RecordNote>
            {unreadOnly
              ? "No unread messages."
              : "No conversations yet. Start one from a worker record, a shift or a staffing request."}
          </RecordNote>
        ) : (
          <RecordList label="Conversations">
            {threads.map((thread) => (
              <li key={thread.id} className={cn(RECORD_ROW, "relative items-start")}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Link
                    href={`${base}/${thread.id}` as Route}
                    className={cn(
                      RECORD_ROW_TITLE,
                      "break-words after:absolute after:inset-0 after:content-['']",
                    )}
                  >
                    {counterpart(thread)}
                  </Link>
                  <span className={RECORD_ROW_META}>{context(thread)}</span>
                  {thread.lastMessagePreview ? (
                    <span
                      className={cn(
                        "line-clamp-1 text-[14px]",
                        thread.unreadCount > 0
                          ? "font-semibold text-chelth-navy"
                          : "text-slate-700",
                      )}
                    >
                      {thread.lastMessagePreview}
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1.5">
                  {thread.lastMessageAt ? (
                    <span className={RECORD_ROW_META}>
                      <LocalTime iso={thread.lastMessageAt} />
                    </span>
                  ) : null}
                  {thread.unreadCount > 0 ? (
                    <RefChip tone="info" className="font-semibold">
                      {thread.unreadCount} unread
                    </RefChip>
                  ) : null}
                </span>
              </li>
            ))}
          </RecordList>
        )}
      </Panel>
    </RecordPage>
  );
}
