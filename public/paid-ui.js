// Achats des fans : une carte apparaît quand un fan paie un média (le nom du fan, la créatrice, le prix, et un bouton vers la conversation).
// Elle s'affiche sur toutes les pages du site ; sur le téléphone, la même information arrive en notification.
window.PAIDUI = (() => {
  const LIFE = 30e3, MAX = 3; let busy = false, timer = null;
  const done = new Set();
  const svg = (p, s = 18, w = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const COIN = '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.6a4.3 4.3 0 1 0 0 6.8M7.5 10.8h5.2M7.5 13.2h5.2"/>';
  const ago = t => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : `il y a ${Math.floor(m / 60)} h${m % 60 ? " " + String(m % 60).padStart(2, "0") : ""}`; };
  function box() {
    let b = document.getElementById("pdBox");
    if (!b) { b = document.createElement("div"); b.id = "pdBox"; b.className = "pds"; b.setAttribute("role", "status"); b.setAttribute("aria-live", "polite"); document.body.appendChild(b);
      // les petites notifications du site passent sous les cartes, jamais dessus
      const fit = () => document.documentElement.style.setProperty("--pd-h", b.children.length ? b.offsetHeight + 8 + "px" : "0px");
      try { new ResizeObserver(fit).observe(b); } catch (e) {} new MutationObserver(fit).observe(b, { childList: true }); }
    return b;
  }
  // deux notes claires, discrètes (rien si le son du site est coupé)
  function chime() { try { const c = window.SND && SND.unlock && SND.unlock(); if (!c || c.state !== "running") return; const t = c.currentTime + .02;
    [[1318.5, 0], [1975.5, .11]].forEach(([f, d]) => { const o = c.createOscillator(), g = c.createGain(); o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(.0001, t + d); g.gain.exponentialRampToValueAtTime(.05, t + d + .02); g.gain.exponentialRampToValueAtTime(.0001, t + d + .6); o.connect(g); g.connect(c.destination); o.start(t + d); o.stop(t + d + .65); }); } catch (e) {} }
  // le bouton : dans la messagerie, la conversation s'ouvre sur place ; ailleurs, on y va
  function open(it) {
    if (it.open) { let ev = null; try { ev = new CustomEvent("paid:open", { detail: it.open, cancelable: true }); } catch (e) {} if (ev && !window.dispatchEvent(ev)) return; }
    go(it.url);
  }
  function card(it) {
    const n = document.createElement("div"); n.className = "pd"; n.dataset.id = it.id;
    n.innerHTML = `<span class="pd-ic">${svg(COIN, 20)}</span>
      <div class="pd-tx"><b>${esc(it.title)}</b><small>${esc(it.sub)} · ${ago(it.at)}</small></div>
      <button type="button" class="pd-x" aria-label="Fermer">${svg('<path d="M6 6l12 12M18 6 6 18"/>', 13, 2.4)}</button>
      <button type="button" class="pd-go">${esc(it.btn)}${svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 14, 2.4)}</button><span class="pd-l"><i></i></span>`;
    let left = LIFE, since = Date.now(), tm = null;
    const bye = () => { clearTimeout(tm); n.classList.add("out"); setTimeout(() => n.remove(), 320); };
    const run = () => { since = Date.now(); tm = setTimeout(bye, left); n.classList.remove("hold"); };
    n.onmouseenter = () => { clearTimeout(tm); left = Math.max(4000, left - (Date.now() - since)); n.classList.add("hold"); };
    n.onmouseleave = run;
    n.querySelector(".pd-x").onclick = bye;
    n.querySelector(".pd-go").onclick = () => { bye(); open(it); };
    n.style.setProperty("--life", LIFE + "ms"); run(); return n;
  }
  async function poll() {
    if (busy || document.hidden) return; busy = true;
    try {
      const d = await api("/api/paid/new"), L = (d.items || []).filter(x => !done.has(x.id)); if (!L.length) return;
      L.forEach(x => done.add(x.id));
      const b = box(), show = L.slice(0, MAX).reverse(); show.forEach(it => b.appendChild(card(it)));
      while (b.querySelectorAll(".pd").length > MAX) b.querySelector(".pd").remove();
      if (L.length > MAX) notify(`${L.length - MAX} autre${L.length - MAX > 1 ? "s" : ""} achat${L.length - MAX > 1 ? "s" : ""} pendant ton absence`, "Retrouve-les dans tes ventes", "info");
      chime();
      api("/api/paid/seen", { body: { ids: L.map(x => x.id) } }).catch(() => {});
    } catch (e) {} finally { busy = false; }
  }
  function mount() {
    if (timer) return; setTimeout(poll, 1500); timer = setInterval(poll, 20e3);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
    // une notification d'achat vient d'arriver pendant que le site est ouvert : la carte s'affiche tout de suite
    try { navigator.serviceWorker && navigator.serviceWorker.addEventListener("message", e => { if (e.data && e.data.paid) poll(); }); } catch (e) {}
  }
  return { mount, poll };
})();
