import type { MetadataRoute } from "next";

/**
 * Web app manifest. Icons are the canonical Chelth production assets in
 * public/brand/chelth/ (never regenerated or substituted). Colours are brand
 * tokens from src/styles/brand.css (Deep Teal, Off White).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Chelth — Healthcare Workforce Operations",
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
