import { Button } from "@/components/ui/button";

import { signOutAction } from "../actions";

/** POST form: sign-out is a state change and must never be a GET link. */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="ghost" size="sm">
        Sign out
      </Button>
    </form>
  );
}
