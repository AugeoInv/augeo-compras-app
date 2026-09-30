const CACHE = "compras-augeo-v2";
const ARCHIVOS = [
  "./",
  "./index.html",
  "./app.js",
  "./styles.css",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/favicon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// El HTML/CSS/JS del cascaron se busca primero en la red (para no quedar pegado con una version vieja
// cuando se actualiza la app) y solo se usa la copia guardada si no hay señal. Las llamadas al backend
// de Apps Script SIEMPRE van directo a la red, nunca se cachean.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // deja pasar las llamadas a script.google.com

  e.respondWith(
    fetch(e.request).then((red) => {
      const copia = red.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copia));
      return red;
    }).catch(() => caches.match(e.request))
  );
});
