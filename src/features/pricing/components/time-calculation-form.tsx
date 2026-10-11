"use client";

import { useActionState, useState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ROUNDING_INCREMENTS } from "@/lib/domain/pricing";

import { applyTimeCalculationMethodAction } from "../actions";

/**
 * Time calculation method (P0-E9-3F): exact minutes, or the existing
 * round-to-nearest policy. Saved as a new version effective from the chosen
 * date; earlier priced work is never recalculated.
 */
export function TimeCalculationForm({
  organisationId,
  today,
  current,
}: {
  organisationId: string;
  today: string;
  current: { mode: "none" | "nearest"; increment: number | null };
}) {
  const [state, formAction] = useActionState(applyTimeCalculationMethodAction, null);
  const [method, setMethod] = useState(
    current.mode === "nearest" && current.increment ? `nearest-${current.increment}` : "none",
  );
  const nearest = method.startsWith("nearest-");
  return (
    <form action={formAction} className="flex max-w-3xl flex-col gap-3" noValidate>
      <FormAlert state={state} successMessage="Time calculation method saved." />
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="mode" value={nearest ? "nearest" : "none"} />
      <input
        type="hidden"
        name="increment"
        value={nearest ? method.slice("nearest-".length) : ""}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-chelth-navy">
          Time calculation method
        </legend>
        <div className="flex items-start gap-2.5 text-sm">
          <input
            id="time-calculation-exact"
            type="radio"
            name="method"
            value="none"
            checked={method === "none"}
            onChange={() => setMethod("none")}
            aria-describedby="time-calculation-exact-note"
            className="mt-1 size-4"
          />
          <div>
            <label htmlFor="time-calculation-exact" className="font-semibold text-chelth-navy">
              Exact minutes
            </label>
            <p id="time-calculation-exact-note" className="text-[13px] text-slate-600">
              Every worked minute is priced: minutes ÷ 60 × hourly rate.
            </p>
          </div>
        </div>
        {ROUNDING_INCREMENTS.map((increment) => (
          <label key={increment} className="flex items-start gap-2.5 text-sm">
            <input
              type="radio"
              name="method"
              value={`nearest-${increment}`}
              checked={method === `nearest-${increment}`}
              onChange={() => setMethod(`nearest-${increment}`)}
              className="mt-1 size-4"
            />
            <span className="font-semibold text-chelth-navy">
              Round to the nearest {increment} minutes
            </span>
          </label>
        ))}
      </fieldset>
      <FormField
        id="time-calculation-from"
        label="Applies to work from"
        description="Work already priced keeps the method it was priced with."
        errors={fieldErrorsFor(state, "effectiveFrom")}
        className="max-w-xs"
      >
        <Input name="effectiveFrom" type="date" defaultValue={today} min={today} />
      </FormField>
      <SubmitButton variant="outline" className="w-fit">
        Save time calculation method
      </SubmitButton>
    </form>
  );
}
