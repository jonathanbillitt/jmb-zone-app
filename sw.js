// JMB Lighting companion — service worker.
// Makes the installed PWA work offline: once you've opened it online, it runs
// with no signal (handy at a venue). Strategy is NETWORK-FIRST so an online
// launch always gets the freshest build, falling back to the cached copy only
// when the network is unreachable. Bump CACHE on each deploy to evict old copies.
// MUST be "jmb-" + the app's APP_VER with dots as dashes. deploy_pages.py
// enforces it: a deploy that bumps APP_VER but not this key publishes new HTML
// that no client ever sees, because the old shell stays cached and un-evicted.
const CACHE="jmb-2026-10-04e-spread";
// The shell: what the connect screen and the app need. Precached at install.
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./firmware.json",
                "./icon.svg", "./icon-maskable.svg", "./icon-192.png",
                "./icon-192-maskable.png", "./icon-512.png",
                "./icon-512-maskable.png", "./privacy.html", "./jmb-splash.png",
                "./crmx-lumenradio-dark.png"];
// Docs precached so the manual + DMX chart open with no signal — but AFTER the
// worker is live, not at install: ~900 KB of PDFs fetched at install time ran
// alongside the page's own first load after an update (caches wiped), and the
// 386 KB splash badge lost the race on a phone (2026-10-02: "logos missing on
// the opening screen after an update, back after a restart").
const DOCS = ["./manual.html", "./dmx-chart.html",
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
  // Nothing slow in here: fetch events wait for activation to finish, so a
  // long waitUntil would stall the page's own requests.
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The page asks for the docs a few seconds after it has settled (see the
// register call in the app); the fetch handler below also caches any doc the
// moment it is opened online.
self.addEventListener("message", e => {
  if (e.data === "precache-docs")
    e.waitUntil(caches.open(CACHE).then(c =>
      Promise.all(DOCS.map(a => c.add(a).catch(() => {})))));
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
