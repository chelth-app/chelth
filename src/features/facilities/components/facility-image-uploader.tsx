"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  checkFacilityImageFile,
  FACILITY_IMAGE_BUCKET,
  FACILITY_IMAGE_MAX_EDGE,
  type FacilityImageType,
  fitWithin,
  MAX_FACILITY_IMAGE_BYTES,
} from "@/lib/domain/facility-images";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils/cn";

import { completeFacilityImageAction, startFacilityImageUploadAction } from "../actions";

/*
 * Facility photo (P0-E9-3D-S2; rebuilt P0-E9-3F). The previous control was a
 * raw file input beside an always-identical "Upload photo" button, and it
 * refused real phone photos before any network call: a strict File.type
 * match (Android pickers report "", "image/jpg" or octet-stream) and a hard
 * 2 MB limit (camera photos are typically 3–8 MB). Nothing showed that a file
 * was selected, so the button appeared not to work.
 *
 * Now: a labelled "Choose photo" control over the native input (Files, Photos
 * and Camera stay available), a visible selected state (name and size), one
 * explicit "Upload photo", and photos over 2 MB resized in the browser (which
 * also drops camera metadata such as GPS). Security is unchanged: one-time
 * signed upload into the facility's private prefix; the server verifies size
 * and signature before attaching; workers only ever get short-lived signed
 * URLs.
 */

const ACCEPT = "image/jpeg,image/png,.jpg,.jpeg,.png";
const MESSAGES = {
  type: "Choose a JPG or PNG photo.",
  empty: "This file is empty. Choose a different photo.",
  unreadable: "This photo can't be read. Choose a JPG or PNG photo.",
  tooLarge: "This photo is too large even after resizing. Choose a smaller photo.",
  network: "The photo was not uploaded. Check your connection and try again.",
  offline: "You're offline. Connect to the internet, then upload again.",
} as const;

type Selected = { file: Blob; name: string; mimeType: FacilityImageType; resized: boolean };

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Re-encodes a large photo as a JPEG within the size limit (browser only). */
async function resizeToLimit(file: File): Promise<Blob | null> {
  const bitmap = await createImageBitmap(file);
  try {
    for (const [edge, quality] of [
      [FACILITY_IMAGE_MAX_EDGE, 0.85],
      [1600, 0.8],
      [1200, 0.75],
    ] as const) {
      const size = fitWithin(bitmap.width, bitmap.height, edge);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.fillStyle = "#ffffff"; // PNG transparency → white, not black, in a JPEG
      context.fillRect(0, 0, size.width, size.height);
      context.drawImage(bitmap, 0, 0, size.width, size.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (blob && blob.size <= MAX_FACILITY_IMAGE_BYTES) return blob;
    }
    return null;
  } finally {
    bitmap.close();
  }
}

export function FacilityImageUploader({
  organisationId,
  facilityId,
  facilityName,
  hasImage,
}: {
  organisationId: string;
  facilityId: string;
  facilityName: string;
  hasImage: boolean;
}) {
  const router = useRouter();
  const inputId = useId();
  const hintId = useId();
  // Guards a second tap before React re-renders the disabled state.
  const inFlight = useRef(false);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const busy = preparing || uploading;

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow picking the same file again
    if (!file) return; // picker dismissed: keep any earlier selection
    setDone(false);
    const check = checkFacilityImageFile(file);
    if (!check.ok) {
      setSelected(null);
      setError(MESSAGES[check.reason]);
      return;
    }
    setError(null);
    if (!check.needsResize) {
      setSelected({ file, name: file.name || "photo", mimeType: check.mimeType, resized: false });
      return;
    }
    setPreparing(true);
    try {
      const resized = await resizeToLimit(file);
      if (!resized) {
        setSelected(null);
        setError(MESSAGES.tooLarge);
        return;
      }
      setSelected({
        file: resized,
        name: file.name || "photo",
        mimeType: "image/jpeg",
        resized: true,
      });
    } catch {
      setSelected(null);
      setError(MESSAGES.unreadable);
    } finally {
      setPreparing(false);
    }
  }

  async function upload() {
    if (!selected || inFlight.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setError(MESSAGES.offline);
      return;
    }
    inFlight.current = true;
    setUploading(true);
    setError(null);
    try {
      const ticket = await startFacilityImageUploadAction({
        organisationId,
        facilityId,
        mimeType: selected.mimeType,
        sizeBytes: selected.file.size,
      });
      if (!ticket.ok) {
        setError(ticket.error.message);
        return;
      }
      const stored = await createSupabaseBrowserClient()
        .storage.from(FACILITY_IMAGE_BUCKET)
        .uploadToSignedUrl(ticket.data.path, ticket.data.token, selected.file, {
          contentType: selected.mimeType,
        });
      if (stored.error) {
        setError(MESSAGES.network);
        return;
      }
      const completed = await completeFacilityImageAction({
        organisationId,
        facilityId,
        path: ticket.data.path,
        mimeType: selected.mimeType,
      });
      if (!completed.ok) {
        setError(completed.error.fieldErrors?.image?.[0] ?? completed.error.message);
        return;
      }
      setSelected(null);
      setDone(true);
      router.refresh();
    } catch {
      // Network loss or an interrupted request: never report success.
      setError(MESSAGES.network);
    } finally {
      inFlight.current = false;
      setUploading(false);
    }
  }

  const chooseLabel = selected
    ? "Choose a different photo"
    : hasImage
      ? "Replace photo"
      : "Choose photo";

  return (
    <div
      role="group"
      aria-label="Facility photo"
      className="flex max-w-xl flex-col gap-3 rounded-[12px] border border-dashed border-[rgba(18,107,103,0.30)] bg-[#f6fbfa] p-3.5"
    >
      {selected ? (
        <div className="flex flex-col gap-0.5">
          <p className="text-[15px] leading-5 font-semibold break-all text-chelth-navy">
            {selected.name}
          </p>
          <p className="text-[13px] leading-[18px] text-slate-600">
            {formatSize(selected.file.size)}
            {selected.resized ? " · resized for upload" : ""} ·{" "}
            {uploading ? "Uploading photo…" : "Ready to upload"}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          <p className="text-[15px] leading-5 font-semibold text-chelth-navy">Facility photo</p>
          <p className="text-[13px] leading-[18px] text-slate-600">
            {hasImage
              ? `Workers see this photo of ${facilityName} on their shift.`
              : "Add a photo workers can use to recognise the facility."}
          </p>
          <p id={hintId} className="text-[13px] leading-[18px] text-slate-600">
            JPG or PNG · up to 2 MB (larger photos are resized)
          </p>
        </div>
      )}

      {preparing ? (
        <p
          role="status"
          className="flex items-center gap-2 text-[13px] font-medium text-chelth-navy"
        >
          <Spinner size="sm" decorative />
          Preparing photo…
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {selected ? (
          <Button
            onClick={() => void upload()}
            loading={uploading}
            className="w-fit"
            aria-label={`Upload photo of ${facilityName}`}
          >
            Upload photo
          </Button>
        ) : null}
        {/* The native input stays in the page (and focusable) for Files / Photos / Camera. */}
        <input
          id={inputId}
          type="file"
          accept={ACCEPT}
          onChange={(event) => void onPick(event)}
          disabled={busy}
          aria-describedby={selected ? undefined : hintId}
          className="peer sr-only"
          data-testid="facility-image-file"
        />
        <label
          htmlFor={inputId}
          className={cn(
            "inline-flex min-h-11 cursor-pointer items-center rounded-[8px] border px-4 text-[14px] font-semibold sm:min-h-9",
            "peer-focus-visible:ring-ring peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2",
            selected || hasImage
              ? "border-[rgba(0,90,96,0.35)] bg-white text-chelth-navy hover:border-chelth-teal-dark"
              : "border-transparent bg-[linear-gradient(180deg,#00666c,#004f55)] text-white hover:brightness-110",
            busy && "pointer-events-none opacity-60",
          )}
        >
          {chooseLabel}
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
      {done && !error ? (
        <p role="status" className="text-[13px] leading-[18px] font-medium text-chelth-navy">
          Facility photo updated.
        </p>
      ) : null}
    </div>
  );
}
