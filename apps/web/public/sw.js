/*
 * Service worker for the journal.
 *
 * Deliberately caches the shell and static assets only. Nothing under /api is
 * ever stored: this is a private journal, CacheStorage survives logout, and a
 * shared or borrowed device would otherwise keep readable entries around after
 * the session ended. The cost is that offline gives you the app, not your data.
 */
const VERSION = "v1";
const SHELL_CACHE = `journal-shell-${VERSION}`;
const ASSET_CACHE = `journal-assets-${VERSION}`;
const SHELL_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.add(new Request(SHELL_URL, { cache: "reload" }))),
  );
});

self.addEventListener("activate", (event) => {
  const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

/** Only same-origin, non-opaque, successful responses are worth storing. */
function isCacheable(response) {
  return response && response.ok && response.type === "basic";
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) {
    const cache = await caches.open(cacheName);
    void cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (isCacheable(response)) void cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached ?? (await network) ?? Response.error();
}

/** Navigations go to the network first so a deploy is picked up immediately. */
async function navigate(request) {
  try {
    return await fetch(request);
  } catch {
    const shell = await caches.match(SHELL_URL);
    return (
      shell ??
      new Response("<h1>Offline</h1>", { status: 503, headers: { "content-type": "text/html" } })
    );
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cached: journal data, media, auth. Straight to the network.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(navigate(request));
    return;
  }

  // Vite fingerprints these, so a given URL's bytes never change.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
});

// Lets a waiting worker take over when the page asks it to.
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") void self.skipWaiting();
});
