import { beforeAll, describe, expect, it } from "vitest";

import { uniqueEmail } from "../support/mailpit";

import { ownerQuery, signUpVerified, stepUpToAal2, type TestIdentity } from "./support/identities";
import { createAgency, invite, must } from "./support/staffing";

/*
 * P0-E9-3A worker invitation lifecycle on the real stack: re-inviting a
 * pending worker rotates the token (old link dead, new link works, one row),
 * cancelling kills the token, and a worker of Agency A can accept Agency B's
 * invitation — one profile, two memberships, two agency worker records.
 */
const WORKER = "agency.healthcare_worker";

async function issue(admin: TestIdentity, organisationId: string, email: string) {
  const rows = await must(
    admin.client.rpc("create_organisation_invite", {
      p_organisation_id: organisationId,
      p_email: email,
      p_role_key: WORKER,
    }),
  );
  const row = rows[0];
  if (!row) throw new Error("no invite row");
  return row;
}

describe("worker invitations (P0-E9-3A)", () => {
  let adminA: TestIdentity;
  let adminB: TestIdentity;
  let agencyA: string;
  let agencyB: string;

  beforeAll(async () => {
    adminA = await signUpVerified("invite-admin-a");
    adminB = await signUpVerified("invite-admin-b");
    agencyA = await createAgency(adminA, "Invite Agency A");
    agencyB = await createAgency(adminB, "Invite Agency B");
    await stepUpToAal2(adminA);
    await stepUpToAal2(adminB);
  });

  it("re-invites a pending worker by rotating the token; the old link stops working", async () => {
    const worker = await signUpVerified("invite-rotate");
    const first = await issue(adminA, agencyA, worker.email);
    const second = await issue(adminA, agencyA, worker.email);
    expect(first.invite_reissued).toBe(false);
    expect(second.invite_reissued).toBe(true);
    expect(second.invite_id).toBe(first.invite_id);
    expect(second.invite_token).not.toBe(first.invite_token);

    const listed = await must(
      adminA.client.rpc("list_organisation_invites", { p_organisation_id: agencyA }),
    );
    const pending = listed.filter(
      (row) => row.invitee_email === worker.email && row.invite_status === "pending",
    );
    expect(pending).toHaveLength(1);
    expect(Object.keys(pending[0] ?? {})).not.toContain("invite_token");

    const old = await worker.client.rpc("accept_organisation_invite", {
      p_token: first.invite_token,
    });
    expect(old.error).toBeNull();
    expect(old.data ?? []).toEqual([]); // uniform: no row, no membership
    const accepted = await worker.client.rpc("accept_organisation_invite", {
      p_token: second.invite_token,
    });
    expect(accepted.error).toBeNull();
    const replay = await worker.client.rpc("accept_organisation_invite", {
      p_token: second.invite_token,
    });
    expect(replay.error).toBeNull();
    expect(replay.data ?? []).toEqual([]); // uniform: no row, no membership

    const after = await must(
      adminA.client.rpc("list_organisation_invites", { p_organisation_id: agencyA }),
    );
    expect(after.find((row) => row.invite_id === first.invite_id)?.invite_status).toBe("accepted");
  });

  it("cancelling an invitation kills its token immediately and keeps the record", async () => {
    const worker = await signUpVerified("invite-cancel");
    const issued = await issue(adminA, agencyA, worker.email);
    expect(
      (await adminA.client.rpc("revoke_organisation_invite", { p_invite_id: issued.invite_id }))
        .error,
    ).toBeNull();
    const refused = await worker.client.rpc("accept_organisation_invite", {
      p_token: issued.invite_token,
    });
    expect(refused.error).toBeNull();
    expect(refused.data ?? []).toEqual([]); // uniform: no row, no membership
    const listed = await must(
      adminA.client.rpc("list_organisation_invites", { p_organisation_id: agencyA }),
    );
    expect(listed.find((row) => row.invite_id === issued.invite_id)?.invite_status).toBe("revoked");
    const audit = await ownerQuery(
      (sql) => sql<{ n: number }[]>`select count(*)::int as n from public.audit_events
                                    where action = 'invite.revoked' and target_id = ${issued.invite_id}::uuid`,
    );
    expect(audit[0]?.n).toBe(1);
  });

  it("lets a worker of Agency A join Agency B: one profile, two agency worker records", async () => {
    const worker = await invite(adminA.client, agencyA, WORKER, uniqueEmail("invite-multi"));
    // Being a worker elsewhere is not "already part of this workforce".
    const issued = await issue(adminB, agencyB, worker.email);
    expect(issued.invite_reissued).toBe(false);
    expect(
      (await worker.client.rpc("accept_organisation_invite", { p_token: issued.invite_token }))
        .error,
    ).toBeNull();

    const rows = await ownerQuery(
      (sql) => sql<
        { agency: string }[]
      >`select agency_organisation_id::text as agency from public.agency_workers
                                         where profile_id = ${worker.userId}::uuid order by 1`,
    );
    expect(rows.map((row) => row.agency).sort()).toEqual([agencyA, agencyB].sort());
    const profiles = await ownerQuery(
      (sql) =>
        sql<
          { n: number }[]
        >`select count(*)::int as n from public.profiles where id = ${worker.userId}::uuid`,
    );
    expect(profiles[0]?.n).toBe(1);

    // Re-inviting a now-member of Agency B is refused with the specific error.
    const again = await adminB.client.rpc("create_organisation_invite", {
      p_organisation_id: agencyB,
      p_email: worker.email,
      p_role_key: WORKER,
    });
    expect(again.error?.code).toBe("CHI10");
  });
});
