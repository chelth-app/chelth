import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getThread,
  listThreadMessages,
  LocalTime,
  MessageComposer,
  threadIdSchema,
  ThreadLive,
} from "@/features/messaging";
import { loadOrganisationPage } from "@/features/organisations";
import { formatShiftDate, formatShiftTimeRange } from "@/lib/domain/shifts";
import { cn } from "@/lib/utils/cn";

import { INK } from "../../my-shifts/_components/worker-cards";
import { threadSubject } from "../_components/thread-subject";

export const metadata: Metadata = { title: "Message" };

/**
 * One conversation with the agency (P0-E9-3D-S4): context header (tap → Shift
 * Details), chronological messages with server times, earlier pages on
 * request, and the composer. Worker threads only; staff use their workspace.
 */
export default async function ThreadPage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/messages/[threadId]">) {
  const { organisationId: rawOrganisationId, threadId: rawThreadId } = await params;
  const { organisationId } = await loadOrganisationPage(rawOrganisationId);
  const threadId = threadIdSchema.safeParse(rawThreadId);
  if (!threadId.success) notFound();
  const thread = await getThread(threadId.data);
  if (!thread || thread.viewerSide !== "worker" || thread.agencyOrganisationId !== organisationId) {
    notFound();
  }
  const before = (await searchParams).before;
  const page = await listThreadMessages(
    thread.id,
    typeof before === "string" && /^[^|]+\|[0-9a-f-]{36}$/.test(before) ? before : undefined,
  );
  const base = `/app/organisations/${organisationId}`;

  return (
    <div className="chelth-locked flex min-h-[calc(100dvh-13rem)] flex-col gap-4">
      <Link
        href={`${base}/messages` as Route}
        className="inline-flex min-h-11 w-fit items-center gap-1.5 text-[15px] font-semibold text-chelth-navy"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
        >
          <path d="m15 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Messages
      </Link>
      <header className="flex flex-col gap-1">
        <h1
          className={cn(
            "font-display text-[22px] leading-[28px] font-bold tracking-[-0.02em]",
            INK,
          )}
        >
          {thread.agencyName}
        </h1>
        <p className="text-[13.5px] text-slate-600">{threadSubject(thread)}</p>
      </header>

      {thread.shift ? (
        thread.myAssignmentId ? (
          <Link
            href={`${base}/my-shifts/${thread.myAssignmentId}` as Route}
            aria-label={`Shift details: ${thread.facilityName ?? "shift"} ${formatShiftDate(thread.shift)}`}
            className="flex items-center gap-3 rounded-[12px] border border-[rgba(18,107,103,0.12)] bg-[#f3faf8] px-3.5 py-3"
          >
            <ShiftContext thread={thread} />
          </Link>
        ) : (
          <div className="flex items-center gap-3 rounded-[12px] border border-[rgba(18,107,103,0.12)] bg-[#f3faf8] px-3.5 py-3">
            <ShiftContext thread={thread} />
          </div>
        )
      ) : null}

      <section aria-label="Conversation" className="flex flex-1 flex-col gap-3">
        {page.olderCursor ? (
          <Link
            href={
              `${base}/messages/${thread.id}?before=${encodeURIComponent(page.olderCursor)}` as Route
            }
            className="inline-flex min-h-11 items-center self-center text-[14px] font-semibold text-primary"
          >
            Show earlier messages
          </Link>
        ) : null}
        {before ? (
          <Link
            href={`${base}/messages/${thread.id}` as Route}
            className="inline-flex min-h-11 items-center self-center text-[14px] font-semibold text-primary"
          >
            Back to latest
          </Link>
        ) : null}
        {page.messages.length === 0 ? (
          <p className="rounded-[12px] bg-white/70 px-4 py-6 text-center text-[14px] text-slate-600">
            No messages yet. Write to {thread.agencyName} below.
          </p>
        ) : (
          <ol aria-label="Messages" className="flex flex-col gap-2.5">
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
                    "max-w-[85%] rounded-[14px] px-3.5 py-2.5 text-[15px] leading-[21px] break-words whitespace-pre-wrap",
                    message.isMine
                      ? "rounded-br-[4px] bg-[linear-gradient(180deg,#e3f5f0,#d4efe7)] text-chelth-navy"
                      : "rounded-bl-[4px] border border-[rgba(18,107,103,0.10)] bg-white text-slate-800 shadow-[0_1px_2px_rgba(13,47,66,0.05)]",
                  )}
                >
                  {message.body}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {thread.canSend ? (
        <MessageComposer
          organisationId={organisationId}
          threadId={thread.id}
          className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-10"
        />
      ) : (
        <p className="text-center text-[13px] text-slate-600">This conversation is read-only.</p>
      )}
      <ThreadLive threadId={thread.id} unread={thread.unreadCount} />
    </div>
  );
}

function ShiftContext({ thread }: { thread: NonNullable<Awaited<ReturnType<typeof getThread>>> }) {
  if (!thread.shift) return null;
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className={cn("text-[14.5px] font-semibold", INK)}>{thread.facilityName}</span>
      <span className="text-[13px] text-slate-600">
        {formatShiftDate(thread.shift)} · {formatShiftTimeRange(thread.shift)}
      </span>
      {thread.shift.disciplineName ? (
        <span className="text-[13px] text-slate-600">
          {thread.shift.disciplineName}
          {thread.shift.unitLabel ? ` · ${thread.shift.unitLabel}` : ""}
        </span>
      ) : null}
    </span>
  );
}
