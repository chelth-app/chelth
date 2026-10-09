"use client";

import { createContext, type ReactNode, useContext, useState } from "react";

/**
 * Panel-level confirmation for invitation actions. Cancelling removes the row
 * it was triggered from (the page re-renders without it), so the message must
 * live above the rows to remain visible.
 */
const InviteNoticeContext = createContext<((message: string) => void) | null>(null);

export function InviteNoticeProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <InviteNoticeContext.Provider value={setMessage}>
      {message ? (
        <p
          role="status"
          className="mx-[5px] mt-[9px] rounded-[10px] border border-[rgba(18,107,103,0.12)] bg-[linear-gradient(180deg,#f6fbfa,#eef7f4)] px-3.5 py-2.5 text-sm font-medium text-chelth-navy"
        >
          {message}
        </p>
      ) : null}
      {children}
    </InviteNoticeContext.Provider>
  );
}

export function useInviteNotice(): ((message: string) => void) | null {
  return useContext(InviteNoticeContext);
}
