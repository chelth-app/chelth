/** Opaque keyset cursor for URLs: base64url("<startAt>|<id>"). Invalid input ⇒ null (first page). */
export type ShiftCursor = { startAt: string; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: ShiftCursor): string {
  return Buffer.from(`${cursor.startAt}|${cursor.id}`, "utf8").toString("base64url");
}

export function decodeCursor(value: string | undefined): ShiftCursor | null {
  if (!value || value.length > 200) return null;
  const [startAt = "", id = ""] = Buffer.from(value, "base64url").toString("utf8").split("|");
  if (!UUID.test(id) || Number.isNaN(Date.parse(startAt))) return null;
  return { startAt, id };
}
