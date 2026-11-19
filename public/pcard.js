// Carte de profil (aperçu sur Mon profil + fenêtre qui s'ouvre en touchant un nom dans le chat)
window.PCARD = (() => {
  const e = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SV = (d, s = 16, w = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const dur = ms => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };
  const day = d => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  // le shift : en cours, en pause, prochain, ou aucun
  function shift(s) {
    if (!s || s.state === "none") return `<div class="pc-sh none"><i></i><span>Pas de shift prévu</span></div>`;
    if (s.state === "on") return `<div class="pc-sh on"><i></i><span><b>En shift sur ${e(s.model)}</b>${s.reinforce ? " · renfort" : ""} · depuis ${dur(Date.now() - s.since)}</span></div>`;
    if (s.state === "pause") return `<div class="pc-sh pause"><i></i><span><b>En pause</b> · shift sur ${e(s.model)}</span></div>`;
    return `<div class="pc-sh next"><i></i><span><b>Prochain shift</b> · ${s.today ? "aujourd'hui" : e(day(s.date))} · ${e(s.start)} → ${e(s.end)} · ${e(s.model)}</span></div>`;
  }
  function html(c, o = {}) {
    const av = c.avatar ? `<span style="background-image:url(${e(c.avatar)})"></span>` : `<span>${e((c.name || "?")[0].toUpperCase())}</span>`;
    const tags = (c.models || []).map(m => `<em>${e(m)}</em>`).join("");
    return `<div class="pcd"${c.id ? ` data-uid="${c.id}"` : ""} style="--ac:${e(c.color || "#b8a4ff")}"><div class="pc-ban"><i></i><i></i><i></i></div>
      <div class="pc-av${c.avatar ? " ph" : ""}">${av}${c.shift && c.shift.state === "on" ? '<b class="dot" aria-label="En shift"></b>' : ""}</div>
      <div class="pc-b"><h3><span data-pcn>${e(c.name)}</span><small>${e((c.roleLabel || "").toUpperCase())}</small></h3><div class="pc-hd">@${e(c.username)}${c.team ? ` · Équipe de ${e(c.team)}` : ""}</div>
        <p class="pc-bio${c.bio ? "" : " ph"}" data-pcb>${c.bio ? e(c.bio) : "Ajoute une phrase d'accroche…"}</p>
        ${c.motm && c.motm.length ? `<div class="pc-motm" style="display:inline-flex;align-items:center;gap:7px;margin:0 0 10px;padding:5px 11px 5px 8px;border-radius:999px;background:linear-gradient(120deg,rgba(255,210,63,.16),rgba(255,154,61,.1));border:1px solid rgba(255,210,63,.4);color:#ffe08a;font:800 11.5px Inter,system-ui,sans-serif"><span style="font-size:14px">🏅</span>Coéquipier du mois${c.motm.length > 1 ? ` ×${c.motm.length}` : ""} · ${e(new Date(c.motm[0] + "-15T12:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" }))}</div>` : ""}
        ${shift(c.shift)}
        ${tags ? `<div class="pc-tags">${tags}</div>` : ""}
        ${o.stats === false ? "" : `<div class="pc-st"><div><small>VENTES · 15 J</small><b>${c.sales || 0}</b></div><div><small>ANCIENNETÉ</small><b>${c.months || 0}<span> mois</span></b></div><div><small>DÉFIS GAGNÉS</small><b>${c.wins || 0}</b></div></div>`}
        ${o.actions || ""}</div></div>`;
  }
  // fenêtre au-dessus du chat : une seule à la fois, même si on clique vite plusieurs fois
  let pop = null, cur = 0, seq = 0;
  async function open(uid, anchor, opts = {}) {
    if (pop && cur === uid) return close();          // re-toucher le même nom referme la carte
    close(); const my = ++seq; cur = uid; let c;
    try { c = await api(`/api/users/${uid}/card`); } catch (er) { return; }
    if (my !== seq) return;                            // un autre clic est arrivé entre-temps
    document.querySelectorAll(".pc-pop").forEach(x => x.remove());
    pop = document.createElement("div"); pop.className = "pc-pop"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Profil de " + c.name);
    const acts = opts.dm && !opts.self ? `<div class="pc-act"><button type="button" data-dm>Message privé</button></div>` : "";
    pop.innerHTML = html(c, { actions: acts }) + `<button type="button" class="pc-x" aria-label="Fermer">✕</button>`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect(), w = Math.min(340, innerWidth - 24), h = pop.offsetHeight;
    let x = r.left, y = r.bottom + 8; if (x + w > innerWidth - 12) x = innerWidth - 12 - w; if (y + h > innerHeight - 12) y = Math.max(12, r.top - h - 8);
    Object.assign(pop.style, { left: x + "px", top: y + "px", width: w + "px" });
    const me = pop; requestAnimationFrame(() => me.isConnected && me.classList.add("on"));
    pop.querySelector(".pc-x").onclick = close;
    const dm = pop.querySelector("[data-dm]"); if (dm) dm.onclick = () => { close(); opts.dm(c); };
    setTimeout(() => { if (pop !== me) return; window.addEventListener("pointerdown", outside, true); window.addEventListener("keydown", esc_, true); addEventListener("resize", close); }, 0);
  }
  const outside = ev => { if (pop && !pop.contains(ev.target) && !(ev.target.closest && ev.target.closest(`[data-uid="${cur}"]`))) close(); };
  const esc_ = ev => { if (ev.key === "Escape") close(); };
  function close() { seq++; window.removeEventListener("pointerdown", outside, true); window.removeEventListener("keydown", esc_, true); removeEventListener("resize", close);
    if (!pop) return; const p = pop; pop = null; cur = 0; p.classList.remove("on"); setTimeout(() => p.remove(), 250); }
  return { html, shift, open, close };
})();
