import type { ReactNode } from "react";

import { PersonalFrame } from "../_components/personal-frame";

export default function PersonalLayout({ children }: { children: ReactNode }) {
  return <PersonalFrame>{children}</PersonalFrame>;
}
