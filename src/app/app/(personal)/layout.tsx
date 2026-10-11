import type { ReactNode } from "react";

import { getRequestTerminology, TerminologyProvider } from "@/features/localization";

import { PersonalFrame } from "../_components/personal-frame";

/** Personal pages: the person's own spelling (P0-E9-3I), never a workspace's. */
export default async function PersonalLayout({ children }: { children: ReactNode }) {
  return (
    <TerminologyProvider terms={await getRequestTerminology()}>
      <PersonalFrame>{children}</PersonalFrame>
    </TerminologyProvider>
  );
}
