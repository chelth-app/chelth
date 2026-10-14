import { beforeAll, describe, expect, it } from "vitest";

import {
  grantPlatformAdmin,
  signUpVerified,
  slug,
  stepUpToAal2,
  type TestIdentity,
} from "./support/identities";

/*
 * P0-E9-4A.2: one self-service staffing business per owner; an additional
 * business only through the commercial path, with its own account.
 */

describe("billing-safe additional business (P0-E9-4A.2)", () => {
  let owner: TestIdentity;
  let operator: TestIdentity;
  let firstAgencyId: string;

  beforeAll(async () => {
    [owner, operator] = await Promise.all([signUpVerified("biz-owner"), signUpVerified("biz-op")]);
    await grantPlatformAdmin(operator.userId);
    await stepUpToAal2(operator);
  });

  it("allows the first agency, refuses a second through the API", async () => {
    const first = await owner.client.rpc("create_organisation", {
      p_type: "agency",
      p_name: "Victor Test Agency",
      p_slug: slug("victor"),
    });
    expect(first.error).toBeNull();
    firstAgencyId = first.data ?? "";
    const second = await owner.client.rpc("create_organisation", {
      p_type: "agency",
      p_name: "Victor Test Agency Lagos",
      p_slug: slug("victor-lagos"),
    });
    expect(second.error?.code).toBe("CHB01");
    const ownership = await owner.client.rpc("my_business_ownership");
    expect(ownership.data?.[0]?.owned_agencies).toBe(1);
  });

  it("creates an additional business only with its own commercial account", async () => {
    const requested = await owner.client.rpc("request_additional_business", {
      p_business_name: "Acme Medical Staffing LLC",
      p_billing_email: "billing@acme.test",
    });
    expect(requested.error).toBeNull();
    const fulfilled = await operator.client.rpc("platform_fulfil_business_request", {
      p_request_id: requested.data ?? "",
      p_status: "trial",
      p_reason: "separate legal entity",
      p_plan_key: "pilot",
    });
    expect(fulfilled.error).toBeNull();

    const customers = await operator.client.rpc("platform_list_customers");
    const acme = customers.data?.find((row) => row.organisation_id === fulfilled.data);
    const first = customers.data?.find((row) => row.organisation_id === firstAgencyId);
    expect(acme).toMatchObject({
      organisation_type: "agency",
      account_status: "trial",
      plan_key: "pilot",
    });
    expect(first?.account_status).toBeNull(); // the first agency gains nothing, and gives nothing

    const memberships = await owner.client
      .from("organisation_memberships")
      .select("organisation_id");
    expect(memberships.data?.map((row) => row.organisation_id).sort()).toEqual(
      [firstAgencyId, fulfilled.data].sort(),
    );
    // Still no self-service creation for the owner.
    const third = await owner.client.rpc("create_organisation", {
      p_type: "agency",
      p_name: "Third Co",
      p_slug: slug("third"),
    });
    expect(third.error?.code).toBe("CHB01");
  });
});
