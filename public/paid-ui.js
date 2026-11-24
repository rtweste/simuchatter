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
      chime(); hoPoll();
      api("/api/paid/seen", { body: { ids: L.map(x => x.id) } }).catch(() => {});
    } catch (e) {} finally { busy = false; }
  }
  // ---- « À reprendre » : les fans qui viennent de payer avec l'IA (ou des acheteurs qu'elle a croisés), à reprendre par un chatter ----
  const FLAME = '<path d="M12 3c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0c0-1 .3-1.8.8-2.5C6.5 10.5 5 12.6 5 15a7 7 0 0 0 14 0c0-5-4.5-7.5-7-12z"/>';
  let hoBusy = false, hoItems = [], hoOpen = false;
  function hoBox() { let b = document.getElementById("hoBox");
    if (!b) { b = document.createElement("div"); b.id = "hoBox"; b.className = "ho"; b.innerHTML = `<button type="button" class="ho-pill" aria-expanded="false">${svg(FLAME, 16)}<b></b></button><div class="ho-pan" hidden><div class="ho-hd"><b>À reprendre</b><small>Ils ont payé : à toi de jouer. Dès que tu écris à un fan, l'IA ne lui répond plus.</small></div><div class="ho-ls"></div></div>`;
      document.body.appendChild(b);
      b.querySelector(".ho-pill").onclick = () => { hoOpen = !hoOpen; hoDraw(); };
      document.addEventListener("click", e => { if (hoOpen && !b.contains(e.target)) { hoOpen = false; hoDraw(); } });
      document.addEventListener("keydown", e => { if (e.key === "Escape" && hoOpen) { hoOpen = false; hoDraw(); } }); }
    return b; }
  function hoDraw() { const b = hoBox(), n = hoItems.length; b.hidden = !n; if (!n) { hoOpen = false; }
    const pill = b.querySelector(".ho-pill"), pan = b.querySelector(".ho-pan"); pill.querySelector("b").textContent = `${n} à reprendre`; pill.setAttribute("aria-expanded", hoOpen ? "true" : "false"); pill.classList.toggle("hot", hoItems.some(x => x.fresh)); pan.hidden = !hoOpen; if (!hoOpen) return;
    pan.querySelector(".ho-ls").innerHTML = hoItems.map(x => { const B = x.brief || {}, more = [B.resume, B.gouts && "Il aime : " + B.gouts, B.etat && "Où ça en est : " + B.etat].filter(Boolean);
      return `<div class="ho-it${x.fresh ? " fresh" : ""}" data-id="${x.id}"><div class="ho-tp"><b>${esc(x.fan)}${B.prenom && B.prenom.toLowerCase() !== String(x.fan).toLowerCase() ? " <i>(" + esc(B.prenom) + ")</i>" : ""}</b><small>${esc(x.creator)} · ${ago(x.at)}</small></div>
        <p class="ho-why">${esc(x.reason)}${x.spend ? " · " + x.spend + " € dépensés chez elle" : ""}</p>${more.length ? `<p class="ho-br">${more.map(esc).join("<br>")}</p>` : ""}
        <div class="ho-bt"><button type="button" class="ho-take">Je le prends${svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 14, 2.4)}</button><button type="button" class="ho-see">Voir la conversation</button></div></div>`; }).join("");
    pan.querySelectorAll(".ho-it").forEach(n => { const it = hoItems.find(x => String(x.id) === n.dataset.id); if (!it) return;
      n.querySelector(".ho-see").onclick = () => { hoOpen = false; hoDraw(); open(it); };
      n.querySelector(".ho-take").onclick = async () => { try { await api("/api/tri/take", { body: { id: it.id } }); } catch (e) {} hoItems = hoItems.filter(x => x.id !== it.id); hoOpen = false; hoDraw(); open(it); }; }); }
  async function hoPoll() { if (hoBusy || document.hidden) return; hoBusy = true;
    try { const d = await api("/api/tri/handoff"); hoItems = d.items || []; hoDraw(); } catch (e) {} finally { hoBusy = false; } }
  function mount() {
    if (timer) return; setTimeout(poll, 1500); timer = setInterval(poll, 20e3); setTimeout(hoPoll, 2500); setInterval(hoPoll, 60e3);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) hoPoll(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
    // une notification d'achat vient d'arriver pendant que le site est ouvert : la carte s'affiche tout de suite
    try { navigator.serviceWorker && navigator.serviceWorker.addEventListener("message", e => { if (e.data && e.data.paid) poll(); }); } catch (e) {}
  }
  return { mount, poll, hoPoll };
})();
