"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

import {
  createPlatformOrganisationAction,
  declineBusinessRequestAction,
  fulfilBusinessRequestAction,
  linkFacilityAction,
  type PlatformInviteResult,
  resendPlatformInviteAction,
  revokePlatformInviteAction,
  saveCustomerAccountAction,
  savePlanAction,
  setLifecycleAction,
} from "../actions";

/*
 * P0-E9-4A control-plane forms. Every rule is enforced by the database; these
 * forms collect input and show the outcome. Each change asks for a reason
 * where the database audits one.
 */

function InviteOutcome({ result }: { result: PlatformInviteResult }) {
  return result.delivery === "sent" ? (
    <p
      role="status"
      className="rounded-md bg-success-soft p-3 text-sm text-success-soft-foreground"
    >
      Invitation emailed to {result.email}.
    </p>
  ) : (
    <div role="status" className="flex flex-col gap-1 rounded-md bg-warning-soft p-3 text-sm">
      <span>The invitation email was not sent. Share this link with {result.email}:</span>
      <code className="break-all">{result.inviteUrl}</code>
    </div>
  );
}

function ReasonField({ id, state }: { id: string; state: Parameters<typeof fieldErrorsFor>[0] }) {
  return (
    <FormField
      id={id}
      label="Reason"
      description="Recorded in the platform audit trail."
      required
      errors={fieldErrorsFor(state, "reason")}
    >
      <Input name="reason" maxLength={500} autoComplete="off" />
    </FormField>
  );
}

export function CreatePlatformOrganisationForm() {
  const [state, formAction] = useActionState(createPlatformOrganisationAction, null);
  return (
    <form action={formAction} className="grid max-w-2xl gap-3 sm:grid-cols-2" noValidate>
      <FormField
        id="platform-org-type"
        label="Organization type"
        required
        errors={fieldErrorsFor(state, "type")}
      >
        <Select name="type" defaultValue="facility">
          <option value="facility">Facility organization</option>
          <option value="agency">Agency</option>
        </Select>
      </FormField>
      <FormField
        id="platform-org-name"
        label="Name"
        required
        errors={fieldErrorsFor(state, "name")}
      >
        <Input name="name" maxLength={120} autoComplete="off" />
      </FormField>
      <FormField
        id="platform-org-owner"
        label="Owner email"
        description="This person is invited as the organization's administrator. You do not become a member."
        required
        errors={fieldErrorsFor(state, "ownerEmail")}
        className="sm:col-span-2"
      >
        <Input name="ownerEmail" type="email" autoComplete="off" />
      </FormField>
      <div className="flex flex-col gap-2 sm:col-span-2">
        {state?.ok ? <InviteOutcome result={state.data} /> : <FormAlert state={state} />}
        <SubmitButton className="w-fit">Create and invite owner</SubmitButton>
      </div>
    </form>
  );
}

export function LinkFacilityForm({
  facilityOrganisationId,
  agencyName,
  records,
}: {
  facilityOrganisationId: string;
  agencyName: string;
  records: { id: string; name: string; timezone: string }[];
}) {
  const [state, formAction] = useActionState(linkFacilityAction, null);
  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-3" noValidate>
      <input type="hidden" name="facilityOrganisationId" value={facilityOrganisationId} />
      <FormField
        id="platform-link-record"
        label={`${agencyName} facility record`}
        required
        errors={fieldErrorsFor(state, "agencyFacilityId")}
      >
        <Select name="agencyFacilityId" defaultValue="">
          <option value="" disabled>
            Choose a facility record
          </option>
          {records.map((record) => (
            <option key={record.id} value={record.id}>
              {record.name} ({record.timezone})
            </option>
          ))}
        </Select>
      </FormField>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" className="mt-0.5 size-4" />
        <span>
          I confirm this facility record and this facility organization are the same facility. The
          link cannot be undone here.
        </span>
      </label>
      {fieldErrorsFor(state, "confirm") ? (
        <p className="text-sm text-danger">{fieldErrorsFor(state, "confirm")?.[0]}</p>
      ) : null}
      <FormAlert state={state} />
      <SubmitButton className="w-fit" variant="outline">
        Link facility
      </SubmitButton>
    </form>
  );
}

export function PlatformInviteActions({
  organisationId,
  inviteId,
  email,
}: {
  organisationId: string;
  inviteId: string;
  email: string;
}) {
  const [resendState, resend] = useActionState(resendPlatformInviteAction, null);
  const [revokeState, revoke] = useActionState(revokePlatformInviteAction, null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <form action={resend}>
          <input type="hidden" name="organisationId" value={organisationId} />
          <input type="hidden" name="inviteId" value={inviteId} />
          <SubmitButton size="sm" variant="outline" aria-label={`Resend invitation to ${email}`}>
            Resend
          </SubmitButton>
        </form>
        <form action={revoke}>
          <input type="hidden" name="organisationId" value={organisationId} />
          <input type="hidden" name="inviteId" value={inviteId} />
          <SubmitButton size="sm" variant="ghost" aria-label={`Revoke invitation to ${email}`}>
            Revoke
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

export type AccountFormValues = {
  status: string;
  planKey: string | null;
  billingName: string | null;
  billingEmail: string | null;
  trialEndsOn: string | null;
  currentPeriodEndsOn: string | null;
  cancelAtPeriodEnd: boolean;
};

export function CustomerAccountForm({
  organisationId,
  account,
  plans,
}: {
  organisationId: string;
  account: AccountFormValues | null;
  plans: { key: string; name: string }[];
}) {
  const [state, formAction] = useActionState(saveCustomerAccountAction, null);
  const id = (field: string) => `account-${field}`;
  return (
    <form action={formAction} className="grid max-w-3xl gap-3 sm:grid-cols-2" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <FormField
        id={id("status")}
        label="Account status"
        description="Manually managed. Suspended also suspends the organization's access."
        required
        errors={fieldErrorsFor(state, "status")}
      >
        <Select name="status" defaultValue={account?.status ?? ""}>
          <option value="" disabled>
            Choose a status
          </option>
          <option value="trial">Trial</option>
          <option value="active">Active</option>
          <option value="past_due">Past due</option>
          <option value="suspended">Suspended</option>
          <option value="cancelled">Canceled</option>
        </Select>
      </FormField>
      <FormField id={id("plan")} label="Plan" errors={fieldErrorsFor(state, "planKey")}>
        <Select name="planKey" defaultValue={account?.planKey ?? ""}>
          <option value="">No plan yet</option>
          {plans.map((plan) => (
            <option key={plan.key} value={plan.key}>
              {plan.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        id={id("billing-name")}
        label="Billing contact name"
        errors={fieldErrorsFor(state, "billingName")}
      >
        <Input name="billingName" maxLength={120} defaultValue={account?.billingName ?? ""} />
      </FormField>
      <FormField
        id={id("billing-email")}
        label="Billing contact email"
        errors={fieldErrorsFor(state, "billingEmail")}
      >
        <Input name="billingEmail" type="email" defaultValue={account?.billingEmail ?? ""} />
      </FormField>
      <FormField id={id("trial")} label="Trial ends" errors={fieldErrorsFor(state, "trialEndsOn")}>
        <Input name="trialEndsOn" type="date" defaultValue={account?.trialEndsOn ?? ""} />
      </FormField>
      <FormField
        id={id("period")}
        label="Current period ends"
        errors={fieldErrorsFor(state, "currentPeriodEndsOn")}
      >
        <Input
          name="currentPeriodEndsOn"
          type="date"
          defaultValue={account?.currentPeriodEndsOn ?? ""}
        />
      </FormField>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          name="cancelAtPeriodEnd"
          defaultChecked={account?.cancelAtPeriodEnd ?? false}
          className="size-4"
        />
        Cancel at the end of the current period
      </label>
      <div className="sm:col-span-2">
        <ReasonField id={id("reason")} state={state} />
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <FormAlert state={state} successMessage="Commercial account saved." />
        <SubmitButton className="w-fit">{account ? "Save account" : "Set up account"}</SubmitButton>
      </div>
    </form>
  );
}

export function LifecycleForm({
  organisationId,
  organisationName,
  currentStatus,
}: {
  organisationId: string;
  organisationName: string;
  currentStatus: "active" | "suspended" | "archived";
}) {
  const [state, formAction] = useActionState(setLifecycleAction, null);
  const target = currentStatus === "active" ? "suspended" : "active";
  if (currentStatus === "archived") return null;
  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="status" value={target} />
      <ReasonField id="lifecycle-reason" state={state} />
      <FormAlert
        state={state}
        successMessage={
          target === "suspended" ? "Organization suspended." : "Organization reactivated."
        }
      />
      <SubmitButton
        className="w-fit"
        variant={target === "suspended" ? "danger" : "outline"}
        aria-label={`${target === "suspended" ? "Suspend" : "Reactivate"} ${organisationName}`}
      >
        {target === "suspended" ? "Suspend organization" : "Reactivate organization"}
      </SubmitButton>
    </form>
  );
}

export function PlanForm() {
  const [state, formAction] = useActionState(savePlanAction, null);
  return (
    <form action={formAction} className="grid max-w-3xl gap-3 sm:grid-cols-3" noValidate>
      <FormField id="plan-key" label="Key" required errors={fieldErrorsFor(state, "key")}>
        <Input name="key" placeholder="pilot" autoComplete="off" />
      </FormField>
      <FormField id="plan-name" label="Name" required errors={fieldErrorsFor(state, "name")}>
        <Input name="name" autoComplete="off" />
      </FormField>
      <FormField id="plan-status" label="Status" errors={fieldErrorsFor(state, "status")}>
        <Select name="status" defaultValue="active">
          <option value="active">Active</option>
          <option value="retired">Retired</option>
        </Select>
      </FormField>
      <FormField
        id="plan-price"
        label="Monthly price"
        description="Leave empty until pricing is approved."
        errors={fieldErrorsFor(state, "monthlyPrice")}
      >
        <Input name="monthlyPrice" inputMode="decimal" autoComplete="off" />
      </FormField>
      <FormField id="plan-currency" label="Currency" errors={fieldErrorsFor(state, "currency")}>
        <Input name="currency" maxLength={3} placeholder="USD" autoComplete="off" />
      </FormField>
      <FormField
        id="plan-seats"
        label="Included seats"
        errors={fieldErrorsFor(state, "includedSeats")}
      >
        <Input name="includedSeats" type="number" min={0} />
      </FormField>
      <FormField
        id="plan-facilities"
        label="Included facilities"
        errors={fieldErrorsFor(state, "includedFacilities")}
      >
        <Input name="includedFacilities" type="number" min={0} />
      </FormField>
      <div className="flex flex-col gap-2 sm:col-span-3">
        <FormAlert state={state} successMessage="Plan saved." />
        <SubmitButton className="w-fit" variant="outline">
          Save plan
        </SubmitButton>
      </div>
    </form>
  );
}

/** P0-E9-4A.2: decide an additional-business request (its own account; never inherited). */
export function BusinessRequestDecision({
  requestId,
  businessName,
  plans,
}: {
  requestId: string;
  businessName: string;
  plans: { key: string; name: string }[];
}) {
  const [fulfilState, fulfil] = useActionState(fulfilBusinessRequestAction, null);
  const [declineState, decline] = useActionState(declineBusinessRequestAction, null);
  const id = (field: string) => `business-${requestId}-${field}`;
  return (
    <div className="flex flex-col gap-4">
      <form action={fulfil} className="grid gap-3 sm:grid-cols-3" noValidate>
        <input type="hidden" name="requestId" value={requestId} />
        <FormField
          id={id("status")}
          label="Start as"
          required
          errors={fieldErrorsFor(fulfilState, "status")}
        >
          <Select name="status" defaultValue="trial">
            <option value="trial">Trial</option>
            <option value="active">Active</option>
          </Select>
        </FormField>
        <FormField id={id("plan")} label="Plan" errors={fieldErrorsFor(fulfilState, "planKey")}>
          <Select name="planKey" defaultValue="">
            <option value="">No plan yet</option>
            {plans.map((plan) => (
              <option key={plan.key} value={plan.key}>
                {plan.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          id={id("trial")}
          label="Trial ends"
          errors={fieldErrorsFor(fulfilState, "trialEndsOn")}
        >
          <Input name="trialEndsOn" type="date" />
        </FormField>
        <div className="sm:col-span-3">
          <ReasonField id={id("reason")} state={fulfilState} />
        </div>
        <div className="flex flex-col gap-2 sm:col-span-3">
          <FormAlert state={fulfilState} successMessage="Business created with its own account." />
          <SubmitButton className="w-fit" aria-label={`Create ${businessName}`}>
            Create business and account
          </SubmitButton>
        </div>
      </form>
      <form action={decline} className="flex flex-col gap-3 border-t border-border pt-3" noValidate>
        <input type="hidden" name="requestId" value={requestId} />
        <ReasonField id={id("decline-reason")} state={declineState} />
        <FormAlert state={declineState} successMessage="Request declined." />
        <SubmitButton
          className="w-fit"
          variant="outline"
          aria-label={`Decline request for ${businessName}`}
        >
          Decline
        </SubmitButton>
      </form>
    </div>
  );
}
