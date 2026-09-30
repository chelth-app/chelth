"use client";

import { fieldErrorsFor } from "@/components/forms/form-alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MAX_REQUESTED_HEADCOUNT } from "@/lib/domain/shifts";
import type { ActionResult } from "@/lib/errors";

type ScheduleFieldsProps = {
  idPrefix: string;
  state: ActionResult<unknown> | null;
  disciplines: { key: string; name: string }[];
  minDate: string;
};

/**
 * Discipline, local date/times (in the LOCATION's timezone), headcount and
 * facility-visible instructions. Shared by agency shifts and facility requests.
 */
export function ShiftScheduleFields({
  idPrefix,
  state,
  disciplines,
  minDate,
}: ScheduleFieldsProps) {
  return (
    <>
      <FormField
        id={`${idPrefix}-discipline`}
        label="Discipline"
        required
        errors={fieldErrorsFor(state, "disciplineKey")}
      >
        <Select name="disciplineKey" defaultValue="">
          <option value="" disabled>
            Choose a discipline
          </option>
          {disciplines.map((discipline) => (
            <option key={discipline.key} value={discipline.key}>
              {discipline.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        id={`${idPrefix}-date`}
        label="Shift date"
        required
        errors={fieldErrorsFor(state, "shiftDate")}
      >
        <Input name="shiftDate" type="date" min={minDate} />
      </FormField>
      <FormField
        id={`${idPrefix}-start`}
        label="Start time"
        description="Local time at the location."
        required
        errors={fieldErrorsFor(state, "startTime")}
      >
        <Input name="startTime" type="time" />
      </FormField>
      <FormField
        id={`${idPrefix}-end`}
        label="End time"
        description="Earlier than the start time means the shift ends the next day."
        required
        errors={fieldErrorsFor(state, "endTime")}
      >
        <Input name="endTime" type="time" />
      </FormField>
      <FormField
        id={`${idPrefix}-headcount`}
        label="Workers needed"
        required
        errors={fieldErrorsFor(state, "requestedHeadcount")}
      >
        <Input
          name="requestedHeadcount"
          type="number"
          min={1}
          max={MAX_REQUESTED_HEADCOUNT}
          defaultValue={1}
          inputMode="numeric"
        />
      </FormField>
      <FormField
        id={`${idPrefix}-reference`}
        label="Reference"
        description="Optional, e.g. a purchase order number."
        errors={fieldErrorsFor(state, "externalReference")}
      >
        <Input name="externalReference" autoComplete="off" />
      </FormField>
      <FormField
        id={`${idPrefix}-instructions`}
        label="Instructions for workers"
        description="Visible to the facility and assigned workers. Never include patient information."
        errors={fieldErrorsFor(state, "instructions")}
        className="sm:col-span-2"
      >
        <Textarea name="instructions" rows={3} maxLength={2000} />
      </FormField>
    </>
  );
}
