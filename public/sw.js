/*
 * Chelth service worker (P0-E9-3C) — installability and a static-only cache.
 *
 * Caches ONLY non-sensitive static files: content-hashed Next.js build assets
 * (/_next/static/), the canonical brand files (/brand/chelth/) and the offline
 * page. Pages, data, server actions, API and auth responses, credential
 * documents, signed URLs and anything cross-origin (Supabase) are never cached
 * and never stored: page navigations always go to the network, and only when
 * the network fails is the static offline page shown. Nothing is queued or
 * replayed; there is no offline storage of healthcare data.
 */
const VERSION = "chelth-sw-1";
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/offline.css", "/brand/chelth/logo-primary.svg"];
const MAX_STATIC_ENTRIES = 300;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" }))))
      // Safe to activate at once: no page or data is ever served from this cache,
      // so a new worker cannot leave an open page on stale code or force a reload.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("chelth-") && name !== STATIC_CACHE)
          .map((name) => caches.delete(name)),
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/chelth/");
}

async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_STATIC_ENTRIES))) {
    await cache.delete(key);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  // Only complete, same-origin, successful responses; never partial or opaque ones.
  if (response.ok && response.status === 200 && response.type === "basic") {
    await cache.put(request, response.clone());
    await trim(cache);
  }
  return response;
}

async function networkFirstNavigation(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch {
    // Offline or unreachable: an honest static page. Never a cached app page.
    const offline = await caches.match(OFFLINE_URL);
    return offline ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // Mutations and server actions: untouched.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase, signed URLs: untouched.

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(event));
    return;
  }
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
  // Everything else (RSC payloads, API, auth, data) goes straight to the network.
});
