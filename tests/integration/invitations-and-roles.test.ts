import { beforeAll, describe, expect, it } from "vitest";

import { signUpVerified, slug, stepUpToAal2, type TestIdentity } from "./support/identities";
import { uniqueEmail } from "../support/mailpit";

describe("invitation → membership → role lifecycle", () => {
  let admin: TestIdentity;
  let invitee: TestIdentity;
  let impostor: TestIdentity;
  let organisationId: string;
  let token: string;
  const inviteeEmail = uniqueEmail("invitee");

  beforeAll(async () => {
    admin = await signUpVerified("admin");
    const created = await admin.client.rpc("create_organisation", {
      p_type: "agency",
      p_name: "Invite Agency",
      p_slug: slug("invite"),
    });
    if (created.error) throw created.error;
    organisationId = created.data;
    await stepUpToAal2(admin);

    const issued = await admin.client.rpc("create_organisation_invite", {
      p_organisation_id: organisationId,
      p_email: inviteeEmail,
      p_role_key: "agency.scheduler",
    });
    if (issued.error) throw issued.error;
    token = issued.data[0]?.invite_token ?? "";

    [invitee, impostor] = await Promise.all([
      signUpVerified("invitee", inviteeEmail),
      signUpVerified("impostor"),
    ]);
  });

  it("the raw token is never readable after issue", async () => {
    const direct = await admin.client.from("organisation_invites" as never).select("*");
    expect(direct.error?.code).toBe("42501");
    const listed = await admin.client.rpc("list_organisation_invites", {
      p_organisation_id: organisationId,
    });
    expect(JSON.stringify(listed.data)).not.toContain(token);
  });

  it("a different identity holding the token learns nothing and cannot accept", async () => {
    const preview = await impostor.client.rpc("preview_organisation_invite", { p_token: token });
    const accept = await impostor.client.rpc("accept_organisation_invite", { p_token: token });
    expect(preview.data).toEqual([]);
    expect(accept.data).toEqual([]);
  });

  it("the invited identity previews, accepts and receives exactly the invited role", async () => {
    const preview = await invitee.client.rpc("preview_organisation_invite", { p_token: token });
    expect(preview.data?.[0]).toMatchObject({
      organisation_id: organisationId,
      role_key: "agency.scheduler",
    });

    const accepted = await invitee.client.rpc("accept_organisation_invite", { p_token: token });
    expect(accepted.data?.[0]?.organisation_id).toBe(organisationId);

    const membershipId = accepted.data?.[0]?.membership_id ?? "";
    const roles = await invitee.client
      .from("membership_roles")
      .select("role_key")
      .eq("membership_id", membershipId);
    expect(roles.data).toEqual([{ role_key: "agency.scheduler" }]);

    // With membership.view (from the scheduler role) they now see co-members'
    // roles in THIS organisation — correct, capability-driven visibility.
    const visible = await invitee.client
      .from("membership_roles")
      .select("role_key")
      .eq("organisation_id", organisationId);
    expect(visible.data?.map((row) => row.role_key).sort()).toEqual([
      "agency.admin",
      "agency.scheduler",
    ]);

    const caps = await invitee.client.rpc("my_capabilities", { p_organisation_id: organisationId });
    expect(caps.data?.map((row) => row.capability_key).sort()).toEqual([
      "compliance.view",
      "facility.view",
      "membership.view",
      "organisation.view",
      "relationship.view",
      "worker.view",
    ]);
  });

  it("an accepted invitation cannot be replayed", async () => {
    const replay = await invitee.client.rpc("accept_organisation_invite", { p_token: token });
    expect(replay.data).toEqual([]);
  });

  it("the new member cannot escalate their own role", async () => {
    await stepUpToAal2(invitee);
    const { data: membership } = await invitee.client
      .from("organisation_memberships")
      .select("id")
      .eq("organisation_id", organisationId)
      .eq("profile_id", invitee.userId)
      .single();
    const escalate = await invitee.client.rpc("assign_membership_role", {
      p_membership_id: membership?.id ?? "",
      p_role_key: "agency.admin",
    });
    expect(escalate.error?.code).toBe("CH403");
  });

  it("an admin can assign and revoke roles; history is kept and audited", async () => {
    const { data: membership } = await admin.client
      .from("organisation_memberships")
      .select("id")
      .eq("organisation_id", organisationId)
      .eq("profile_id", invitee.userId)
      .single();
    const membershipId = membership?.id ?? "";

    const assigned = await admin.client.rpc("assign_membership_role", {
      p_membership_id: membershipId,
      p_role_key: "agency.finance",
    });
    expect(assigned.error).toBeNull();
    const revoked = await admin.client.rpc("revoke_membership_role", {
      p_membership_id: membershipId,
      p_role_key: "agency.finance",
    });
    expect(revoked.error).toBeNull();

    const history = await admin.client
      .from("membership_roles")
      .select("role_key, revoked_at")
      .eq("membership_id", membershipId)
      .eq("role_key", "agency.finance");
    expect(history.data).toHaveLength(1);
    expect(history.data?.[0]?.revoked_at).not.toBeNull();

    const audit = await admin.client
      .from("audit_events")
      .select("action")
      .eq("organisation_id", organisationId)
      .in("action", ["invite.accepted", "role.assigned", "role.revoked"]);
    expect(new Set(audit.data?.map((row) => row.action))).toEqual(
      new Set(["invite.accepted", "role.assigned", "role.revoked"]),
    );
  });

  it("suspension removes access immediately (no stale tokens)", async () => {
    const { data: membership } = await admin.client
      .from("organisation_memberships")
      .select("id")
      .eq("organisation_id", organisationId)
      .eq("profile_id", invitee.userId)
      .single();
    const suspended = await admin.client.rpc("set_membership_status", {
      p_membership_id: membership?.id ?? "",
      p_status: "suspended",
    });
    expect(suspended.error).toBeNull();

    // The invitee's existing JWT is unchanged, yet access is gone: authorization
    // is evaluated live in the database, not carried in token claims.
    const orgs = await invitee.client.from("organisations").select("id").eq("id", organisationId);
    expect(orgs.data).toEqual([]);
  });
});
