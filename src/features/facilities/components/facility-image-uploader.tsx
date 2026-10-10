"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { FACILITY_IMAGE_BUCKET, MAX_FACILITY_IMAGE_BYTES } from "@/lib/domain/facility-images";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import { completeFacilityImageAction, startFacilityImageUploadAction } from "../actions";

const TYPES = ["image/jpeg", "image/png"] as const;

/**
 * Facility photo upload (P0-E9-3D-S2): one-time signed upload into the
 * facility's private prefix; the server verifies the bytes before attaching.
 */
export function FacilityImageUploader({
  organisationId,
  facilityId,
  hasImage,
}: {
  organisationId: string;
  facilityId: string;
  hasImage: boolean;
}) {
  const router = useRouter();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);

  async function upload() {
    const file = input.current?.files?.[0];
    if (!file) return setMessage({ tone: "error", text: "Choose a JPG or PNG image." });
    const type = TYPES.find((candidate) => candidate === file.type);
    if (!type) return setMessage({ tone: "error", text: "Upload a JPG or PNG image." });
    if (file.size > MAX_FACILITY_IMAGE_BYTES) {
      return setMessage({ tone: "error", text: "Images must be 2 MB or smaller." });
    }
    setBusy(true);
    setMessage(null);
    try {
      const ticket = await startFacilityImageUploadAction({
        organisationId,
        facilityId,
        mimeType: type,
        sizeBytes: file.size,
      });
      if (!ticket.ok) return setMessage({ tone: "error", text: ticket.error.message });
      const stored = await createSupabaseBrowserClient()
        .storage.from(FACILITY_IMAGE_BUCKET)
        .uploadToSignedUrl(ticket.data.path, ticket.data.token, file, { contentType: type });
      if (stored.error) {
        return setMessage({ tone: "error", text: "The upload failed. Please try again." });
      }
      const done = await completeFacilityImageAction({
        organisationId,
        facilityId,
        path: ticket.data.path,
        mimeType: type,
      });
      if (!done.ok) {
        return setMessage({
          tone: "error",
          text: done.error.fieldErrors?.image?.[0] ?? done.error.message,
        });
      }
      if (input.current) input.current.value = "";
      setMessage({ tone: "ok", text: "Facility photo updated." });
      router.refresh();
    } catch {
      setMessage({
        tone: "error",
        text: "The upload failed. Check your connection and try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium">
        {hasImage ? "Replace photo" : "Add a photo"} (JPG or PNG, up to 2 MB)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          ref={input}
          type="file"
          accept="image/jpeg,image/png,.jpg,.jpeg,.png"
          className="text-sm"
          data-testid="facility-image-file"
        />
        <Button variant="outline" size="sm" loading={busy} onClick={() => void upload()}>
          Upload photo
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
