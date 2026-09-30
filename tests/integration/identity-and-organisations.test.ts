import { beforeAll, describe, expect, it } from "vitest";

import { CAPABILITIES } from "@/lib/authz";

import { signUpVerified, slug, stepUpToAal2, type TestIdentity } from "./support/identities";

describe("identity → profile", () => {
  let user: TestIdentity;
  beforeAll(async () => {
    user = await signUpVerified("identity");
  });

  it("sign-up creates exactly one profile, with the chosen display name and no roles", async () => {
    const { data, error } = await user.client.from("profiles").select("*");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      id: user.userId,
      display_name: user.displayName,
      status: "active",
    });
    expect(Object.keys(data?.[0] ?? {}).sort()).toEqual([
      "created_at",
      "display_name",
      "id",
      "status",
      "updated_at",
    ]);
  });

  it("sign-up alone grants no organisation membership", async () => {
    const { data } = await user.client.from("organisation_memberships").select("id");
    expect(data).toEqual([]);
  });

  it("a user may rename themselves but not change their status", async () => {
    const renamed = await user.client
      .from("profiles")
      .update({ display_name: "Renamed" })
      .eq("id", user.userId);
    expect(renamed.error).toBeNull();
    // `status` is not column-granted: PostgREST rejects the whole update.
    const escalated = await user.client
      .from("profiles")
      .update({ status: "active" } as never)
      .eq("id", user.userId);
    expect(escalated.error?.code).toBe("42501");
  });
});

describe("organisations, capabilities and AAL2", () => {
  let alice: TestIdentity;
  let bob: TestIdentity;
  let alphaId: string;
  let betaId: string;

  beforeAll(async () => {
    [alice, bob] = await Promise.all([signUpVerified("alice"), signUpVerified("bob")]);
    const alpha = await alice.client.rpc("create_organisation", {
      p_type: "agency",
      p_name: "Alpha Agency",
      p_slug: slug("alpha"),
    });
    const beta = await bob.client.rpc("create_organisation", {
      p_type: "agency",
      p_name: "Beta Agency",
      p_slug: slug("beta"),
    });
    if (alpha.error || beta.error) throw alpha.error ?? beta.error;
    alphaId = alpha.data;
    betaId = beta.data;
  });

  it("the creator becomes the organisation's admin (server-derived role)", async () => {
    const { data } = await alice.client
      .from("membership_roles")
      .select("role_key, organisation_id")
      .eq("organisation_id", alphaId);
    expect(data).toEqual([{ role_key: "agency.admin", organisation_id: alphaId }]);
  });

  it("self-serve creation of a facility is refused", async () => {
    const { error } = await alice.client.rpc("create_organisation", {
      p_type: "facility",
      p_name: "My Facility",
      p_slug: slug("facility"),
    });
    expect(error?.code).toBe("CH403");
  });

  it("privileged capabilities need step-up; non-privileged ones do not", async () => {
    const { data: before } = await alice.client.rpc("my_capabilities", {
      p_organisation_id: alphaId,
    });
    const unsatisfied = before
      ?.filter((row) => !row.is_satisfied)
      .map((row) => row.capability_key)
      .sort();
    expect(unsatisfied).toEqual([
      "audit.view",
      "membership.invite",
      "membership.manage",
      "organisation.manage",
      "role.assign",
    ]);

    const attempt = await alice.client.rpc("create_organisation_invite", {
      p_organisation_id: alphaId,
      p_email: "someone@example.test",
      p_role_key: "agency.scheduler",
    });
    expect(attempt.error?.code).toBe("CH402");

    await stepUpToAal2(alice);
    const { data: after } = await alice.client.rpc("my_capabilities", {
      p_organisation_id: alphaId,
    });
    expect(after?.every((row) => row.is_satisfied)).toBe(true);
    expect(after?.map((row) => row.capability_key)).toContain(CAPABILITIES.ROLE_ASSIGN);
  });

  it("cross-organisation reads return nothing", async () => {
    const orgs = await bob.client.from("organisations").select("id").eq("id", alphaId);
    const members = await bob.client
      .from("organisation_memberships")
      .select("id")
      .eq("organisation_id", alphaId);
    const audit = await bob.client.from("audit_events").select("id").eq("organisation_id", alphaId);
    const caps = await bob.client.rpc("my_capabilities", { p_organisation_id: alphaId });
    expect([orgs.data, members.data, audit.data, caps.data]).toEqual([[], [], [], []]);
  });

  it("cross-organisation writes are refused even at AAL2", async () => {
    await stepUpToAal2(bob);
    const { data: aliceMembership } = await alice.client
      .from("organisation_memberships")
      .select("id")
      .eq("organisation_id", alphaId)
      .single();
    const assign = await bob.client.rpc("assign_membership_role", {
      p_membership_id: aliceMembership?.id ?? "",
      p_role_key: "agency.finance",
    });
    const suspend = await bob.client.rpc("set_membership_status", {
      p_membership_id: aliceMembership?.id ?? "",
      p_status: "suspended",
    });
    const invite = await bob.client.rpc("create_organisation_invite", {
      p_organisation_id: alphaId,
      p_email: "intruder@example.test",
      p_role_key: "agency.admin",
    });
    expect([assign.error?.code, suspend.error?.code, invite.error?.code]).toEqual([
      "CH403",
      "CH403",
      "CH403",
    ]);
  });

  it("direct table writes are refused (RPC-only mutations)", async () => {
    const insert = await bob.client
      .from("organisation_memberships")
      .insert({ organisation_id: alphaId, profile_id: bob.userId } as never);
    expect(insert.error?.code).toBe("42501");
  });

  it("organisation and membership events are audited and visible at AAL2", async () => {
    const { data } = await alice.client
      .from("audit_events")
      .select("action")
      .eq("organisation_id", alphaId)
      .order("occurred_at");
    expect(data?.map((row) => row.action)).toEqual(
      expect.arrayContaining(["organisation.created", "membership.created", "role.assigned"]),
    );
    expect(betaId).not.toBe(alphaId);
  });
});
