const CACHE = "grifos-v3";
const SHELL = ["./", "index.html", "style.css", "app.js", "ruta.js", "herramientas.js", "interfaz.js", "manejo.js", "features.json", "data/grifos.json", "manifest.webmanifest", "icon.svg",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Red primero (los precios cambian a diario); la caché solo sirve sin conexión. Los mapas no se cachean.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.hostname.endsWith("tile.openstreetmap.org") || url.pathname.includes("/api/") ||
    url.hostname.includes("osrm") || url.hostname.includes("nominatim")) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
