// Stella's côté chatter, sur toutes les pages : solde dans le menu et petites notifications quand on gagne ou perd des Stella's
(() => {
  const K = "stl:last", el = document.createElement("div"); el.className = "stt"; document.body.appendChild(el);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = n => Number(n).toLocaleString("fr-FR");
  function pill(b) { document.querySelectorAll("[data-stl-bal]").forEach(x => x.textContent = fmt(b)); document.querySelectorAll('.sidebar a[href="/boutique"]').forEach(a => { let p = a.querySelector(".nav-stl");
    if (!p) { p = document.createElement("span"); p.className = "nav-stl"; a.appendChild(p); } p.innerHTML = `<i class="stc"></i>${fmt(b)}`; }); }
  function toast(t, bal) {
    const d = document.createElement("div"), loss = t.amount < 0; if (loss) d.className = "loss";
    d.innerHTML = loss ? `<span class="cw" style="display:grid;place-items:center;border-radius:12px;background:rgba(240,98,114,.12);color:#ff8a96"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 3l10 18H2zM12 10v4M12 17h.01"/></svg></span><div><b>${fmt(t.amount)} Stella's</b><small>${esc(t.label)}${t.sub ? " · " + esc(t.sub) : ""}</small></div>`
      : `<span class="cw"><i class="stc"></i><em>+${fmt(t.amount)}</em></span><div><b>+${fmt(t.amount)} Stella's</b><small>${esc(t.label)}${t.sub ? " · " + esc(t.sub) : ""}</small></div><span class="ri">${fmt(bal)}</span>`;
    d.onclick = () => location.href = "/cagnotte"; d.style.cursor = "pointer";
    el.appendChild(d); requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add("on")));
    setTimeout(() => { d.classList.add("out"); setTimeout(() => d.remove(), 450); }, 6000);
  }
  // dernier mouvement vu, par compte (plusieurs comptes peuvent passer sur le même navigateur)
  const seen = () => { try { return JSON.parse(localStorage.getItem(K) || "{}") || {}; } catch (e) { return {}; } };
  let UID = null;
  async function tick(first) {
    let r; try { r = await api(`/api/stellas/feed?after=${UID ? seen()[UID] || 0 : 0}`); } catch (e) { return; }
    pill(r.balance); window.STL_BAL = r.balance; if (first) [1500, 4000].forEach(d => setTimeout(() => pill(r.balance), d));
    if (!UID) { UID = r.uid; const was = seen()[UID]; if (was && r.last > was) { try { r = await api(`/api/stellas/feed?after=${was}`); } catch (e) { return; } } else r.items = []; if (!was) r.items = []; }
    r.items.slice(-3).forEach((t, i) => setTimeout(() => toast(t, r.balance), (first ? 1200 : 0) + i * 700));
    try { const m = seen(); m[UID] = r.last; localStorage.setItem(K, JSON.stringify(m)); } catch (e) {}
  }
  window.STLUI = { refresh: () => tick(false), pill };
  setTimeout(() => tick(true), 600); setInterval(() => { if (!document.hidden) tick(false); }, 45e3);
})();
