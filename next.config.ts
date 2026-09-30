import type { NextConfig } from "next";
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants";

import { parsePublicEnv, parseServerEnv, resolveAppEnvironment } from "./src/config/env.schema";
import { buildSecurityHeaders } from "./src/lib/security/security-headers";

/**
 * Environment validation runs here so that a build, dev server or production
 * server with missing/invalid configuration FAILS IMMEDIATELY. There is no
 * fallback or demo mode.
 */
const VALIDATED_PHASES = new Set([
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
]);

export default function nextConfig(phase: string): NextConfig {
  const appEnv = resolveAppEnvironment({
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    NODE_ENV: process.env.NODE_ENV,
  });

  if (VALIDATED_PHASES.has(phase)) {
    parsePublicEnv({
      NEXT_PUBLIC_APP_ENV: appEnv,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
    parseServerEnv({
      LOG_LEVEL: process.env.LOG_LEVEL,
      SENTRY_DSN: process.env.SENTRY_DSN,
    });
  }

  const isDevelopment = phase === PHASE_DEVELOPMENT_SERVER;

  return {
    reactStrictMode: true,
    poweredByHeader: false,
    // Browser source maps are not published. If error monitoring is added,
    // upload maps to the provider during build and delete them from output.
    productionBrowserSourceMaps: false,
    typedRoutes: true,
    // Pin the workspace root so builds never depend on lockfiles in parent directories.
    turbopack: { root: import.meta.dirname },
    env: {
      // Resolved value is inlined so client and server always agree.
      NEXT_PUBLIC_APP_ENV: appEnv,
    },
    async headers() {
      return [{ source: "/:path*", headers: buildSecurityHeaders({ isDevelopment }) }];
    },
  };
}
