"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { WORKER_PRIMARY_CTA } from "@/components/reference/worker-ui";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils/cn";

import { sendMessageAction } from "../actions";

const newKey = () => crypto.randomUUID();

/**
 * Message composer (P0-E9-3D-S4). One idempotency key per composed message:
 * a double tap, a retried request or a resubmission returns the same stored
 * message. Nothing is queued: offline, the text stays and the worker is told
 * it was not sent. Success is shown only once the server accepted it.
 */
export function MessageComposer({
  organisationId,
  threadId,
  className,
}: {
  organisationId: string;
  threadId: string;
  className?: string;
}) {
  const router = useRouter();
  const inputId = useId();
  const form = useRef<HTMLFormElement>(null);
  const [clientKey, setClientKey] = useState(newKey);
  const [body, setBody] = useState("");
  const [offline, setOffline] = useState(false);
  const [state, formAction, pending] = useActionState(sendMessageAction, null);

  // A new key only after the server accepted this message (once per response).
  const [handled, setHandled] = useState<typeof state>(null);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) {
      setBody("");
      setClientKey(newKey());
    }
  }

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form
      ref={form}
      action={formAction}
      onSubmit={(event) => {
        if (navigator.onLine === false) {
          event.preventDefault();
          setOffline(true);
          return;
        }
        setOffline(false);
      }}
      className={cn(
        "flex flex-col gap-2 rounded-[14px] border border-[rgba(18,107,103,0.14)] bg-white p-3 shadow-[0_-4px_18px_rgba(13,47,66,0.06)]",
        className,
      )}
    >
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="threadId" value={threadId} />
      <input type="hidden" name="clientKey" value={clientKey} />
      <label htmlFor={inputId} className="sr-only">
        Message
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id={inputId}
          name="body"
          rows={1}
          maxLength={2000}
          required
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends on hardware keyboards; Shift+Enter adds a line.
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (body.trim() && !pending) form.current?.requestSubmit();
            }
          }}
          placeholder="Write a message…"
          className="max-h-40 min-h-12 flex-1 resize-y rounded-[10px] border border-input-border bg-surface px-3 py-2.5 text-base text-foreground placeholder:text-subtle-foreground"
        />
        <button
          type="submit"
          disabled={pending || body.trim().length === 0}
          aria-busy={pending || undefined}
          className={cn(
            WORKER_PRIMARY_CTA,
            "w-auto shrink-0 gap-2 px-5 disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {pending ? <Spinner size="sm" decorative /> : null}
          Send
        </button>
      </div>
      {offline ? (
        <p role="alert" className="text-[13px] font-medium text-danger-soft-foreground">
          You&apos;re offline. Your message was not sent.
        </p>
      ) : state && !state.ok ? (
        <p role="alert" className="text-[13px] font-medium text-danger-soft-foreground">
          {state.error.fieldErrors?.body?.[0] ?? "Your message was not sent. Try again."}
        </p>
      ) : null}
    </form>
  );
}
