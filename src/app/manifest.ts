import type { MetadataRoute } from "next";

/**
 * Web app manifest (installable PWA, P0-E9-3C). Icons are the canonical Chelth
 * production assets in public/brand/chelth/ (never regenerated or substituted).
 * Colours are brand tokens from src/styles/brand.css (Deep Teal, Off White).
 *
 * start_url is /app: the existing entry resolves it per person (signed out →
 * Sign in; a worker of one agency → My Shifts; several → the agency chooser;
 * staff and mixed accounts → the workspace gateway). The scope covers the
 * whole app, so every worker route stays inside the installed window.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "Chelth",
    short_name: "Chelth",
    description: "Healthcare workforce operations that keep every shift moving.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#FAFBFA",
    theme_color: "#126B67",
    icons: [
      {
        src: "/brand/chelth/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/chelth/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/chelth/icon-maskable-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/brand/chelth/icon-maskable-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
