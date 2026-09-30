import "@fontsource-variable/inter";
import "./globals.css";

import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { SkipLink } from "@/components/layout/skip-link";
import { APP_DESCRIPTOR, APP_NAME } from "@/constants/app";

export const metadata: Metadata = {
  title: { default: `${APP_NAME} — ${APP_DESCRIPTOR}`, template: `%s · ${APP_NAME}` },
  description:
    "Healthcare workforce operations for staffing agencies, facilities and professionals.",
  applicationName: APP_NAME,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f766e",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The per-request CSP nonce (src/proxy.ts) requires dynamic rendering: a
  // statically prerendered page cannot carry a nonce. Next.js reads the nonce
  // from the request CSP header and applies it to its own scripts. Components
  // that add a <Script> read it via headers().get(NONCE_HEADER).
  await connection();

  return (
    <html lang="en-GB">
      <body className="min-h-dvh">
        <SkipLink />
        {children}
      </body>
    </html>
  );
}
