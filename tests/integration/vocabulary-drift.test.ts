import { beforeAll, describe, expect, it } from "vitest";

import { ALL_CAPABILITY_KEYS, ALL_ROLE_KEYS } from "@/lib/authz";

import { signUpVerified, type TestIdentity } from "./support/identities";

/** The TypeScript vocabulary must match the migration-defined reference data. */
describe("authorization vocabulary drift", () => {
  let user: TestIdentity;
  beforeAll(async () => {
    user = await signUpVerified("vocab");
  });

  it("capability keys match the database", async () => {
    const { data } = await user.client.from("capabilities").select("key");
    expect(data?.map((row) => row.key).sort()).toEqual([...ALL_CAPABILITY_KEYS].sort());
  });

  it("role keys match the database", async () => {
    const { data } = await user.client.from("roles").select("key");
    expect(data?.map((row) => row.key).sort()).toEqual([...ALL_ROLE_KEYS].sort());
  });
});
