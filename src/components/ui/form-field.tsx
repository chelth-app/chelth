import { cloneElement, type ReactElement } from "react";

import { cn } from "@/lib/utils/cn";

import { Label } from "./label";

type ControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  invalid?: boolean;
  required?: boolean;
};

type FormFieldProps = {
  /** Stable id for the control; label, description and error are derived from it. */
  id: string;
  label: string;
  description?: string;
  /** Validation messages (e.g. from ActionResult fieldErrors). */
  errors?: readonly string[] | undefined;
  required?: boolean;
  className?: string;
  children: ReactElement<ControlProps>;
};

/**
 * Wires a label, optional description and error messages to a single form
 * control with the correct `for` / `aria-describedby` / `aria-invalid`
 * relationships, so every form in Chelth is accessible by construction.
 */
export function FormField({
  id,
  label,
  description,
  errors,
  required = false,
  className,
  children,
}: FormFieldProps) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = errors && errors.length > 0 ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {description ? (
        <p id={descriptionId} className="text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {cloneElement(children, {
        id,
        required,
        invalid: errorId !== undefined,
        "aria-describedby": describedBy,
      })}
      {errorId ? (
        <ul id={errorId} className="flex flex-col gap-0.5 text-sm text-danger">
          {errors?.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
