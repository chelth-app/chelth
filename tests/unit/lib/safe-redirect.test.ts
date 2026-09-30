import { describe, expect, it } from "vitest";

import { getSafeRedirectPath } from "@/lib/security/safe-redirect";

describe("getSafeRedirectPath", () => {
  it.each([
    ["/", "/"],
    ["/account", "/account"],
    ["/a/b?tab=1#top", "/a/b?tab=1#top"],
  ])("allows same-origin path %s", (input, expected) => {
    expect(getSafeRedirectPath(input)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "account",
    "/\tevil",
    `/${"a".repeat(3000)}`,
  ])("rejects %s", (input) => {
    expect(getSafeRedirectPath(input, "/fallback")).toBe("/fallback");
  });

  it("keeps percent-encoded control characters encoded (never decoded into headers)", () => {
    expect(getSafeRedirectPath("/%0d%0aSet-Cookie:x")).toBe("/%0d%0aSet-Cookie:x");
  });
});
