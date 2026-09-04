// JMB Lighting companion — service worker.
// Makes the installed PWA work offline: once you've opened it online, it runs
// with no signal (handy at a venue). Strategy is NETWORK-FIRST so an online
// launch always gets the freshest build, falling back to the cached copy only
// when the network is unreachable. Bump CACHE on each deploy to evict old copies.
// MUST be "jmb-" + the app's APP_VER with dots as dashes. deploy_pages.py
// enforces it: a deploy that bumps APP_VER but not this key publishes new HTML
// that no client ever sees, because the old shell stays cached and un-evicted.
const CACHE="jmb-2026-09-04a-testbanner-rollback";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest",
                "./icon.svg", "./icon-maskable.svg", "./icon-512.png",
                "./icon-512-maskable.png", "./privacy.html", "./jmb-splash.png",
                // Docs precached so the manual + DMX chart open with no signal.
                "./manual.html", "./dmx-chart.html",
                "./manual.pdf", "./dmx-chart.pdf",
                "./safety.html", "./safety.pdf"];

self.addEventListener("install", e => {
  self.skipWaiting();                                   // take over ASAP
  // Cache each asset independently — a single 404 must not sink the whole
  // precache (atomic addAll would leave the cache empty and break offline).
  e.waitUntil(caches.open(CACHE).then(c =>
    Promise.all(ASSETS.map(a => c.add(a).catch(() => {})))));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;                     // never cache writes
  e.respondWith(
    fetch(req)
      .then(resp => {                                   // online: serve + refresh cache
        if (resp && resp.ok) {                          // never cache a 404/5xx — a
          const copy = resp.clone();                    // transient error must not
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); // poison the shell
        }
        return resp;
      })
      .catch(() =>                                      // offline: cached copy; the
        caches.match(req).then(r => {                   // app-shell fallback is for
          if (r) return r;                              // NAVIGATIONS only — a missed
          if (req.mode === "navigate")                  // subresource (say a PDF) must
            return caches.match("./index.html");        // fail, not open as HTML
          return Response.error();
        }))
  );
});
