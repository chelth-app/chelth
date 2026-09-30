"use client";

import { useActionState } from "react";

import { FormAlert, fieldErrorsFor } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  GEOFENCE_ACCURACY_BOUNDS,
  GEOFENCE_OUTSIDE_POLICIES,
  GEOFENCE_POLICY_LABELS,
  GEOFENCE_RADIUS_BOUNDS,
  type GeofenceOutsidePolicy,
} from "@/lib/domain/attendance";

import { saveAttendanceSettingsAction, saveGeofenceAction } from "../actions";

type Rules = {
  earlyClockInMinutes: number;
  lateClockInMinutes: number;
  earlyClockOutMinutes: number;
  lateClockOutMinutes: number;
  missedClockInMinutes: number;
  missedClockOutMinutes: number;
  clockOutCutoffMinutes: number;
};

const RULE_FIELDS: { name: keyof Rules; label: string; description: string }[] = [
  {
    name: "earlyClockInMinutes",
    label: "Earliest clock-in (minutes before start)",
    description: "Clock-in opens this long before the shift.",
  },
  {
    name: "lateClockInMinutes",
    label: "Late after (minutes past start)",
    description: "Clock-ins after this are flagged late.",
  },
  {
    name: "earlyClockOutMinutes",
    label: "Early clock-out (minutes before end)",
    description: "Leaving earlier than this is flagged.",
  },
  {
    name: "lateClockOutMinutes",
    label: "Late clock-out (minutes after end)",
    description: "Clock-outs after this are flagged.",
  },
  {
    name: "missedClockInMinutes",
    label: "Missed clock-in after (minutes)",
    description: "No clock-in this long after the start is flagged.",
  },
  {
    name: "missedClockOutMinutes",
    label: "Missed clock-out after (minutes)",
    description: "No clock-out this long after the end is flagged.",
  },
  {
    name: "clockOutCutoffMinutes",
    label: "Clock-out closes (minutes after end)",
    description: "After this, a correction is needed.",
  },
];

export function AttendanceSettingsForm({
  organisationId,
  rules,
}: {
  organisationId: string;
  rules: Rules;
}) {
  const [state, formAction] = useActionState(saveAttendanceSettingsAction, null);
  return (
    <form action={formAction} className="grid max-w-3xl gap-3 sm:grid-cols-2" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      {RULE_FIELDS.map((field) => (
        <FormField
          key={field.name}
          id={`rule-${field.name}`}
          label={field.label}
          description={field.description}
          errors={fieldErrorsFor(state, field.name)}
        >
          <Input
            name={field.name}
            type="number"
            inputMode="numeric"
            defaultValue={rules[field.name]}
          />
        </FormField>
      ))}
      <SubmitButton variant="outline" className="w-fit">
        Save attendance rules
      </SubmitButton>
      <FormAlert state={state} successMessage="Attendance rules saved." className="sm:col-span-2" />
    </form>
  );
}

type GeofenceFormProps = {
  organisationId: string;
  facilityId: string;
  locationId: string;
  locationName: string;
  current: {
    enabled: boolean;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    maxAccuracyMeters: number;
    outsidePolicy: GeofenceOutsidePolicy;
  } | null;
};

/** Optional, location-scoped geofence. Off by default: no location is requested unless enabled. */
export function GeofenceForm({
  organisationId,
  facilityId,
  locationId,
  locationName,
  current,
}: GeofenceFormProps) {
  const [state, formAction] = useActionState(saveGeofenceAction, null);
  const id = (field: string) => `geofence-${locationId}-${field}`;
  return (
    <form action={formAction} className="grid max-w-3xl gap-3 sm:grid-cols-3" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="facilityId" value={facilityId} />
      <input type="hidden" name="locationId" value={locationId} />
      <label className="flex items-start gap-2 text-sm sm:col-span-3">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={current?.enabled ?? false}
          className="mt-1 size-4"
        />
        <span>Check location at clock-in and clock-out for {locationName}</span>
      </label>
      <FormField id={id("lat")} label="Site latitude" errors={fieldErrorsFor(state, "latitude")}>
        <Input name="latitude" inputMode="decimal" defaultValue={current?.latitude ?? ""} />
      </FormField>
      <FormField id={id("lon")} label="Site longitude" errors={fieldErrorsFor(state, "longitude")}>
        <Input name="longitude" inputMode="decimal" defaultValue={current?.longitude ?? ""} />
      </FormField>
      <FormField
        id={id("radius")}
        label="Radius (metres)"
        description={`${GEOFENCE_RADIUS_BOUNDS.min}–${GEOFENCE_RADIUS_BOUNDS.max} m`}
        errors={fieldErrorsFor(state, "radiusMeters")}
      >
        <Input
          name="radiusMeters"
          type="number"
          inputMode="numeric"
          defaultValue={current?.radiusMeters ?? 200}
        />
      </FormField>
      <FormField
        id={id("accuracy")}
        label="Required accuracy (metres)"
        description={`${GEOFENCE_ACCURACY_BOUNDS.min}–${GEOFENCE_ACCURACY_BOUNDS.max} m`}
        errors={fieldErrorsFor(state, "maxAccuracyMeters")}
      >
        <Input
          name="maxAccuracyMeters"
          type="number"
          inputMode="numeric"
          defaultValue={current?.maxAccuracyMeters ?? 100}
        />
      </FormField>
      <FormField
        id={id("policy")}
        label="Outside the area"
        errors={fieldErrorsFor(state, "outsidePolicy")}
        className="sm:col-span-2"
      >
        <Select name="outsidePolicy" defaultValue={current?.outsidePolicy ?? "allow_with_review"}>
          {GEOFENCE_OUTSIDE_POLICIES.map((policy) => (
            <option key={policy} value={policy}>
              {GEOFENCE_POLICY_LABELS[policy]}
            </option>
          ))}
        </Select>
      </FormField>
      <SubmitButton
        variant="outline"
        className="w-fit"
        aria-label={`Save geofence for ${locationName}`}
      >
        Save geofence
      </SubmitButton>
      <FormAlert state={state} successMessage="Geofence saved." className="sm:col-span-3" />
    </form>
  );
}
