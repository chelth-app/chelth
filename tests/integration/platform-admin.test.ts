import { beforeAll, describe, expect, it } from "vitest";

import {
  grantPlatformAdmin,
  ownerQuery,
  signUpVerified,
  slug,
  stepUpToAal2,
  type TestIdentity,
} from "./support/identities";

describe("platform administration", () => {
  let operatorTarget: TestIdentity;
  let tenantOwner: TestIdentity;
  let tenantId: string;

  beforeAll(async () => {
    [operatorTarget, tenantOwner] = await Promise.all([
      signUpVerified("platform"),
      signUpVerified("tenant"),
    ]);
    const created = await tenantOwner.client.rpc("create_organisation", {
      p_type: "agency",
      p_name: "Tenant Agency",
      p_slug: slug("tenant"),
    });
    if (created.error) throw created.error;
    tenantId = created.data;
  });

  it("platform RPCs are refused without a grant", async () => {
    const { error } = await operatorTarget.client.rpc("platform_list_organisations");
    expect(error?.code).toBe("CH403");
  });

  it("the grant procedure is unreachable through the API", async () => {
    // `internal` is not an exposed schema; the RPC does not exist from the API's view.
    const { error } = await operatorTarget.client.rpc("grant_platform_admin" as never, {} as never);
    expect(error).not.toBeNull();
  });

  it("an operator grant requires AAL2 to use, and every call is audited", async () => {
    await grantPlatformAdmin(operatorTarget.userId);

    const atAal1 = await operatorTarget.client.rpc("platform_list_organisations");
    expect(atAal1.error?.code).toBe("CH402");

    await stepUpToAal2(operatorTarget);
    const atAal2 = await operatorTarget.client.rpc("platform_list_organisations");
    expect(atAal2.error).toBeNull();
    expect(atAal2.data?.map((row) => row.organisation_id)).toContain(tenantId);

    const [row] = await ownerQuery(
      (sql) => sql`select count(*)::int as n from public.audit_events
                   where action = 'platform.organisations_listed'
                     and actor_profile_id = ${operatorTarget.userId}::uuid and actor_aal = 'aal2'`,
    );
    expect(row?.n).toBe(1);
  });

  it("a platform admin gains no tenant data through RLS", async () => {
    const orgs = await operatorTarget.client.from("organisations").select("id");
    const members = await operatorTarget.client.from("organisation_memberships").select("id");
    expect([orgs.data, members.data]).toEqual([[], []]);
  });
});
