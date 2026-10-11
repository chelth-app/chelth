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
  GEOFENCE_POLICY_DEFAULTS,
  GEOFENCE_POLICY_LABELS,
  GEOFENCE_RADIUS_BOUNDS,
  geofenceFormValues,
  type GeofenceOutsidePolicy,
  type GeofencePolicy,
} from "@/lib/domain/attendance";

import {
  saveAttendanceSettingsAction,
  saveGeofenceAction,
  saveGeofencePolicyAction,
} from "../actions";

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
  /** Agency defaults: prefill a location that has no geofence yet (never overwrite a saved one). */
  policy?: GeofencePolicy;
};

/** Plain-language explanations, shared by the agency defaults and each location. */
const COPY = {
  radius: "How close a worker must be to the facility to check in.",
  accuracy: "How precise the worker's location reading must be.",
  policy: "What Chelth should do when a reliable location reading is outside the allowed area.",
} as const;

/**
 * Location-scoped geofence: the operational values clock-in uses. A location
 * without one prefills from the agency defaults; the site centre is never
 * defaulted and must be confirmed by the operator.
 */
export function GeofenceForm({
  organisationId,
  facilityId,
  locationId,
  locationName,
  current,
  policy = GEOFENCE_POLICY_DEFAULTS,
}: GeofenceFormProps) {
  const [state, formAction] = useActionState(saveGeofenceAction, null);
  const values = geofenceFormValues(current, policy);
  const id = (field: string) => `geofence-${locationId}-${field}`;
  return (
    <form action={formAction} className="grid max-w-3xl gap-3 sm:grid-cols-2" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="facilityId" value={facilityId} />
      <input type="hidden" name="locationId" value={locationId} />
      <label className="flex items-start gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={values.enabled}
          className="mt-1 size-4"
        />
        <span>Check location at clock-in and clock-out for {locationName}</span>
      </label>
      {values.fromDefaults ? (
        <p className="text-[13px] leading-5 text-slate-600 sm:col-span-2">
          Prefilled from your agency defaults. Enter the site centre and save to set up this
          location.
        </p>
      ) : null}
      <FormField
        id={id("lat")}
        label="Site centre latitude"
        description="Decimal degrees, e.g. the main entrance."
        errors={fieldErrorsFor(state, "latitude")}
      >
        <Input name="latitude" inputMode="decimal" defaultValue={values.latitude ?? ""} />
      </FormField>
      <FormField
        id={id("lon")}
        label="Site centre longitude"
        description="Decimal degrees."
        errors={fieldErrorsFor(state, "longitude")}
      >
        <Input name="longitude" inputMode="decimal" defaultValue={values.longitude ?? ""} />
      </FormField>
      <FormField
        id={id("radius")}
        label="Check-in radius (metres)"
        description={`${COPY.radius} ${GEOFENCE_RADIUS_BOUNDS.min}–${GEOFENCE_RADIUS_BOUNDS.max} m.`}
        errors={fieldErrorsFor(state, "radiusMeters")}
      >
        <Input
          name="radiusMeters"
          type="number"
          inputMode="numeric"
          min={GEOFENCE_RADIUS_BOUNDS.min}
          max={GEOFENCE_RADIUS_BOUNDS.max}
          defaultValue={values.radiusMeters}
        />
      </FormField>
      <FormField
        id={id("accuracy")}
        label="Maximum GPS uncertainty (metres)"
        description={`${COPY.accuracy} ${GEOFENCE_ACCURACY_BOUNDS.min}–${GEOFENCE_ACCURACY_BOUNDS.max} m.`}
        errors={fieldErrorsFor(state, "maxAccuracyMeters")}
      >
        <Input
          name="maxAccuracyMeters"
          type="number"
          inputMode="numeric"
          min={GEOFENCE_ACCURACY_BOUNDS.min}
          max={GEOFENCE_ACCURACY_BOUNDS.max}
          defaultValue={values.maxAccuracyMeters}
        />
      </FormField>
      <FormField
        id={id("policy")}
        label="Outside-area policy"
        description={COPY.policy}
        errors={fieldErrorsFor(state, "outsidePolicy")}
        className="sm:col-span-2"
      >
        <Select name="outsidePolicy" defaultValue={values.outsidePolicy}>
          {GEOFENCE_OUTSIDE_POLICIES.map((option) => (
            <option key={option} value={option}>
              {GEOFENCE_POLICY_LABELS[option]}
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
      <FormAlert state={state} successMessage="Geofence saved." className="sm:col-span-2" />
    </form>
  );
}

/**
 * Agency geofence policy: whether worker check-in requires a configured
 * geofence, and the defaults used to set up a location. Defaults never change
 * an existing location's geofence.
 */
export function GeofencePolicyForm({
  organisationId,
  policy,
}: {
  organisationId: string;
  policy: GeofencePolicy;
}) {
  const [state, formAction] = useActionState(saveGeofencePolicyAction, null);
  return (
    <form action={formAction} className="grid max-w-3xl gap-3 sm:grid-cols-2" noValidate>
      <input type="hidden" name="organisationId" value={organisationId} />
      <div className="flex items-start gap-2.5 text-sm sm:col-span-2">
        <input
          id="require-geofence"
          type="checkbox"
          name="requireGeofence"
          defaultChecked={policy.requireGeofence}
          className="mt-1 size-4"
          aria-describedby="require-geofence-note"
        />
        <div className="flex flex-col gap-0.5">
          <label htmlFor="require-geofence" className="font-semibold text-chelth-navy">
            Require geofencing for worker check-in
          </label>
          <p id="require-geofence-note" className="text-[13px] leading-5 text-slate-600">
            When on, workers cannot check in at a location until its geofence is set up and enabled.
            When off, locations without a geofence check in without a location check.
          </p>
        </div>
      </div>
      <FormField
        id="geofence-default-radius"
        label="Default check-in radius (metres)"
        description={`${COPY.radius} ${GEOFENCE_RADIUS_BOUNDS.min}–${GEOFENCE_RADIUS_BOUNDS.max} m.`}
        errors={fieldErrorsFor(state, "defaultRadiusMeters")}
      >
        <Input
          name="defaultRadiusMeters"
          type="number"
          inputMode="numeric"
          min={GEOFENCE_RADIUS_BOUNDS.min}
          max={GEOFENCE_RADIUS_BOUNDS.max}
          defaultValue={policy.defaultRadiusMeters}
        />
      </FormField>
      <FormField
        id="geofence-default-accuracy"
        label="Maximum location accuracy (metres)"
        description={`Workers must have a sufficiently accurate location reading before check-in can be confirmed. ${GEOFENCE_ACCURACY_BOUNDS.min}–${GEOFENCE_ACCURACY_BOUNDS.max} m.`}
        errors={fieldErrorsFor(state, "defaultMaxAccuracyMeters")}
      >
        <Input
          name="defaultMaxAccuracyMeters"
          type="number"
          inputMode="numeric"
          min={GEOFENCE_ACCURACY_BOUNDS.min}
          max={GEOFENCE_ACCURACY_BOUNDS.max}
          defaultValue={policy.defaultMaxAccuracyMeters}
        />
      </FormField>
      <FormField
        id="geofence-default-policy"
        label="Outside-area policy"
        description={COPY.policy}
        errors={fieldErrorsFor(state, "defaultOutsidePolicy")}
        className="sm:col-span-2"
      >
        <Select name="defaultOutsidePolicy" defaultValue={policy.defaultOutsidePolicy}>
          {GEOFENCE_OUTSIDE_POLICIES.map((option) => (
            <option key={option} value={option}>
              {GEOFENCE_POLICY_LABELS[option]}
            </option>
          ))}
        </Select>
      </FormField>
      <p className="text-[13px] leading-5 text-slate-600 sm:col-span-2">
        These defaults are used when setting up a facility location. Each location can be adjusted
        individually.
      </p>
      <SubmitButton variant="outline" className="w-fit">
        Save geofencing settings
      </SubmitButton>
      <FormAlert
        state={state}
        successMessage="Geofencing settings saved."
        className="sm:col-span-2"
      />
    </form>
  );
}
