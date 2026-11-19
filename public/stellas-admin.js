// Gestion › Stella's : fondateur (tout) et managers (leur équipe, coups de pouce sur une enveloppe, titres à valider)
window.STELADMIN = (() => {
  let O = null, CFG = null, SUB = "home", G = { uid: null, amt: 25, why: "" };
  const root = () => document.getElementById("stelRoot");
  const SV = (d, s = 16, w = 2.2, c = "currentColor") => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const N = n => Number(n).toLocaleString("fr-FR");
  const C = (s = 14) => `<i class="stc" style="width:${s}px;height:${s}px"></i>`;
  const RL = { sale10: ["Vente validée", "Par tranche de 10 € comptés au chatter"], superSale: ["Super vente", "Bonus pour une vente au-dessus du seuil « super vente »"], ontime: ["Shift commencé à l'heure", "Pointé dans la tolérance"],
    streak7: ["Série de 7 shifts à l'heure", "Sans retard ni absence"], streak30: ["Série de 30 shifts à l'heure", "Un mois parfait"], swap: ["Shift repris pour un collègue", "Échange validé par un manager"],
    sos: ["Meilleure réponse en aide fan", "La plus étoilée du fil, 24 h après la demande"], handover: ["Passation remplie", "Une par créatrice et par jour"], tier: ["Palier de commission atteint", "Chaque nouveau palier de la quinzaine"],
    challenge: ["Défi gagné", "Perso ou d'équipe"], motm: ["Coéquipier du mois", "Élu par l'équipe"], sancLight: ["Sanction légère", "1 point ou moins"], sancMid: ["Sanction moyenne", "2 points"], sancHeavy: ["Sanction grave", "3 points ou plus"] };
  const RAR = { C: ["COMMUN", "#bdbdbd"], R: ["RARE", "#9fdcff"], E: ["ÉPIQUE", "#d6cbff"], L: ["LÉGENDAIRE", "#ffe08a"] };
  const SHELF = { cos: "Cosmétique", adv: "Avantage", rew: "Récompense" };
  const isF = () => O && O.role === "founder";
  const ago = ms => new Date(ms).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  async function load() {
    const r = root(); if (!r) return; if (!O) r.innerHTML = `<div class="ld">Chargement…</div>`;
    try { O = await api("/api/admin/stellas/overview"); } catch (e) { r.innerHTML = `<div class="st-closed">${esc(e.message)}</div>`; return; }
    const n = document.getElementById("nStel"); if (n) n.textContent = O.requests.filter(q => isF() || q.kind === "title").length || "";
    render();
  }
  function tabs() {
    const T = isF() ? [["home", "Vue d'ensemble"], ["rules", "Barème des gains"], ["cat", "Catalogue"], ["log", "Journal"]] : [["home", "Mon équipe"], ["req", "Demandes"], ["log", "Journal"]];
    return `<div class="st-segs" style="align-self:flex-start;margin-bottom:4px">${T.map(([k, l]) => `<button type="button" class="${SUB === k ? "on" : ""}" data-sub="${k}">${l}</button>`).join("")}</div>`;
  }
  function reqRow(q) {
    const canDo = q.kind === "title" || isF();
    return `<div class="st-row"><span class="ic" style="background:${q.kind === "bonus" ? "rgba(243,217,164,.12);color:#f3d9a4" : "rgba(255,122,182,.12);color:#ffb3d4"}">${SV(q.kind === "bonus" ? "M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6" : "M4 7h16M4 12h10M4 17h7")}</span>
      <div class="m"><b>${esc(q.username)} · ${esc(q.item_name)}</b><small>${q.text ? `« ${esc(q.text)} » · ` : ""}${N(q.cost)} Stella's mises de côté · ${ago(q.created_at)}</small></div>
      ${canDo ? `<div style="display:flex;gap:6px"><button class="st-btn sm ghost" data-rq="${q.id}:refuse">Refuser</button><button class="st-btn sm ok" data-rq="${q.id}:approve">Valider</button></div>`
        : `<span style="font-size:11.5px;font-weight:800;color:#f3d9a4;background:rgba(243,217,164,.1);border:1px solid rgba(243,217,164,.3);padding:6px 10px;border-radius:999px;white-space:nowrap">Chez le fondateur</span>`}</div>`;
  }
  function teamTable() {
    return `<div class="st-box"><div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px"><h2>${isF() ? "L'équipe" : "Mon équipe"}</h2><span class="sub" style="margin:0">Trié par Stella's gagnées ce mois-ci</span></div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;margin-top:10px;min-width:640px;font-size:13.5px">
      <thead><tr style="text-align:left;font-size:11px;letter-spacing:.14em;color:#8f8f8f"><th style="padding:10px 0;font-weight:800">CHATTER</th><th style="text-align:right;font-weight:800">SOLDE</th><th style="text-align:right;font-weight:800">CE MOIS</th><th style="font-weight:800;padding-left:22px">SÉRIE À L'HEURE</th><th style="font-weight:800">DERNIER MOUVEMENT</th></tr></thead>
      <tbody>${O.team.map(c => `<tr style="border-top:1px solid #1a1a1a"><td style="padding:11px 0"><b data-lk-name="${c.id}">${esc(c.name)}</b></td>
        <td style="text-align:right;font-weight:900;white-space:nowrap">${C(12)} ${N(c.balance)}</td><td style="text-align:right;font-weight:800;color:#5fd3a2">+${N(c.month)}</td>
        <td style="padding-left:22px"><div style="display:flex;align-items:center;gap:8px"><div style="width:80px;height:6px;border-radius:3px;background:#222;overflow:hidden"><i style="display:block;height:100%;width:${Math.min(100, Math.round(c.streak / 12 * 100))}%;background:${c.streak >= 7 ? "#5fd3a2" : c.streak >= 3 ? "#f3d9a4" : "#ff8a96"}"></i></div><span style="color:#cfcfcf">${c.streak}</span></div></td>
        <td style="color:#a3a3a3">${c.last ? `${c.last.amount > 0 ? "+" : "−"} ${N(Math.abs(c.last.amount))} · ${esc(c.last.label)}` : "—"}</td></tr>`).join("") || `<tr><td colspan="5" class="st-empty">Aucun chatter actif</td></tr>`}</tbody></table></div></div>`;
  }
  function grantForm() {
    const env = O.envelope, chat = O.team;
    if (!G.uid && chat[0]) G.uid = chat[0].id;
    const amts = isF() ? [10, 25, 50, 100, -25, -50] : [10, 25, 50, 100];
    return `<div class="st-box" style="display:flex;flex-direction:column;gap:16px"><div><h2>${isF() ? "Ajouter ou retirer à la main" : "Récompenser un chatter"}</h2><p class="sub">${isF() ? "Le chatter voit le motif dans sa cagnotte." : "Un coup de pouce pris sur ton enveloppe du mois. Le chatter voit le motif."}</p></div>
      <label style="display:flex;flex-direction:column;gap:7px;font-size:11px;font-weight:800;letter-spacing:.14em;color:#8f8f8f">CHATTER<select class="st-in" id="gU">${chat.map(c => `<option value="${c.id}"${c.id === G.uid ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
      ${isF() ? "" : `<div style="display:flex;flex-direction:column;gap:8px"><span style="font-size:11px;font-weight:800;letter-spacing:.14em;color:#8f8f8f">POURQUOI</span><div class="st-chips">${["Super passation", "A aidé un collègue", "Remplacement de dernière minute", "Belle attitude"].map(w => `<button type="button" class="${G.why === w ? "on" : ""}" data-why="${esc(w)}">${w}</button>`).join("")}</div></div>`}
      <div style="display:flex;flex-direction:column;gap:8px"><span style="font-size:11px;font-weight:800;letter-spacing:.14em;color:#8f8f8f">COMBIEN</span><div style="display:grid;grid-template-columns:repeat(${amts.length},minmax(0,1fr));gap:6px">${amts.map(a => `<button type="button" class="st-btn" style="${G.amt === a ? "border-color:#f3d9a4;background:rgba(243,217,164,.1);color:#f3d9a4" : ""}${a < 0 ? ";color:#ff8a96" : ""}" data-amt="${a}">${a > 0 ? "+" : "−"} ${Math.abs(a)}</button>`).join("")}</div></div>
      <label style="display:flex;flex-direction:column;gap:7px;font-size:11px;font-weight:800;letter-spacing:.14em;color:#8f8f8f">MOTIF · VISIBLE PAR LE CHATTER<input class="st-in" id="gW" maxlength="120" value="${esc(G.why)}" placeholder="Ex. : merci d'avoir formé la nouvelle recrue"></label>
      <button type="button" class="st-btn g" style="height:50px" id="gGo">Envoyer ${C(16)} ${G.amt > 0 ? "" : "−"}${Math.abs(G.amt)}</button>
      ${env ? `<p class="sub" style="margin:-6px 0 0;font-size:12px">Il te reste ${N(env.left)} Stella's à donner ce mois-ci. Pour retirer des Stella's, passe par une sanction : elles sont reprises automatiquement.</p>` : ""}</div>`;
  }
  function home() {
    const k = isF() ? `<div class="st-kpi"><div class="st-k">EN CIRCULATION</div><div style="display:flex;align-items:center;gap:9px;margin-top:10px">${C(20)}<b class="v" style="margin:0">${N(O.circulation)}</b></div><small>Soldes cumulés de l'équipe</small></div>
        <div class="st-kpi"><div class="st-k">DISTRIBUÉES CE MOIS-CI</div><b class="v" style="color:#5fd3a2">+${N(O.distributed)}</b><small>dont ${N(O.distributedTime)} pour la ponctualité</small></div>
        <div class="st-kpi"><div class="st-k">DÉPENSÉES CE MOIS-CI</div><b class="v">${N(O.spent)}</b><small>${O.purchases} achat${O.purchases > 1 ? "s" : ""}</small></div>
        <div class="st-kpi gold"><div style="display:flex;justify-content:space-between"><span class="st-k" style="color:#b5b5b5">BUDGET RÉCOMPENSES</span><button type="button" style="background:none;border:0;color:#f3d9a4;font:700 12px Inter;cursor:pointer;padding:0" id="bEdit">Modifier</button></div>
          <b class="v">${eur(O.budget.used)} <span style="font-size:15px;color:#8f8f8f;letter-spacing:0">/ ${eur(O.budget.total)}</span></b><div class="st-bar" style="margin-top:10px"><i style="width:${O.budget.total ? Math.min(100, Math.round(O.budget.used / O.budget.total * 100)) : 0}%"></i></div></div>`
      : `<div class="st-kpi"><div class="st-k">GAGNÉES PAR L'ÉQUIPE CE MOIS-CI</div><b class="v" style="color:#5fd3a2">+${N(O.team.reduce((t, c) => t + c.month, 0))}</b><small>${O.team.length} chatters</small></div>
        <div class="st-kpi"><div class="st-k">SHIFTS COMMENCÉS À L'HEURE</div><b class="v">${O.punctuality == null ? "—" : O.punctuality + " %"}</b><small>Ce mois-ci</small></div>
        <div class="st-kpi gold"><div class="st-k" style="color:#b5b5b5">MON ENVELOPPE DU MOIS</div><div style="display:flex;align-items:center;gap:9px;margin-top:10px">${C(20)}<b class="v" style="margin:0">${N(O.envelope.left)} <span style="font-size:15px;color:#8f8f8f;letter-spacing:0">/ ${N(O.envelope.total)} à donner</span></b></div>
          <div class="st-bar" style="margin-top:10px"><i style="width:${O.envelope.total ? Math.round(O.envelope.left / O.envelope.total * 100) : 0}%"></i></div></div>`;
    const reqs = isF() ? O.requests : O.requests;
    const jok = O.jokers.length ? O.jokers.map(j => `<div class="st-row" style="opacity:.85"><span class="ic" style="background:rgba(125,211,252,.1);color:#7dd3fc">${SV("M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 1.5")}</span><div class="m"><b>${esc(j.username)} a utilisé un joker retard</b><small>${j.late} min de retard effacées · ${ago(j.at)}</small></div><button class="st-btn sm ghost" data-jk="${j.id}">Annuler</button></div>`).join("") : "";
    const top = O.team.slice().sort((a, b) => b.month - a.month).slice(0, 5);
    return `<section class="st-kpis">${k}</section>
      <section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(440px,100%),1fr));gap:16px;align-items:start">
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="st-box"><div style="display:flex;justify-content:space-between;align-items:center"><h2>À valider</h2><span class="sub" style="margin:0">${reqs.length ? reqs.length + " en attente" : ""}</span></div>
            <div style="margin-top:8px">${reqs.map(reqRow).join("") || `<div class="st-empty">Rien à valider</div>`}${jok}</div>
            ${reqs.length ? `<p class="sub" style="margin-top:10px;font-size:12px">Refuser rend les Stella's au chatter.</p>` : ""}</div>
          ${isF() ? `<div class="st-box"><h2>Qui gagne le plus ce mois-ci</h2><div style="margin-top:8px">${top.map((c, i) => `<div class="st-row"><b style="width:18px;color:#8f8f8f">${i + 1}</b><div class="m"><b data-lk-name="${c.id}">${esc(c.name)}</b><small>${esc(c.mix || "")}</small></div><span class="a" style="display:inline-flex;align-items:center;gap:6px">${C(12)}${N(c.month)}</span></div>`).join("") || `<div class="st-empty">Personne pour l'instant</div>`}</div></div>`
            : `<div class="st-box"><h2>Ce que tu peux faire</h2><div style="display:flex;flex-direction:column;gap:10px;margin-top:12px;font-size:13.5px">
              ${["Donner des Stella's de ton enveloppe", "Valider ou refuser les titres personnalisés", "Annuler un joker retard utilisé à tort"].map(t => `<div style="display:flex;gap:10px;color:#cfcfcf">${SV("M5 12.5l4.5 4.5L19 7.5", 16, 2.6, "#5fd3a2")}${t}</div>`).join("")}
              <div style="display:flex;gap:10px;color:#8f8f8f">${SV("M6 6l12 12M18 6L6 18", 16, 2.4, "#6f6f6f")}Valider les bonus en €, changer les prix ou le barème</div></div></div>`}
        </div>
        ${grantForm()}
      </section>${teamTable()}`;
  }
  function rules() {
    return `<div class="st-box"><div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:14px"><div><h2>Barème des gains</h2><p class="sub">Combien rapporte ou coûte chaque action. 0 = désactivé. Les changements comptent pour les prochaines actions.</p></div>
      <label style="display:flex;align-items:center;gap:10px;font-size:13px;color:#cfcfcf">Boutique ouverte<input type="checkbox" id="cOpen" ${CFG.open ? "checked" : ""} style="width:20px;height:20px;accent-color:#5fd3a2"></label></div>
      <div style="margin-top:10px">${Object.keys(RL).map(k => `<div class="st-row"><div class="m"><b>${RL[k][0]}</b><small>${RL[k][1]}</small></div><span style="font-weight:900;color:${k.startsWith("sanc") ? "#ff8a96" : "#f3d9a4"}">${k.startsWith("sanc") ? "−" : "+"}</span><input class="st-in" style="width:110px;text-align:right;font-weight:800" type="number" min="0" data-rule="${k}" value="${CFG.rules[k]}" aria-label="${RL[k][0]}"></div>`).join("")}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:12px;margin-top:18px">
        <label style="display:flex;flex-direction:column;gap:7px;font-size:11px;font-weight:800;letter-spacing:.12em;color:#8f8f8f">PLAFOND PAR JOUR (HORS VENTES)<input class="st-in" type="number" min="0" id="cCap" value="${CFG.cap}"></label>
        <label style="display:flex;flex-direction:column;gap:7px;font-size:11px;font-weight:800;letter-spacing:.12em;color:#8f8f8f">BUDGET RÉCOMPENSES PAR MOIS (€)<input class="st-in" type="number" min="0" id="cBud" value="${CFG.budget}"></label>
        <label style="display:flex;flex-direction:column;gap:7px;font-size:11px;font-weight:800;letter-spacing:.12em;color:#8f8f8f">ENVELOPPE PAR MANAGER PAR MOIS<input class="st-in" type="number" min="0" id="cEnv" value="${CFG.envelope}"></label></div>
      <div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="st-btn w" id="cSave">Enregistrer</button></div></div>`;
  }
  function cat() {
    return `<div class="st-box"><h2>Catalogue</h2><p class="sub">Un article désactivé disparaît de la boutique ; ceux qui l'ont déjà le gardent.</p>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;margin-top:12px;min-width:640px;font-size:13.5px">
      <thead><tr style="text-align:left;font-size:11px;letter-spacing:.14em;color:#8f8f8f"><th style="padding:10px 0;font-weight:800">ARTICLE</th><th style="font-weight:800">RAYON</th><th style="font-weight:800">RARETÉ</th><th style="text-align:right;font-weight:800">PRIX</th><th style="text-align:right;font-weight:800">VENDUS</th><th style="text-align:right;font-weight:800">ACTIF</th></tr></thead>
      <tbody>${CFG.items.map(i => `<tr style="border-top:1px solid #1a1a1a"><td style="padding:10px 0"><b>${esc(i.name)}</b>${i.eur ? `<div style="font-size:12px;color:#8f8f8f">${eur(i.eur)} sur la paie</div>` : ""}</td><td style="color:#b5b5b5">${SHELF[i.shelf]}</td>
        <td>${i.rar ? `<span style="font-size:10.5px;font-weight:900;letter-spacing:.14em;color:${RAR[i.rar][1]}">${RAR[i.rar][0]}</span>` : "—"}</td>
        <td style="text-align:right"><input class="st-in" style="width:100px;height:40px;text-align:right;font-weight:800" type="number" min="1" data-price="${i.id}" value="${i.price}" aria-label="Prix ${esc(i.name)}"></td>
        <td style="text-align:right;color:#cfcfcf">${i.sold}</td><td style="text-align:right"><input type="checkbox" data-act="${i.id}" ${i.active ? "checked" : ""} style="width:20px;height:20px;accent-color:#5fd3a2" aria-label="Actif"></td></tr>`).join("")}</tbody></table></div>
      <div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="st-btn w" id="iSave">Enregistrer</button></div></div>`;
  }
  async function logView() {
    const L = await api("/api/admin/stellas/log");
    return `<div class="st-box"><h2>Journal des Stella's</h2><div style="margin-top:8px">${L.map(t => `<div class="st-row"><span style="font-size:12.5px;color:#8f8f8f;width:120px;flex:none">${ago(t.at)}</span><b style="width:110px;flex:none;font-size:14px">${esc(t.username)}</b><div class="m"><b style="font-weight:600;color:#cfcfcf">${esc(t.label)}</b><small>${esc(t.sub || "")}</small></div><span class="a" style="color:${t.amount > 0 ? "#5fd3a2" : t.kind === "buy" ? "#e5e5e5" : "#ff8a96"}">${t.amount > 0 ? "+" : "−"} ${N(Math.abs(t.amount))}</span></div>`).join("") || `<div class="st-empty">Aucun mouvement pour l'instant</div>`}</div></div>`;
  }
  async function reqView() {
    const L = await api("/api/admin/stellas/requests"), st = { pending: ["À valider", "#f3d9a4"], approved: ["Validé", "#5fd3a2"], refused: ["Refusé", "#ff8a96"] };
    return `<div class="st-box"><h2>Demandes de l'équipe</h2><div style="margin-top:8px">${L.map(q => `<div class="st-row"><span style="font-size:12.5px;color:#8f8f8f;width:120px;flex:none">${ago(q.created_at)}</span><b style="width:110px;flex:none;font-size:14px">${esc(q.username)}</b><div class="m"><b style="font-weight:600;color:#cfcfcf">${esc(q.item_name)}${q.text ? ` « ${esc(q.text)} »` : ""}</b></div>
      ${q.status === "pending" && (q.kind === "title" || isF()) ? `<div style="display:flex;gap:6px"><button class="st-btn sm ghost" data-rq="${q.id}:refuse">Refuser</button><button class="st-btn sm ok" data-rq="${q.id}:approve">Valider</button></div>`
        : `<span style="font-size:11.5px;font-weight:800;padding:6px 10px;border-radius:999px;color:${q.status === "pending" ? "#a3a3a3" : st[q.status][1]};border:1px solid ${q.status === "pending" ? "#333" : st[q.status][1]}">${q.status === "pending" ? "Chez le fondateur" : st[q.status][0]}</span>`}</div>`).join("") || `<div class="st-empty">Aucune demande</div>`}</div></div>`;
  }
  async function render() {
    const r = root(); if (!r) return;
    let body = "";
    if (SUB === "home") body = home();
    else if (SUB === "rules" || SUB === "cat") { if (!CFG) CFG = await api("/api/admin/stellas/config"); body = SUB === "rules" ? rules() : cat(); }
    else if (SUB === "log") body = await logView();
    else if (SUB === "req") body = await reqView();
    r.innerHTML = `<div style="display:flex;flex-direction:column;gap:18px">${tabs()}${body}</div>`;
    bind(r);
  }
  function bind(r) {
    r.querySelectorAll("[data-sub]").forEach(b => b.onclick = () => { SUB = b.dataset.sub; render(); });
    r.querySelectorAll("[data-rq]").forEach(b => b.onclick = async () => { const [id, action] = b.dataset.rq.split(":"); b.disabled = true;
      try { await api(`/api/admin/stellas/requests/${id}`, { body: { action } }); notify(action === "approve" ? "Validé ✓" : "Refusé", action === "approve" ? "" : "Les Stella's sont rendues au chatter", "ok"); await load(); } catch (e) { b.disabled = false; notify("Impossible", e.message, "err"); } });
    r.querySelectorAll("[data-jk]").forEach(b => b.onclick = async () => { if (!confirmBox(b)) return;
      try { await api(`/api/admin/stellas/jokers/${b.dataset.jk}/cancel`, { method: "POST" }); notify("Joker annulé", "Le retard repasse dans les sanctions à traiter", "ok"); await load(); } catch (e) { notify("Impossible", e.message, "err"); } });
    r.querySelectorAll("[data-why]").forEach(b => b.onclick = () => { G.why = b.dataset.why; G.uid = +r.querySelector("#gU").value; render(); });
    r.querySelectorAll("[data-amt]").forEach(b => b.onclick = () => { G.amt = +b.dataset.amt; G.uid = +r.querySelector("#gU").value; G.why = r.querySelector("#gW").value; render(); });
    const gu = r.querySelector("#gU"); if (gu) gu.onchange = () => G.uid = +gu.value;
    const gw = r.querySelector("#gW"); if (gw) gw.oninput = () => G.why = gw.value;
    const go = r.querySelector("#gGo"); if (go) go.onclick = async () => { go.disabled = true;
      try { const x = await api("/api/admin/stellas/grant", { body: { user_id: +r.querySelector("#gU").value, amount: G.amt, reason: r.querySelector("#gW").value } });
        notify(x.amount > 0 ? `+${x.amount} Stella's envoyées ✓` : `${x.amount} Stella's retirées`, r.querySelector("#gU").selectedOptions[0].textContent, "ok"); G.why = ""; await load(); } catch (e) { go.disabled = false; notify("Impossible", e.message, "err"); } };
    const be = r.querySelector("#bEdit"); if (be) be.onclick = () => { SUB = "rules"; render(); };
    const cs = r.querySelector("#cSave"); if (cs) cs.onclick = async () => { const rules = {}; r.querySelectorAll("[data-rule]").forEach(i => rules[i.dataset.rule] = +i.value);
      try { await api("/api/admin/stellas/config", { method: "PUT", body: { rules, open: r.querySelector("#cOpen").checked, cap: +r.querySelector("#cCap").value, budget: +r.querySelector("#cBud").value, envelope: +r.querySelector("#cEnv").value } });
        CFG = null; notify("Barème enregistré ✓", "", "ok"); await load(); SUB = "rules"; render(); } catch (e) { notify("Impossible", e.message, "err"); } };
    const is = r.querySelector("#iSave"); if (is) is.onclick = async () => { const items = {};
      r.querySelectorAll("[data-price]").forEach(i => (items[i.dataset.price] = items[i.dataset.price] || {}).price = +i.value);
      r.querySelectorAll("[data-act]").forEach(i => (items[i.dataset.act] = items[i.dataset.act] || {}).active = i.checked);
      try { await api("/api/admin/stellas/config", { method: "PUT", body: { items } }); CFG = null; notify("Catalogue enregistré ✓", "", "ok"); SUB = "cat"; render(); } catch (e) { notify("Impossible", e.message, "err"); } };
  }
  // confirmation en deux temps sur le bouton lui-même
  function confirmBox(b) { if (b.dataset.sure) return true; b.dataset.sure = 1; const t = b.textContent; b.textContent = "Sûr ?"; setTimeout(() => { delete b.dataset.sure; b.textContent = t; }, 3000); return false; }
  return { load };
})();
