import { describe, expect, it } from "vitest";

import {
  createCustomTypeSchema,
  setCustomTypeActiveSchema,
  updateCustomTypeSchema,
} from "@/features/compliance/schemas";
import { createCredentialSchema } from "@/features/credentials/schemas";
import {
  CREDENTIAL_CATEGORIES,
  CREDENTIAL_CATEGORY_LABELS,
  credentialCategoryLabel,
  isCustomCredentialTypeKey,
} from "@/lib/domain/credentials";
import { ERROR_CODES, normalizeError } from "@/lib/errors";
import { localizeTerms, terminology, typeDisplayName } from "@/lib/i18n/terminology";
import { Constants } from "@/types/database.types";

/* P0-E9-3J: agency-defined credential and requirement types. */

const ORG = "00000000-0000-4000-8000-000000000001";
const KEY = `custom_${"a1".repeat(16)}`;
const gb = terminology("en-GB");

describe("custom type keys", () => {
  it("recognises only the database-enforced key shape", () => {
    expect(isCustomCredentialTypeKey(KEY)).toBe(true);
    expect(isCustomCredentialTypeKey("rn_license")).toBe(false);
    expect(isCustomCredentialTypeKey("custom_abc")).toBe(false);
    expect(isCustomCredentialTypeKey(`custom_${"A1".repeat(16)}`)).toBe(false);
    expect(isCustomCredentialTypeKey(null)).toBe(false);
  });

  it("both requirement and credential forms accept standard or custom keys, nothing else", () => {
    const base = { organisationId: ORG };
    expect(createCredentialSchema.safeParse({ ...base, credentialTypeKey: KEY }).success).toBe(
      true,
    );
    expect(
      createCredentialSchema.safeParse({ ...base, credentialTypeKey: "bls_certification" }).success,
    ).toBe(true);
    expect(
      createCredentialSchema.safeParse({ ...base, credentialTypeKey: "drop table" }).success,
    ).toBe(false);
  });
});

describe("custom type names are never respelled", () => {
  it("standard names follow the workspace spelling", () => {
    expect(typeDisplayName("RN License", "rn_license", gb)).toBe("RN Licence");
  });

  it("custom names stay exactly as the agency typed them", () => {
    expect(typeDisplayName("State Driver License", KEY, gb)).toBe("State Driver License");
    expect(typeDisplayName("Orientation Program", KEY, terminology("en-US"))).toBe(
      "Orientation Program",
    );
  });
});

describe("categories", () => {
  it("cover exactly the database enum", () => {
    expect([...CREDENTIAL_CATEGORIES].sort()).toEqual(
      [...Constants.public.Enums.credential_category].sort(),
    );
  });

  it("have American source labels that the workspace spelling localizes", () => {
    expect(CREDENTIAL_CATEGORY_LABELS.professional_license).toBe("Professional license");
    expect(localizeTerms(CREDENTIAL_CATEGORY_LABELS.professional_license, gb)).toBe(
      "Professional licence",
    );
    expect(localizeTerms(CREDENTIAL_CATEGORY_LABELS.identity_work_authorization, gb)).toBe(
      "Identity & work authorisation",
    );
    expect(credentialCategoryLabel("unknown")).toBe("Other");
  });
});

describe("custom type form schema", () => {
  const valid = {
    organisationId: ORG,
    name: "  Driver License  ",
    category: "other",
    requiresDocument: "on",
    requiresVerification: "on",
    validityMonths: "12",
    instructions: "Upload both sides.\nThe photo must be readable.",
  };

  it("parses a valid type (trimmed name, unticked boxes are false, line breaks allowed)", () => {
    const parsed = createCustomTypeSchema.parse(valid);
    expect(parsed).toMatchObject({
      name: "Driver License",
      requiresDocument: true,
      requiresVerification: true,
      requiresExpiryDate: false,
      requiresCredentialNumber: false,
      jurisdictionRule: "none",
      validityMonths: 12,
    });
  });

  it("supports a requirement with no document (agency verification only)", () => {
    const parsed = createCustomTypeSchema.parse({
      organisationId: ORG,
      name: "Orientation completed",
      category: "orientation",
      requiresVerification: "on",
    });
    expect(parsed.requiresDocument).toBe(false);
    expect(parsed.validityMonths).toBeUndefined();
    expect(parsed.instructions).toBeUndefined();
  });

  it("refuses bad names, categories, intervals and control characters", () => {
    expect(createCustomTypeSchema.safeParse({ ...valid, name: "x" }).success).toBe(false);
    expect(createCustomTypeSchema.safeParse({ ...valid, name: "a".repeat(121) }).success).toBe(
      false,
    );
    expect(createCustomTypeSchema.safeParse({ ...valid, name: "Bad\u0007name" }).success).toBe(
      false,
    );
    expect(createCustomTypeSchema.safeParse({ ...valid, category: "secret" }).success).toBe(false);
    expect(createCustomTypeSchema.safeParse({ ...valid, validityMonths: "7" }).success).toBe(false);
    expect(
      createCustomTypeSchema.safeParse({ ...valid, instructions: "x".repeat(1001) }).success,
    ).toBe(false);
    expect(createCustomTypeSchema.safeParse({ ...valid, instructions: "bell\u0007" }).success).toBe(
      false,
    );
  });

  it("edits and archiving need a custom key, never a standard one", () => {
    expect(updateCustomTypeSchema.safeParse({ ...valid, key: KEY }).success).toBe(true);
    expect(updateCustomTypeSchema.safeParse({ ...valid, key: "rn_license" }).success).toBe(false);
    expect(
      setCustomTypeActiveSchema.safeParse({ organisationId: ORG, key: KEY, active: "false" }).data
        ?.active,
    ).toBe(false);
    expect(
      setCustomTypeActiveSchema.safeParse({
        organisationId: ORG,
        key: "bls_certification",
        active: "false",
      }).success,
    ).toBe(false);
  });
});

describe("errors", () => {
  it("map the custom type database codes to safe messages", () => {
    expect(normalizeError({ code: "CHC01", message: "x" }).code).toBe("CUSTOM_TYPE_EXISTS");
    expect(normalizeError({ code: "CHC02", message: "x" }).code).toBe("CUSTOM_TYPE_IN_USE");
    expect(ERROR_CODES.CUSTOM_TYPE_EXISTS.message).toBe(
      "A custom requirement with this name already exists.",
    );
  });
});
