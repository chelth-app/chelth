"use client";

import { useState } from "react";

import { cn } from "@/lib/utils/cn";

import { Input, type InputProps } from "./input";

type PasswordInputProps = Omit<InputProps, "type"> & {
  /**
   * What the toggle reveals, used in its accessible name: "Show <label>" /
   * "Hide <label>" (e.g. "password", "new password", "confirm password").
   */
  revealLabel?: string;
};

/**
 * Password field with an accessible show / hide control (P0-E8-A1.2).
 * Presentation only: the value, name, autocomplete and validation are the
 * input's own; nothing is stored, logged or persisted, and visibility resets
 * on every render of the page. The toggle is a type="button" (never submits),
 * keeps the caret in the field on pointer use, and is named by its visible-
 * to-screen-readers text (not aria-label), so label lookups for the field stay
 * unambiguous. Works inside FormField (id, required, invalid, aria-describedby
 * are forwarded to the input).
 */
export function PasswordInput({
  revealLabel = "password",
  className,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={cn("pr-12", className)} />
      <button
        type="button"
        aria-controls={props.id}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setVisible((value) => !value)}
        className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r-md text-slate-500 hover:text-chelth-navy focus-visible:outline-offset-[-3px]"
      >
        <span className="sr-only">
          {visible ? "Hide" : "Show"} {revealLabel}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
          className="size-5"
        >
          {visible ? (
            <>
              <path d="M3 3l18 18" />
              <path d="M10.6 5.1A9.9 9.9 0 0 1 12 5c5 0 8.5 4.5 9.5 7a13 13 0 0 1-2.6 3.8M6.3 6.3A13.4 13.4 0 0 0 2.5 12c1 2.5 4.5 7 9.5 7a9.6 9.6 0 0 0 4.6-1.2" />
              <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
            </>
          ) : (
            <>
              <path d="M2.5 12C3.5 9.5 7 5 12 5s8.5 4.5 9.5 7c-1 2.5-4.5 7-9.5 7s-8.5-4.5-9.5-7z" />
              <circle cx="12" cy="12" r="3" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}
