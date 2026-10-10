/**
 * Organisation presentation hint (P0-E9-3F). The proxy copies the organisation
 * id from /app/organisations/<id>/… into a request header so server code can
 * resolve the workspace's terminology without threading it through every
 * query. Presentation only — never an authorization input.
 */
export const ORGANISATION_HINT_HEADER = "x-chelth-organisation-hint";

const PATH =
  /^\/app\/organisations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

export function organisationIdFromPath(pathname: string): string | null {
  return PATH.exec(pathname)?.[1]?.toLowerCase() ?? null;
}
