// Alertes manager : cloche dans le menu (toutes les pages) et bandeau dans la salle de contrôle
window.ALERTS = (() => {
  const KIND = {
    pause: ["#e0a35f", '<path d="M10 9v6M14 9v6"/><circle cx="12" cy="12" r="9"/>'],
    late: ["#ff5c7a", '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>'],
    swap: ["#7dd3fc", '<path d="M7 7h11l-3-3M17 17H6l3 3"/>'],
    help: ["#b388ff", '<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/>'],
    sos: ["#ff5c7a", '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M12 8v4M12 15.5v.01"/>'],
    sales: ["#5fd3a2", '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>'],
    ref: ["#b388ff", '<path d="M20 12v8H4v-8M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>'],
    custom: ["#ffd23f", '<rect x="3" y="5" width="14" height="14" rx="3"/><path d="m17 10 4-2.5v9L17 14"/>'],
  };
  const svg = (p, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const BELL = '<path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/>';
  const ago = t => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : `il y a ${Math.floor(m / 60)} h${m % 60 ? " " + String(m % 60).padStart(2, "0") : ""}`; };
  // masquage temporaire (1 h), propre à chaque navigateur
  const HIDE = "stAlHide";
  const hidden = () => { try { const o = JSON.parse(localStorage.getItem(HIDE) || "{}"), n = Date.now(); Object.keys(o).forEach(k => { if (o[k] < n) delete o[k]; }); return o; } catch (e) { return {}; } };
  const hide = k => { try { const o = hidden(); o[k] = Date.now() + 3.6e6; localStorage.setItem(HIDE, JSON.stringify(o)); } catch (e) {} };
  const seenKeys = new Set(); let first = true, items = [], timer = null;
  const subs = [];
  async function poll() {
    try { const d = await api("/api/admin/alerts"); const h = hidden(); items = (d.items || []).filter(x => !h[x.key]); } catch (e) { return; }
    const fresh = items.filter(x => !seenKeys.has(x.key)); items.forEach(x => seenKeys.add(x.key));
    subs.forEach(f => f(items, first ? [] : fresh)); first = false;
  }
  function start() { if (timer) return; poll(); timer = setInterval(() => { if (!document.hidden) poll(); }, 30e3); document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); }); }
  async function act(a, btn, it) {
    if (a.href) { location.href = a.href; return; }
    btn.disabled = true; btn.classList.add("busy");
    try { await api(a.post, { body: a.body || {} }); notify(a.done || "C'est fait", it.title, "ok"); hide(it.key); await poll(); }
    catch (e) { notify("Impossible", e.message || "Réessaie dans un instant", "err"); btn.disabled = false; btn.classList.remove("busy"); }
  }
  const row = (it, i) => { const [c, ic] = KIND[it.kind] || KIND.sales;
    return `<div class="al-it l${it.lvl}" style="--c:${c};--i:${i}" data-k="${esc(it.key)}"><span class="al-ic">${svg(ic)}</span>
      <div class="al-tx"><b>${esc(it.title)}</b><small>${esc(it.sub || "")}</small><div class="al-ac">${(it.actions || []).map((a, j) => `<button type="button" class="${a.main ? "m" : ""}" data-a="${j}">${esc(a.label)}</button>`).join("")}<span class="al-t">${ago(it.at)}</span></div></div>
      <button class="al-x" type="button" aria-label="Masquer pendant 1 heure" title="Masquer 1 h">${svg('<path d="M6 6l12 12M18 6 6 18"/>', 14)}</button></div>`; };
  function wire(root, list) {
    root.querySelectorAll(".al-it").forEach(el => { const it = list.find(x => x.key === el.dataset.k); if (!it) return;
      el.querySelectorAll("[data-a]").forEach(b => b.onclick = e => { e.stopPropagation(); act(it.actions[+b.dataset.a], b, it); });
      el.querySelector(".al-x").onclick = e => { e.stopPropagation(); hide(it.key); el.classList.add("gone"); setTimeout(() => { items = items.filter(x => x.key !== it.key); subs.forEach(f => f(items, [])); }, 320); }; });
  }

  /* ---------- cloche (menu) ---------- */
  function mountBell() {
    const me = document.querySelector("#sidebar .me"); if (!me || document.querySelector(".al-bell")) return;
    const b = document.createElement("button"); b.type = "button"; b.className = "al-bell"; b.setAttribute("aria-label", "Alertes"); b.title = "Alertes du shift";
    b.innerHTML = `${svg(BELL)}<em class="al-n hidden"></em>`; me.insertBefore(b, me.querySelector("button"));
    const pn = document.createElement("div"); pn.className = "al-pn"; pn.setAttribute("role", "dialog"); pn.setAttribute("aria-label", "Alertes du shift"); document.body.appendChild(pn);
    let open = false;
    const place = () => { const r = b.getBoundingClientRect(), W = innerWidth, H = innerHeight;
      if (W < 760) { pn.style.cssText = `left:10px;right:10px;top:${Math.round(r.bottom + 10)}px;bottom:auto;max-height:${Math.round(H - r.bottom - 100)}px`; pn.dataset.o = "top"; }
      else { pn.style.cssText = `left:${Math.round(r.right + 18)}px;bottom:${Math.max(12, Math.round(H - r.bottom - 8))}px;top:auto;right:auto;max-height:${Math.round(H - 40)}px`; pn.dataset.o = "side"; } };
    const render = () => { const n2 = items.filter(x => x.lvl === 2).length;
      pn.innerHTML = `<div class="al-hd"><div><b>Alertes</b><small><i></i>shift en cours · mis à jour toutes les 30 s</small></div><span class="al-cnt ${n2 ? "r" : ""}">${items.length}</span></div>
        <div class="al-ls">${items.length ? items.map(row).join("") : `<div class="al-ok"><span>${svg('<path d="M5 12.5 10 17.5 19 7"/>', 26)}</span><b>Tout roule</b><small>Aucune alerte pour le shift en cours.</small></div>`}</div>`;
      wire(pn, items); };
    const toggle = v => { open = v ?? !open; if (open) { place(); render(); } pn.classList.toggle("on", open); b.classList.toggle("on", open); b.setAttribute("aria-expanded", open); };
    b.onclick = e => { e.stopPropagation(); toggle(); };
    document.addEventListener("click", e => { if (open && !pn.contains(e.target) && !b.contains(e.target)) toggle(false); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && open) toggle(false); });
    addEventListener("resize", () => { if (open) place(); });
    subs.push((list, fresh) => {
      const n = b.querySelector(".al-n"), n2 = list.some(x => x.lvl === 2);
      n.classList.toggle("hidden", !list.length); n.classList.toggle("r", n2); n.textContent = list.length > 9 ? "9+" : list.length;
      if (fresh.length) { b.classList.remove("ring"); void b.offsetWidth; b.classList.add("ring"); const f = fresh[0]; notify(f.title, f.sub || "", "info"); }
      if (open) render();
    });
    start();
  }

  /* ---------- bandeau (salle de contrôle) ---------- */
  function mountStrip() {
    if (document.querySelector(".al-strip")) return;
    const s = document.createElement("div"); s.className = "al-strip"; s.setAttribute("aria-live", "polite"); document.body.appendChild(s);
    let idx = 0, rot = null;
    const show = () => { if (!items.length) { s.classList.remove("on"); return; } s.classList.add("on");
      const n2 = items.filter(x => x.lvl === 2).length;
      s.innerHTML = `<div class="al-sh"><span class="al-dot ${n2 ? "r" : ""}"></span><b>${items.length} alerte${items.length > 1 ? "s" : ""}</b></div><div class="al-sl">${items.map((it, i) => { const [c, ic] = KIND[it.kind] || KIND.sales;
        return `<div class="al-sc l${it.lvl} ${i === idx % items.length ? "on" : ""}" style="--c:${c}"><span class="al-ic">${svg(ic, 16)}</span><b>${esc(it.title)}</b><small>${esc(it.sub || "")}</small></div>`; }).join("")}</div>
        <div class="al-pg">${items.map((_, i) => `<i class="${i === idx % items.length ? "on" : ""}"></i>`).join("")}</div>`; };
    subs.push((list, fresh) => { if (fresh.length) idx = list.indexOf(fresh[0]); show(); if (fresh.length) { s.classList.remove("ping"); void s.offsetWidth; s.classList.add("ping"); } });
    rot = setInterval(() => { if (items.length > 1) { idx = (idx + 1) % items.length; show(); } }, 6000);
    start();
  }
  return { mountBell, mountStrip, poll, items: () => items };
})();
