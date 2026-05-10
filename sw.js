// Service worker that forces fresh HTML on every visit so families
// pick up new builds automatically — no hard-refresh required.
//
// Strategy: only intercept navigation requests (the page document),
// fetch them with `cache: "no-store"`. Everything else (JS, CSS,
// images, Firebase, gstatic CDN) uses normal browser caching.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
  }
});
