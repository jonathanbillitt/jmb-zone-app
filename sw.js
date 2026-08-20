// JMB Zone companion — service worker.
// Makes the installed PWA work offline: once you've opened it online, it runs
// with no signal (handy at a venue). Strategy is NETWORK-FIRST so an online
// launch always gets the freshest build, falling back to the cached copy only
// when the network is unreachable. Bump CACHE on each deploy to evict old copies.
const CACHE="jmb-2026-08-20j-uniform-logos";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest",
                "./icon.svg", "./icon-maskable.svg", "./icon-512.png",
                "./icon-512-maskable.png", "./privacy.html"];

self.addEventListener("install", e => {
  self.skipWaiting();                                   // take over ASAP
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
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
      .catch(() =>                                      // offline: cached, else app shell
        caches.match(req).then(r => r || caches.match("./index.html")))
  );
});
