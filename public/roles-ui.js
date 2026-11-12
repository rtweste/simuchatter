// Gestion › Rôles et équipes : organigramme, équipes des Team Leaders (glisser-déposer), nominations, « qui fait quoi »
window.ROLESUI = (() => {
  const SV = (d, s = 18, w = 1.8) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"></path></svg>`;
  const P = { crown: "M3 8l4 4 5-7 5 7 4-4-2 11H5z", lock: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z", user: "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5",
    users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c.6-3.6 3-5.5 6-5.5s5.4 1.9 6 5.5M16 4.5a3.2 3.2 0 0 1 0 6.2M17.5 14.6c2 .5 3.2 2.3 3.5 5.4", headset: "M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H4zM17 15h3v5h-3z",
    shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z", grad: "M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5", grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01", plus: "M12 5v14M5 12h14", check: "M5 12.5l4.5 4.5L19 7.5", table: "M3 5h18v14H3zM3 10h18M9 5v14" };
  const I = (k, s, w) => SV(P[k], s, w);
  const N = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const E0 = n => Math.round(n || 0).toLocaleString("fr-FR") + " €";
  const LBL = { founder: "Fondateur", manager: "Manager", assistant: "Assistante", tl: "Team Leader", chatter: "Chatter", trainee: "Élève" };
  const CLS = { founder: "f", manager: "m", assistant: "a", tl: "t", chatter: "c", trainee: "e" };
  const rb = (rk, txt) => `<span class="rb ${CLS[rk]}">${rk === "founder" ? I("crown", 11, 2.4) : ""}${esc(txt || LBL[rk])}</span>`;
  let D = null, host = null, sel = null, pick = null, team = null, dragId = null, mxOpen = false;
  const me = () => D.me.rk, canEdit = () => ["founder", "manager"].includes(me());
  const P0 = id => D.people.find(p => p.id === +id);
  const q = s => (/data-r(dr|scrim)/.test(s) ? document : host).querySelector(s), qa = s => [...host.querySelectorAll(s)];
  const say = (t, g) => { const el = document.getElementById("toast"); if (!el) return; el.innerHTML = (g ? "✓ " : "") + t; el.classList.toggle("g", !!g); el.classList.add("on"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), 3000); };

  function orgCard() {
    const f = D.people.filter(p => p.rk === "founder"), m = D.people.filter(p => p.rk === "manager"), a = D.people.filter(p => p.rk === "assistant");
    const node = (p, cls = "") => `<div class="on2 ${cls}${p.id === D.me.id ? " me2" : ""}" data-n="${p.id}" role="button" tabindex="0"><span class="av">${esc(p.username[0].toUpperCase())}</span><div><b>${esc(N(p.username))}${p.id === D.me.id ? " · toi" : ""}</b>${rb(p.rk)}</div></div>`;
    const l2 = [...m, ...a], k = l2.length;
    const wires = k ? `<div class="wires"><svg data-wires></svg></div>` : "";
    return `<div class="card"><div class="ch"><h3>L’<em>encadrement</em></h3><span class="mut">Seul le Fondateur nomme les managers · Fondateur et managers nomment les Team Leaders et les Assistantes</span></div>
      <div class="org"><div class="lvl">${f.map(p => node(p, "fd")).join("")}</div>${wires}<div class="lvl l2">${l2.map(p => node(p)).join("") || '<span class="mut">Aucun manager ni assistante pour l’instant</span>'}</div></div></div>`;
  }
  const mb = p => `<div class="mb${sel === p.id ? " sel" : ""}" ${canEdit() ? 'draggable="true"' : ""} data-id="${p.id}" role="button" tabindex="0"><span class="gr">${canEdit() ? I("grip", 14, 2.6) : ""}</span><span class="av">${esc(p.username[0].toUpperCase())}</span><span style="min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(N(p.username))}</span>${rb(p.rk)}</div>`;
  function teamsBoard() {
    const free = D.people.filter(p => p.rk === "chatter" && !D.teams.some(t => t.id === p.team));
    const cols = D.teams.map((t, i) => { const mem = t.members.map(P0).filter(Boolean);
      return `<div class="tc" data-team="${t.id}" style="animation-delay:${(.06 + i * .05).toFixed(2)}s"><div class="th2"><span class="av">${esc(t.username[0].toUpperCase())}</span><div style="min-width:0"><b>Équipe ${esc(N(t.username))}</b><small>${rb("tl", "Team Leader")}</small></div><span class="ct">${mem.length}</span></div>
        <div class="tk"><span>CA 7 jours<b>${E0(t.ca7)}</b></span><span>Ponctualité<b>${t.punct == null ? "—" : t.punct + " %"}</b></span></div>
        ${mem.map(mb).join("")}<div class="hint">${canEdit() ? "Glisse un membre ici" : "Aucun autre membre"}</div><a class="sb" href="/equipe?tl=${t.id}" style="display:flex;align-items:center;justify-content:center;text-decoration:none;margin-top:6px">Voir son espace Mon équipe</a></div>`; }).join("");
    const none = `<div class="tc none" data-team="0"><div class="th2"><span class="av" style="border-style:dashed;box-shadow:none;border-color:#3a3a3a">${I("user", 16)}</span><div><b>Sans équipe</b><small>Leurs alertes vont aux managers seulement</small></div><span class="ct">${free.length}</span></div>${free.map(mb).join("")}<div class="hint">${canEdit() ? "Glisse un membre ici pour le retirer de son équipe" : ""}</div></div>`;
    const add = canEdit() ? `<div class="tc add" role="button" tabindex="0" data-add><span class="pl">${I("plus", 18, 2.2)}</span><span>Nomme un chatter Team Leader pour créer une équipe</span></div>` : "";
    return `<div class="teams" style="--cols:${Math.min(4, D.teams.length + 1 + (add ? 1 : 0))}">${cols}${none}${add}</div>`;
  }
  function logRow() {
    if (!D.log.length) return "";
    return `<div class="jr"><span class="lab">DERNIÈRES NOMINATIONS</span>${D.log.slice(0, 3).map(l => `<span><b>${esc(N(l.by_name || "?"))}</b> a nommé <b>${esc(N(l.user_name || "?"))}</b> ${rb(l.to_rk)} · ${new Date(l.at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>`).join("")}</div>`;
  }
  /* ---------- qui fait quoi ---------- */
  const ROLES = [["Fondateur", "#ffd23f", "crown"], ["Manager", "#ededed", "shield"], ["Assistante", "#b8a4ff", "headset"], ["Team Leader", "#5fd3a2", "users"], ["Chatter", "#9a9a9a", "user"]];
  const ROWS = [["ÉQUIPE ET RÔLES"], ["Nommer ou retirer un manager", "F", "-", "-", "-", "-"], ["Nommer Team Leaders et Assistantes", "y", "y", "-", "-", "-"], ["Rattacher les chatters à un Team Leader", "y", "y", "-", "-", "-"], ["Fiches de l’équipe", "y", "y", "Lecture", "Son équipe", "-"],
    ["ARGENT"], ["CA, ventes et paies", "y", "y", "Sans la marge", "Ventes de son équipe", "Les siennes"], ["Marge de l’agence", "y", "y", "-", "-", "-"], ["Primes et ajustements de paie", "y", "y", "y", "-", "-"], ["Paliers de commission", "F", "Lecture", "-", "-", "-"], ["Part des créatrices", "F", "Lecture", "-", "-", "-"], ["Clôturer la paie et les périodes", "F", "-", "-", "-", "-"],
    ["OPÉRATIONS"], ["Salle de contrôle", "y", "y", "-", "-", "-"], ["Valider les ventes · Studio · Défis", "y", "y", "-", "-", "-"], ["Planning et remplacements", "y", "y", "y", "Demander un renfort", "Ses shifts"], ["Cloche d’alertes", "y", "y", "y", "Son équipe", "-"],
    ["COMMUNICATION"], ["Annonces dans #informations · modération du chat", "y", "y", "y", "-", "-"], ["COACHING"], ["Espace Mon équipe", "Via Gestion", "Via Gestion", "-", "y", "-"], ["Conseils et entraînements", "y", "y", "-", "Son équipe", "-"], ["Prime quand une recrue atteint le 1er palier", "-", "-", "-", "y", "-"]];
  const cell = (v, i) => `<span data-c="${i}">${v === "y" ? `<span class="ck2">${I("check", 13, 3.2)}</span>` : v === "-" ? '<span class="no2"></span>' : v === "F" ? `<span class="fo2">${I("crown", 10, 2.4)}Seul</span>` : `<span class="pt2">${esc(v)}</span>`}</span>`;
  function matrix() {
    return `<div class="card" data-mxcard style="margin-top:14px"><div class="ch"><h3>Qui fait <em>quoi</em></h3><div class="rps">${ROLES.map((r, i) => `<button class="rp2" data-ri="${i}" style="--rc:${r[1]}"><span class="ic">${I(r[2], 17)}</span>${r[0]}</button>`).join("")}</div></div>
      <div class="mx" style="overflow-x:auto"><div style="min-width:760px;position:relative"><span class="band"></span><div class="mrow h"><span></span>${ROLES.map(r => `<span>${r[0].toUpperCase()}</span>`).join("")}</div>
      ${ROWS.map(r => r.length === 1 ? `<div class="mrow g"><span>${r[0]}</span><span></span><span></span><span></span><span></span><span></span></div>` : `<div class="mrow"><span>${esc(r[0])}${r[1] === "F" ? ` <span class="fo2">${I("crown", 10, 2.4)}Fondateur seul</span>` : ""}</span>${r.slice(1).map(cell).join("")}</div>`).join("")}<div style="height:8px"></div></div></div></div>`;
  }
  function bindMatrix() {
    const card = q("[data-mxcard]"); if (!card) return; const band = card.querySelector(".band"), pills = [...card.querySelectorAll(".rp2")];
    const pk = i => { pills.forEach((p, k) => p.classList.toggle("on", k === i)); card.style.setProperty("--rc", ROLES[i][1]); const th = card.querySelector(".mrow.h").children[i + 1]; band.style.left = th.offsetLeft + "px"; band.style.width = th.offsetWidth + "px"; card.querySelectorAll("[data-c]").forEach(c => c.classList.toggle("hl", c.dataset.c === String(i))); };
    pills.forEach((p, i) => p.addEventListener("click", () => pk(i))); setTimeout(() => pk({ founder: 0, manager: 1, assistant: 2 }[me()] ?? 1), 60);
  }
  /* ---------- rendu ---------- */
  function render() {
    host.innerHTML = `<div class="bar" style="margin-bottom:12px"><span class="mut">${canEdit() ? "Glisse un membre d’une équipe à l’autre, ou touche-le pour changer son rôle." : "Lecture seule : seuls le Fondateur et les managers modifient les rôles."}</span><button class="gbtn" data-mx>${I("table", 15)}${mxOpen ? "Masquer" : "Voir"} qui fait quoi</button></div>
      ${orgCard()}${teamsBoard()}${logRow()}${mxOpen ? matrix() : ""}`;
    // tiroir hors de l'onglet (l'animation de l'onglet décalerait un élément « fixed »)
    const ge = document.getElementById("root") || document.body;
    if (!document.querySelector("[data-rdr]")) ge.insertAdjacentHTML("beforeend", '<div class="scrim" data-rscrim></div><div class="drawer rl" data-rdr role="dialog" aria-modal="true" aria-label="Rôle et équipe"></div>');
    bind(); if (mxOpen) bindMatrix(); wires();
  }
  // traits de l'organigramme : mesurés sur la position réelle des cartes
  function wires() {
    const sv = q("[data-wires]"); if (!sv) return; const org = sv.closest(".org"), w = sv.parentElement, f = org.querySelector(".lvl .on2"); if (!f) return;
    const ob = w.getBoundingClientRect(), fx = f.getBoundingClientRect(), W = Math.max(1, ob.width), cx = fx.left + fx.width / 2 - ob.left;
    const xs = [...org.querySelectorAll(".lvl.l2 .on2")].map(n => { const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2 - ob.left, row: Math.round(r.top) }; });
    const top = xs.length ? Math.min(...xs.map(x => x.row)) : 0;
    sv.setAttribute("viewBox", `0 0 ${W.toFixed(0)} 34`); sv.setAttribute("width", W.toFixed(0)); sv.setAttribute("height", 34);
    sv.innerHTML = xs.filter(x => x.row === top).map(x => `<path class="gd" pathLength="1" d="M${cx.toFixed(1)} 0 V16 H${x.x.toFixed(1)} V34"/>`).join("");
  }
  addEventListener("resize", () => { if (host && D) wires(); });
  function bind() {
    q("[data-mx]").addEventListener("click", () => { mxOpen = !mxOpen; render(); if (mxOpen) setTimeout(() => q("[data-mxcard]")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80); });
    qa(".mb").forEach(m => { m.addEventListener("click", () => openDr(+m.dataset.id)); m.addEventListener("keydown", e => { if (e.key === "Enter") openDr(+m.dataset.id); }); });
    qa(".on2[data-n]").forEach(n => n.addEventListener("click", () => { const p = P0(n.dataset.n); if (!p) return;
      if (p.rk === "founder") return say("Le rôle de Fondateur ne peut pas être changé");
      if (p.id === D.me.id) return say("Tu ne peux pas changer ton propre rôle");
      if (p.rk === "manager" && me() !== "founder") { n.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }], { duration: 400 }); return say("Seul le Fondateur peut modifier un manager"); }
      openDr(p.id); }));
    q("[data-add]")?.addEventListener("click", () => say("Touche un chatter puis choisis « Team Leader » : son équipe apparaît ici"));
    const sc = q("[data-rscrim]"); if (!sc.dataset.b) { sc.dataset.b = 1; sc.addEventListener("click", close); }
    if (!canEdit()) return;
    qa(".mb").forEach(m => { m.addEventListener("dragstart", e => { dragId = +m.dataset.id; m.classList.add("drag"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", m.dataset.id); } catch (x) {} });
      m.addEventListener("dragend", () => { m.classList.remove("drag"); qa(".tc").forEach(c => c.classList.remove("ovr")); }); });
    qa(".tc[data-team]").forEach(c => { c.addEventListener("dragover", e => { if (!dragId) return; e.preventDefault(); c.classList.add("ovr"); });
      c.addEventListener("dragleave", e => { if (!c.contains(e.relatedTarget)) c.classList.remove("ovr"); });
      c.addEventListener("drop", async e => { e.preventDefault(); c.classList.remove("ovr"); const id = dragId; dragId = null; const p = P0(id), to = +c.dataset.team || null; if (!p || (p.team || null) === to) return;
        const el = q(`.mb[data-id="${id}"]`), hint = c.querySelector(".hint"); if (el && hint) { c.insertBefore(el, hint); el.classList.remove("land"); el.getBoundingClientRect(); el.classList.add("land"); }
        try { await api("/api/admin/roles/" + id, { body: { team: to } }); const t = D.teams.find(x => x.id === to); say(t ? `${esc(N(p.username))} rejoint l’équipe de ${esc(N(t.username))}` : `${esc(N(p.username))} n’a plus d’équipe`, true); await load(true); }
        catch (x) { say(esc(x.message)); await load(true); } }); });
  }
  /* ---------- tiroir rôle ---------- */
  const EXPL = { chatter: "Garde son espace habituel : shifts, ventes et paie.", trainee: "Accès au Simu Chatter et à la formation. Pour qu’il devienne chatter, valide sa formation dans l’onglet Équipe.",
    tl: "<b>Reste chatter</b> (shifts, ventes, paie) et reçoit l’espace <b>Mon équipe</b> :<ul><li>ventes, shifts, pauses et formation de son équipe</li><li>les alertes de ses chatters seulement</li><li>conseils, entraînements et demandes de renfort</li><li>__PRIME__</li></ul>",
    assistant: "Planning et remplacements, annonces dans #informations, modération du chat, cloche d’alertes, fiches en lecture, paies et primes <b>sans la marge</b>. Pas de salle de contrôle, de validation des ventes, de Studio ni de défis.",
    manager: "Accès complet, sauf les réglages du Fondateur : paliers de commission, part des créatrices et clôture des périodes." };
  const RC = [["chatter", "Chatter", "Shifts, ventes et paie", "user", "#bdbdbd"], ["tl", "Team Leader", "Chatter + espace Mon équipe", "users", "#5fd3a2"], ["assistant", "Assistante", "Planning, annonces, paies sans marge", "headset", "#b8a4ff"], ["manager", "Manager", "Tout, sauf les réglages du Fondateur", "shield", "#ededed"]];
  function close() { q("[data-rdr]")?.classList.remove("on"); q("[data-rscrim]")?.classList.remove("on"); sel = null; qa(".mb").forEach(m => m.classList.remove("sel")); }
  function openDr(id) {
    const p = P0(id); if (!p) return; sel = id; pick = p.rk; team = p.team || null; qa(".mb").forEach(m => m.classList.toggle("sel", +m.dataset.id === id));
    const dr = q("[data-rdr]"), tr = p.rk === "trainee", ro = !canEdit() || p.id === D.me.id;
    const lockM = me() !== "founder";
    dr.innerHTML = `<div class="dh"><span class="av">${esc(p.username[0].toUpperCase())}</span><div><b>${esc(N(p.username))} ${rb(p.rk)}</b><small>${tr ? "En formation" : "Membre"} depuis le ${new Date(p.since).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}${p.ca7 ? ` · ${E0(p.ca7)} sur 7 jours` : ""}</small></div><button class="x" aria-label="Fermer">✕</button></div>
      ${tr ? "" : `<div class="sec"><span class="lab">RÔLE</span><div class="rcs">${RC.map(([k, l, d, ic, c]) => `<button class="rc${k === "manager" ? " full" : ""}${(k === "manager" || p.rk === "manager") && lockM ? " lk" : ""}" data-r="${k}" style="--rc:${c}" ${ro ? "disabled" : ""}><span class="ic">${I(ic, 17)}</span><b>${l}</b><small>${d}</small>${(k === "manager" || p.rk === "manager") && lockM ? `<span class="lkb">${I("lock", 15, 2)}</span>` : ""}</button>`).join("")}</div>
        <div class="lkmsg">${I("lock", 15, 2)}<span>Seul le <b>Fondateur</b> peut nommer ou retirer un manager.</span></div></div>`}
      <div class="expl"></div>
      <div class="sec tsec"><span class="lab">RATTACHÉ À</span><div class="tlo">${D.teams.filter(t => t.id !== p.id).map(t => `<button data-team="${t.id}" ${ro ? "disabled" : ""}><span class="av">${esc(t.username[0].toUpperCase())}</span>Équipe ${esc(N(t.username))}<small>${t.members.length} membre${t.members.length > 1 ? "s" : ""}</small></button>`).join("")}<button data-team="0" ${ro ? "disabled" : ""}><span class="av">${I("user", 14)}</span>Aucune équipe<small>alertes aux managers</small></button></div>
        ${D.teams.length ? "" : '<div class="mut" style="margin-top:8px">Aucun Team Leader pour l’instant.</div>'}</div>
      ${ro ? "" : '<button class="send cfm"><span>Enregistrer</span><i class="fx"></i></button>'}`;
    dr.querySelector(".x").addEventListener("click", close);
    dr.querySelectorAll(".rc").forEach(c => c.addEventListener("click", () => { if (c.classList.contains("lk")) { c.classList.remove("shake"); c.getBoundingClientRect(); c.classList.add("shake"); dr.querySelector(".lkmsg").classList.add("on"); return; } pick = c.dataset.r; paint(); }));
    dr.querySelectorAll(".tlo button").forEach(b => b.addEventListener("click", () => { team = +b.dataset.team || null; paint(); }));
    dr.querySelector(".cfm")?.addEventListener("click", save);
    paint(); dr.classList.add("on"); q("[data-rscrim]").classList.add("on");
  }
  function paint() {
    const dr = q("[data-rdr]"), p = P0(sel); if (!p) return;
    dr.querySelectorAll(".rc").forEach(c => c.classList.toggle("on", c.dataset.r === pick));
    dr.querySelector(".expl").innerHTML = (EXPL[pick] || "").replace("__PRIME__", `une prime de ${E0(D.prime)} quand une recrue atteint ${E0(D.target)} de ventes nettes sur une quinzaine`);
    dr.querySelector(".tsec").style.display = pick === "chatter" ? "" : "none";
    dr.querySelectorAll(".tlo button").forEach(b => b.classList.toggle("on", (+b.dataset.team || null) === team));
    const cf = dr.querySelector(".cfm span"); if (!cf) return;
    cf.textContent = pick !== p.rk ? (pick === "tl" ? "Nommer Team Leader" : pick === "assistant" ? "Nommer Assistante" : pick === "manager" ? "Nommer Manager" : "Repasser chatter") : (team !== (p.team || null) ? (team ? "Changer d’équipe" : "Retirer de son équipe") : "Enregistrer");
  }
  async function save() {
    const p = P0(sel), b = q("[data-rdr] .cfm"); if (!p) return;
    if (pick === p.rk && team === (p.team || null)) return close();
    if (pick === "manager" && !confirm(`Nommer ${N(p.username)} manager ? Il aura accès à tout, sauf à tes réglages de Fondateur.`)) return;
    if (p.rk === "tl" && pick !== "tl" && !confirm(`${N(p.username)} n’est plus Team Leader : les membres de son équipe passent « sans équipe ».`)) return;
    b.disabled = true; b.classList.remove("go"); b.getBoundingClientRect(); b.classList.add("go");
    try { await api("/api/admin/roles/" + p.id, { body: { to: pick, team } });
      say(pick !== p.rk ? `${esc(N(p.username))} est maintenant ${LBL[pick]}${pick === "tl" ? " · glisse des chatters dans son équipe" : ""}${["assistant", "manager", "chatter"].includes(pick) && (p.rk === "assistant" || p.rk === "manager" || pick !== "chatter") ? "" : ""}` : team ? `${esc(N(p.username))} change d’équipe` : `${esc(N(p.username))} n’a plus d’équipe`, true);
      close(); await load(true);
      const t = pick === "tl" ? q(`.tc[data-team="${p.id}"]`) : null; if (t) { t.classList.add("new"); t.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
    } catch (e) { say(esc(e.message)); b.disabled = false; }
  }
  async function load(silent) {
    host = document.getElementById("rolesRoot"); if (!host) return;
    try { D = await api("/api/admin/roles"); render(); } catch (e) { if (!silent) host.innerHTML = `<div class="emp">${esc(e.message)}</div>`; }
  }
  return { load, open: id => { const go = () => openDr(+id); D ? go() : load().then(go); } };
})();
