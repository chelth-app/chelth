import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * supabase/templates/ is the source of truth for the HOSTED Supabase email
 * templates too. These tests pin the link format the app's /auth/confirm
 * route expects, so template drift fails CI instead of stranding users.
 */
const root = path.resolve(import.meta.dirname, "../../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);

const EXPECTED = {
  "supabase/templates/recovery.html":
    "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password",
  "supabase/templates/confirmation.html":
    "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/app",
  "supabase/templates/email_change.html":
    "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change&next=/app/account",
} as const;

describe("auth email templates", () => {
  it.each(Object.entries(EXPECTED))(
    "%s links only to the server-side token_hash route",
    (file, link) => {
      const html = read(file);
      expect(hrefs(html)).toEqual([link]);
      // The default Supabase variables bypass /auth/confirm (GoTrue /verify →
      // Site URL root with a PKCE code): never use them.
      expect(html).not.toContain("ConfirmationURL");
      expect(html).not.toContain("RedirectTo");
    },
  );

  it("config.toml wires every template", () => {
    const config = read("supabase/config.toml");
    for (const [kind, file] of [
      ["confirmation", "confirmation.html"],
      ["recovery", "recovery.html"],
      ["email_change", "email_change.html"],
    ]) {
      expect(config).toMatch(
        new RegExp(
          `\\[auth\\.email\\.template\\.${kind}\\][^\\[]*content_path = "\\./supabase/templates/${file}"`,
        ),
      );
    }
  });
});
