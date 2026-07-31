const CACHE = "rajudhara-football-predictor-v3-combo";
const CORE = [
  "./", "./index.html", "./reset.html", "./styles.css", "./app.js", "./model.js", "./normalization.js",
  "./player-model.js", "./player-data.js", "./csv.js", "./storage.js", "./sentiment.js", "./i18n.js", "./combo.js",
  "./manifest.webmanifest", "./data/leagues.json", "./data/demo-fixtures.json",
  "./data/demo-history.csv", "./data/demo-players.json", "./data/demo-lineups.json",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request)) || (request.mode === "navigate" ? caches.match("./index.html") : Response.error());
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isCode = event.request.mode === "navigate" || /\.(?:html|js|css|webmanifest)$/.test(url.pathname);
  event.respondWith(isCode ? networkFirst(event.request) : cacheFirst(event.request));
});
