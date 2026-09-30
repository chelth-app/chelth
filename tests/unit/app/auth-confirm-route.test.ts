import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyOtp = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { verifyOtp } }),
}));

const { GET } = await import("@/app/auth/confirm/route");

// A hosted-style origin: redirects must stay on the request's own origin.
const HOSTED = "https://app.chelth.example";

async function follow(query: string): Promise<{ status: number; location: string | null }> {
  const response = await GET(new NextRequest(`${HOSTED}/auth/confirm?${query}`));
  return { status: response.status, location: response.headers.get("location") };
}

describe("/auth/confirm — password recovery (hosted-style links)", () => {
  beforeEach(() => {
    verifyOtp.mockReset();
    verifyOtp.mockResolvedValue({ error: null });
  });

  it("verifies the recovery token server-side and opens the reset form", async () => {
    const result = await follow("token_hash=abc123&type=recovery&next=/reset-password");
    expect(verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "abc123" });
    expect(result.location).toBe(`${HOSTED}/reset-password`);
  });

  it("opens the reset form even when the hosted template omits `next` (regression)", async () => {
    const result = await follow("token_hash=abc123&type=recovery");
    expect(result.location).toBe(`${HOSTED}/reset-password`);
  });

  it.each(["/app", "//evil.example", "https://evil.example/reset-password", "/sign-in"])(
    "ignores `next=%s` for recovery sessions",
    async (next) => {
      const result = await follow(
        `token_hash=abc123&type=recovery&next=${encodeURIComponent(next)}`,
      );
      expect(result.location).toBe(`${HOSTED}/reset-password`);
    },
  );

  it("never opens the reset form when verification fails", async () => {
    verifyOtp.mockResolvedValue({ error: { code: "otp_expired", message: "expired" } });
    const result = await follow("token_hash=used-or-expired&type=recovery&next=/reset-password");
    expect(result.location).toBe(`${HOSTED}/auth/error`);
  });

  it("rejects links without a token hash without calling Supabase", async () => {
    const result = await follow("type=recovery&next=/reset-password");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(result.location).toBe(`${HOSTED}/auth/error`);
  });

  it("rejects a PKCE `code` link (default Supabase template) instead of treating it as verified", async () => {
    const result = await follow("code=pkce-code-from-default-template");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(result.location).toBe(`${HOSTED}/auth/error`);
  });
});

describe("/auth/confirm — other email link types", () => {
  beforeEach(() => {
    verifyOtp.mockReset();
    verifyOtp.mockResolvedValue({ error: null });
  });

  it("honours a safe same-origin `next`", async () => {
    const result = await follow("token_hash=abc&type=email_change&next=/app/account");
    expect(result.location).toBe(`${HOSTED}/app/account`);
  });

  it("lands verified users in the app when `next` is missing", async () => {
    const result = await follow("token_hash=abc&type=email");
    expect(result.location).toBe(`${HOSTED}/app`);
  });

  it("refuses open redirects", async () => {
    const result = await follow(
      `token_hash=abc&type=email&next=${encodeURIComponent("//evil.example")}`,
    );
    expect(result.location).toBe(`${HOSTED}/app`);
  });

  it("refuses link types that are not enabled", async () => {
    const result = await follow("token_hash=abc&type=magiclink");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(result.location).toBe(`${HOSTED}/auth/error`);
  });
});
