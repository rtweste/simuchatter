/* =====================================================================
   StellADS — Simu Chatter : onglet Gestion (manager), regarder en direct,
   conseils du manager, entraînements assignés, brouillon du chatter.
   Utilise les fonctions globales de common.js ($, api, esc, notify) et d'app.html.
   ===================================================================== */
const SIMLIVE = window.SIMLIVE = (() => {
  const G = "#5fd3a2", W = "#ededed", R = "#e07a7a";
  const col = v => v >= 70 ? G : v >= 40 ? W : R, iCol = v => v >= 75 ? G : v >= 45 ? W : R, iLab = v => v >= 75 ? "Très intéressé" : v >= 45 ? "Intéressé" : "Distant";
  const DIFF = d => d ? d.charAt(0).toUpperCase() + d.slice(1) : "";
  const ago = t => { if (!t) return "—"; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`; };
  const dur = t => { const s = Math.max(0, Math.floor((Date.now() - t) / 1000)); return s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.floor(s / 60) % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6"/></svg>';
  const ring = v => { const C = 2 * Math.PI * 15; return `<span class="gx-ring"><svg viewBox="0 0 38 38"><circle cx="19" cy="19" r="15" fill="none" stroke="#222" stroke-width="4"/><circle cx="19" cy="19" r="15" fill="none" stroke="${col(v)}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - v / 100)).toFixed(1)}"/></svg><b>${v}</b></span>`; };
  const spark = (vals, c) => { if (!vals || vals.length < 2) return '<span class="gx-mut">—</span>'; const n = vals.length; return `<svg class="gx-sp" viewBox="0 0 90 26" aria-hidden="true"><polyline points="${vals.map((v, i) => `${(i / (n - 1) * 90).toFixed(1)},${(24 - v / 100 * 22).toFixed(1)}`).join(" ")}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`; };
  let ME = null, OV = null, gestTimer = null, watchId = null, watchTimer = null;

  /* ================= onglets ================= */
  function setPane(p) {
    document.querySelectorAll("#simTabs button").forEach(b => { const on = b.dataset.pane === p; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    $("simTabs").classList.toggle("g2", p === "gest");
    $("paneTrain").classList.toggle("hidden", p !== "train"); $("paneGest").classList.toggle("hidden", p !== "gest");
    $("sStats").classList.toggle("hidden", p === "gest"); $("myAssign").classList.toggle("hidden", p === "gest");
    try { sessionStorage.setItem("stSimPane", p); } catch (e) {}
    clearInterval(gestTimer);
    if (p === "gest") { loadGest(true); gestTimer = setInterval(() => { if (!$("homeScreen").classList.contains("hidden") && !$("paneGest").classList.contains("hidden")) loadGest(false); }, 3000); }
  }
  function showGest() { if (ME && ME.role === "admin") setPane("gest"); }

  /* ================= onglet Gestion ================= */
  async function loadGest(full) {
    try { OV = await api("/api/admin/sim/overview"); } catch (e) { if (full) $("paneGest").innerHTML = `<p class="gx-mut">${esc(e.message)}</p>`; return; }
    const lc = $("liveCount"); lc.classList.toggle("hidden", !OV.live.length); lc.querySelector("b").textContent = OV.live.length;
    if (full || !$("gLive")) renderGest(); else { $("gStats").innerHTML = statsHTML(); $("gLive").innerHTML = livesHTML(); bindLive(); }
  }
  const statsHTML = () => { const s = OV.stats, d = (a, b) => a != null && b != null && a !== b ? `<i class="${a > b ? "" : "dn"}">${a > b ? "↑" : "↓"} ${Math.abs(a - b)}</i>` : "";
    return `<div class="gx-stt"><small><span class="dot ${s.live ? "" : "off"}"></span>En simu maintenant</small><b>${s.live}</b></div>
      <div class="gx-stt"><small>Sessions · 7 jours</small><b>${s.sessions7}${d(s.sessions7, s.sessionsPrev)}</b></div>
      <div class="gx-stt"><small>Score moyen équipe</small><b>${s.avg7 ?? "—"}${s.avg7 != null ? "<span>/100</span>" : ""}${d(s.avg7, s.avgPrev)}</b></div>
      <div class="gx-stt"><small>Meilleur score · 7 jours</small><b>${s.best ? `${s.best.score}<span> · ${esc(s.best.user)}</span>` : "—"}</b></div>
      ${s.ai7 ? `<div class="gx-stt" title="Coût de l'IA (fan, coach, évaluation) facturé par Anthropic, en dollars"><small>Coût IA · 7 jours</small><b>$${s.ai7.cost.toFixed(2)}</b><em class="gx-aim">${s.live ? `<span class="gx-ail">● en cours : $${(s.aiLive || 0).toFixed(3)}</span> · ` : ""}${s.ai7.perSession != null ? `~$${s.ai7.perSession.toFixed(3)} / session · ` : ""}30 j : $${s.ai7.month.toFixed(2)}</em></div>` : ""}`; };
  const livesHTML = () => {
    const cards = OV.live.map(l => {
      const pv = l.draft ? `<div class="gx-prev">✍️ ${esc(l.draft)}<span class="car"></span></div>` : l.fanTyping ? `<div class="gx-prev ty">${esc(l.persona)} écrit…</div>` : `<div class="gx-prev">${l.last ? (l.last.who === "fan" ? "💬 " : "↪ ") + esc(l.last.text) : "La conversation commence…"}</div>`;
      return `<div class="gx-live" data-watch="${l.id}"><div class="gx-lt"><span class="gx-av on">${esc(l.user[0].toUpperCase())}</span><div class="gx-nm"><b>${esc(l.user)}</b><small>avec ${esc(l.persona)} · ${esc(l.label)} · ${esc(DIFF(l.difficulty))}</small></div><span class="gx-tm"><span class="dot"></span><span data-since="${l.started_at}">${dur(l.started_at)}</span></span></div>
        ${pv}<div class="gx-mm"><span>Msgs <b>${l.msgs}</b></span><span>Revenu <b>${l.revenue} €</b></span><span title="Coût de l'IA pour cette session, en direct">IA <b class="gx-aic">$${(l.aiCost || 0).toFixed(3)}</b></span><span class="gx-mint">Intérêt<i class="gx-ib"><i style="width:${l.interest}%;background:${iCol(l.interest)}"></i></i></span></div>
        <button class="gx-watchb">${EYE}Regarder en direct</button></div>`; });
    const idle = OV.shifts.map(s => `<div class="gx-live idle"><div class="gx-lt"><span class="gx-av">${esc(s.user[0].toUpperCase())}</span><div class="gx-nm"><b>${esc(s.user)}</b><small>en shift sur ${esc(s.model)} · pas en simu</small></div></div>
        <div class="gx-prev dim">${s.lastAt ? `Dernière simu ${ago(s.lastAt)} · ${s.lastScore}/100` : "Aucune simu terminée"}</div><button class="gx-watchb" data-assign="${s.userId}">Lui assigner un entraînement</button></div>`);
    return cards.length || idle.length ? `<div class="gx-lives">${cards.join("")}${idle.join("")}</div>` : `<p class="gx-empty">Personne n'est en simulation pour l'instant. Les sessions apparaîtront ici dès qu'un chatter en lance une.</p>`;
  };
  function teamHTML() {
    if (!OV.team.length) return `<p class="gx-empty">Aucun chatter pour l'instant.</p>`;
    return `<div class="gx-tb"><div class="gx-tr h"><span>CHATTER</span><span>SESSIONS 7J</span><span>SCORE MOYEN</span><span>MEILLEUR</span><span>PROGRESSION</span><span>DERNIÈRE</span></div>` +
      OV.team.map(t => { const d = t.avg7 != null && t.prevAvg != null ? t.avg7 - t.prevAvg : null;
        return `<div class="gx-tr"><span class="gx-who"><span class="gx-av">${esc(t.name[0].toUpperCase())}</span>${esc(t.name)}</span><span><b>${t.sessions7}</b></span>
          <span>${t.avg7 != null ? `<b>${t.avg7}</b>/100` : "—"} ${d ? `<span class="${d > 0 ? "up" : "dn"}">${d > 0 ? "↑" : "↓"} ${Math.abs(d)}</span>` : ""}</span><span>${t.best ?? "—"}</span>
          <span>${spark(t.trend, t.trend.length > 1 && t.trend[t.trend.length - 1] < t.trend[0] ? R : G)}</span><span class="gx-mut">${ago(t.last)}</span></div>`; }).join("") + `</div>`;
  }
  const recentHTML = () => OV.recent.length ? `<div class="gx-rows">${OV.recent.map(r => `<button class="gx-row" data-rep="${r.id}">${ring(r.score)}<span><b>${esc(r.user)}</b> avec ${esc(r.persona)}<small>${esc(DIFF(r.difficulty))} · ${ago(r.at)}</small></span><span class="gx-pill">Rapport →</span></button>`).join("")}</div>` : `<p class="gx-empty">Aucune session terminée.</p>`;
  const tg = (k, on) => `<button class="gx-tg ${on ? "on" : ""}" data-set="${k}" role="switch" aria-checked="${on}"></button>`;
  const settingsHTML = () => { const s = OV.settings; return `<div class="gx-set">
      <div class="gx-si"><div>Prévenir le chatter quand je regarde<small>Un badge « 👁 regarde ta session » s'affiche chez lui</small></div>${tg("notify", s.notify)}</div>
      <div class="gx-si"><div>Voir ce qu'il tape en direct<small>Avant qu'il envoie son message</small></div>${tg("draft", s.draft)}</div>
      <div class="gx-si"><div>Conseils du manager<small>Sans pénalité de points</small></div>${tg("whisper", s.whisper)}</div>
      <div class="gx-si"><div>Simulations par jour<small>Pour chaque chatter</small></div><span class="gx-step"><button data-lim="-1" aria-label="Moins">−</button><b id="gLim">${s.limit}</b><button data-lim="1" aria-label="Plus">+</button></span></div></div>`; };
  const asgHTML = () => { const a = OV.assignments;
    return (a.length ? `<div class="gx-mis">${a.map(x => { const done = !!x.done_at, st = done ? `<span class="gx-pill g">✓ ${x.best}/100</span>` : x.attempts ? `<span class="gx-pill">meilleur ${x.best ?? 0} · ${x.attempts} essai${x.attempts > 1 ? "s" : ""}</span>` : `<span class="gx-pill">À faire</span>`;
      return `<div class="gx-mi ${done ? "done" : ""}"><span class="gx-av">${esc(x.username[0].toUpperCase())}</span><div><b>${esc(x.username)}</b> · ${esc(x.persona)} · ${esc(DIFF(x.difficulty))}<small>Objectif ${x.goal}${x.due_at ? ` · avant le ${new Date(x.due_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}` : ""}${x.note ? " · " + esc(x.note) : ""}</small></div>${st}<button class="gx-del" data-del="${x.id}" aria-label="Supprimer">✕</button></div>`; }).join("")}</div>` : `<p class="gx-empty">Aucun entraînement assigné.</p>`) +
      `<button class="gx-add" data-assign="">+ Assigner un entraînement</button>`; };
  function renderGest() {
    $("paneGest").innerHTML = `<div class="gx-stats" id="gStats">${statsHTML()}</div>
      <div class="gx-g"><div>
        <section class="gx-card"><div class="gx-hr"><h3><span class="dot"></span>En <em>direct</em></h3><span class="gx-mut">Clique sur une session pour la regarder</span></div><div id="gLive">${livesHTML()}</div></section>
        <section class="gx-card" style="--d:.08s"><div class="gx-hr"><h3>Ton <em>équipe</em></h3><span class="gx-mut">7 derniers jours</span></div>${teamHTML()}</section>
      </div><div>
        <section class="gx-card" style="--d:.05s"><h3>Réglages</h3>${settingsHTML()}</section>
        <section class="gx-card" style="--d:.1s"><h3>Entraînements <em>assignés</em></h3><div id="gAsg">${asgHTML()}</div></section>
        <section class="gx-card" style="--d:.15s" id="gEthCard"><div class="gx-hr"><h3>Alertes <em>éthiques</em></h3><span class="gx-mut">Signalées par l'IA dans les rapports</span></div><div id="gEth"><p class="gx-empty">Chargement…</p></div></section>
      </div></div>
      <section class="gx-card" style="--d:.2s;margin-top:14px"><div class="gx-hr"><h3>Toutes les <em>sessions</em></h3><span class="gx-flt"><select id="gfUser" aria-label="Chatter"><option value="">Tous les chatters</option>${OV.chatters.map(c => `<option value="${c.id}">${esc(c.username)}</option>`).join("")}</select><select id="gfFan" aria-label="Profil de fan"><option value="">Tous les profils</option>${OV.personas.map(p => `<option value="${p.id}">${esc(p.name)} · ${esc(p.label)}</option>`).join("")}</select></span></div><div id="gSess"><p class="gx-empty">Chargement…</p></div></section>`;
    bindLive(); bindStatic(); loadSessions(true);
    $("gfUser").onchange = () => loadSessions(); $("gfFan").onchange = () => loadSessions();
  }
  // liste complète des sessions (filtres chatter / profil) et alertes éthiques
  async function loadSessions(first) {
    const qs = new URLSearchParams(); if ($("gfUser")?.value) qs.set("user", $("gfUser").value); if ($("gfFan")?.value) qs.set("persona", $("gfFan").value);
    let list; try { list = await api("/api/admin/sims?" + qs); } catch (e) { $("gSess").innerHTML = `<p class="gx-empty">${esc(e.message)}</p>`; return; }
    const row = s => `<button class="gx-row" data-rep="${s.id}">${ring(s.score)}<span><b>${esc(s.username)}</b> avec ${esc(s.persona || "")} · ${esc(s.creator_name)}${s.ethics ? ' <span class="gx-pill r">⚠ éthique</span>' : ""}<small>${esc(DIFF(s.difficulty))} · ${s.revenue} € · ${s.avgRt != null ? s.avgRt + " s de réponse · " : ""}${ago(s.started_at)}${s.verdict ? " · " + esc(s.verdict) : ""}</small></span><span class="gx-pill">Rapport →</span></button>`;
    $("gSess").innerHTML = list.length ? `<div class="gx-rows gx-all">${list.slice(0, 60).map(row).join("")}</div>${list.length > 60 ? `<p class="gx-mut" style="margin-top:8px">60 sessions affichées sur ${list.length}. Filtre par chatter pour voir les autres.</p>` : ""}` : `<p class="gx-empty">Aucune session pour ce filtre.</p>`;
    if (first) { const fl = list.filter(s => s.ethics).slice(0, 8);
      $("gEth").innerHTML = fl.length ? `<div class="gx-rows">${fl.map(s => `<button class="gx-row eth" data-rep="${s.id}"><span class="gx-av" style="color:${R}">!</span><span><b>${esc(s.username)}</b> avec ${esc(s.persona || "")}<small style="color:#e9a0a0">${esc(s.ethics)}</small><small>${ago(s.started_at)}</small></span><span class="gx-pill">Voir →</span></button>`).join("")}</div>` : `<p class="gx-empty">Aucune alerte. 👍</p>`; }
    document.querySelectorAll("#gSess [data-rep], #gEth [data-rep]").forEach(b => b.onclick = async () => { try { showReport(await api("/api/sims/" + b.dataset.rep)); } catch (e) { notify("Rapport indisponible", e.message, "err"); } });
  }
  function bindLive() {
    document.querySelectorAll("#gLive [data-watch]").forEach(c => c.onclick = () => openWatch(+c.dataset.watch));
    document.querySelectorAll("#paneGest [data-assign]").forEach(b => b.onclick = e => { e.stopPropagation(); openAssign(b.dataset.assign); });
  }
  function bindStatic() {
    document.querySelectorAll("#paneGest [data-rep]").forEach(b => b.onclick = async () => { try { showReport(await api("/api/sims/" + b.dataset.rep)); } catch (e) { notify("Rapport indisponible", e.message, "err"); } });
    document.querySelectorAll("#paneGest [data-set]").forEach(t => t.onclick = async () => { const on = !t.classList.contains("on"); t.classList.toggle("on", on); t.setAttribute("aria-checked", on);
      try { OV.settings = await api("/api/admin/sim/settings", { method: "PUT", body: { [t.dataset.set]: on } }); } catch (e) { t.classList.toggle("on", !on); notify("Réglage non enregistré", e.message, "err"); } });
    document.querySelectorAll("#paneGest [data-lim]").forEach(b => b.onclick = async () => { const v = Math.max(1, Math.min(50, OV.settings.limit + +b.dataset.lim)); $("gLim").textContent = v; OV.settings.limit = v;
      clearTimeout(bindStatic.t); bindStatic.t = setTimeout(async () => { try { OV.settings = await api("/api/admin/sim/settings", { method: "PUT", body: { limit: v } }); } catch (e) { notify("Réglage non enregistré", e.message, "err"); } }, 500); });
    document.querySelectorAll("#paneGest [data-del]").forEach(b => b.onclick = async () => { if (!confirm("Supprimer cet entraînement ?")) return; await api("/api/admin/assignments/" + b.dataset.del, { method: "DELETE" }).catch(() => {}); loadGest(true); });
  }
  // chronos des cartes « en direct »
  setInterval(() => document.querySelectorAll("#paneGest [data-since]").forEach(e => e.textContent = dur(+e.dataset.since)), 1000);

  /* ================= assigner un entraînement ================= */
  let asgDiff = "normal";
  function openAssign(userId) {
    if (!OV) return;
    $("asgUser").innerHTML = OV.chatters.map(c => `<option value="${c.id}" ${String(c.id) === String(userId) ? "selected" : ""}>${esc(c.username)}</option>`).join("");
    $("asgFan").innerHTML = OV.personas.map(p => `<option value="${p.id}">${esc(p.name)} · ${esc(p.label)}</option>`).join("");
    const d = new Date(Date.now() + 3 * 864e5); $("asgDue").value = d.toISOString().slice(0, 10);
    $("asgErr").textContent = ""; $("asgNote").value = ""; $("asgModal").classList.remove("hidden");
  }
  function bindAssign() {
    $("asgClose").onclick = () => $("asgModal").classList.add("hidden");
    $("asgModal").addEventListener("click", e => { if (e.target === $("asgModal")) $("asgModal").classList.add("hidden"); });
    document.querySelectorAll("#asgDiff button").forEach(b => b.onclick = () => { asgDiff = b.dataset.d; document.querySelectorAll("#asgDiff button").forEach(x => x.classList.toggle("on", x === b)); });
    $("asgSave").onclick = async () => {
      const due = $("asgDue").value ? new Date($("asgDue").value + "T23:59:00").getTime() : null;
      try { await api("/api/admin/assignments", { body: { userId: $("asgUser").value, personaId: $("asgFan").value, difficulty: asgDiff, goal: $("asgGoal").value, dueAt: due, note: $("asgNote").value } });
        $("asgModal").classList.add("hidden"); notify("Entraînement assigné", "Le chatter le verra sur sa page Simu Chatter"); loadGest(true);
      } catch (e) { $("asgErr").textContent = e.message; }
    };
  }

  /* ================= regarder une session ================= */
  const WV = { n: 0, hist: [], ppv: {}, sold: new Set(), sentN: -1 };
  function openWatch(id) {
    watchId = id; Object.assign(WV, { n: 0, hist: [], ppv: {}, sold: new Set(), sentN: -1, last: null, n0done: false, first: false, sim: null, wait: null });
    $("wvMsgs").innerHTML = ""; $("wvSent").innerHTML = '<p class="wv-none">Aucun pour l\'instant.</p>'; $("wvEnd").classList.add("hidden");
    ["homeScreen", "chatScreen", "reportScreen"].forEach(s => $(s).classList.add("hidden")); $("watchScreen").classList.remove("hidden"); window.scrollTo(0, 0);
    clearInterval(gestTimer); clearInterval(watchTimer); pollWatch(); watchTimer = setInterval(pollWatch, 1300);
  }
  function closeWatch() { clearInterval(watchTimer); watchId = null; $("watchScreen").classList.add("hidden"); $("homeScreen").classList.remove("hidden"); setPane("gest"); }
  const bub = (cls, html) => { const d = document.createElement("div"); d.className = "msg " + cls; d.innerHTML = html; return d; };
  function ppvEl(l) {
    const d = document.createElement("div"); d.className = "ppv"; d.dataset.pid = l.id;
    d.innerHTML = `<div class="pic"><div class="img"></div><div class="flash"></div><div class="lk"><span class="ring"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="shackle" d="M7 11V8a5 5 0 0 1 10 0v3"/><path d="M5 11h14v10H5z"/></svg></span><b>${esc(l.price)} €</b></div></div>
      <div class="info"><div>${esc(l.desc)}</div><div class="row2"><b>${esc(l.price)} €</b><span class="pst">En attente</span></div></div>`; return d;
  }
  const PST = { "acheté": ["Acheté", "bought"], "refusé": ["Refusé", "refused"], "en négociation": ["Négociation", "nego"], "remplacé": ["Remplacé", "replaced"] };
  async function pollWatch() {
    if (!watchId || $("watchScreen").classList.contains("hidden")) return;
    let s; try { s = await api(`/api/admin/sims/${watchId}/watch`); } catch (e) { return; }
    const box = $("wvMsgs"), atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    $("wvTitle").innerHTML = `${esc(s.username)} <span>avec</span> ${esc(s.persona.name)}`;
    $("wvSub").textContent = `${s.persona.label} · ${DIFF(s.difficulty)} · en tant que ${s.creator_name}`;
    const live = s.status === "active";
    $("wvLive").classList.toggle("off", !live); $("wvLive").innerHTML = live ? '<span class="dot"></span>EN DIRECT' : "TERMINÉE";
    $("wvSeen").innerHTML = live && s.settings.notify ? `${EYE}${esc(s.username)} sait que tu regardes` : live ? `${EYE}Il ne sait pas que tu regardes` : "";
    $("wvName").textContent = s.username; $("wvAv").textContent = s.username[0].toUpperCase();
    $("wvStats").textContent = `${s.chatterStats.sessions} session${s.chatterStats.sessions > 1 ? "s" : ""}${s.chatterStats.avg != null ? " · moyenne " + s.chatterStats.avg + "/100" : ""}${s.online || !live ? "" : " · hors ligne"}`;
    // nouveaux messages
    const log = s.log.filter(l => l.who === "fan" || l.who === "chatter" || l.who === "ppv");
    box.querySelector(".wv-draft")?.remove(); box.querySelector(".typing")?.remove();
    for (; WV.n < log.length; WV.n++) { const l = log[WV.n];
      if (l.who === "ppv") { const e = ppvEl(l); WV.ppv[l.id] = e; box.appendChild(e); } else box.appendChild(bub(l.who === "fan" ? "fan" : "me", esc(l.text))); }
    log.filter(l => l.who === "ppv").forEach(l => { const e = WV.ppv[l.id]; if (!e) return; const [t, c] = PST[l.status] || ["En attente", ""]; e.querySelector(".pst").textContent = t;
      e.classList.remove("bought", "refused", "nego", "replaced"); if (c) e.classList.add(c);
      if (l.status === "acheté" && !WV.sold.has(l.id)) { WV.sold.add(l.id); if (WV.n0done) CHATFX.sale($("watchScreen"), e, l.price, () => {}); } });
    WV.n0done = true;
    if (live && s.fanTyping) { const t = document.createElement("div"); t.className = "typing"; t.innerHTML = "<i></i><i></i><i></i>"; box.appendChild(t); }
    if (live && s.draft) { const d = document.createElement("div"); d.className = "wv-draft"; d.dataset.l = `${s.username} écrit…`; d.innerHTML = esc(s.draft) + '<span class="car"></span>'; box.appendChild(d); }
    if (atBottom || WV.first !== true) { box.scrollTop = box.scrollHeight; WV.first = true; }
    // tableau de bord
    const v = Math.round(s.interest), c = iCol(v); if (WV.hist[WV.hist.length - 1] !== v) WV.hist.push(v);
    document.querySelectorAll("[data-wint]").forEach(e => { e.textContent = v; e.style.color = c; }); $("wvILab").textContent = iLab(v); $("wvILab").style.color = c;
    document.querySelectorAll("[data-wrev]").forEach(e => e.textContent = s.revenue + " €"); $("wvHints").innerHTML = `${s.hints}${s.hints ? '<small> · −' + s.hints * 3 + " pts</small>" : ""}`; const cst = "$" + (s.aiCost || 0).toFixed(3); if ($("wvCost")) $("wvCost").textContent = cst; document.querySelectorAll("[data-wcost]").forEach(e => e.textContent = cst);
    const h = WV.hist.length > 1 ? WV.hist.slice(-12) : [v, v], n = h.length, p = $("wvSpark").querySelector("path");
    p.setAttribute("d", h.map((x, i) => `${i ? "L" : "M"}${(i / (n - 1) * 290).toFixed(1)} ${(44 - x / 100 * 42).toFixed(1)}`).join(" ")); p.style.stroke = c;
    const lastFan = [...s.log].reverse().find(l => l.who === "fan"), lastAny = log[log.length - 1];
    WV.wait = live && lastAny && lastAny.who === "fan" && !s.fanTyping ? lastFan.at : null;
    // conseils envoyés
    if (s.whispers.length !== WV.sentN || s.whispers.some(w => w.seen_at && !w._s)) { WV.sentN = s.whispers.length;
      $("wvSent").innerHTML = s.whispers.length ? s.whispers.map(w => `<div>${esc(w.text)}<small>${w.seen_at ? `<span class="vu">✓ Vu par ${esc(s.username)}</span>` : "Envoyé"} · ${ago(w.created_at)}</small></div>`).join("") : '<p class="wv-none">Aucun pour l\'instant.</p>'; }
    $("wvWh").classList.toggle("hidden", !live || !s.settings.whisper); $("wvWhLab").textContent = `SOUFFLER UN CONSEIL À ${s.username.toUpperCase()}`;
    $("wvEnd").classList.toggle("hidden", live);
    if (!live) { WV.sim = s; clearInterval(watchTimer); watchTimer = setInterval(pollWatch, 6000); }
  }
  setInterval(() => { const t = WV.wait, el = document.querySelectorAll("[data-wclk]"); if (!watchId) return;
    if (!t) { el.forEach(e => e.textContent = "—"); $("wvClkS").textContent = "—"; $("wvClkS").className = "s"; return; }
    const s = Math.max(0, (Date.now() - t) / 1000), l = s < 20 ? 0 : s < 45 ? 1 : 2; el.forEach(e => e.textContent = `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
    $("wvClkS").textContent = ["RAPIDE", "CORRECT", "LENT"][l]; $("wvClkS").className = "s l" + l; }, 500);
  async function sendWhisper() {
    const t = $("wvInput").value.trim(); if (!t || !watchId) return;
    $("wvSend").disabled = true;
    try { await api(`/api/admin/sims/${watchId}/whisper`, { body: { text: t } }); $("wvInput").value = ""; notify("Conseil envoyé", "Il apparaît dans sa conversation"); WV.sentN = -1; pollWatch(); }
    catch (e) { notify("Conseil non envoyé", e.message, "err"); }
    $("wvSend").disabled = false;
  }

  /* ================= côté chatter ================= */
  let sendDraft = true, lastDraft = "", draftT = null, seenW = new Set();
  function chatOpen() { return typeof SIM !== "undefined" && SIM && !$("chatScreen").classList.contains("hidden"); }
  async function pollLive() {
    if (!chatOpen()) return;
    let r; try { r = await api(`/api/sims/${SIM.id}/live`); } catch (e) { return; }
    sendDraft = r.sendDraft;
    const who = r.watchers.join(", ");
    $("watchBadge").classList.toggle("hidden", !who); $("watchBan").classList.toggle("hidden", !who);
    if (who) { $("watchBadge").innerHTML = `${EYE}${esc(who)} regarde ta session`; $("watchBan").innerHTML = `${EYE}${esc(who)} regarde ta session en direct`; }
    r.whispers.forEach(w => { if (seenW.has(w.id)) return; seenW.add(w.id);
      const d = document.createElement("div"); d.className = "cq-mgr"; d.innerHTML = `<b><i>${esc(w.from[0].toUpperCase())}</i>CONSEIL DE ${esc(w.from.toUpperCase())}</b><p>${esc(w.text)}</p>`;
      $("msgs").appendChild(d); $("msgs").scrollTop = $("msgs").scrollHeight;
      try { FX.sound.soft(); navigator.vibrate && navigator.vibrate(30); } catch (e) {} });
  }
  function postDraft(text) { if (!chatOpen() || !sendDraft || text === lastDraft) return; lastDraft = text; api(`/api/sims/${SIM.id}/draft`, { body: { text } }).catch(() => {}); }

  /* ================= démarrage ================= */
  async function loadMyAssign() {
    let a = []; try { a = await api("/api/my-assignments"); } catch (e) {}
    $("myAssign").innerHTML = a.length ? `<div class="gx gx-asgbar">${a.map(x => `<div class="gx-asg"><span class="gx-av">${esc(x.created_by_name[0].toUpperCase())}</span>
      <div><b>Entraînement de ${esc(x.created_by_name)}</b><small>${esc(x.persona)} · ${esc(x.label)} · ${esc(DIFF(x.difficulty))} · objectif ${x.goal}/100${x.due_at ? ` · avant le ${new Date(x.due_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}` : ""}${x.attempts ? ` · meilleur essai ${x.best}/100` : ""}${x.note ? `<br>« ${esc(x.note)} »` : ""}</small></div>
      <button data-go="${x.persona_id}" data-d="${x.difficulty}">Commencer →</button></div>`).join("")}</div>` : "";
    document.querySelectorAll("#myAssign [data-go]").forEach(b => b.onclick = () => {
      selPersona = b.dataset.go; renderPersonas(); setDiff(b.dataset.d); document.querySelector(".s-grid")?.scrollIntoView({ behavior: "smooth", block: "start" });
      notify("Fan et difficulté choisis", "Vérifie la créatrice puis lance la simulation", "info"); });
  }
  let inited = false;
  function onInit(me) {
    ME = me;
    if (!inited) { inited = true;
      document.querySelectorAll("#simTabs button").forEach(b => b.onclick = () => setPane(b.dataset.pane));
      $("wvBack").onclick = closeWatch; $("wvSend").onclick = sendWhisper; $("wvInput").addEventListener("keydown", e => { if (e.key === "Enter") sendWhisper(); });
      document.querySelectorAll("#wvWh .wv-chips button").forEach(b => b.onclick = () => { $("wvInput").value = b.textContent; $("wvInput").focus(); });
      $("wvReport").onclick = () => { if (WV.sim) { clearInterval(watchTimer); watchId = null; showReport(WV.sim); } };
      bindAssign();
      $("input").addEventListener("input", () => { clearTimeout(draftT); draftT = setTimeout(() => postDraft($("input").value), 300); });
      $("sendBtn").addEventListener("click", () => setTimeout(() => postDraft(""), 50));
      $("input").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) setTimeout(() => postDraft(""), 50); });
      setInterval(pollLive, 2500);
    }
    if (me.role === "admin") { $("simTabs").classList.remove("hidden"); let p = "train"; try { p = sessionStorage.getItem("stSimPane") || "train"; } catch (e) {} if (location.hash === "#gestion") p = "gest"; setPane(p);
      api("/api/admin/sim/live").then(l => { $("liveCount").classList.toggle("hidden", !l.length); $("liveCount").querySelector("b").textContent = l.length; }).catch(() => {}); }
    else loadMyAssign();
  }
  return { onInit, showGest, openWatch };
})();
