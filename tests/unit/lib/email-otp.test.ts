import { describe, expect, it } from "vitest";

import { parseEmailOtpType } from "@/lib/auth/email-otp";

describe("parseEmailOtpType", () => {
  it("accepts approved email link types", () => {
    expect(parseEmailOtpType("signup")).toBe("signup");
    expect(parseEmailOtpType("recovery")).toBe("recovery");
  });

  it("rejects flows that are not enabled", () => {
    expect(parseEmailOtpType("magiclink")).toBeNull();
    expect(parseEmailOtpType("invite")).toBeNull();
    expect(parseEmailOtpType(null)).toBeNull();
    expect(parseEmailOtpType("")).toBeNull();
  });
});
