"use client";

import { useActionState, useState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useSpell } from "@/lib/i18n/terminology-context";

import {
  acceptFacilityConnectionAction,
  type ConnectionInviteResult,
  inviteFacilityConnectionAction,
  resendFacilityConnectionAction,
  revokeFacilityConnectionAction,
} from "../connection-actions";

function InviteOutcome({ result }: { result: ConnectionInviteResult }) {
  return result.delivery === "sent" ? (
    <p
      role="status"
      className="rounded-md bg-success-soft p-3 text-sm text-success-soft-foreground"
    >
      Invitation sent.
    </p>
  ) : (
    <div role="status" className="flex flex-col gap-1 rounded-md bg-warning-soft p-3 text-sm">
      <span>The invitation email was not sent. Share this link with {result.email}:</span>
      <code className="break-all">{result.inviteUrl}</code>
    </div>
  );
}

/** Agency: invite the facility's administrator to connect on Chelth (P0-E9-4A.1). */
export function InviteFacilityConnectionForm({
  organisationId,
  facilityId,
}: {
  organisationId: string;
  facilityId: string;
}) {
  const [state, formAction] = useActionState(inviteFacilityConnectionAction, null);
  if (state?.ok) {
    return (
      <div className="flex max-w-2xl flex-col gap-2">
        <InviteOutcome result={state.data} />
        <p className="text-sm text-slate-600">
          Pending acceptance. The facility administrator chooses to create their facility on Chelth
          or connect one they already manage.
        </p>
      </div>
    );
  }
  return (
    <form action={formAction} className="grid max-w-2xl gap-3 sm:grid-cols-2" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="facilityId" value={facilityId} />
      <FormField
        id="connection-email"
        label="Facility administrator email"
        required
        errors={fieldErrorsFor(state, "email")}
      >
        <Input name="email" type="email" autoComplete="off" />
      </FormField>
      <FormField
        id="connection-contact"
        label="Contact name"
        description="Optional."
        errors={fieldErrorsFor(state, "contactName")}
      >
        <Input name="contactName" maxLength={120} autoComplete="off" />
      </FormField>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <FormAlert state={state} />
        <SubmitButton className="w-fit">Invite facility to Chelth</SubmitButton>
      </div>
    </form>
  );
}

export function FacilityConnectionInviteActions({
  organisationId,
  facilityId,
  inviteId,
}: {
  organisationId: string;
  facilityId: string;
  inviteId: string;
}) {
  const [resendState, resend] = useActionState(resendFacilityConnectionAction, null);
  const [revokeState, revoke] = useActionState(revokeFacilityConnectionAction, null);
  const fields = (
    <>
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="facilityId" value={facilityId} />
      <input type="hidden" name="inviteId" value={inviteId} />
    </>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <form action={resend}>
          {fields}
          <SubmitButton size="sm" variant="outline">
            Resend invitation
          </SubmitButton>
        </form>
        <form action={revoke}>
          {fields}
          <SubmitButton size="sm" variant="ghost">
            Revoke invitation
          </SubmitButton>
        </form>
      </div>
      {resendState?.ok ? (
        <InviteOutcome result={resendState.data} />
      ) : (
        <FormAlert state={resendState} className="p-2 text-xs" />
      )}
      <FormAlert state={revokeState} successMessage="Invitation revoked." className="p-2 text-xs" />
    </div>
  );
}

type ConnectionOption = {
  organisationId: string;
  name: string;
  canApprove: boolean;
  alreadyConnected: boolean;
};

/**
 * Facility representative: connect a facility they already administer, or
 * create the facility (P0-E9-4A.1). Only their own facilities are listed;
 * connecting an existing facility prevents duplicates and is offered first.
 */
export function AcceptFacilityConnectionForm({
  agencyName,
  facilityName,
  options,
  stepUpHref,
}: {
  agencyName: string;
  facilityName: string;
  options: ConnectionOption[];
  stepUpHref: string;
}) {
  const spell = useSpell();
  const [state, formAction] = useActionState(acceptFacilityConnectionAction, null);
  const approvable = options.filter((option) => option.canApprove && !option.alreadyConnected);
  const [mode, setMode] = useState<"connect" | "create">(
    approvable.length > 0 ? "connect" : "create",
  );
  const [selected, setSelected] = useState(approvable[0]?.organisationId ?? "");
  const administersAny = options.some((option) => option.canApprove);
  const memberWithoutAuthority = options.length > 0 && !administersAny;
  const needsStepUp = state && !state.ok && state.error.code === "MFA_REQUIRED";

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {memberWithoutAuthority ? (
        <p role="note" className="rounded-md bg-warning-soft p-3 text-sm">
          An administrator for your facility must approve this connection. Ask them to accept the
          invitation, or have {agencyName} invite them.
        </p>
      ) : null}
      {options.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-chelth-navy">
            Connect this staffing agency to:
          </legend>
          {options.map((option) => (
            <label
              key={option.organisationId}
              className="flex flex-wrap items-start gap-2 rounded-md border border-border p-3 text-sm font-medium text-chelth-navy has-[:disabled]:opacity-60"
            >
              <input
                type="radio"
                name="choice"
                value={option.organisationId}
                disabled={!option.canApprove || option.alreadyConnected}
                defaultChecked={approvable[0]?.organisationId === option.organisationId}
                onChange={() => {
                  setMode("connect");
                  setSelected(option.organisationId);
                }}
                className="mt-0.5 size-4"
              />
              {option.name}
              <span className="ml-auto text-right font-normal text-slate-600">
                {option.alreadyConnected
                  ? `Already connected to ${agencyName}`
                  : option.canApprove
                    ? "You administer this facility"
                    : "You are not an administrator here"}
              </span>
            </label>
          ))}
          <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
            <input
              type="radio"
              name="choice"
              value="create"
              defaultChecked={approvable.length === 0}
              onChange={() => setMode("create")}
              className="mt-0.5 size-4"
            />
            <span className="font-medium text-chelth-navy">
              {spell("Create a new facility organization")}
            </span>
          </label>
        </fieldset>
      ) : null}
      <input type="hidden" name="mode" value={mode} />
      {mode === "connect" ? (
        <input type="hidden" name="facilityOrganisationId" value={selected} />
      ) : (
        <>
          {administersAny ? (
            <p role="note" className="rounded-md bg-warning-soft p-3 text-sm">
              You already manage a facility on Chelth. Create a separate facility only if this is a
              different legal or operational organization.
            </p>
          ) : null}
          <FormField
            id="connection-facility-name"
            label="Facility name"
            description="As your staff and agencies know it. You can change it later."
            errors={fieldErrorsFor(state, "facilityName")}
          >
            <Input name="facilityName" defaultValue={facilityName} maxLength={200} />
          </FormField>
        </>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" className="mt-0.5 size-4" />
        <span>
          {mode === "create"
            ? spell(
                `Create ${facilityName} as a new Chelth facility organization and connect ${agencyName}.`,
              )
            : `Connect ${agencyName} to the selected facility.`}
        </span>
      </label>
      {fieldErrorsFor(state, "confirm") ? (
        <p className="text-sm text-danger">{fieldErrorsFor(state, "confirm")?.[0]}</p>
      ) : null}
      {needsStepUp ? (
        <p role="alert" className="rounded-md bg-warning-soft p-3 text-sm">
          Approving for an existing facility requires your authenticator app.{" "}
          <a href={stepUpHref} className="font-medium text-primary underline underline-offset-4">
            Verify now
          </a>
          , then return to this invitation.
        </p>
      ) : (
        <FormAlert state={state} />
      )}
      <SubmitButton className="w-full">
        {mode === "create" ? "Create facility and connect" : "Connect facility"}
      </SubmitButton>
    </form>
  );
}
