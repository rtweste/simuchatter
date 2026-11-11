// Gestion (manager) : équipe, créatrices, réglages, journal et sanctions
const GE = (() => {
const root = $("root"), q = s => root.querySelector(s), qa = s => [...root.querySelectorAll(s)];
const E = n => n == null || isNaN(n) ? "—" : (Math.round(n * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: Math.abs(n % 1) > .004 ? 2 : 0, maximumFractionDigits: 2 }) + " €";
const num = v => { const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
const dShort = ms => new Date(ms).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const hm = ms => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const PER = (() => { const d = new Date(), m = MONTHS[d.getMonth()], last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); return d.getDate() <= 15 ? `1 – 15 ${m}` : `16 – ${last} ${m}`; })();
const dayLbl = (d, ms) => { const t = new Date(), y = new Date(Date.now() - 864e5), same = (a, b) => a.toDateString() === b.toDateString();
  return same(d, t) ? "AUJOURD'HUI" : same(d, y) ? "HIER" : dShort(ms).toUpperCase(); };
const genPw = () => { const w = ["lune", "rose", "nova", "ciel", "jade", "opal", "vega", "luna", "zest", "miel", "aube", "iris", "sable", "perle"]; const r = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  return w[r(w.length)] + "-" + w[r(w.length)] + "-" + (10 + r(89)); };
async function copy(t) { try { await navigator.clipboard.writeText(t); return true; } catch (e) {
  const a = document.createElement("textarea"); a.value = t; a.style.position = "fixed"; a.style.opacity = "0"; document.body.appendChild(a); a.select(); let ok = false; try { ok = document.execCommand("copy"); } catch (x) {} a.remove(); return ok; } }

/* ----- sons discrets ----- */
const S = (() => {
  let c = null, o = null;
  const on = () => { try { return localStorage.getItem("stSound") !== "0"; } catch (e) { return true; } };
  const ac = () => { if (!on()) return null; try { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
    if (!c) { c = new C(); o = c.createGain(); o.gain.value = .14; o.connect(c.destination); if (window.stAudio) stAudio.add(c); }
    if (c.state !== "running") c.resume().catch(() => {}); return c; } catch (e) { return null; } };
  const tone = (f, at, len, peak, type) => { const os = c.createOscillator(), g = c.createGain(); os.type = type || "sine"; os.frequency.setValueAtTime(f, at);
    g.gain.setValueAtTime(.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + .015); g.gain.exponentialRampToValueAtTime(.0001, at + len); os.connect(g); g.connect(o); os.start(at); os.stop(at + len + .05); };
  const run = f => { const x = ac(); if (x) try { f(x.currentTime + .02); } catch (e) {} };
  return { tick: () => run(t => tone(2637, t, .05, .025, "triangle")), ok: () => run(t => [1318.5, 1975.5, 2637].forEach((f, i) => tone(f, t + i * .06, .7 - i * .15, .08 - i * .02))),
    open: () => run(t => tone(1975.5, t, .22, .03)), warn: () => run(t => { tone(660, t, .18, .06, "triangle"); tone(523, t + .12, .3, .05, "triangle"); }) };
})();
const toast = (t, g) => { const el = $("toast"); el.innerHTML = (g ? "✓ " : "") + t; el.classList.toggle("g", !!g); el.classList.add("on"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), 2800); };
const fail = e => { toast(esc(e.message || "Erreur")); S.warn(); };

/* ----- tiroir / feuille ----- */
const scrim = $("scrim"), dr = $("drawer"), sh = $("sheet");
let onClose = null;
const close = () => { dr.classList.remove("on"); sh.classList.remove("on"); scrim.classList.remove("on"); document.body.style.overflow = ""; const f = onClose; onClose = null; if (f) f(); };
scrim.onclick = close;
document.addEventListener("keydown", e => { if (e.key === "Escape" && scrim.classList.contains("on")) close(); });
const openDr = (html, cb) => { dr.innerHTML = html; dr.classList.add("on"); scrim.classList.add("on"); document.body.style.overflow = "hidden"; dr.scrollTop = 0; dr.querySelector(".x")?.addEventListener("click", close); S.open(); onClose = cb || null; };

/* ----- onglets ----- */
const LOADED = {};
function tab(t) {
  qa(".tabs button").forEach(x => x.classList.toggle("on", x.dataset.t === t)); qa(".pane").forEach(p => p.classList.toggle("on", p.dataset.p === t));
  try { history.replaceState(null, "", "#" + t); } catch (e) {}
  ({ team: loadTeam, crea: loadCrea, reg: loadReg, jour: loadJour, sanc: loadSanc })[t]();
}
qa(".tabs button").forEach(b => b.addEventListener("click", () => { S.tick(); tab(b.dataset.t); }));

/* =================== ÉQUIPE =================== */
let T = null, F = "all";
const avatar = (n, live, cls = "") => `<span class="av ${cls}">${esc((n || "?")[0].toUpperCase())}${live ? '<i class="dot"></i>' : ""}</span>`;
const warnOf = c => c.role === "chatter" && (c.points >= (T?.warnAt || 3) || (c.punctuality != null && c.punctuality < 80));
const CK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const sinceTxt = ms => { const d = Math.floor((Date.now() - ms) / 864e5); return d < 1 ? "aujourd'hui" : d === 1 ? "1 j" : d + " j"; };
// carte d'un stagiaire
function tcard(c, i) {
  const tr = c.training || { done: 0, total: 6, ready: false, stats: {} }, s = tr.stats || {};
  return `<div class="pc${tr.ready ? " ready" : ""}${c.active ? "" : " off"}${c.isNew ? " new" : ""}" data-id="${c.id}" tabindex="0" role="button" style="animation-delay:${.04 + i * .04}s"><div class="r1">${avatar(c.username, false)}<div><b>${esc(c.username)}</b><small>En formation depuis ${sinceTxt(c.created_at)}</small></div>${!c.active ? '<span class="tag w">Désactivé</span>' : tr.ready ? '<span class="tag v"><i></i>Prêt</span>' : '<span class="tag f">En formation</span>'}</div>
    <div class="st"><div><small>SCORE MOYEN</small><b style="color:${s.avg5 >= 70 ? "#5fd3a2" : "#fff"}">${s.avg5 ?? "—"}</b></div><div><small>SESSIONS</small><b>${s.sessions ?? 0}</b></div><div><small>CRITÈRES</small><b>${tr.done} / ${tr.total}</b></div></div>
    <div class="pg"><span class="t"><i style="width:${tr.total ? Math.round(tr.done / tr.total * 100) : 0}%"></i></span><b>${tr.ready ? "Prêt · " : ""}${tr.done} / ${tr.total}</b></div></div>`;
}
const nextTxt = s => { const d = new Date(s.start_ms), today = new Date().toDateString(), tom = new Date(Date.now() + 864e5).toDateString();
  return `${d.toDateString() === today ? "Aujourd'hui" : d.toDateString() === tom ? "Demain" : d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })} ${s.start}–${s.end} · ${s.model}`; };
const hrs = h => { const m = Math.round((h || 0) * 60); return `${Math.floor(m / 60)} h${m % 60 ? " " + String(m % 60).padStart(2, "0") : ""}`; };
function card(c, i) {
  if (c.role === "trainee") return tcard(c, i);
  const st = !c.active ? "Compte désactivé" : c.live ? "En shift · " + c.live : c.next[0] ? "Prochain : " + nextTxt(c.next[0]) : "Pas de shift prévu";
  const tag = !c.active ? '<span class="tag w">Désactivé</span>' : c.suspendedUntil ? '<span class="tag r"><i></i>Suspendu</span>' : warnOf(c) ? '<span class="tag r"><i></i>À surveiller</span>' : c.live ? '<span class="tag v live"><i></i>En shift</span>' : "";
  const pc = c.punctuality;
  return `<div class="pc${c.active ? "" : " off"}${c.isNew ? " new" : ""}" data-id="${c.id}" tabindex="0" role="button" style="animation-delay:${.04 + i * .04}s"><div class="r1">${avatar(c.username, c.live)}<div><b>${esc(c.username)} ${c.role === "admin" ? '<span class="tier">Manager</span>' : `<span class="tier ${c.rate >= 15 ? "top" : ""}">${c.rate} %</span>`}</b><small>${esc(st)}</small></div>${tag}</div>
    <div class="st"><div><small>VENTES NETTES</small><b>${E(c.sales)}</b></div><div><small>PAIE</small><b>${E(c.pay)}</b></div><div><small>PONCTUALITÉ</small><b style="color:${pc == null ? "#fff" : pc >= 90 ? "#5fd3a2" : pc >= 80 ? "#fff" : "#e07a7a"}">${pc == null ? "—" : pc + " %"}</b></div></div>
    <div class="ft"><div class="chips">${c.creators.map(x => `<span>${esc(x.name)}</span>`).join("")}</div><span>${c.points ? `<span class="pts ${c.points >= (T.warnAt || 3) ? "" : "w"}" style="margin-right:6px">${c.points} pt${c.points > 1 ? "s" : ""}</span>` : ""}${hrs(c.hours)}</span></div></div>`;
}
function renderTeam() {
  const k = T.kpis;
  $("teamKpis").innerHTML = (k.trainees && F === "train" ? `<div><small>Chatters actifs</small><b>${k.active}</b></div><div style="animation-delay:.04s"><small>En formation</small><b>${k.trainees}</b></div><div style="animation-delay:.08s"><small>Prêts à valider</small><b style="color:${k.ready ? "#5fd3a2" : "#fff"}">${k.ready}</b></div>`
    : `<div><small>Chatters actifs</small><b>${k.active}</b></div><div style="animation-delay:.04s"><small>En shift maintenant</small><b style="color:${k.live ? "#5fd3a2" : "#fff"}">${k.live}</b></div><div style="animation-delay:.08s"><small>${k.trainees ? "En formation" : "Ponctualité moyenne"}</small><b>${k.trainees ? `${k.trainees}${k.ready ? ` <span style="font-size:13px;color:#5fd3a2">· ${k.ready} prêt${k.ready > 1 ? "s" : ""}</span>` : ""}` : k.punctuality == null ? "—" : k.punctuality + " %"}</b></div>`) +
    `<div style="animation-delay:.12s"><small>Paie · ${PER}</small><b>${E(k.pay)}</b></div>`;
  $("nTrain").textContent = k.trainees || "";
  const L = T.team.filter(c => F === "all" ? c.active : F === "live" ? c.active && c.live : F === "train" ? c.active && c.role === "trainee" : F === "warn" ? c.active && warnOf(c) : !c.active)
    .sort((a, b) => F === "train" ? (b.training?.ready ? 1 : 0) - (a.training?.ready ? 1 : 0) || (b.training?.done || 0) - (a.training?.done || 0) : 0);
  $("teamGrid").innerHTML = L.length ? L.map(card).join("") : '<div class="mut" style="padding:20px 4px">Personne dans ce filtre.</div>';
  T.team.forEach(c => delete c.isNew);
  qa(".pc").forEach(p => { const go = () => fiche(+p.dataset.id); p.addEventListener("click", go); p.addEventListener("keydown", e => { if (e.key === "Enter") go(); }); });
  $("nTeam").textContent = T.team.filter(c => c.active && c.role === "chatter").length;
}
qa("#teamSeg button").forEach(b => b.addEventListener("click", () => { qa("#teamSeg button").forEach(x => x.classList.toggle("on", x === b)); F = b.dataset.v; S.tick(); renderTeam(); }));
async function loadTeam(force) { if (T && !force) return renderTeam(); try { T = await api("/api/admin/team"); renderTeam(); } catch (e) { fail(e); } }

async function fiche(id) {
  let c; try { c = await api("/api/admin/team/" + id); } catch (e) { return fail(e); }
  if (c.role === "trainee") return tfiche(c);
  const isMe = T.me === c.id, since = new Date(c.created_at).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const lateTxt = c.punctuality == null ? "pas encore de shift terminé" : !c.late && !c.absent ? "toujours à l'heure" : [c.late ? `${c.late} retard${c.late > 1 ? "s" : ""} · ${c.lateMin} min` : "", c.absent ? `${c.absent} absence${c.absent > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ");
  const notes = n => `<div class="note"><button class="del" data-del="${n.id}" aria-label="Supprimer la note">✕</button><small>${esc(n.kind || "Remarque")} · ${dShort(n.created_at)}${n.by_name ? " · " + esc(n.by_name) : ""}</small>${esc(n.text)}</div>`;
  const models = T.models;
  openDr(`<div class="dh">${avatar(c.username, c.live)}<div><b>${esc(c.username)} ${c.role === "admin" ? '<span class="tier">Manager</span>' : `<span class="tier ${c.rate >= 15 ? "top" : ""}">${c.rate} %</span>`}</b><small>${c.role === "admin" ? "Manager" : "Chatter"} · dans l'équipe depuis ${since}</small></div><button class="x" aria-label="Fermer">✕</button></div>
    ${c.suspendedUntil ? `<div class="susp"><span>Shifts suspendus jusqu'au <b>${dShort(c.suspendedUntil)}</b> (${c.points} points)</span><button class="sb" data-a="unsusp">Lever</button></div>` : ""}
    <div class="dk"><div><small>Ventes nettes · ${PER}</small><b>${E(c.sales)}</b><em>${c.salesCount} vente${c.salesCount > 1 ? "s" : ""} validée${c.salesCount > 1 ? "s" : ""}</em></div><div><small>Paie de la quinzaine</small><b style="color:#5fd3a2">${E(c.pay)}</b><em>${c.paid ? "Payée le " + dShort(c.paid.at) : "À payer"}</em></div>
      <div><small>Ponctualité</small><b>${c.punctuality == null ? "—" : c.punctuality + " %"}</b><em>${lateTxt}</em></div><div><small>Heures pointées</small><b>${hrs(c.hours)}</b><em>${c.renfortHours ? "+ " + hrs(c.renfortHours) + " en renfort" : "aucun renfort"}</em></div></div>
    <div class="sec"><span class="lab">PROCHAINS SHIFTS</span>${c.next.length ? c.next.map(s => `<div class="ln"><span>${esc(nextTxt(s).split(" · ")[0].replace(/ \d\d:\d\d–\d\d:\d\d$/, ""))}</span><b>${s.start}–${s.end} · ${esc(s.model)}</b></div>`).join("") : '<div class="mut">Aucun shift prévu. Ajoute-en depuis le Planning.</div>'}</div>
    <div class="sec"><span class="lab">CRÉATRICES HABITUELLES · TOUCHE POUR CHANGER</span><div class="pick" data-crea>${models.map(m => `<button class="${c.creators.some(x => x.id === m.id) ? "on" : ""}" data-m="${m.id}">${esc(m.name)}</button>`).join("")}</div></div>
    <div class="sec"><div class="simu"><span>${c.simu == null ? "Simu : aucune session terminée" : `Simu : moyenne <b>${c.simu}/100</b> sur ${c.simuN > 1 ? `ses ${c.simuN} dernières sessions` : "sa dernière session"}`}</span><a href="/app#gestion">Voir dans Simu Chatter →</a></div></div>
    <div class="sec"><span class="lab">POINTS DE SANCTION</span><div class="ln"><span>Sur ${T.windowDays || 30} jours glissants</span><b>${c.points} pt${c.points > 1 ? "s" : ""}</b></div>${c.sanctions.filter(s => s.status === "active").slice(0, 3).map(s => `<div class="ln"><span>${esc(s.label)}<br><small class="mut">${dShort(s.created_at)}</small></span><b>${s.amount ? `<span style="color:#e07a7a">−${E(s.amount)}</span>` : `+${s.points} pt`}</b></div>`).join("")}</div>
    ${isMe ? "" : `<div class="sec"><span class="lab">COMPTE</span><div class="acts"><button data-a="pw">Nouveau mot de passe</button><button data-a="role">${c.role === "admin" ? "Repasser chatter" : "Passer manager"}</button><button data-a="copy">Copier l'identifiant</button><button data-a="off" class="r">${c.active ? "Désactiver le compte" : "Réactiver le compte"}</button></div>
      <div class="pw"><code></code><button class="sb" data-a="pwcopy">Copier</button><button class="sb" data-a="pwre" aria-label="Autre mot de passe">↻</button><button class="sb w" data-a="pwset">Valider</button></div></div>`}
    <div class="sec"><span class="lab">NOTES PRIVÉES · VISIBLES PAR LES MANAGERS SEULEMENT</span><div data-notes>${c.notes.map(notes).join("") || '<div class="mut" data-none>Aucune note pour l\'instant.</div>'}</div>
      <div class="nchips"><button class="on">Remarque</button><button>Point fort</button><button>À travailler</button></div><div class="nin"><input placeholder="Ajouter une note sur ${esc(c.username)}…" maxlength="600"><button class="sb w" data-a="note" style="height:40px">Ajouter</button></div></div>`, () => { if (dirtyTeam) { dirtyTeam = false; loadTeam(true); } });
  let dirtyTeam = false;
  const pw = dr.querySelector(".pw");
  dr.querySelectorAll(".nchips button").forEach(b => b.onclick = () => dr.querySelectorAll(".nchips button").forEach(x => x.classList.toggle("on", x === b)));
  dr.querySelectorAll("[data-crea] button").forEach(b => b.onclick = async () => { b.classList.toggle("on"); S.tick();
    try { await api(`/api/admin/team/${c.id}/creators`, { method: "PUT", body: { models: [...dr.querySelectorAll("[data-crea] button.on")].map(x => +x.dataset.m) } }); dirtyTeam = true; } catch (e) { fail(e); } });
  const bindDel = () => dr.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { try { await api("/api/admin/notes/" + b.dataset.del, { method: "DELETE" }); b.closest(".note").remove(); dirtyTeam = true; } catch (e) { fail(e); } });
  bindDel();
  dr.querySelector(".nin input").addEventListener("keydown", e => { if (e.key === "Enter") dr.querySelector('[data-a="note"]').click(); });
  dr.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => {
    const a = b.dataset.a;
    try {
      if (a === "pw" || a === "pwre") { pw.classList.add("on"); pw.querySelector("code").textContent = genPw(); S.tick(); }
      if (a === "pwcopy") { await copy(pw.querySelector("code").textContent); toast("Mot de passe copié", true); }
      if (a === "pwset") { const p = pw.querySelector("code").textContent; await api("/api/admin/users/" + c.id, { method: "PATCH", body: { password: p } }); await copy(`Site : stellads.fr\nIdentifiant : ${c.username}\nMot de passe : ${p}`);
        pw.classList.remove("on"); toast(`Nouveau mot de passe de ${esc(c.username)} enregistré et copié · à lui envoyer`, true); S.ok(); }
      if (a === "copy") { await copy(c.username); toast(`Identifiant « ${esc(c.username)} » copié`, true); }
      if (a === "role") { if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = c.role === "admin" ? "Confirmer : chatter" : "Confirmer : manager"; return; }
        const r = c.role === "admin" ? "chatter" : "admin"; await api("/api/admin/users/" + c.id, { method: "PATCH", body: { role: r } }); toast(`${esc(c.username)} est maintenant ${r === "admin" ? "manager" : "chatter"}`, true); S.ok(); close(); loadTeam(true); }
      if (a === "off") { if (!b.dataset.sure && c.active) { b.dataset.sure = 1; b.textContent = "Confirmer la désactivation"; return; }
        await api("/api/admin/users/" + c.id, { method: "PATCH", body: { active: !c.active } }); toast(c.active ? `Compte de ${esc(c.username)} désactivé · il ne peut plus se connecter` : `Compte de ${esc(c.username)} réactivé`, !c.active); close(); loadTeam(true); }
      if (a === "unsusp") { await api("/api/admin/suspensions/" + c.id, { method: "DELETE" }); b.closest(".susp").remove(); toast("Suspension levée", true); dirtyTeam = true; LOADED.sanc = false; }
      if (a === "note") { const inp = dr.querySelector(".nin input"), t = inp.value.trim(); if (!t) return inp.focus(); const k = dr.querySelector(".nchips button.on").textContent;
        await api(`/api/admin/team/${c.id}/notes`, { body: { kind: k, text: t } }); dr.querySelector("[data-none]")?.remove();
        const f = await api("/api/admin/team/" + c.id); dr.querySelector("[data-notes]").innerHTML = f.notes.map(notes).join(""); dr.querySelector(".note")?.classList.add("new"); bindDel();
        inp.value = ""; toast("Note ajoutée", true); S.ok(); dirtyTeam = true; }
    } catch (e) { fail(e); }
  });
}


/* ----- fiche d'un stagiaire ----- */
function tfiche(c) {
  const tr = c.training, s = tr.stats, notes = n => `<div class="note"><button class="del" data-del="${n.id}" aria-label="Supprimer la note">✕</button><small>${esc(n.kind || "Remarque")} · ${dShort(n.created_at)}${n.by_name ? " · " + esc(n.by_name) : ""}</small>${esc(n.text)}</div>`;
  openDr(`<div class="dh">${avatar(c.username)}<div><b>${esc(c.username)} ${tr.ready ? '<span class="tag v">Prêt</span>' : '<span class="tag f">En formation</span>'}</b><small>En formation depuis ${sinceTxt(c.created_at)}</small></div><button class="x" aria-label="Fermer">✕</button></div>
    <div class="dk"><div><small>Score moyen (5 dern.)</small><b class="${s.avg5 >= 70 ? "g" : ""}" style="${s.avg5 >= 70 ? "color:#5fd3a2" : ""}">${s.avg5 ?? "—"}</b><em>meilleur : ${s.best ?? "—"}</em></div><div><small>Sessions terminées</small><b>${s.sessions}</b><em>dont ${s.hard} difficile${s.hard > 1 ? "s" : ""} réussie${s.hard > 1 ? "s" : ""}</em></div></div>
    <div class="rdy${tr.ready ? "" : " no"}"><span class="ic">${tr.ready ? "✓" : tr.done}</span><span>${tr.ready ? `Les ${tr.total} critères sont remplis. ${esc(c.username)} peut passer chatter.` : `${tr.done} critère${tr.done > 1 ? "s" : ""} sur ${tr.total} rempli${tr.done > 1 ? "s" : ""}.`}</span></div>
    <div class="sec"><span class="lab">CRITÈRES</span>${tr.criteria.map(k => `<div class="tck${k.ok ? " ok" : ""}"><span class="bx">${k.ok ? CK : ""}</span><div>${esc(k.label)}${k.sub ? `<small>${esc(k.sub)}</small>` : ""}</div><span class="v${k.ok ? "" : " no"}">${k.test ? '<span class="ttest">test</span>' : ""}${esc(k.value)}</span></div>`).join("")}</div>
    <button class="valid${tr.ready ? "" : " soft"}" data-a="promote">${tr.ready ? "Valider la formation" : "Valider la formation quand même"}</button>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px"><a class="gbtn" href="/app#gestion" style="text-decoration:none">Assigner un entraînement</a><a class="gbtn" href="/app#gestion" style="text-decoration:none">Voir ses sessions →</a></div>
    <div class="mut" style="margin-top:10px;line-height:1.5">Une fois validée, ${esc(c.username)} voit le planning, les ventes et sa paie. Tu pourras lui ajouter des shifts.</div>
    <div class="sec"><span class="lab">OUTIL DE TEST · VISIBLE PAR TOI SEULEMENT</span><div class="acts">
      <button data-a="tsim"${tr.test ? " disabled" : ""}>Valider le simulateur (test)</button><button data-a="tall"${tr.test === "all" ? " disabled" : ""}>Tout valider (test)</button>
      <button data-a="treset" style="grid-column:span 2">Réinitialiser (test)</button></div>
      <div class="mut" style="margin-top:8px;line-height:1.5">Pour tester le parcours. « Réinitialiser » retire les validations de test, remet les vidéos et la présentation à zéro. Les vraies sessions du simulateur sont conservées.</div></div>
    <div class="sec"><span class="lab">COMPTE</span><div class="acts"><button data-a="pw">Nouveau mot de passe</button><button data-a="copy">Copier l'identifiant</button><button data-a="off" class="r" style="grid-column:span 2">${c.active ? "Désactiver le compte" : "Réactiver le compte"}</button></div>
      <div class="pw"><code></code><button class="sb" data-a="pwcopy">Copier</button><button class="sb" data-a="pwre" aria-label="Autre mot de passe">↻</button><button class="sb w" data-a="pwset">Valider</button></div></div>
    <div class="sec"><span class="lab">NOTES PRIVÉES · VISIBLES PAR LES MANAGERS SEULEMENT</span><div data-notes>${c.notes.map(notes).join("") || '<div class="mut" data-none>Aucune note pour l\'instant.</div>'}</div>
      <div class="nchips"><button class="on">Remarque</button><button>Point fort</button><button>À travailler</button></div><div class="nin"><input placeholder="Ajouter une note sur ${esc(c.username)}…" maxlength="600"><button class="sb w" data-a="note" style="height:40px">Ajouter</button></div></div>`);
  const pw = dr.querySelector(".pw");
  dr.querySelectorAll(".nchips button").forEach(b => b.onclick = () => dr.querySelectorAll(".nchips button").forEach(x => x.classList.toggle("on", x === b)));
  dr.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => {
    const a = b.dataset.a;
    try {
      if (a === "promote") { if (!tr.ready && !b.dataset.sure) { b.dataset.sure = 1; b.textContent = "Confirmer : il n'a pas rempli tous les critères"; return; }
        await api(`/api/admin/users/${c.id}/promote`, { body: {} }); b.classList.remove("soft"); b.classList.add("done"); b.textContent = `✓ ${c.username} est chatter`;
        toast(`${esc(c.username)} est maintenant chatter · il apparaît dans le planning et la paie`, true); S.ok();
        burst(b); setTimeout(() => { close(); loadTeam(true); }, 1300); }
      if (a === "tsim" || a === "tall" || a === "treset") { if (a === "treset" && !b.dataset.sure) { b.dataset.sure = 1; b.textContent = "Confirmer la remise à zéro"; return; }
        await api(`/api/admin/users/${c.id}/training-test`, { body: { mode: { tsim: "sim", tall: "all", treset: "reset" }[a] } });
        toast(a === "treset" ? `Formation de ${esc(c.username)} remise à zéro` : a === "tall" ? `Toute la formation de ${esc(c.username)} est validée (test)` : `Simulateur de ${esc(c.username)} validé (test) : la formation Twizz est débloquée`, true); S.ok();
        close(); loadTeam(true); }
      if (a === "pw" || a === "pwre") { pw.classList.add("on"); pw.querySelector("code").textContent = genPw(); S.tick(); }
      if (a === "pwcopy") { await copy(pw.querySelector("code").textContent); toast("Mot de passe copié", true); }
      if (a === "pwset") { const p = pw.querySelector("code").textContent; await api("/api/admin/users/" + c.id, { method: "PATCH", body: { password: p } }); await copy(`Site : stellads.fr\nIdentifiant : ${c.username}\nMot de passe : ${p}`); pw.classList.remove("on"); toast(`Nouveau mot de passe de ${esc(c.username)} enregistré et copié`, true); }
      if (a === "copy") { await copy(c.username); toast(`Identifiant « ${esc(c.username)} » copié`, true); }
      if (a === "off") { if (!b.dataset.sure && c.active) { b.dataset.sure = 1; b.textContent = "Confirmer la désactivation"; return; }
        await api("/api/admin/users/" + c.id, { method: "PATCH", body: { active: !c.active } }); toast(c.active ? `Compte de ${esc(c.username)} désactivé` : `Compte de ${esc(c.username)} réactivé`, !c.active); close(); loadTeam(true); }
      if (a === "note") { const inp = dr.querySelector(".nin input"), t = inp.value.trim(); if (!t) return inp.focus();
        await api(`/api/admin/team/${c.id}/notes`, { body: { kind: dr.querySelector(".nchips button.on").textContent, text: t } });
        const f = await api("/api/admin/team/" + c.id); dr.querySelector("[data-notes]").innerHTML = f.notes.map(notes).join(""); inp.value = ""; toast("Note ajoutée", true); }
    } catch (e) { fail(e); }
  });
  dr.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { try { await api("/api/admin/notes/" + b.dataset.del, { method: "DELETE" }); b.closest(".note").remove(); } catch (e) { fail(e); } });
}
// petits éclats verts sur le bouton de validation
function burst(el) {
  const r = el.getBoundingClientRect(), box = document.createElement("div"); box.style.cssText = `position:fixed;left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;z-index:95;pointer-events:none`;
  for (let i = 0; i < 22; i++) { const d = document.createElement("i"), a = i / 22 * 6.283, dist = 90 + Math.random() * 90;
    d.style.cssText = `position:absolute;width:8px;height:8px;border-radius:50%;background:#5fd3a2;box-shadow:0 0 10px #5fd3a2;transition:transform .9s cubic-bezier(.2,.8,.2,1),opacity .9s;transform:translate(-4px,-4px)`;
    box.appendChild(d); requestAnimationFrame(() => requestAnimationFrame(() => { d.style.transform = `translate(${Math.cos(a) * dist}px,${Math.sin(a) * dist}px) scale(.3)`; d.style.opacity = 0; })); }
  document.body.appendChild(box); setTimeout(() => box.remove(), 1000);
}
/* ----- ajouter un chatter ----- */
$("addBtn").onclick = async () => {
  if (!T) await loadTeam(true);
  sh.classList.remove("ok"); $("nuName").value = ""; $("nuErr").textContent = ""; $("nuPw").textContent = genPw();
  qa("#nuRole button").forEach(x => x.classList.toggle("on", x.dataset.v === "trainee"));
  $("nuModels").innerHTML = T.models.map(m => `<button data-m="${m.id}">${esc(m.name)}</button>`).join("");
  $("nuModels").querySelectorAll("button").forEach(b => b.onclick = () => { b.classList.toggle("on"); S.tick(); });
  sh.classList.add("on"); scrim.classList.add("on"); S.open(); setTimeout(() => $("nuName").focus(), 300);
};
qa("#nuRole button").forEach(b => b.onclick = () => qa("#nuRole button").forEach(x => x.classList.toggle("on", x === b)));
$("nuRe").onclick = () => { $("nuPw").textContent = genPw(); S.tick(); };
$("nuCp").onclick = async () => { await copy($("nuPw").textContent); toast("Mot de passe copié", true); };
sh.querySelector("[data-x]").onclick = close;
$("nuName").addEventListener("keydown", e => { if (e.key === "Enter") $("nuCreate").click(); });
$("nuCreate").onclick = async () => {
  const id = $("nuName").value.trim().toLowerCase(), pw = $("nuPw").textContent, role = q("#nuRole button.on").dataset.v;
  if (!id) { $("nuErr").textContent = "Choisis un identifiant."; return $("nuName").focus(); }
  $("nuCreate").disabled = true;
  try {
    const r = await api("/api/admin/users", { body: { username: id, password: pw, role, models: qa("#nuModels button.on").map(b => +b.dataset.m) } });
    $("nuCred").innerHTML = `Site : <b>stellads.fr</b><br>Identifiant : <b>${esc(id)}</b><br>Mot de passe : <b>${esc(pw)}</b>`; $("nuCred").dataset.t = `Site : stellads.fr\nIdentifiant : ${id}\nMot de passe : ${pw}`;
    sh.classList.add("ok"); S.ok();
    T = await api("/api/admin/team"); const n = T.team.find(x => x.id === r.id); if (n) n.isNew = true;
    F = "all"; qa("#teamSeg button").forEach(x => x.classList.toggle("on", x.dataset.v === "all")); renderTeam();
  } catch (e) { $("nuErr").textContent = e.message; S.warn(); }
  $("nuCreate").disabled = false;
};
$("nuCredCp").onclick = async () => { await copy($("nuCred").dataset.t); toast("Accès copiés · colle-les dans un message", true); };
$("nuFin").onclick = close;

/* =================== CRÉATRICES =================== */
let CR = null;
function renderCrea() {
  $("nCrea").textContent = CR.creators.length;
  $("creaGrid").innerHTML = CR.creators.map((c, k) => `<div class="cc" data-i="${k}" tabindex="0" role="button" style="animation-delay:${.05 + k * .05}s"><div class="r1">${avatar(c.name)}<div><b>${esc(c.name)}</b><small>${c.creator_pct} % du net reversé</small></div></div>
    <div class="big"><small>CA NET · ${PER.toUpperCase()}</small>${E(c.net)}</div><div class="ft"><div class="chips">${c.chatters.slice(0, 3).map(x => `<span>${esc(x.username)}</span>`).join("") || '<span style="opacity:.6">Aucune vente</span>'}</div><span class="mut">${c.sales} vente${c.sales > 1 ? "s" : ""}</span></div></div>`).join("") || '<div class="mut">Aucune créatrice.</div>';
  qa(".cc").forEach(cc => { const go = () => crea(CR.creators[+cc.dataset.i]); cc.addEventListener("click", go); cc.addEventListener("keydown", e => { if (e.key === "Enter") go(); }); });
}
async function loadCrea(force) { if (CR && !force) return renderCrea(); try { CR = await api("/api/admin/creators"); renderCrea(); } catch (e) { fail(e); } }
$("addCrea").onclick = async () => { if (!CR) await loadCrea(true); crea({ isNew: true, name: "", creator_pct: CR.creatorPct, style: "", prices: "", chatters: [], slots: [] }); };
function crea(c) {
  const mx = Math.max(1, ...c.chatters.map(x => x.amount));
  const slot = s => { const nx = s.end <= s.start; return `<span>${s.start.replace(":00", "")}–${s.end.replace(":00", "")}${nx ? " <sup>+1 j</sup>" : ""}</span>`; };
  openDr(`<div class="dh"><span class="av">${c.isNew ? "+" : esc(c.name[0])}</span><div style="min-width:0;flex:1"><b>${c.isNew ? "Nouvelle créatrice" : esc(c.name)}</b><small>${c.isNew ? "Elle apparaîtra dans la Compta, le Planning et le simulateur" : `Créatrice · ${c.creator_pct} % du net reversé`}</small></div><button class="x" aria-label="Fermer">✕</button></div>
    ${c.isNew ? "" : `<div class="dk"><div><small>CA net · ${PER}</small><b>${E(c.net)}</b><em>chatting + entrées</em></div><div><small>Sa part</small><b style="color:#5fd3a2">${E(c.part)}</b><em>${c.creator_pct} % du net</em></div><div><small>Ventes validées</small><b>${c.sales}</b><em>sur la quinzaine</em></div><div><small>Chatters</small><b>${c.chatters.length}</b><em>${esc(c.chatters.map(x => x.username).join(", ") || "—")}</em></div></div>
    <div class="sec"><span class="lab">VENTES PAR CHATTER</span>${c.chatters.length ? `<div class="bars">${c.chatters.map(x => `<div><span>${esc(x.username)}</span><span class="t"><i data-w="${x.amount / mx * 100}"></i></span><b>${E(x.amount)}</b></div>`).join("")}</div>` : '<div class="mut">Aucune vente validée sur la quinzaine.</div>'}</div>
    <div class="sec"><span class="lab">SES CRÉNEAUX CETTE SEMAINE</span>${c.slots.length ? `<div class="slots">${c.slots.map(slot).join("")}</div>` : '<div class="mut">Aucun shift prévu sur 7 jours.</div>'}</div>`}
    <div class="sec"><span class="lab">NOM</span><input class="fi" data-f="name" value="${esc(c.name)}" placeholder="Nom de la créatrice" maxlength="40"></div>
    <div class="sec"><span class="lab">POURCENTAGE REVERSÉ</span><div class="unit" style="width:max-content"><input data-f="pct" value="${c.creator_pct}" inputmode="decimal"> % du CA net</div></div>
    <div class="sec"><span class="lab">STYLE D'ÉCRITURE ET PERSONNALITÉ</span><textarea class="ta" data-f="style" placeholder="Âge, centres d'intérêt, ton, emojis, tics d'écriture…">${esc(c.style)}</textarea></div>
    <div class="sec"><span class="lab">GRILLE DE PRIX</span><input class="fi" data-f="prices" value="${esc(c.prices)}" placeholder="Photos : 8–15 € · Vidéo : 20–40 €"></div>
    <div class="mut" style="margin-top:8px">Le style et les prix servent aussi au simulateur pour faire jouer cette créatrice.</div>
    <div class="err" data-err></div>
    <button class="send" data-save>${c.isNew ? "Créer la créatrice" : "Enregistrer"}</button>
    ${c.isNew ? "" : '<button class="sb r" data-delc style="width:100%;height:40px;margin-top:10px">Supprimer la créatrice</button>'}`);
  requestAnimationFrame(() => requestAnimationFrame(() => dr.querySelectorAll("[data-w]").forEach(i => i.style.width = i.dataset.w + "%")));
  const f = k => dr.querySelector(`[data-f="${k}"]`).value.trim();
  dr.querySelector("[data-save]").onclick = async () => {
    const pct = num(f("pct")); if (!(pct >= 0 && pct <= 100)) return dr.querySelector("[data-err]").textContent = "Pourcentage entre 0 et 100.";
    try { const r = await api("/api/admin/models", { body: { id: c.id, name: f("name"), style: f("style"), prices: f("prices") } });
      if (pct !== c.creator_pct || c.isNew) await api(`/api/admin/models/${r.id || c.id}/pct`, { method: "PUT", body: { creator_pct: pct } });
      toast(c.isNew ? "Créatrice ajoutée · elle apparaît dans la Compta et le Planning" : `Fiche de ${esc(f("name"))} enregistrée`, true); S.ok(); close(); T = null; loadCrea(true);
    } catch (e) { dr.querySelector("[data-err]").textContent = e.message; S.warn(); }
  };
  const del = dr.querySelector("[data-delc]");
  if (del) del.onclick = async () => { if (!del.dataset.sure) { del.dataset.sure = 1; del.textContent = "Confirmer la suppression"; return; }
    try { await api("/api/admin/models/" + c.id, { method: "DELETE" }); toast(`${esc(c.name)} supprimée`); close(); T = null; loadCrea(true); } catch (e) { fail(e); } };
}

/* =================== RÉGLAGES =================== */
let AG = null, TI = [], SL = [];
const regDirty = () => $("regBar").classList.add("on");
function drawTiers(nw) {
  $("tiers").innerHTML = TI.map((t, k) => `<div class="tr${nw && k === TI.length - 1 ? " new" : ""}"><span class="n">${k + 1}</span><label>DÈS<input data-k="from" value="${t.from}" inputmode="decimal" ${k === 0 ? "disabled" : ""}>€</label>
    <label><button class="sb" data-tg style="height:22px;padding:0 6px;font-size:10px" title="Changer le type">${t.prime ? "PRIME" : "TAUX"}</button><input data-k="${t.prime ? "prime" : "rate"}" value="${t.prime || t.rate}" inputmode="decimal">${t.prime ? "€" : "%"}</label><button class="del" aria-label="Supprimer le palier">✕</button></div>`).join("");
  qa("#tiers .tr").forEach((r, k) => {
    r.querySelectorAll("input").forEach(i => i.addEventListener("input", () => { TI[k][i.dataset.k] = num(i.value) || 0; regDirty(); calc(); }));
    r.querySelector("[data-tg]").onclick = () => { const t = TI[k]; if (t.prime) { t.rate = t.prime > 100 ? 15 : t.prime; delete t.prime; } else { if (k === 0) return toast("Le premier palier doit être un taux"); t.prime = 10; } drawTiers(); regDirty(); calc(); };
    r.querySelector(".del").onclick = () => { if (k === 0) return toast("Le premier palier est obligatoire"); TI.splice(k, 1); drawTiers(); regDirty(); calc(); };
  });
}
$("addTier").onclick = () => { const last = TI[TI.length - 1]; TI.push({ from: last.from + 1000, prime: (last.prime || 0) + 20 }); drawTiers(true); regDirty(); calc(); S.tick(); };
function calc() {
  const v = num($("tryInp").value) || 0, sorted = TI.map(t => ({ ...t })).sort((a, b) => a.from - b.from);
  let cur = 0; sorted.forEach(t => { if (t.prime) t.rate = cur; else cur = t.rate; });
  const rates = []; sorted.forEach(x => { if (!rates.length || rates[rates.length - 1].rate !== x.rate) rates.push({ from: x.from, rate: x.rate }); });
  const cols = ["#3a3a3a", "#555", "#777", "#5fd3a2", "#7fe0b8"]; let com = 0; const parts = [];
  rates.forEach((t, k) => { const to = rates[k + 1] ? rates[k + 1].from : Infinity, p = Math.max(0, Math.min(v, to) - t.from) * t.rate / 100; com += p; if (p) parts.push([p, cols[Math.min(k, 4)]]); });
  const pr = sorted.filter(t => t.prime && v >= t.from).reduce((m, t) => Math.max(m, t.prime), 0); if (pr) parts.push([pr, "#fff"]);
  $("tryRes").textContent = E(com + pr); $("tryDet").textContent = `${E(com)} de commission${pr ? ` + ${E(pr)} de prime` : ""}`;
  $("tryStk").innerHTML = parts.map(p => `<span style="flex:${p[0]};background:${p[1]}"></span>`).join("");
}
$("tryInp").addEventListener("input", calc);
function drawSlots(nw) {
  $("slots").innerHTML = SL.map((s, k) => `<span class="${nw && k === SL.length - 1 ? "new" : ""}">${esc(s[0])}${s[2] <= s[1] ? " <sup>+1 j</sup>" : ""}<button data-k="${k}" aria-label="Retirer ${esc(s[0])}">✕</button></span>`).join("") + '<button class="add" id="slPlus">+ Ajouter un créneau</button>';
  qa("#slots span button").forEach(b => b.onclick = () => { if (SL.length <= 1) return toast("Garde au moins un créneau"); SL.splice(+b.dataset.k, 1); drawSlots(); regDirty(); });
  $("slPlus").onclick = () => { $("slotAdd").classList.add("on"); $("slName").focus(); };
}
$("slNo").onclick = () => $("slotAdd").classList.remove("on");
$("slOk").onclick = () => { const a = $("slA").value, b = $("slB").value; if (!a || !b) return; const lbl = $("slName").value.trim() || `${+a.slice(0, 2)}–${+b.slice(0, 2)}`;
  SL.push([lbl, a, b]); SL.sort((x, y) => x[1].localeCompare(y[1]) || x[2].localeCompare(y[2])); $("slotAdd").classList.remove("on"); $("slName").value = ""; drawSlots(); regDirty(); S.tick(); };
const TRK = [["sessions", "Sessions terminées", "au moins", ""], ["avg", "Score moyen sur les 5 dernières", "au moins", "/100"], ["hard", "Sessions difficiles réussies", "score de 70 ou plus", ""],
  ["fans", "Profils de fans différents réussis", "score de 70 ou plus", ""], ["ethics", "Aucune alerte éthique", "sur les dernières sessions", "sess."], ["rt", "Temps de réponse moyen", "au maximum", "s"]];
function drawTr() {
  const t = AG.training;
  $("trCrit").innerHTML = TRK.map(([k, a, b, u]) => `<div class="set" data-tk="${k}"><span>${a}<small>${b}</small></span><div class="rt"><div class="unit"><input value="${t[k].v}" inputmode="numeric" aria-label="${a}">${u}</div><button class="tg2${t[k].on ? "" : " off"}" aria-label="Activer ce critère"></button></div></div>`).join("")
    + `<div class="set" data-tk="notify"><span>Me prévenir quand un stagiaire est prêt<small>Noté dans le Journal et badge « Prêt » sur sa carte</small></span><button class="tg2${t.notify ? "" : " off"}" aria-label="Prévenir"></button></div>`;
  $("trCrit").querySelectorAll("input").forEach(i => i.addEventListener("input", regDirty));
  $("trCrit").querySelectorAll(".tg2").forEach(b => b.onclick = () => { b.classList.toggle("off"); regDirty(); S.tick(); });
}
function readTr() {
  const o = {}; TRK.forEach(([k]) => { const r = $("trCrit").querySelector(`[data-tk="${k}"]`); o[k] = { v: num(r.querySelector("input").value), on: !r.querySelector(".tg2").classList.contains("off") }; if (k === "hard") o[k].score = AG.training.hard.score; });
  o.notify = !$("trCrit").querySelector('[data-tk="notify"] .tg2').classList.contains("off"); return o;
}
function fillReg() {
  drawTr();
  TI = AG.tiers.map(t => t.prime ? { from: t.from, prime: t.prime } : { from: t.from, rate: t.rate }); SL = AG.slots.map(s => [...s]);
  qa("[data-s]").forEach(i => i.value = String(AG[i.dataset.s] ?? "").replace(".", ","));
  drawTiers(); drawSlots(); calc(); $("regBar").classList.remove("on");
}
qa("[data-s]").forEach(i => i.addEventListener("input", regDirty));
async function loadReg(force) { if (AG && !force) return; try { AG = await api("/api/admin/agency"); fillReg(); } catch (e) { fail(e); } }
$("regCancel").onclick = () => { fillReg(); toast("Modifications annulées"); };
$("regSave").onclick = async () => {
  const sorted = TI.map(t => ({ ...t })).sort((a, b) => a.from - b.from); let cur = 0;
  const tiers = sorted.map(t => { if (!t.prime) cur = t.rate; return { from: t.from, rate: t.prime ? cur : t.rate, prime: t.prime || 0 }; });
  const body = { tiers, slots: SL, training: readTr() }; qa("[data-s]").forEach(i => body[i.dataset.s] = num(i.value));
  try { const r = await api("/api/admin/agency", { method: "PUT", body }); AG = r.agency; fillReg(); toast("Réglages enregistrés · la compta est recalculée", true); S.ok(); T = null; CR = null; }
  catch (e) { fail(e); }
};

/* =================== JOURNAL =================== */
let J = null, JF = "all";
const jIcon = r => { const t = r.text;
  if (r.kind === "v") return t.includes("validé") ? ["#5fd3a2", "✓"] : t.includes("refusé") ? ["#e07a7a", "✕"] : ["#9a9a9a", "↺"];
  if (r.kind === "p") return t.includes("retenue") || t.includes("annulé") || t.includes("supprimé") ? ["#e07a7a", "−"] : t.includes("prime") ? ["#5fd3a2", "+"] : ["#5fd3a2", "€"];
  if (r.kind === "c") return t.includes("clôturé") ? ["#5fd3a2", "🔒"] : t.includes("rouvert") ? ["#e6e6e6", "🔓"] : ["#e6e6e6", "✎"];
  if (r.kind === "pl") return t.includes("renfort") ? ["#9a9a9a", "+"] : t.includes("supprimé") ? ["#e07a7a", "−"] : ["#9a9a9a", "⇄"];
  if (r.kind === "a") return ["#e6e6e6", "●"];
  if (r.kind === "s") return ["#e6e6e6", "⚙"];
  return t.includes("annulé") || t.includes("levé") ? ["#5fd3a2", "↺"] : t.includes("explication") ? ["#e6e6e6", "✉"] : ["#e07a7a", "!"]; };
function renderJour() {
  const s = ($("jourQ").value || "").toLowerCase().trim();
  const L = J.items.filter(r => (JF === "all" || r.kind === JF) && (!s || (r.text + " " + (r.sub || "") + " " + (r.chg ? r.chg.from + " " + r.chg.to : "")).toLowerCase().includes(s)));
  let html = "", last = "", n = 0;
  L.slice(0, 200).forEach(r => { const d = new Date(r.at), lbl = dayLbl(d, r.at); if (lbl !== last) { html += `<div class="jday">${lbl}</div>`; last = lbl; } const [c, ic] = jIcon(r);
    html += `<div class="je" style="--c:${c};animation-delay:${Math.min(.5, .03 * n++)}s"><span class="ic">${ic}</span><div class="t">${md(r.text)}${r.sub ? `<small>${esc(r.sub)}</small>` : ""}${r.chg ? `<span class="chg"><s>${esc(r.chg.from)}</s> → <em>${esc(r.chg.to)}</em></span>` : ""}</div><span class="h">${hm(r.at)}</span></div>`; });
  $("jourList").innerHTML = html || `<div class="mut" style="padding:20px 0">${J.items.length ? "Rien ne correspond." : "Le journal se remplit au fil des actions : ventes, paies, compta, planning, comptes et sanctions."}</div>`;
  const w = J.week;
  $("jourSum").innerHTML = `<div>Ventes validées<b>${w.validated}</b></div><div>Ventes refusées<b>${w.refused}</b></div><div>Paiements<b>${w.payments}</b></div><div>Modifications de la compta<b>${w.compta}</b></div><div>Échanges de shifts<b>${w.swaps}</b></div><div>Sanctions et explications<b>${w.sanctions}</b></div>`;
}
qa("#jourSeg button").forEach(b => b.addEventListener("click", () => { qa("#jourSeg button").forEach(x => x.classList.toggle("on", x === b)); JF = b.dataset.v; S.tick(); renderJour(); }));
$("jourQ").addEventListener("input", () => J && renderJour());
async function loadJour() { try { J = await api("/api/admin/activity"); renderJour(); } catch (e) { fail(e); } }

/* =================== SANCTIONS =================== */
let SA = null;
const KIND = { warn: "Avertissement", fine: "Retenue", prime: "Perte de prime", suspend: "Suspension" };
const ruleTxt = r => r.kind === "fine" ? `Retenue de <b>${E(r.amount)}</b>` : `<b>${KIND[r.kind]}</b>`;
function renderSanc() {
  const k = SA.kpis, th = SA.thresholds;
  $("nTodo").textContent = k.todo || "";
  $("sKpis").innerHTML = `<div><small>À traiter</small><b>${k.todo}</b></div><div style="animation-delay:.04s"><small>Sanctions actives</small><b>${k.active}</b></div><div style="animation-delay:.08s"><small>Retenues · ${PER}</small><b style="color:${k.fines ? "#e07a7a" : "#fff"}">${E(k.fines)}</b></div><div style="animation-delay:.12s"><small>À surveiller</small><b>${k.watch}</b></div>`;
  $("props").innerHTML = SA.props.map((p, i) => { const r = p.rule || {}, light = r.kind !== "warn";
    return `<div class="pr" data-id="${p.id}" style="animation-delay:${.08 + i * .05}s"><div class="r1">${avatar(p.username)}<div><b>${esc(p.username)} · ${esc(r.label || p.rule_key)}</b><small>${esc(p.detail || "")}</small></div><span class="src">${["doublon", "fake"].includes(p.rule_key) ? "VENTES" : "PLANNING"}</span></div>
      <div class="prop"><span>Barème : ${ruleTxt(r)}</span><span class="pts ${r.kind === "fine" ? "" : "w"}">+${r.points} pt${r.points > 1 ? "s" : ""}</span></div>
      <div class="ab"><button class="ap" data-d="apply">Appliquer</button><button data-d="lighten" ${!light && r.points <= 1 ? "disabled style='opacity:.4'" : ""}>${light ? "Alléger" : "Réduire"}</button><button data-d="ignore">Ignorer</button></div></div>`; }).join("");
  $("propsEmpty").classList.toggle("on", !SA.props.length);
  qa("#props .pr").forEach(pr => pr.querySelectorAll("[data-d]").forEach(b => b.onclick = async () => {
    if (b.disabled) return; pr.querySelectorAll("button").forEach(x => x.disabled = true);
    try { const r = await api("/api/admin/sanctions/props/" + pr.dataset.id, { body: { action: b.dataset.d } }); const p = SA.props.find(x => x.id === +pr.dataset.id);
      if (b.dataset.d === "apply") { toast(`${KIND[p.rule.kind]} appliquée à ${esc(p.username)}${p.rule.kind === "fine" ? " · " + E(p.rule.amount) + " retenus sur sa paie" : ""}`, true); S.ok(); }
      else if (b.dataset.d === "lighten") { toast(`Allégée en avertissement pour ${esc(p.username)}`); S.tick(); } else { toast("Proposition ignorée"); S.tick(); }
      pr.classList.add("gone"); await sleep(380);
      if (r.suspendedUntil && b.dataset.d !== "ignore") { toast(`${esc(p.username)} atteint ${r.points} points · shifts suspendus jusqu'au ${dShort(r.suspendedUntil)}`); S.warn(); }
      T = null; await loadSanc(true);
    } catch (e) { fail(e); pr.querySelectorAll("button").forEach(x => x.disabled = false); }
  }));
  $("explCard").style.display = SA.explanations.length ? "" : "none";
  $("expl").innerHTML = SA.explanations.map(s => `<div class="ex" data-id="${s.id}"><div style="display:flex;align-items:center;gap:10px">${avatar(s.username)}<div><b style="font-weight:900;font-size:13.5px">${esc(s.username)} · ${esc(s.label.toLowerCase())}</b><small style="display:block;font-size:11.5px;color:#7a7a7a;font-weight:700">${esc(s.detail || "")}${s.amount ? " · " + E(s.amount) : ""}</small></div></div>
    <q>${esc(s.explanation)}</q><div class="ab" style="grid-template-columns:1fr 1fr"><button class="ap" data-e="cancel">Annuler la sanction</button><button data-e="keep">Maintenir</button></div></div>`).join("");
  qa("#expl .ex").forEach(ex => ex.querySelectorAll("[data-e]").forEach(b => b.onclick = async () => { const s = SA.explanations.find(x => x.id === +ex.dataset.id);
    try { await api(`/api/admin/sanctions/${s.id}/decide`, { body: { decision: b.dataset.e } });
      toast(b.dataset.e === "cancel" ? `Sanction annulée${s.amount ? " · " + E(s.amount) + " rendus à " + esc(s.username) : ""}` : `Sanction maintenue · ${esc(s.username)} est prévenu`, b.dataset.e === "cancel"); S.ok();
      ex.classList.add("gone"); await sleep(380); T = null; loadSanc(true); } catch (e) { fail(e); } }));
  const max = th.suspendAt + 1;
  $("ptsWin").textContent = `Sur ${th.windowDays} jours glissants`;
  $("pbars").innerHTML = SA.points.map(p => `<div class="pb"><span>${esc(p.username)}</span><span class="t"><i data-w="${Math.min(100, p.points / max * 100)}" style="background:${p.points >= th.suspendAt ? "#e07a7a" : p.points >= th.warnAt ? "#e6e6e6" : "#5fd3a2"}"></i><span class="m" style="left:${th.warnAt / max * 100}%"></span><span class="m s" style="left:${th.suspendAt / max * 100}%"></span></span><b>${p.points} pt${p.points > 1 ? "s" : ""}</b></div>`).join("") || '<div class="mut">Aucun chatter actif.</div>';
  $("pleg").innerHTML = `<span><i style="background:#9a9a9a"></i>${th.warnAt} pts : à surveiller</span><span><i style="background:#e07a7a"></i>${th.suspendAt} pts : shifts suspendus ${th.suspendDays} j</span>`;
  $("susps").innerHTML = SA.points.filter(p => p.suspendedUntil).map(p => `<div class="susp"><span><b>${esc(p.username)}</b> · shifts suspendus jusqu'au <b>${dShort(p.suspendedUntil)}</b></span><button class="sb" data-un="${p.id}">Lever</button></div>`).join("");
  qa("#susps [data-un]").forEach(b => b.onclick = async () => { try { await api("/api/admin/suspensions/" + b.dataset.un, { method: "DELETE" }); toast("Suspension levée", true); S.ok(); loadSanc(true); } catch (e) { fail(e); } });
  requestAnimationFrame(() => requestAnimationFrame(() => qa("#pbars [data-w]").forEach(e => e.style.width = e.dataset.w + "%")));
  $("hist").innerHTML = SA.recent.map(s => { const off = s.status !== "active" || s.expired;
    return `<div class="hi${off ? " exp" : ""}">${avatar(s.username, false)}<div><b>${esc(s.username)}</b> · ${esc(s.label)}<small>${dShort(s.created_at)}${s.points ? ` · +${s.points} pt${s.points > 1 ? "s" : ""}` : ""}${s.status === "cancelled" ? " · annulée" : s.expired ? " · expirée" : s.decision === "kept" ? " · maintenue" : s.explanation ? " · explication reçue" : ""}${s.status === "active" && !s.expired ? `<button class="x2" data-cx="${s.id}">Annuler</button>` : ""}</small></div><div class="r">${s.amount ? `<span class="amt" ${off ? 'style="color:#6a6a6a"' : ""}>${E(s.amount)}</span>` : ""}</div></div>`; }).join("") || '<div class="mut">Aucune sanction pour l\'instant.</div>';
  qa("#hist .hi .av").forEach(a => { a.style.cssText = "width:32px;height:32px;border-radius:10px;font-size:13px"; });
  qa("#hist [data-cx]").forEach(b => b.onclick = async () => { if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = "Confirmer l'annulation"; return; }
    try { await api(`/api/admin/sanctions/${b.dataset.cx}/decide`, { body: { decision: "cancel" } }); toast("Sanction annulée", true); S.ok(); T = null; loadSanc(true); } catch (e) { fail(e); } });
  if (!$("barBar").classList.contains("on")) fillBareme();
}
function fillBareme() {
  $("bareme").innerHTML = SA.rules.map(r => `<div class="bar2" data-k="${r.key}"><span>${esc(r.label)}<small>${esc(r.detail)}</small></span><select aria-label="Sanction">${Object.entries(KIND).map(([k, v]) => `<option value="${k}"${k === r.kind ? " selected" : ""}>${v}</option>`).join("")}</select><input data-v="amount" value="${r.kind === "fine" ? r.amount : ""}" placeholder="—" inputmode="decimal" aria-label="Montant" ${r.kind === "fine" ? "" : "disabled"}><input data-v="points" value="${r.points}" inputmode="numeric" aria-label="Points"></div>`).join("");
  qa("[data-th]").forEach(i => i.value = SA.thresholds[i.dataset.th]);
  qa("#bareme select").forEach(s => s.addEventListener("change", () => { const a = s.parentNode.querySelector('[data-v="amount"]'); a.disabled = s.value !== "fine"; if (s.value === "fine" && !a.value) a.value = "10"; if (s.value !== "fine") a.value = ""; }));
  qa("#bareme select, #bareme input, [data-th]").forEach(i => i.addEventListener("input", () => $("barBar").classList.add("on")));
  $("barBar").classList.remove("on");
}
$("barCancel").onclick = () => { fillBareme(); toast("Modifications annulées"); };
$("barSave").onclick = async () => {
  const rules = qa("#bareme .bar2").map(r => ({ key: r.dataset.k, kind: r.querySelector("select").value, amount: num(r.querySelector('[data-v="amount"]').value) || 0, points: num(r.querySelector('[data-v="points"]').value) || 0 }));
  if (rules.some(r => r.kind === "fine" && !r.amount)) return toast("Indique le montant de chaque retenue");
  const thresholds = {}; qa("[data-th]").forEach(i => thresholds[i.dataset.th] = num(i.value));
  if (thresholds.warnAt >= thresholds.suspendAt) return toast("Le seuil « à surveiller » doit être plus bas que la suspension");
  try { await api("/api/admin/agency", { method: "PUT", body: { rules, thresholds } }); $("barBar").classList.remove("on"); toast("Barème enregistré · les chatters le voient sur leur accueil", true); S.ok(); AG = null; loadSanc(true); } catch (e) { fail(e); }
};
async function loadSanc(force) { if (SA && !force && LOADED.sanc) return renderSanc(); try { SA = await api("/api/admin/sanctions"); LOADED.sanc = true; renderSanc(); } catch (e) { fail(e); } }

/* ----- sanction manuelle ----- */
$("manualBtn").onclick = async () => {
  if (!SA) await loadSanc(true);
  openDr(`<div class="dh"><span class="av">!</span><div><b>Sanction <em style="font-style:italic">manuelle</em></b><small>Ajoutée au dossier du chatter et notée au journal</small></div><button class="x" aria-label="Fermer">✕</button></div>
    <div class="mform" style="margin-top:16px">
      <div><span class="lab">CHATTER</span><select data-m="user">${SA.users.map(u => `<option value="${u.id}">${esc(u.username)}</option>`).join("")}</select></div>
      <div><span class="lab">FAUTE</span><select data-m="rule">${SA.rules.map(r => `<option value="${r.key}"${r.key === "rules" ? " selected" : ""}>${esc(r.label)}</option>`).join("")}</select></div>
      <div><span class="lab">PRÉCISION (VISIBLE PAR LE CHATTER)</span><input data-m="detail" maxlength="200" placeholder="ex. Ton insultant avec un fan le 11 nov."></div>
      <div class="two"><div><span class="lab">SANCTION</span><select data-m="kind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div><div><span class="lab">POINTS</span><input data-m="points" inputmode="numeric"></div></div>
      <div data-amt><span class="lab">MONTANT RETENU SUR LA PAIE (€)</span><input data-m="amount" inputmode="decimal"></div>
    </div><div class="err" data-err></div>
    <button class="send" data-go>Appliquer la sanction</button>`);
  const g = k => dr.querySelector(`[data-m="${k}"]`);
  const sync = () => { const r = SA.rules.find(x => x.key === g("rule").value); g("kind").value = r.kind; g("points").value = r.points; g("amount").value = r.kind === "fine" ? r.amount : ""; amt(); };
  const amt = () => dr.querySelector("[data-amt]").style.display = g("kind").value === "fine" ? "" : "none";
  g("rule").onchange = sync; g("kind").onchange = amt; sync();
  dr.querySelector("[data-go]").onclick = async () => {
    try { await api("/api/admin/sanctions", { body: { user_id: +g("user").value, rule_key: g("rule").value, kind: g("kind").value, points: num(g("points").value) || 0, amount: num(g("amount").value) || 0, detail: g("detail").value.trim() || undefined } });
      toast(`Sanction appliquée à ${esc(g("user").selectedOptions[0].textContent)}`, true); S.ok(); close(); T = null; loadSanc(true);
    } catch (e) { dr.querySelector("[data-err]").textContent = e.message; S.warn(); }
  };
};

return { tab, loadSanc };
})();

(async () => {
  const me = await api("/api/me");
  if (me.role !== "admin") { location.href = "/home"; return; }
  renderShell("admin", me);
  const h = (location.hash || "").slice(1);
  GE.tab(["team", "crea", "reg", "jour", "sanc"].includes(h) ? h : "team");
  // compteur « à traiter » visible dès l'ouverture
  if (h !== "sanc") api("/api/admin/sanctions").then(s => { $("nTodo").textContent = s.kpis.todo || ""; }).catch(() => {});
})();
