// Service worker minimal : il permet d'« installer » StellADS comme une appli.
// Aucune mise en cache : tout passe par le réseau, donc le site est toujours à jour.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
// toucher une notification de rappel ouvre (ou ramène) l'appli sur la bonne page
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/planning";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const w = list.find(c => c.url.includes(url)) || list[0];
    return w ? w.focus().then(c => c && c.navigate && !c.url.includes(url) ? c.navigate(url) : c) : self.clients.openWindow(url);
  }));
});
