"use client";

import { useFormStatus } from "react-dom";

import { Button, type ButtonProps } from "@/components/ui/button";

/** Submit button that shows a busy state while its form's action is pending. */
export function SubmitButton({ children, ...props }: Omit<ButtonProps, "type" | "loading">) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} {...props}>
      {children}
    </Button>
  );
}
