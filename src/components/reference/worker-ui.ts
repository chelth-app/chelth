/*
 * Worker Mobile style tokens (locked Worker Mobile reference, P0-E8-W1), shared
 * by the worker route components and the worker-facing feature components.
 * Presentation only.
 */

export const INK = "text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)]";

/** Worker card surface (12 px radius, teal hairline, soft navy depth). */
export const WORKER_CARD =
  "flex flex-col gap-3.5 rounded-[14px] border border-[rgba(18,107,103,0.10)] bg-white p-4 shadow-[0_8px_24px_rgba(13,47,66,0.06),0_1px_2px_rgba(13,47,66,0.04)]";

/** Worker primary CTA (locked J primary at the W1 48 px touch height). */
export const WORKER_PRIMARY_CTA =
  "inline-flex h-12 w-full items-center justify-center rounded-[8px] bg-[linear-gradient(180deg,#00666c,#004f55)] px-4 text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_6px_14px_-4px_rgba(0,58,64,0.45)] hover:brightness-110";

/** Worker secondary CTA (locked J outlined secondary at the W1 48 px touch height). */
export const WORKER_SECONDARY_CTA =
  "inline-flex h-12 w-full items-center justify-center rounded-[8px] border border-[rgba(0,90,96,0.35)] bg-white px-4 text-[15px] font-semibold text-chelth-navy hover:border-chelth-teal-dark";
