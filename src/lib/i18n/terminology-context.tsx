"use client";

import { createContext, type ReactNode, useCallback, useContext } from "react";

import { localizeTerms, type Terminology, terminology } from "@/lib/i18n/terminology";

/*
 * Client side of the request terminology (P0-E9-3I). Layouts resolve the
 * workspace / personal terminology on the server and provide it here, so client
 * components spell Chelth copy the same way as server components — without
 * locale conditions in components. Default: the American source text.
 */
const TerminologyContext = createContext<Terminology>(terminology());

export function TerminologyProvider({
  terms,
  children,
}: {
  terms: Terminology;
  children: ReactNode;
}) {
  return <TerminologyContext.Provider value={terms}>{children}</TerminologyContext.Provider>;
}

export function useTerminology(): Terminology {
  return useContext(TerminologyContext);
}

/** spell("…") for client components: Chelth copy only, never user-entered names. */
export function useSpell(): (text: string) => string {
  const terms = useContext(TerminologyContext);
  return useCallback((text: string) => localizeTerms(text, terms), [terms]);
}
