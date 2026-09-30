// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/ui/loading-state";

describe("Button", () => {
  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("type", "button");
  });

  it("is keyboard-activatable", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("marks loading buttons busy and disabled", () => {
    render(<Button loading>Saving</Button>);
    const button = screen.getByRole("button", { name: "Saving" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});

describe("FormField", () => {
  it("associates label, description and errors with the control", () => {
    render(
      <FormField
        id="email"
        label="Email"
        description="Work address"
        errors={["Enter an email."]}
        required
      >
        <Input type="email" />
      </FormField>,
    );
    const input = screen.getByLabelText(/Email/);
    expect(input).toHaveAttribute("id", "email");
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Work address Enter an email.");
  });

  it("is not invalid without errors", () => {
    render(
      <FormField id="name" label="Name">
        <Input />
      </FormField>,
    );
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-invalid");
  });
});

describe("status components", () => {
  it("LoadingState announces via role=status", () => {
    render(<LoadingState label="Loading shifts" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading shifts");
  });

  it("ErrorState announces via role=alert", () => {
    render(<ErrorState message="Safe message" reference="abc" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Safe message");
    expect(screen.getByRole("alert")).toHaveTextContent("Reference: abc");
  });

  it("Badge renders its text (meaning is never colour-only)", () => {
    render(<Badge tone="danger">Expired</Badge>);
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });
});
