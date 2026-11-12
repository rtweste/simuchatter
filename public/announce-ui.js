// Annonces importantes (bandeau sur l'accueil) et urgentes (écran bloquant) pour les chatters
window.ANNOUNCE = (() => {
  let items = [], ACTIVE = "", timer = null, busy = false, ov = null;
  const AV = ["#9be8c6,#5fd3a2", "#d7c4ff,#b388ff", "#bfe6ff,#7dd3fc", "#ffc2d0,#ff7a9c", "#c8f7c5,#7bd389", "#ffe9a6,#ffd23f"];
  const ago = t => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.floor(m / 60)} h` : `le ${new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`; };
  const fmtB = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
  const MEGA = '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>';
  const svg = (p, s = 20, w = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const seen = () => { try { return JSON.parse(localStorage.getItem("stAnnN") || "{}"); } catch (e) { return {}; } };
  const mark = (id, t) => { try { const s = seen(); s[id] = t; Object.keys(s).forEach(k => { if (Date.now() - s[k] > 20 * 864e5) delete s[k]; }); localStorage.setItem("stAnnN", JSON.stringify(s)); } catch (e) {} };
  function push(it) {
    notify(it.level === "urgent" ? "Annonce urgente" : "Annonce importante", `${it.author} : ${it.body.slice(0, 90)}`, "info");
    try { if (window.Notification && Notification.permission === "granted" && navigator.serviceWorker)
      navigator.serviceWorker.ready.then(r => r.showNotification(it.level === "urgent" ? "Annonce urgente · StellADS" : "Annonce importante · StellADS", { body: `${it.author} : ${it.body.slice(0, 140)}`, icon: "/icon-192.png", badge: "/icon-192.png", tag: "ann" + it.id, data: { url: "/home" } })).catch(() => {}); } catch (e) {}
  }
  async function poll() {
    if (busy) return; let d; try { d = await api("/api/announcements/pending"); } catch (e) { return; }
    items = d.items || [];
    const s = seen();
    items.forEach(it => { const last = s[it.id] || 0; if (!last || (it.remind_at && it.remind_at > last)) { mark(it.id, Date.now()); if (it.level !== "urgent" && ACTIVE !== "home") push(it); else if (it.level === "urgent") push(it); } });
    render();
  }
  async function ack(it) {
    busy = true; try { await api(`/api/chat/m/${it.id}/ack`, { body: {} }); } catch (e) { busy = false; notify("Impossible", e.message || "Réessaie", "err"); return false; }
    items = items.filter(x => x.id !== it.id); busy = false; render(); return true;
  }
  function render() {
    const urg = items.find(x => x.level === "urgent");
    if (urg) showUrgent(urg); else if (ov) { ov.classList.remove("on"); const o = ov; ov = null; setTimeout(() => o.remove(), 400); document.documentElement.style.overflow = ""; }
    if (ACTIVE === "home") banner(items.filter(x => x.level === "important"));
  }
  /* ---------- bandeau (accueil) ---------- */
  function banner(list) {
    let b = document.querySelector(".anb"); const hm = document.getElementById("hm"); if (!hm) return;
    if (!list.length) { if (b) { b.classList.add("out"); setTimeout(() => b.remove(), 450); } return; }
    const it = list[0], fresh = !b;
    if (!b) { b = document.createElement("section"); b.className = "anb"; b.setAttribute("aria-label", "Annonce importante"); b.setAttribute("aria-live", "polite"); hm.parentNode.insertBefore(b, document.querySelector(".wrx,.chx") || hm); }
    if (b.dataset.id === String(it.id) && b.dataset.n === String(list.length)) return;
    b.dataset.id = it.id; b.dataset.n = list.length;
    b.innerHTML = `<div class="anb-ic"><i></i><span>${svg(MEGA, 24, 2.1)}</span>${list.length > 1 ? `<em>${list.length}</em>` : ""}</div>
      <div class="anb-tx"><div class="anb-k"><b>ANNONCE IMPORTANTE</b><span>#informations</span><i></i><span class="anb-by"><span class="anb-av">${esc((it.author || "?")[0].toUpperCase())}</span>${esc(it.author)} · manager · ${ago(it.created_at)}</span></div>
        <p>${fmtB(it.body)}</p>
        <div class="anb-r"><span class="anb-avs">${it.readers.map((r, i) => `<span style="background:linear-gradient(135deg,${AV[i % AV.length]})">${esc(r[0].toUpperCase())}</span>`).join("")}</span><span>Lu par <b>${it.reads} sur ${it.of}</b>${list.length > 1 ? ` · ${list.length - 1} autre${list.length > 2 ? "s" : ""} annonce${list.length > 2 ? "s" : ""} non lue${list.length > 2 ? "s" : ""}` : ""}</span></div></div>
      <div class="anb-bt"><button type="button" class="anb-ok">${svg('<path d="M5 12.5 10 17.5 19 7"/>', 16, 3)}J'ai lu</button><a href="/chat?c=${it.channel_id}">Ouvrir dans le chat</a></div>`;
    if (!fresh) { b.classList.remove("swap"); void b.offsetWidth; b.classList.add("swap"); }
    b.querySelector(".anb-ok").onclick = async e => { const bt = e.currentTarget; bt.disabled = true; bt.classList.add("done"); if (!(await ack(it))) bt.disabled = false; };
  }
  /* ---------- écran bloquant (urgent) ---------- */
  function showUrgent(it) {
    if (ov && ov.dataset.id === String(it.id)) return;
    if (!ov) { ov = document.createElement("div"); ov.className = "anu"; ov.setAttribute("role", "alertdialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-labelledby", "anuT"); document.body.appendChild(ov); requestAnimationFrame(() => ov.classList.add("on")); }
    document.documentElement.style.overflow = "hidden";
    ov.dataset.id = it.id;
    ov.innerHTML = `<div class="anu-c"><div class="anu-ic"><i></i><i></i><span>${svg('<path d="M12 3 2 20h20z"/><path d="M12 9v5M12 17h.01"/>', 60, 1.8)}</span></div>
      <div class="anu-k">ANNONCE URGENTE</div><h2 id="anuT">Message de <em>${esc(it.author)}</em></h2>
      <div class="anu-m"><div class="anu-by"><span class="anb-av">${esc((it.author || "?")[0].toUpperCase())}</span><div><b>${esc(it.author)} · manager</b><small>#informations · ${ago(it.created_at)}</small></div></div><p>${fmtB(it.body)}</p></div>
      <div class="anu-f"><small>Pour continuer à utiliser StellADS, confirme que tu as lu.</small>
        <button type="button" class="anu-hold"><span class="anu-fill"></span><span class="anu-l">Maintiens pour confirmer : j'ai lu et compris</span></button>
        <small class="anu-n">Ta confirmation est visible par les managers.</small></div></div>`;
    const bt = ov.querySelector(".anu-hold"), fill = ov.querySelector(".anu-fill"), HOLD = 1100; let t0 = 0, raf = 0, done = false;
    const stop = () => { if (done) return; cancelAnimationFrame(raf); t0 = 0; fill.style.transition = "width .3s"; fill.style.width = "0%"; };
    const step = () => { const p = Math.min(1, (performance.now() - t0) / HOLD); fill.style.width = p * 100 + "%";
      if (p >= 1) { done = true; bt.classList.add("ok"); ov.querySelector(".anu-l").textContent = "Merci, c'est noté ✓"; try { navigator.vibrate && navigator.vibrate(30); } catch (e) {} setTimeout(() => ack(it), 450); return; } raf = requestAnimationFrame(step); };
    const start = e => { if (done || t0) return; e.preventDefault(); fill.style.transition = "none"; t0 = performance.now(); raf = requestAnimationFrame(step); };
    bt.addEventListener("pointerdown", start); ["pointerup", "pointerleave", "pointercancel"].forEach(ev => bt.addEventListener(ev, stop));
    bt.addEventListener("keydown", e => { if ((e.key === " " || e.key === "Enter") && !e.repeat) start(e); }); bt.addEventListener("keyup", e => { if (e.key === " " || e.key === "Enter") stop(); });
    bt.addEventListener("contextmenu", e => e.preventDefault());
    setTimeout(() => bt.focus({ preventScroll: true }), 300);
  }
  function mount(me, active) {
    if (!me || me.role !== "chatter" || timer) return; ACTIVE = active;
    poll(); timer = setInterval(() => { if (!document.hidden) poll(); }, 30e3);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  }
  return { mount, poll };
})();
