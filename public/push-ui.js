// Notifications (téléphone ou ordinateur) : activer / désactiver sur cet appareil, choisir quoi recevoir, tester
window.PUSH = (() => {
  const env = () => { const ua = navigator.userAgent || "";
    const ios = /iP(hone|ad|od)/.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    const android = /Android/i.test(ua);
    return { ios, android, desk: !ios && !android && !/Mobi|Tablet/i.test(ua), standalone, supported: "serviceWorker" in navigator && "PushManager" in window && "Notification" in window }; };
  let KEY = null, INFO = null;
  const b64 = s => { const p = "=".repeat((4 - s.length % 4) % 4), r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...r].map(c => c.charCodeAt(0))); };
  async function info(force) { if (!INFO || force) { INFO = await api("/api/push/key"); KEY = INFO.key; } return INFO; }
  async function reg() { const r = await navigator.serviceWorker.register("/sw.js"); await navigator.serviceWorker.ready; return r; }
  async function state() {
    const e = env(); if (!e.supported) return e.ios && !e.standalone ? "ios-install" : "unsupported";
    if (e.ios && !e.standalone) return "ios-install";
    if (Notification.permission === "denied") return "denied";
    try { const r = await navigator.serviceWorker.getRegistration(); const s = r && await r.pushManager.getSubscription(); return s && Notification.permission === "granted" ? "on" : "off"; } catch (x) { return "off"; }
  }
  async function enable() {
    const e = env(); if (!e.supported) throw new Error(e.ios ? "Ajoute d'abord StellADS à ton écran d'accueil" : "Ce navigateur ne gère pas les notifications");
    await info(); if (!KEY) throw new Error("Les notifications ne sont pas encore disponibles sur le site");
    const p = await Notification.requestPermission(); if (p !== "granted") throw new Error(p === "denied" ? (e.desk ? "Notifications bloquées : clique sur le cadenas à gauche de l'adresse pour les autoriser" : "Notifications bloquées : autorise-les dans les réglages du téléphone") : "Notifications pas autorisées");
    const r = await reg(); let s = await r.pushManager.getSubscription();
    if (!s) s = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(KEY) });
    await api("/api/push/sub", { body: { sub: s.toJSON(), standalone: e.standalone } }); return true;
  }
  async function disable() { try { const r = await navigator.serviceWorker.getRegistration(), s = r && await r.pushManager.getSubscription(); if (s) { await api("/api/push/unsub", { body: { endpoint: s.endpoint } }); await s.unsubscribe(); } } catch (e) {} }
  // si l'abonnement existe déjà (ou change), on le renvoie au serveur pour ce compte
  async function sync() { try { if (await state() !== "on") return; const r = await navigator.serviceWorker.getRegistration(), s = await r.pushManager.getSubscription(); if (s) api("/api/push/sub", { body: { sub: s.toJSON(), standalone: env().standalone } }).catch(() => {}); } catch (e) {} }

  /* ---------- fenêtre « Notifications » ---------- */
  const SV = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const BELL = "M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0", SHARE = "M12 3v12M8 7l4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6", PLUS = "M12 5v14M5 12h14";
  function iosSteps() { return `<div class="ps-ios"><b>Sur iPhone, une étape avant :</b><ol><li><span class="ps-i">${SV(SHARE)}</span><span>Touche <b>Partager</b> en bas de Safari</span></li><li><span class="ps-i">${SV(PLUS)}</span><span>Choisis <b>Sur l'écran d'accueil</b></span></li><li><span class="ps-i">✦</span><span>Ouvre StellADS depuis l'icône, puis reviens ici</span></li></ol></div>`; }
  async function sheet() {
    document.querySelector(".ps-wrap")?.remove();
    const D = env().desk, w = document.createElement("div"); w.className = "ps-wrap"; w.innerHTML = `<div class="ps-scrim"></div><div class="ps" role="dialog" aria-modal="true" aria-label="Notifications"><div class="ps-h"><span class="ps-bell">${SV(BELL)}</span><div><b>Notifications</b><small>${D ? "Sur cet ordinateur" : "Sur ce téléphone"}</small></div><button class="ps-x" aria-label="Fermer">✕</button></div><div class="ps-body"><div class="ps-ld">…</div></div></div>`;
    document.body.appendChild(w); requestAnimationFrame(() => w.classList.add("on"));
    const close = () => { w.classList.remove("on"); setTimeout(() => w.remove(), 400); };
    w.querySelector(".ps-scrim").onclick = close; w.querySelector(".ps-x").onclick = close;
    const body = w.querySelector(".ps-body");
    const draw = async () => {
      let st = await state(), d = null; try { d = await info(true); } catch (e) {}
      const on = st === "on";
      const top = st === "ios-install" ? iosSteps() : st === "unsupported" ? `<div class="ps-note">Ce navigateur ne gère pas les notifications. ${D ? "Utilise Chrome, Edge, Firefox ou Safari à jour." : "Utilise Chrome ou l'appli installée."}</div>`
        : st === "denied" ? `<div class="ps-note r">${blocked()}</div>`
        : `<button class="ps-dev${on ? " on" : ""}" data-dev><span class="ps-pulse"></span><span class="ps-dt"><b>${on ? "Activées sur cet " + (D ? "ordinateur" : "appareil") : "Désactivées sur cet " + (D ? "ordinateur" : "appareil")}</b><small>${on ? (D ? "Tu reçois les alertes même onglet fermé, tant que ton navigateur est ouvert" : "Tu reçois les alertes même site fermé") : D ? "Clique pour les activer" : "Touche pour les activer"}</small></span><span class="ps-tg"></span></button>`;
      body.innerHTML = top + (d ? `<div class="ps-lab">CE QUE JE REÇOIS</div><div class="ps-list">${Object.entries(d.kinds).map(([k, l]) => `<button class="ps-row${d.prefs[k] ? " on" : ""}" data-k="${k}"><span>${l}</span><span class="ps-tg"></span></button>`).join("")}</div>
        <div class="ps-ft"><span>${d.devices} appareil${d.devices > 1 ? "s" : ""} relié${d.devices > 1 ? "s" : ""}</span>${on ? '<button class="ps-test" data-test>Envoyer un test</button>' : ""}</div>` : "");
      body.querySelector("[data-dev]")?.addEventListener("click", async e => { const b = e.currentTarget; b.classList.add("busy");
        try { if (on) await disable(); else await enable(); toastP(on ? "Notifications désactivées sur cet appareil" : "Notifications activées ✨"); } catch (x) { toastP(x.message); } draw(); });
      body.querySelectorAll("[data-k]").forEach(b => b.addEventListener("click", async () => { b.classList.toggle("on"); const p = {}; body.querySelectorAll("[data-k]").forEach(x => p[x.dataset.k] = x.classList.contains("on"));
        try { await api("/api/push/prefs", { method: "PUT", body: p }); } catch (x) { toastP(x.message); } }));
      body.querySelector("[data-test]")?.addEventListener("click", async e => { e.target.disabled = true; try { await api("/api/push/test", { body: {} }); toastP("Test envoyé : il arrive dans quelques secondes"); } catch (x) { toastP(x.message); } e.target.disabled = false; });
    };
    draw();
  }
  // notifications bloquées : comment les débloquer selon le téléphone
  function blocked() { const e = env();
    if (e.android) return e.standalone ? "Les notifications sont bloquées. Va dans <b>Réglages › Applications › StellADS › Notifications</b> et active-les, puis reviens ici."
      : "Les notifications sont bloquées pour le site. Touche le <b>cadenas</b> à gauche de l’adresse, puis <b>Autorisations › Notifications › Autoriser</b>, et reviens ici.";
    if (e.ios) return "Les notifications sont bloquées. Va dans <b>Réglages › Notifications › StellADS</b> et active « Autoriser les notifications », puis reviens ici.";
    return "Les notifications sont bloquées pour le site. Clique sur le <b>cadenas</b> à gauche de l’adresse, autorise les notifications, puis recharge la page."; }
  function toastP(t) { try { notify("Notifications", t, "info"); } catch (e) { alert(t); } }
  // petite carte sur l'accueil tant que les notifications ne sont pas activées
  async function nudge(host) {
    try { if (!host || localStorage.getItem("stPushNo") > Date.now()) return; } catch (e) {}
    const st = await state(); if (st === "on" || st === "unsupported") return;
    const D = env().desk, c = document.createElement("div"); c.className = "ps-nudge";
    c.innerHTML = `<span class="ps-bell">${SV(BELL)}</span><div><b>Active les notifications${D ? " sur ton ordinateur" : ""}</b><small>${st === "ios-install" ? "Ajoute StellADS à ton écran d'accueil pour recevoir messages, annonces et rappels de shift" : st === "denied" ? `Elles sont bloquées : ${D ? "clique" : "touche"} pour voir comment les autoriser` : D ? "Messages privés, annonces, rappels de shift et renforts, même quand StellADS n'est pas ouvert" : "Messages privés, annonces, rappels de shift et renforts, même site fermé"}</small></div><button class="ps-go">Activer</button><button class="ps-no" aria-label="Plus tard">✕</button>`;
    host.parentNode.insertBefore(c, host);
    c.querySelector(".ps-go").onclick = () => sheet();
    c.querySelector(".ps-no").onclick = () => { try { localStorage.setItem("stPushNo", Date.now() + 3 * 864e5); } catch (e) {} c.remove(); };
  }
  /* ---------- écran bloquant : notifications obligatoires pour les chatters ---------- */
  const inApp = () => /Instagram|FBAN|FBAV|FB_IAB|Telegram|WhatsApp|Snapchat|Line\/|MicroMessenger|; wv\)/i.test(navigator.userAgent || "");
  async function gate() {
    if (document.querySelector(".pg-wrap")) return;
    let d = null; try { d = await info(true); } catch (e) {} if (!d || !d.key) return;   // notifications pas disponibles sur le site : on ne bloque pas
    const w = document.createElement("div"); w.className = "pg-wrap"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true");
    w.innerHTML = `<div class="pg"><div class="pg-bell">${SV(BELL)}<i></i></div><h2>Active tes <em>notifications</em></h2>
      <p>Elles sont obligatoires pour travailler chez StellADS : rappels de shift, ventes validées, messages de ton manager.</p><div class="pg-body"></div>
      <button class="pg-out">Se déconnecter</button></div>`;
    document.body.appendChild(w); document.documentElement.classList.add("pg-lock"); requestAnimationFrame(() => w.classList.add("on"));
    w.querySelector(".pg-out").onclick = () => { try { logout(); } catch (e) { location.href = "/"; } };
    const body = w.querySelector(".pg-body");
    // le serveur confirme qu'un appareil est bien relié à ce compte avant de débloquer
    const check = async () => { try { const me = await api("/api/me", { fresh: true }); if (!me.pushNeeded) { w.classList.remove("on"); document.documentElement.classList.remove("pg-lock"); setTimeout(() => w.remove(), 500); toastP("Notifications activées ✨ Bon shift !"); return true; } } catch (e) {} return false; };
    const draw = async () => {
      const st = await state(), e = env();
      if (inApp()) { body.innerHTML = `<div class="ps-note">Tu as ouvert StellADS depuis une autre appli : les notifications n'y fonctionnent pas. Ouvre le site dans <b>${e.ios ? "Safari" : "Chrome"}</b>.</div><button class="pg-go" data-copy>Copier le lien du site</button>`;
        body.querySelector("[data-copy]").onclick = async ev => { try { await navigator.clipboard.writeText(location.origin); ev.target.textContent = "Lien copié : colle-le dans " + (e.ios ? "Safari" : "Chrome"); } catch (x) { ev.target.textContent = location.origin; } }; return; }
      if (st === "ios-install") { body.innerHTML = iosSteps() + `<div class="pg-hint">Ensuite, ouvre StellADS depuis l'icône sur ton écran d'accueil : cet écran te proposera d'activer les notifications.</div>`; return; }
      if (st === "unsupported") { body.innerHTML = `<div class="ps-note">Ce navigateur ne gère pas les notifications. Ouvre StellADS dans <b>${e.ios ? "Safari (iOS 16.4 ou plus)" : "Chrome"}</b> à jour.</div>`; return; }
      if (st === "denied") { body.innerHTML = `<div class="ps-note r">${blocked()}</div><button class="pg-go" data-re>J'ai réactivé, vérifier</button>`;
        body.querySelector("[data-re]").onclick = async ev => { ev.target.classList.add("busy"); if (await state() === "denied") { ev.target.classList.remove("busy"); ev.target.textContent = "Toujours bloquées : vérifie les réglages"; return; } draw(); }; return; }
      body.innerHTML = `<button class="pg-go" data-on>Activer les notifications</button><div class="pg-hint">Ton téléphone va te demander l'autorisation : touche <b>Autoriser</b>.</div>`;
      body.querySelector("[data-on]").onclick = async ev => { const b = ev.currentTarget; b.classList.add("busy"); b.textContent = "Activation…";
        try { await enable(); if (await check()) return; b.textContent = "Réessayer"; } catch (x) { toastP(x.message); b.textContent = "Réessayer"; }
        b.classList.remove("busy"); draw(); };
    };
    // déjà autorisées sur ce téléphone mais pas reliées à ce compte : on relie sans rien demander
    if (await state() === "on") { try { await enable(); if (await check()) return; } catch (e) {} }
    draw();
    document.addEventListener("visibilitychange", () => { if (!document.hidden && document.contains(w)) draw(); });
  }
  return { env, state, enable, disable, sync, sheet, nudge, iosSteps, blocked, gate };
})();
