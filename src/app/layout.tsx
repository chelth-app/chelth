import "@fontsource-variable/inter";
import "@fontsource-variable/manrope";
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
  // Canonical production icons (public/brand/chelth/); the manifest is src/app/manifest.ts.
  icons: {
    icon: [
      { url: "/brand/chelth/favicon.ico", sizes: "any" },
      { url: "/brand/chelth/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/brand/chelth/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/brand/chelth/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#126B67", // Chelth Deep Teal (src/styles/brand.css)
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
