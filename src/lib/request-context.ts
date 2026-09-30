import "server-only";

import { cache } from "react";

/**
 * Per-request correlation id. Memoised for the lifetime of one server request
 * (React `cache`), forwarded to Supabase as `x-chelth-request-id` and recorded
 * on audit events so logs and audit history can be correlated.
 * It is never used for authorization.
 */
export const getRequestId = cache((): string => crypto.randomUUID());

export const REQUEST_ID_HEADER = "x-chelth-request-id";
