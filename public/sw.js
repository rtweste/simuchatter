// Service worker minimal : il permet d'« installer » StellADS comme une appli.
// Aucune mise en cache : tout passe par le réseau, donc le site est toujours à jour.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
// notifications envoyées par le site (messages, annonces, shifts, renforts…)
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: "StellADS", body: e.data ? e.data.text() : "" }; }
  const url = d.url || "/home";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    // déjà sur la bonne page et l'appli au premier plan : pas besoin de notifier (sauf urgence)
    if (!d.urgent && list.some(c => c.focused && c.visibilityState === "visible" && new URL(c.url).pathname + new URL(c.url).search === url)) return;
    return self.registration.showNotification(d.title || "StellADS", { body: d.body || "", icon: "/icon-192.png", badge: "/badge-96.png", tag: d.tag || undefined, renotify: !!d.tag,
      requireInteraction: !!d.urgent, vibrate: d.urgent ? [200, 100, 200, 100, 300] : [120, 60, 120], data: { url } });
  }));
});
// toucher une notification de rappel ouvre (ou ramène) l'appli sur la bonne page
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/planning";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const w = list.find(c => c.url.includes(url)) || list[0];
    return w ? w.focus().then(c => c && c.navigate && !c.url.includes(url) ? c.navigate(url) : c) : self.clients.openWindow(url);
  }));
});
