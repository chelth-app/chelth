/**
 * Build/runtime mode (distinct from the deployment environment in
 * env.public.ts: a "preview" deployment still runs a production build).
 */
export const isDevelopmentBuild = process.env.NODE_ENV === "development";
