import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RecordPage } from "@/components/reference/record-page";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import {
  getThread,
  listThreadMessages,
  LocalTime,
  MessageComposer,
  threadIdSchema,
  ThreadLive,
} from "@/features/messaging";
import { loadOrganisationPage, requireCapabilityOrNotFound } from "@/features/organisations";
import { CAPABILITIES } from "@/lib/authz";
import { formatShiftDate, formatShiftTimeRange } from "@/lib/domain/shifts";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Conversation" };

/**
 * One conversation for agency or facility staff (P0-E9-3D-S5): who it is
 * with, its shift / request context (linked to the caller's own record of
 * it), the messages and a reply box when the caller holds message.send.
 * History stays readable after the shift or request is closed.
 */
export default async function ConversationPage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/conversations/[threadId]">) {
  const { organisationId: rawOrganisationId, threadId: rawThreadId } = await params;
  const context = await loadOrganisationPage(rawOrganisationId);
  requireCapabilityOrNotFound(context, CAPABILITIES.MESSAGE_VIEW);
  const { organisationId, organisation } = context;
  const threadId = threadIdSchema.safeParse(rawThreadId);
  if (!threadId.success) notFound();
  const thread = await getThread(threadId.data);
  if (!thread || thread.viewerSide === "worker") notFound();
  // The page belongs to the caller's own organisation side of the thread.
  const ownSide =
    thread.viewerSide === "agency"
      ? thread.agencyOrganisationId === organisationId
      : organisation.type === "facility";
  if (!ownSide) notFound();
  const before = (await searchParams).before;
  const page = await listThreadMessages(
    thread.id,
    typeof before === "string" && /^[^|]+\|[0-9a-f-]{36}$/.test(before) ? before : undefined,
  );
  const base = `/app/organisations/${organisationId}`;
  const title =
    thread.viewerSide === "facility"
      ? thread.agencyName
      : thread.kind === "facility"
        ? (thread.facilityName ?? "Facility")
        : (thread.workerName ?? "Worker");
  const shiftHref = thread.shift
    ? thread.viewerSide === "facility"
      ? `${base}/staffing-requests/${thread.shift.id}`
      : `${base}/shifts/${thread.shift.id}`
    : null;

  return (
    <RecordPage>
      <PageHeader
        variant="reference"
        title={title}
        back={
          <Link
            href={`${base}/conversations` as Route}
            className="text-primary underline underline-offset-4"
          >
            Messages
          </Link>
        }
        description={
          <p>
            {thread.kind === "facility" ? "Facility conversation" : "Worker conversation"}
            {thread.shift ? (
              <>
                {" · "}
                {shiftHref ? (
                  <Link
                    href={shiftHref as Route}
                    className="text-primary underline underline-offset-4"
                  >
                    {thread.facilityName ? `${thread.facilityName}, ` : ""}
                    {formatShiftDate(thread.shift)} · {formatShiftTimeRange(thread.shift)}
                  </Link>
                ) : null}
                {thread.shift.disciplineName ? ` · ${thread.shift.disciplineName}` : ""}
                {thread.shift.unitLabel ? ` · ${thread.shift.unitLabel}` : ""}
              </>
            ) : (
              " · General"
            )}
          </p>
        }
      />
      <Panel titleId="conversation-heading" title={<>Conversation</>}>
        {page.olderCursor ? (
          <Link
            href={
              `${base}/conversations/${thread.id}?before=${encodeURIComponent(page.olderCursor)}` as Route
            }
            className="inline-flex min-h-11 items-center self-center text-sm font-semibold text-primary"
          >
            Show earlier messages
          </Link>
        ) : null}
        {page.messages.length === 0 ? (
          <p className="text-sm text-slate-600">No messages yet.</p>
        ) : (
          <ol aria-label="Messages" className="flex flex-col gap-3">
            {page.messages.map((message) => (
              <li
                key={message.id}
                className={cn("flex flex-col gap-1", message.isMine ? "items-end" : "items-start")}
              >
                <span className="px-1 text-[12px] text-slate-600">
                  {message.senderLabel} · <LocalTime iso={message.createdAt} mode="full" />
                </span>
                <p
                  className={cn(
                    "max-w-[75%] rounded-[12px] px-3.5 py-2.5 text-[14.5px] leading-[21px] break-words whitespace-pre-wrap",
                    message.isMine
                      ? "rounded-br-[4px] bg-[linear-gradient(180deg,#e3f5f0,#d4efe7)] text-chelth-navy"
                      : "rounded-bl-[4px] border border-[rgba(18,107,103,0.10)] bg-white text-slate-800",
                  )}
                >
                  {message.body}
                </p>
              </li>
            ))}
          </ol>
        )}
        {thread.canSend ? (
          <MessageComposer organisationId={organisationId} threadId={thread.id} />
        ) : (
          <p className="text-sm text-slate-600">You can read this conversation but not reply.</p>
        )}
      </Panel>
      <ThreadLive threadId={thread.id} unread={thread.unreadCount} />
    </RecordPage>
  );
}
