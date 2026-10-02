import type { ReactNode } from "react";

import { PersonalFrame } from "../../../_components/personal-frame";

/**
 * Worker self-service pages (My shifts, My credentials) keep the personal
 * frame: they are not part of the operational workspace shell (P0-E8-S1).
 */
export default function SelfServiceLayout({ children }: { children: ReactNode }) {
  return <PersonalFrame>{children}</PersonalFrame>;
}
