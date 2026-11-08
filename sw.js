// JMB Lighting companion — service worker.
// Makes the installed PWA work offline: once you've opened it online, it runs
// with no signal (handy at a venue). Strategy is NETWORK-FIRST so an online
// launch always gets the freshest build, falling back to the cached copy only
// when the network is unreachable. Bump CACHE on each deploy to evict old copies.
// MUST be "jmb-" + the app's APP_VER with dots as dashes. deploy_pages.py
// enforces it: a deploy that bumps APP_VER but not this key publishes new HTML
// that no client ever sees, because the old shell stays cached and un-evicted.
const CACHE="jmb-2026-11-08c-tap";
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

// How long a request waits for the network before the cached copy is served.
// Wi-Fi with no internet behind it (a venue network, or aeroplane mode with
// Wi-Fi left on) holds a connection open for 30 s or more before it fails, and
// network-first sat on the splash for all of it: "the app wouldn't start"
// (2026-10-29, reproduced at 30 s). The network fetch carries on in the
// background and refreshes the cache for next time.
const NET_WAIT = 3000;
// Once one request has timed out or failed, the ones right behind it (the
// splash badge, the manifest) go straight to the cache instead of each waiting
// NET_WAIT again: the opening screen came up with its logos missing.
const NET_BAD_MS = 30000;
let netBadUntil = 0;

self.addEventListener("install", e => {
  self.skipWaiting();                                   // take over ASAP
  // Cache each asset independently — a single 404 must not sink the whole
  // precache (atomic addAll would leave the cache empty and break offline).
  // Except the shell: if index.html didn't land, fail the install so the old
  // worker and its cache stay, rather than activating with nothing to start
  // offline and deleting the old cache on the way in. "reload" skips the
  // browser's 10-minute HTTP cache, which can still hold the previous build.
  const get = a => new Request(a, { cache: "reload" });
  e.waitUntil(caches.open(CACHE).then(c =>
    Promise.all(ASSETS.map(a => a === "./index.html" ? c.add(get(a))
                                                     : c.add(get(a)).catch(() => {})))));
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

// Only the app's own pages and its precached files take the NET_WAIT shortcut:
// they are what starting the app needs. A firmware download that is merely slow
// must never be swapped for an older cached copy, so everything else waits for
// the network as before and falls back to the cache only when it fails.
const QUICK = new Set(ASSETS.concat(DOCS).map(a => new URL(a, self.location).href));
// The app's own page: the scope root or index.html, with any query. Only that
// falls back to index.html; a doc page that isn't cached must not open the app.
const isShell = u => { const p = new URL(u).pathname, root = new URL(self.registration.scope).pathname;
                       return p === root || p === root + "index.html"; };

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;                     // never cache writes
  // "no-store" / "no-cache" is the app asking the SERVER (Look for app update,
  // the published firmware list): a cached copy would answer "you're on the
  // latest" with no signal, or offer a stale firmware build. Navigations keep
  // the cache: a pull-to-refresh is a "no-cache" navigation.
  if (req.mode !== "navigate" && (req.cache === "no-store" || req.cache === "no-cache")) return;
  const net = fetch(req);
  e.waitUntil(net.then(resp => {                        // online: refresh the cache
    if (resp && resp.ok) {                              // never cache a 404/5xx — a
      const copy = resp.clone();                        // transient error must not
      return caches.open(CACHE).then(c => c.put(req, copy)); // poison the shell
    }
  }).catch(() => {}));
  // This build's cache only: the outgoing worker's late write could recreate
  // an old cache after activate deleted it, and caches.match() searches them
  // all (second review 2026-10-31).
  const cached = () => caches.open(CACHE).then(c => c.match(req).then(r => {
    if (r) return r;                                    // the app-shell fallback is
    if (req.mode === "navigate" && isShell(req.url))    // for the app's own page
      return c.match("./index.html");                   // only — a missed doc or
  }));                                                  // subresource must fail
  if (!(req.mode === "navigate" || QUICK.has(req.url))) {
    e.respondWith(net.catch(() => {
      netBadUntil = Date.now() + NET_BAD_MS;
      return cached().then(r => r || Response.error(), () => Response.error());
    }));
    return;
  }
  e.respondWith(new Promise(resolve => {
    let done = false;
    const give = r => { if (!done && r) { done = true; resolve(r); } };
    // Slow network: the cached copy if there is one; with none, keep waiting.
    const slow = setTimeout(() => { netBadUntil = Date.now() + NET_BAD_MS;
                                    cached().then(give, () => {}); },
                            Date.now() < netBadUntil ? 0 : NET_WAIT);
    net.then(r => { clearTimeout(slow); netBadUntil = 0; give(r); },
             () => { clearTimeout(slow);                // offline: cached copy
                     netBadUntil = Date.now() + NET_BAD_MS;
                     cached().then(r => give(r || Response.error()),
                                   () => give(Response.error())); });
  }));
});
