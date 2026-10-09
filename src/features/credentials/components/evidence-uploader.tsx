"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

import { Spinner } from "@/components/ui/spinner";
import { INK, WORKER_PRIMARY_CTA, WORKER_SECONDARY_CTA } from "@/components/reference/worker-ui";
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  checkDocumentFile,
  CREDENTIAL_DOCUMENT_BUCKET,
  DOCUMENT_TYPES,
  type DocumentMimeType,
} from "@/lib/domain/credentials";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils/cn";

import { completeUploadAction, startUploadAction } from "../actions";

/*
 * Worker evidence upload (P0-E9-3C): a branded control over the native file
 * input (Files, Photos and Camera stay available where the device offers them),
 * a visible "selected" state, then one explicit "Upload evidence".
 *
 * Flow (unchanged security): one-time signed upload ticket → the file goes
 * straight to the private bucket → the server verifies size, signature and
 * hash → the document is "scanning" until the malware scanner decides. Every
 * failure is shown; nothing is queued, retried silently or reported as done.
 */

// MIME types plus extensions: some Android document providers only match on one of them.
const ACCEPT = [
  ...ALLOWED_DOCUMENT_MIME_TYPES,
  ...ALLOWED_DOCUMENT_MIME_TYPES.flatMap((type) =>
    DOCUMENT_TYPES[type].extensions.map((extension) => `.${extension}`),
  ),
].join(",");

const REFUSED = {
  type: "Choose a PDF, JPG or PNG file.",
  size: "This file is larger than 10 MB. Choose a smaller file.",
  empty: "This file is empty. Choose a different file.",
} as const;
const UNUSABLE = "This document cannot be used. Upload a different file.";
const NETWORK = "We couldn't upload this document. Check your connection and try again.";

type Selected = { file: File; mimeType: DocumentMimeType; uploadName: string };

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EvidenceUploader({
  versionId,
  replacing = false,
  checkingIds = [],
}: {
  versionId: string;
  /** A stored document already exists: the control offers a replacement. */
  replacing?: boolean;
  /** Documents the server still reports as being checked (the confirmation follows them). */
  checkingIds?: string[];
}) {
  const router = useRouter();
  const inputId = useId();
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  // Guards a second tap before React re-renders the disabled state.
  const inFlight = useRef(false);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The document this control uploaded; its confirmation shows only while the
  // server still reports it as being checked (never a client-only success).
  const [uploadedId, setUploadedId] = useState<string | null>(null);

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setUploadedId(null);
    if (!file) return; // Picker dismissed: keep any earlier selection.
    const check = checkDocumentFile(file);
    if (!check.ok) {
      setSelected(null);
      setError(REFUSED[check.reason]);
      event.target.value = "";
      return;
    }
    setError(null);
    // The File object is kept in state, so the input can be cleared for re-picking.
    setSelected({ file, mimeType: check.mimeType, uploadName: check.uploadName });
    event.target.value = "";
  }

  async function upload() {
    if (!selected || inFlight.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setError("You're offline. Connect to the internet, then upload again.");
      return;
    }
    inFlight.current = true;
    setUploading(true);
    setError(null);
    try {
      const ticket = await startUploadAction({
        versionId,
        fileName: selected.uploadName,
        mimeType: selected.mimeType,
        sizeBytes: selected.file.size,
      });
      if (!ticket.ok) {
        setError(ticket.error.fieldErrors?.file?.[0] ?? ticket.error.message);
        return;
      }
      const stored = await createSupabaseBrowserClient()
        .storage.from(CREDENTIAL_DOCUMENT_BUCKET)
        .uploadToSignedUrl(ticket.data.path, ticket.data.token, selected.file, {
          contentType: selected.mimeType,
        });
      if (stored.error) {
        setError(NETWORK);
        return;
      }
      const completed = await completeUploadAction({ documentId: ticket.data.documentId });
      if (!completed.ok) {
        setError(completed.error.fieldErrors?.file ? UNUSABLE : completed.error.message);
        return;
      }
      setSelected(null);
      setUploadedId(ticket.data.documentId);
      router.refresh();
    } catch {
      // Network loss or an interrupted request: never report success.
      setError(NETWORK);
    } finally {
      inFlight.current = false;
      setUploading(false);
    }
  }

  const chooseLabel = selected
    ? "Replace"
    : replacing
      ? "Upload a different file"
      : "Choose document";

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-[12px] border border-dashed border-[rgba(18,107,103,0.30)] bg-[#f6fbfa] p-3.5",
        uploading && "opacity-95",
      )}
    >
      {selected ? (
        <div className="flex items-start gap-3">
          <FileGlyph />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className={cn("text-[15px] leading-5 font-semibold break-all", INK)}>
              {selected.file.name || selected.uploadName}
            </p>
            <p className="text-[13px] leading-[18px] text-slate-600">
              {formatSize(selected.file.size)} ·{" "}
              {uploading ? "Uploading document…" : "Ready to upload"}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <FileGlyph />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className={cn("text-[15px] leading-5 font-semibold", INK)}>
              {replacing ? "Replace evidence" : "Upload evidence"}
            </p>
            <p id={hintId} className="text-[13px] leading-[18px] text-slate-600">
              PDF, JPG or PNG · up to 10 MB
            </p>
          </div>
        </div>
      )}

      {uploading ? (
        <div
          role="status"
          className="flex items-center gap-2.5 text-[13px] leading-[18px] font-medium text-chelth-navy"
        >
          <Spinner size="sm" decorative />
          Uploading document…
        </div>
      ) : null}

      <div className={cn("flex flex-col gap-2", selected && "sm:flex-row-reverse")}>
        {selected ? (
          <button
            type="button"
            onClick={() => void upload()}
            disabled={uploading}
            aria-busy={uploading || undefined}
            className={cn(
              WORKER_PRIMARY_CTA,
              "gap-2 disabled:cursor-not-allowed disabled:opacity-70",
            )}
          >
            {uploading ? <Spinner size="sm" decorative /> : null}
            Upload evidence
          </button>
        ) : null}
        {/* The native input stays in the page (and focusable) for Files / Photos / Camera. */}
        <input
          id={inputId}
          ref={input}
          type="file"
          accept={ACCEPT}
          onChange={onPick}
          disabled={uploading}
          aria-describedby={selected ? undefined : hintId}
          className="peer sr-only"
          data-testid="credential-file"
        />
        <label
          htmlFor={inputId}
          className={cn(
            selected ? WORKER_SECONDARY_CTA : replacing ? WORKER_SECONDARY_CTA : WORKER_PRIMARY_CTA,
            "peer-focus-visible:ring-ring cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2",
            uploading && "pointer-events-none opacity-60",
          )}
        >
          {chooseLabel}
          {selected ? <span className="sr-only"> document</span> : null}
        </label>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-[10px] border border-[rgba(180,35,24,0.18)] bg-danger-soft px-3 py-2 text-[13px] leading-[18px] font-medium text-danger-soft-foreground"
        >
          {error}
        </p>
      ) : null}
      {uploadedId && checkingIds.includes(uploadedId) && !error ? (
        <p role="status" className="text-[13px] leading-[18px] font-medium text-chelth-navy">
          Document uploaded. Checking document…
        </p>
      ) : null}
    </div>
  );
}

function FileGlyph() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-white text-chelth-teal-dark shadow-[0_2px_8px_rgba(0,90,96,0.10)]"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7 3h7l5 5v13H7z" />
        <path d="M14 3v5h5M12 18v-6M9.5 14.5 12 12l2.5 2.5" />
      </svg>
    </span>
  );
}
