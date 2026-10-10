import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { LocalTime, listMyThreads, OpenThreadButton } from "@/features/messaging";
import { loadOrganisationPage } from "@/features/organisations";
import { getMyWorkerRecord } from "@/features/workforce";
import { cn } from "@/lib/utils/cn";

import { INK, WORKER_CARD, WorkerEmpty } from "../my-shifts/_components/worker-cards";
import { threadSubject } from "./_components/thread-subject";

export const metadata: Metadata = { title: "Messages" };

/**
 * The worker's messages with their agency (P0-E9-3D-S4): All / Unread, one
 * card per thread with its context, the latest message, time and unread
 * count. Only the worker's own threads are ever listed (derived access).
 */
export default async function MessagesPage({
  params,
  searchParams,
}: PageProps<"/app/organisations/[organisationId]/messages">) {
  const { organisationId } = await loadOrganisationPage((await params).organisationId);
  const worker = await getMyWorkerRecord(organisationId);
  if (!worker) notFound();
  const unreadOnly = (await searchParams).view === "unread";
  const threads = (await listMyThreads(organisationId, { unreadOnly })).filter(
    (thread) => thread.viewerSide === "worker",
  );
  const base = `/app/organisations/${organisationId}/messages`;
  const tabs = [
    { label: "All", href: base, current: !unreadOnly },
    { label: "Unread", href: `${base}?view=unread`, current: unreadOnly },
  ];

  return (
    <div className="chelth-locked flex flex-col gap-5">
      <PageHeader variant="reference" title="Messages" />
      <nav aria-label="Message filter">
        <ul className="grid grid-cols-2 gap-1 rounded-[12px] border border-[rgba(18,107,103,0.12)] bg-white p-1 shadow-[0_1px_2px_rgba(13,47,66,0.04)]">
          {tabs.map((tab) => (
            <li key={tab.label}>
              <Link
                href={tab.href as Route}
                aria-current={tab.current ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center justify-center rounded-[9px] text-[14px] font-medium",
                  tab.current
                    ? "bg-[linear-gradient(180deg,#e9f7f3,#dcf2ec)] font-semibold text-chelth-teal-dark shadow-[inset_0_0_0_1px_rgba(18,107,103,0.18)]"
                    : "text-slate-600 hover:text-chelth-navy",
                )}
              >
                {tab.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {threads.length === 0 ? (
        <div className="flex flex-col gap-3">
          <WorkerEmpty
            icon="requests"
            title={unreadOnly ? "No unread messages." : "No messages yet."}
            note="Messages with your agency about your shifts appear here."
          />
          {unreadOnly ? null : (
            <OpenThreadButton
              organisationId={organisationId}
              surface="worker"
              target={{ kind: "worker", agencyWorkerId: worker.id }}
              label="Message your agency"
              variant="primary"
              className="h-12 w-full rounded-[8px] text-[15px]"
            />
          )}
        </div>
      ) : (
        <ul aria-label="Message threads" className="flex flex-col gap-3">
          {threads.map((thread) => (
            <li key={thread.id} className={cn(WORKER_CARD, "relative gap-2")}>
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={`${base}/${thread.id}` as Route}
                  className={cn(
                    "text-[16px] leading-[22px] font-semibold break-words after:absolute after:inset-0 after:rounded-[14px] after:content-['']",
                    INK,
                  )}
                >
                  {thread.agencyName}
                  <span className="sr-only">: {threadSubject(thread)}</span>
                </Link>
                {thread.lastMessageAt ? (
                  <span className="shrink-0 text-[12.5px] text-slate-600">
                    <LocalTime iso={thread.lastMessageAt} />
                  </span>
                ) : null}
              </div>
              <p className="text-[13px] leading-[18px] text-slate-600">{threadSubject(thread)}</p>
              {thread.lastMessagePreview ? (
                <p
                  className={cn(
                    "line-clamp-2 text-[14px] leading-5",
                    thread.unreadCount > 0 ? "font-semibold text-chelth-navy" : "text-slate-700",
                  )}
                >
                  {thread.lastSenderSide === "worker" ? "You: " : ""}
                  {thread.lastMessagePreview}
                </p>
              ) : (
                <p className="text-[14px] text-slate-600">No messages yet.</p>
              )}
              {thread.unreadCount > 0 ? (
                <span className="inline-flex h-6 w-fit items-center rounded-full bg-chelth-teal-dark px-2.5 text-[12px] font-semibold text-white">
                  {thread.unreadCount} unread
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
