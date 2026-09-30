import { describe, expect, it } from "vitest";

import { isSensitiveKey, REDACTED, redact, redactString } from "@/lib/logging/redact";

describe("redact", () => {
  it("redacts sensitive keys at any depth", () => {
    const input = {
      userId: "u_1",
      password: "hunter2",
      nested: { accessToken: "t", profile: { email: "a@b.com", dateOfBirth: "1990-01-01" } },
      headers: { authorization: "Bearer x", cookie: "sb=1" },
      worker: {
        niNumber: "QQ123456C",
        nin: "QQ123456C",
        licenceNumber: "123",
        credentialDocument: "file",
      },
    };
    const output = redact(input) as typeof input;
    expect(output.userId).toBe("u_1");
    expect(output.password).toBe(REDACTED);
    expect(output.nested.accessToken).toBe(REDACTED);
    expect(output.nested.profile.email).toBe(REDACTED);
    expect(output.nested.profile.dateOfBirth).toBe(REDACTED);
    expect(output.headers.authorization).toBe(REDACTED);
    expect(output.headers.cookie).toBe(REDACTED);
    expect(output.worker.nin).toBe(REDACTED);
    expect(output.worker.licenceNumber).toBe(REDACTED);
    expect(output.worker.credentialDocument).toBe(REDACTED);
  });

  it("does not over-match short tokens inside ordinary words", () => {
    for (const key of [
      "mapping",
      "warning",
      "discard",
      "shipping",
      "routePath",
      "status",
      "profile",
    ]) {
      expect(isSensitiveKey(key)).toBe(false);
    }
  });

  it("scrubs tokens and emails embedded in strings", () => {
    // Synthetic token assembled at runtime so secret scanners do not flag it.
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const jwt = `${encode({ alg: "HS256" })}.${encode({ sub: "1" })}.signature`;
    const text = redactString(`failed for jane@example.com with ${jwt} and Bearer abc.def`);
    expect(text).not.toContain("jane@example.com");
    expect(text).not.toContain(jwt);
    expect(text).not.toContain("abc.def");
    const secretKey = `${["sb", "secret", ""].join("_")}abc123`;
    expect(redactString(`key ${secretKey}`)).not.toContain(secretKey);
  });

  it("serialises errors without stacks and handles circular references", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    expect((redact(circular) as Record<string, unknown>).self).toBe("[Circular]");

    const serialised = redact(new Error("contact a@b.com")) as Record<string, unknown>;
    expect(serialised).toEqual({ name: "Error", message: `contact ${REDACTED}` });
  });
});
