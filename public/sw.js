// Service worker minimal : il permet d'« installer » StellADS comme une appli.
// Aucune mise en cache : tout passe par le réseau, donc le site est toujours à jour.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
