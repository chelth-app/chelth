/**
 * Validated public (browser-safe) environment.
 *
 * Each variable is referenced literally so Next.js can inline it into client
 * bundles at build time. Do not destructure `process.env` or read it
 * dynamically here — dynamic access is not inlined and would be undefined in
 * the browser.
 */
import { parsePublicEnv, type PublicEnv } from "./env.schema";

export const publicEnv: PublicEnv = parsePublicEnv({
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

export const isProduction = publicEnv.NEXT_PUBLIC_APP_ENV === "production";
