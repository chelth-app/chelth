import "server-only";

import type { Database } from "@/types/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/*
 * Operational messaging read models (P0-E9-3D-S3). Every read is a
 * security-definer projection that derives access from the thread's context
 * (deny by default); RLS on the tables backs it up.
 */

type Enums = Database["public"]["Enums"];
export type ConversationKind = Enums["conversation_kind"];
export type MessageSenderSide = Enums["message_sender_side"];

export type ThreadSummary = {
  id: string;
  kind: ConversationKind;
  viewerSide: MessageSenderSide;
  agencyOrganisationId: string;
  agencyName: string;
  facilityName: string | null;
  workerName: string | null;
  shift: {
    id: string;
    startAt: string;
    endAt: string;
    timezone: string;
    disciplineName: string | null;
    unitLabel: string | null;
  } | null;
  myAssignmentId: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastSenderSide: MessageSenderSide | null;
  unreadCount: number;
};

type ThreadRow = Database["public"]["Functions"]["list_my_threads"]["Returns"][number];

function toSummary(row: ThreadRow): ThreadSummary {
  return {
    id: row.thread_id,
    kind: row.kind,
    viewerSide: row.viewer_side,
    agencyOrganisationId: row.agency_organisation_id,
    agencyName: row.agency_name,
    facilityName: row.facility_name,
    workerName: row.worker_name,
    shift:
      row.shift_id && row.start_at && row.end_at && row.timezone
        ? {
            id: row.shift_id,
            startAt: row.start_at,
            endAt: row.end_at,
            timezone: row.timezone,
            disciplineName: row.discipline_name,
            unitLabel: row.unit_label,
          }
        : null,
    myAssignmentId: row.my_assignment_id,
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview,
    lastSenderSide: row.last_sender_side,
    unreadCount: row.unread_count,
  };
}

/** Threads the caller may read in an agency or facility organisation, newest first. */
export async function listMyThreads(
  organisationId: string,
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<ThreadSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_my_threads", {
    p_organisation_id: organisationId,
    p_unread_only: options.unreadOnly ?? false,
    p_limit: options.limit ?? 50,
  });
  if (error) throw error;
  return data.map(toSummary);
}

export type ThreadDetail = ThreadSummary & { canSend: boolean };

/** One thread the caller may read, or null (missing and hidden are the same). */
export async function getThread(threadId: string): Promise<ThreadDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_thread", { p_thread_id: threadId });
  if (error) throw error;
  const row = data[0];
  return row ? { ...toSummary(row), canSend: row.can_send } : null;
}

export type ThreadMessage = {
  id: string;
  senderSide: MessageSenderSide;
  senderLabel: string;
  isMine: boolean;
  body: string;
  createdAt: string;
};

export type MessagePage = { messages: ThreadMessage[]; olderCursor: string | null };

export const MESSAGE_PAGE_SIZE = 30;

/**
 * A page of messages in chronological order. `before` is an opaque cursor
 * from a previous page ("<iso>|<id>").
 */
export async function listThreadMessages(threadId: string, before?: string): Promise<MessagePage> {
  const [beforeAt, beforeId] = before?.split("|") ?? [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_thread_messages", {
    p_thread_id: threadId,
    ...(beforeAt && beforeId ? { p_before_at: beforeAt, p_before_id: beforeId } : {}),
    p_limit: MESSAGE_PAGE_SIZE + 1,
  });
  if (error) throw error;
  const hasOlder = data.length > MESSAGE_PAGE_SIZE;
  const page = data.slice(0, MESSAGE_PAGE_SIZE);
  const oldest = page[page.length - 1];
  return {
    messages: page.reverse().map((row) => ({
      id: row.message_id,
      senderSide: row.sender_side,
      senderLabel: row.sender_label,
      isMine: row.is_mine,
      body: row.body,
      createdAt: row.created_at,
    })),
    olderCursor: hasOlder && oldest ? `${oldest.created_at}|${oldest.message_id}` : null,
  };
}

/** Total unread messages for the caller in one organisation. */
export async function unreadMessageCount(organisationId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("unread_message_count", {
    p_organisation_id: organisationId,
  });
  if (error) throw error;
  return data ?? 0;
}
