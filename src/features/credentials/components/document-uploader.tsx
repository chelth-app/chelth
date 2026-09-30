"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  CREDENTIAL_DOCUMENT_BUCKET,
  extensionMatchesMimeType,
  isAllowedDocumentMimeType,
  MAX_DOCUMENT_BYTES,
} from "@/lib/domain/credentials";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import { completeUploadAction, startUploadAction } from "../actions";

/**
 * Uploads a file straight to the private bucket with a one-time signed upload
 * ticket, then asks the server to verify size, magic bytes and hash. Client
 * checks here are only for fast feedback — the server and database enforce.
 */
export function DocumentUploader({ versionId }: { versionId: string }) {
  const router = useRouter();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);

  async function upload() {
    const file = input.current?.files?.[0];
    if (!file) {
      setMessage({ tone: "error", text: "Choose a file to upload." });
      return;
    }
    if (!isAllowedDocumentMimeType(file.type) || !extensionMatchesMimeType(file.name, file.type)) {
      setMessage({ tone: "error", text: "Upload a PDF, JPEG or PNG file." });
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      setMessage({ tone: "error", text: "Files must be 10 MB or smaller." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const ticket = await startUploadAction({
        versionId,
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if (!ticket.ok) {
        setMessage({
          tone: "error",
          text: ticket.error.fieldErrors?.file?.[0] ?? ticket.error.message,
        });
        return;
      }
      const { error } = await createSupabaseBrowserClient()
        .storage.from(CREDENTIAL_DOCUMENT_BUCKET)
        .uploadToSignedUrl(ticket.data.path, ticket.data.token, file, { contentType: file.type });
      if (error) {
        setMessage({ tone: "error", text: "The upload failed. Please try again." });
        return;
      }
      const completed = await completeUploadAction({ documentId: ticket.data.documentId });
      if (!completed.ok) {
        setMessage({
          tone: "error",
          text: completed.error.fieldErrors?.file?.[0] ?? completed.error.message,
        });
        return;
      }
      setMessage({
        tone: "ok",
        text: "Uploaded. The document will be usable once its security scan clears.",
      });
      if (input.current) input.current.value = "";
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium">
        Upload document (PDF, JPEG or PNG, up to 10 MB)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          ref={input}
          type="file"
          accept={ALLOWED_DOCUMENT_MIME_TYPES.join(",")}
          className="text-sm"
          data-testid="credential-file"
        />
        <Button variant="outline" size="sm" loading={busy} onClick={() => void upload()}>
          Upload
        </Button>
      </div>
      {message ? (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={
            message.tone === "error"
              ? "text-sm text-danger"
              : "text-sm text-success-soft-foreground"
          }
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
