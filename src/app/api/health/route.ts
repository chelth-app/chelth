/**
 * Liveness probe. Returns no configuration, versions or dependency details.
 */
export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
