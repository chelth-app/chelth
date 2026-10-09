import { describe, expect, it } from "vitest";

import {
  AppError,
  ERROR_CODES,
  fail,
  isErrorCode,
  normalizeError,
  ok,
  toPublicError,
} from "@/lib/errors";

describe("AppError", () => {
  it("derives kind, status and a safe public message from the code", () => {
    const error = new AppError("FORBIDDEN", { internalMessage: "user 42 lacks role x" });
    expect(error.kind).toBe("authorization");
    expect(error.status).toBe(403);
    expect(error.publicMessage).toBe(ERROR_CODES.FORBIDDEN.message);
  });
});

describe("toPublicError", () => {
  it("never exposes internal messages, causes or context", () => {
    const error = new AppError("INTERNAL", {
      internalMessage: 'relation "secret_table" does not exist',
      cause: new Error("stack detail"),
      context: { query: "select * from secret_table" },
    });
    const serialised = JSON.stringify(toPublicError(error));
    expect(serialised).not.toContain("secret_table");
    expect(serialised).not.toContain("stack detail");
    expect(toPublicError(error)).toEqual({
      code: "INTERNAL",
      message: ERROR_CODES.INTERNAL.message,
    });
  });

  it("includes field errors for validation failures", () => {
    const error = new AppError("VALIDATION_FAILED", { fieldErrors: { email: ["Invalid"] } });
    expect(toPublicError(error).fieldErrors).toEqual({ email: ["Invalid"] });
  });
});

describe("normalizeError", () => {
  it.each([
    [{ code: "23505", message: "duplicate key value violates unique constraint" }, "CONFLICT"],
    [{ code: "42501", message: "new row violates row-level security policy" }, "FORBIDDEN"],
    [
      { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
      "NOT_FOUND",
    ],
    [{ code: "PGRST301", message: "JWT expired" }, "AUTH_SESSION_EXPIRED"],
    [{ code: "CH409", message: "shift is not open" }, "INVALID_STATE_TRANSITION"],
    [{ code: "CHI09", message: "pending invite, other role" }, "INVITE_PENDING_OTHER_ROLE"],
    [{ code: "CHI10", message: "already a member" }, "ALREADY_A_MEMBER"],
    [{ status: 429, message: "rate limit" }, "RATE_LIMITED"],
    [{ status: 401, message: "no session" }, "AUTH_REQUIRED"],
    [new Error("boom"), "INTERNAL"],
    ["a string", "INTERNAL"],
    [null, "INTERNAL"],
  ])("maps %o to %s", (input, expected) => {
    const normalised = normalizeError(input);
    expect(normalised).toBeInstanceOf(AppError);
    expect(normalised.code).toBe(expected);
    expect(normalised.cause).toBe(input);
  });

  it("returns AppErrors unchanged", () => {
    const error = new AppError("NOT_FOUND");
    expect(normalizeError(error)).toBe(error);
  });

  it("never lets a database message reach the public message", () => {
    const error = normalizeError({
      code: "23505",
      message: "Key (email)=(a@b.com) already exists",
    });
    expect(toPublicError(error).message).not.toContain("a@b.com");
  });
});

describe("ActionResult helpers", () => {
  it("builds success and failure results", () => {
    expect(ok(1)).toEqual({ ok: true, data: 1 });
    expect(fail(new AppError("CONFLICT"))).toEqual({
      ok: false,
      error: { code: "CONFLICT", message: ERROR_CODES.CONFLICT.message },
    });
  });

  it("recognises registered codes only", () => {
    expect(isErrorCode("FORBIDDEN")).toBe(true);
    expect(isErrorCode("toString")).toBe(false);
  });
});

describe("normalizeError — identity & authorization codes", () => {
  it.each([
    [{ code: "CH402", message: "multi-factor authentication required" }, "MFA_REQUIRED"],
    [{ code: "CH403", message: "not permitted" }, "FORBIDDEN"],
    [{ code: "CH410", message: "invalid invitation" }, "INVITE_INVALID"],
    [
      { code: "invalid_credentials", status: 400, message: "Invalid login" },
      "AUTH_INVALID_CREDENTIALS",
    ],
    [
      { code: "email_not_confirmed", status: 400, message: "Email not confirmed" },
      "AUTH_EMAIL_NOT_VERIFIED",
    ],
    [{ code: "mfa_verification_failed", status: 422, message: "Invalid TOTP" }, "MFA_CODE_INVALID"],
    [{ code: "over_email_send_rate_limit", status: 429, message: "rate" }, "RATE_LIMITED"],
  ])("maps %o to %s", (input, expected) => {
    expect(normalizeError(input).code).toBe(expected);
  });
});

describe("normalizeError — workforce & facility codes", () => {
  it.each([
    [{ code: "CHW09", message: "worker status change not allowed" }, "INVALID_WORKER_STATE"],
    [
      { code: "CHR09", message: "relationship status change not allowed" },
      "INVALID_RELATIONSHIP_STATE",
    ],
    [{ code: "CHF09", message: "archived facilities are read-only" }, "INVALID_STATE_TRANSITION"],
    [{ code: "CHF04", message: "facility not found" }, "FACILITY_NOT_FOUND"],
    [{ code: "CHW04", message: "worker not found" }, "WORKER_NOT_FOUND"],
    [{ code: "CHR04", message: "relationship not found" }, "RELATIONSHIP_NOT_FOUND"],
  ])("maps %o to %s", (input, expected) => {
    expect(normalizeError(input).code).toBe(expected);
  });
});
