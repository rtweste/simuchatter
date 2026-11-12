// Compta (manager) : quinzaine et récap du mois
const SRCS = [["abo", "Abonnements"], ["live", "Live"], ["coll", "Collections"], ["push", "Média push"]];
const BANDS = [[0, 500, 10], [500, 1000, 12], [1000, 1400, 14], [1400, Infinity, 15]];
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const E = n => n == null || isNaN(n) ? "—" : (Math.round(n * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: Math.abs(n % 1) > .004 ? 2 : 0, maximumFractionDigits: 2 }) + " €";
const N0 = n => Math.round(n || 0).toLocaleString("fr-FR");
const parseNum = v => { const s = String(v ?? "").trim().replace(/\s/g, "").replace(",", "."); return s === "" ? "" : Number(s); };
const fix2 = n => n == null ? "" : String(Math.round(n * 100) / 100).replace(".", ",");
const dShort = ms => new Date(ms).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const shortLbl = k => { const [y, m, h] = k.split("-"); const M = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."][m - 1]; return (h === "A" ? "1 " : "16 ") + M; };
function countTo(el, to, fmt = E, dur = 1000) {
  if (!el) return; const from = +el.dataset.v || 0; el.dataset.v = to;
  if (REDUCED || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), st = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(k < 1 ? from + (to - from) * e : to); if (k < 1) requestAnimationFrame(st); };
  requestAnimationFrame(st);
}
const VS = (() => {
  let c = null, o = null;
  const on = () => { try { return localStorage.getItem("stSound") !== "0"; } catch (e) { return true; } };
  function ac() { if (!on()) return null; try { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
    if (!c) { c = new C(); o = c.createGain(); o.gain.value = .16; o.connect(c.destination); if (window.stAudio) stAudio.add(c); }
    if (c.state !== "running") c.resume().catch(() => {}); return c; } catch (e) { return null; } }
  const tone = (f, at, len, peak, type, glide) => { const os = c.createOscillator(), g = c.createGain(); os.type = type || "sine"; os.frequency.setValueAtTime(f, at);
    if (glide) os.frequency.exponentialRampToValueAtTime(glide, at + len * .9);
    g.gain.setValueAtTime(.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + Math.min(.02, len / 4)); g.gain.exponentialRampToValueAtTime(.0001, at + len);
    os.connect(g); g.connect(o); os.start(at); os.stop(at + len + .05); };
  const run = f => { const x = ac(); if (x) try { f(x.currentTime + .02); } catch (e) {} };
  return {
    tick: () => run(t => tone(2637, t, .06, .03, "triangle")),
    ok: () => run(t => [1318.5, 1975.5, 2637].forEach((f, i) => tone(f, t + i * .06, .8 - i * .15, .1 - i * .025))),
    lock: () => run(t => { tone(220, t, .12, .12, "triangle", 160); tone(1318.5, t + .18, .5, .06); tone(1975.5, t + .24, .6, .04); }),
    open: () => run(t => tone(1975.5, t, .25, .035))
  };
})();

let VIEW = "q", PERIOD = null, MONTH = null, C = null, HIST = null, M = null, OPEN = null;
const root = $("root");
const locked = () => !!(C && C.locked);

/* ======================= QUINZAINE ======================= */
async function loadQ(p) {
  const q = p || PERIOD ? `?period=${p || PERIOD}` : "";
  const [c, h] = await Promise.all([api("/api/admin/compta" + q), api("/api/admin/compta/history" + q).catch(() => null)]);
  C = c; HIST = h; PERIOD = c.period.key; MONTH = PERIOD.slice(0, 7);
  root.classList.toggle("locked", !!c.locked);
  $("pLab").textContent = c.period.label;
  renderHero(); renderProj(); renderAlerts(); renderPay(); renderCreators(); renderChecks(); renderMore();
  if (OPEN != null) { const ch = C.chatters.find(x => x.id === OPEN); if (ch) renderFiche(ch, true); }
}
const trendHtml = (a, b) => { if (!b) return ""; const p = Math.round((a - b) / b * 100); return `<span class="c-trend ${p >= 0 ? "up" : "dn"}">${p >= 0 ? "▲" : "▼"} ${Math.abs(p)} %</span>`; };
function srcBar(el, s, legacyNet) {
  const parts = [["s1", "Chatting", s.chat, true], ["s2", "Abonnements", s.abo], ["s3", "Live", s.live], ["s4", "Collections", s.coll], ["s5", "Média push", s.push]];
  if (legacyNet) parts.push(["s6", "Saisi d'un bloc", legacyNet]);
  const tot = parts.reduce((t, p) => t + (p[2] || 0), 0);
  el.innerHTML = !tot ? `<span style="flex:1;color:#6a6a6a;font-size:12px;font-weight:700;justify-content:center;align-items:center">Pas encore de CA sur cette période</span>`
    : parts.filter(p => p[2] > 0).map((p, i) => `<span class="${p[0]}" style="flex:${p[2]};--dl:${.1 + i * .08}s" title="${p[1]} : ${E(p[2])}"><b>${p[1]}</b><i>${E(p[2])}</i>${p[3] ? "<em>auto</em>" : ""}</span>`).join("");
}
function flowBar(bar, leg, t, fee) {
  const NM = window.RK === "assistant", ag = t.margin, parts = [["pf", "Plateforme", t.platform], ["cr", "Créatrices", t.creators], ["chh", "Chatters", t.chatters], ...(NM ? [] : [[ag >= 0 ? "ag" : "ng", "Agence", Math.abs(ag)]])];
  bar.innerHTML = !t.brut ? "" : parts.filter(p => p[2] > 0).map((p, i) => `<span class="${p[0]}" style="flex:${p[2]};--dl:${.2 + i * .15}s" title="${p[1]} : ${E(p[2])}">${p[1]}</span>`).join("");
  leg.innerHTML = `<div><i style="background:#1b1b1b;border:1px solid #333"></i>Plateforme (${fix2(fee)} % du chatting)<b>${E(t.platform)}</b></div><div><i style="background:#2c2c2c"></i>Créatrices<b>${E(t.creators)}</b></div>
    <div><i style="background:#4a4a4a"></i>Paie des chatters<b>${E(t.chatters)}</b></div>${NM ? "" : `<div><i style="background:#5fd3a2"></i>Reste à l'agence<b style="color:${ag >= 0 ? "#5fd3a2" : "#e07a7a"}">${E(ag)}</b></div>`}`;
}
function renderHero() {
  const t = C.totals;
  $("hLab").textContent = C.period.label; $("hTrend").outerHTML = `<span id="hTrend">${trendHtml(t.brut, C.prev.brut)}</span>`;
  countTo($("kBrut"), t.brut, N0, 1200); countTo($("kNet"), t.net);
  if (window.RK === "assistant") $("kMargin").closest(".c-sub").style.display = "none";
  else { countTo($("kMargin"), t.margin); $("kMargin").classList.toggle("g", t.margin >= 0); $("kMargin").style.color = t.margin < 0 ? "#e07a7a" : ""; }
  srcBar($("srcBar"), t.sources, t.sources.legacy); flowBar($("flowBar"), $("flowLeg"), t, C.fee);
  document.querySelectorAll(".feeTxt").forEach(e => e.textContent = fix2(C.fee));
}
function renderProj() {
  const g = C.goals.ca, t = C.totals, P = HIST ? HIST.periods : [];
  const head = C.running ? `<div class="c-ch" style="margin-bottom:0"><div class="c-lab">Fin de période estimée</div><span class="c-tag w"><i></i>Jour ${C.dayOf} sur ${C.nDays}</span></div>
      <div class="pv">${E(C.projection)}</div><div class="c-mut">${g ? (C.projection >= g ? `CA brut à ce rythme : l'objectif de ${E(g)} est dépassé de <b style="color:#5fd3a2">+${E(C.projection - g)}</b>` : `CA brut à ce rythme : il manque <b style="color:#fff">${E(g - C.projection)}</b> pour l'objectif de ${E(g)}`) : "Fixe un objectif dans les réglages."}</div>`
    : `<div class="c-ch" style="margin-bottom:0"><div class="c-lab">Résultat de la période</div><span class="c-tag ${C.locked ? "v" : "w"}"><i></i>${C.locked ? "Clôturée" : "Terminée"}</span></div>
      <div class="pv">${E(t.brut)}</div><div class="c-mut">${g ? (t.brut >= g ? `Objectif de ${E(g)} atteint (<b style="color:#5fd3a2">+${E(t.brut - g)}</b>)` : `Objectif de ${E(g)} manqué de <b style="color:#e07a7a">${E(g - t.brut)}</b>`) : ""}</div>`;
  const max = Math.max(g || 0, C.projection || 0, t.brut) * 1.08 || 1;
  const mm = Math.max(1, ...P.map(x => Math.abs(x.margin || 0)));
  $("projCard").innerHTML = head + `<div class="c-goal"><span class="p" data-w="${C.running ? Math.min(100, C.projection / max * 100) : 0}"></span><span class="f" data-w="${Math.min(100, t.brut / max * 100)}"></span>${g ? `<span class="mk" style="left:${Math.min(99, g / max * 100)}%"><span>Objectif</span></span>` : ""}</div>
    ${window.RK === "assistant" ? "" : `<div class="c-lab" style="margin-top:22px">Marge agence · ${P.length} dernières quinzaines</div>
    <div class="c-spark">${P.map((x, i) => `<i class="${x.key === PERIOD ? "cur" : ""}${x.margin < 0 ? " neg" : ""}" data-h="${Math.abs(x.margin || 0) / mm * 100}" title="${esc(x.label)} : ${E(x.margin)}"><span>${shortLbl(x.key)}</span></i>`).join("")}</div>`}`;
  requestAnimationFrame(() => requestAnimationFrame(() => { $("projCard").querySelectorAll("[data-w]").forEach(e => e.style.width = e.dataset.w + "%"); $("projCard").querySelectorAll("[data-h]").forEach(e => e.style.height = e.dataset.h + "%"); }));
}
function renderAlerts() {
  const out = [];
  C.models.filter(m => m.missing && m.missing.length).forEach(m => {
    const names = m.missing.map(k => SRCS.find(s => s[0] === k)[1]);
    out.push(`<div class="c-al r"><span class="i">!</span><div><b>${esc(m.name)} : ${names.length > 2 ? names.length + " entrées" : names.join(" et ")} pas encore saisi${names.length > 1 ? "es" : ""}</b><small>Son CA ne compte que le chatting et les entrées déjà remplies.</small>${locked() ? "" : `<button class="c-sb" data-goto="${m.id}:${m.missing[0]}">Saisir</button>`}</div></div>`);
  });
  if (C.pending.n) out.push(`<div class="c-al w"><span class="i">⏳</span><div><b>${C.pending.n} vente${C.pending.n > 1 ? "s" : ""} en attente · ${E(C.pending.total)}</b><small>Tant qu'elles ne sont pas validées, le chatting et la paie peuvent encore changer.</small><a class="c-sb" href="/ventes" style="display:inline-flex;align-items:center;text-decoration:none">Voir les ventes</a></div></div>`);
  const unpaid = C.chatters.filter(c => c.pay > 0 && !c.paid);
  if (!C.running && unpaid.length) out.push(`<div class="c-al w"><span class="i">€</span><div><b>${unpaid.length} chatter${unpaid.length > 1 ? "s" : ""} pas encore payé${unpaid.length > 1 ? "s" : ""}</b><small>${unpaid.map(c => esc(c.username)).join(", ")} · ${E(unpaid.reduce((t, c) => t + c.pay, 0))} au total</small></div></div>`);
  if (C.models.some(m => m.legacy)) out.push(`<div class="c-al w"><span class="i">i</span><div><b>CA saisi d'un bloc (ancien système)</b><small>Remplis les entrées d'une créatrice pour passer au calcul par sources : le chatting sera alors ajouté automatiquement.</small></div></div>`);
  $("alerts").innerHTML = out.join("");
  document.querySelectorAll("[data-goto]").forEach(b => b.onclick = () => { const [m, k] = b.dataset.goto.split(":"), i = document.querySelector(`[data-src="${k}"][data-m="${m}"]`);
    if (i) { i.scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(() => i.focus(), 400); } });
}
function payable() { return C.chatters.filter(c => c.active || c.pay > 0 || c.sales > 0); }
function renderPay() {
  const L = payable();
  const st = (c, i) => c.paid ? `<span class="c-tag v"><i></i>Payé · ${dShort(c.paid.at)}</span>` : c.pay > 0 ? `<button class="c-sb w" data-pay="${c.id}">Payer</button>` : `<span class="c-mut">Rien à payer</span>`;
  const adj = c => c.adjTotal ? `<span class="c-adj ${c.adjTotal < 0 ? "n" : ""}">${c.adjTotal > 0 ? "+" : ""}${E(c.adjTotal)}</span>` : "—";
  const sub = c => `${c.salesCount} vente${c.salesCount > 1 ? "s" : ""} · ${hrs(c.hours)}${c.renfortHours ? " · renfort " + hrs(c.renfortHours) : ""}`;
  $("payTable").innerHTML = !L.length ? `<div class="c-empty">Aucun chatter sur cette période.</div>` :
    `<table class="c-pay"><tr><th>CHATTER</th><th class="r">VENTES NETTES</th><th class="r">COMMISSION</th><th class="r">AJUST.</th><th class="r">TOTAL</th><th class="r">STATUT</th></tr>` +
    L.map((c, i) => `<tr class="c-row${c.paid ? " paid" : ""}" data-row="${c.id}" style="animation-delay:${.05 + i * .04}s"><td><div class="c-who"><span class="c-av">${esc(c.username[0])}</span><div><b>${esc(c.username)} <span class="c-tier ${c.rate >= 15 ? "top" : ""}">${c.rate} %</span></b><small>${sub(c)}</small></div></div></td>
      <td class="r">${E(c.sales)}</td><td class="r">${E(c.commission + c.prime)}</td><td class="r">${adj(c)}</td><td class="r c-tot">${E(c.pay)}</td><td class="r">${st(c, i)}</td></tr>`).join("") + `</table>
    <div class="c-mcards">${L.map((c, i) => `<div class="c-mc${c.paid ? " paid" : ""}" data-row="${c.id}" style="animation-delay:${.05 + i * .04}s"><div class="r1"><div class="c-who"><span class="c-av">${esc(c.username[0])}</span><div><b>${esc(c.username)} <span class="c-tier ${c.rate >= 15 ? "top" : ""}">${c.rate} %</span></b><small>${sub(c)}</small></div></div>${st(c, i)}</div>
      <div class="r2"><span>Ventes nettes<b>${E(c.sales)}</b></span><span>Ajustements<b>${adj(c)}</b></span><span style="text-align:right">Total<b>${E(c.pay)}</b></span></div></div>`).join("")}</div>`;
  const P = L.filter(c => c.pay > 0), n = P.filter(c => c.paid).length, due = P.filter(c => !c.paid).reduce((t, c) => t + c.pay, 0);
  $("paidN").textContent = `${n} / ${P.length} payé${n > 1 ? "s" : ""}`; $("paidBar").style.width = (P.length ? n / P.length * 100 : 0) + "%";
  $("dueTxt").textContent = !P.length ? "" : due ? `${E(due)} restent à payer` : "Tout le monde est payé";
  document.querySelectorAll("[data-row]").forEach(r => r.onclick = () => openFiche(+r.dataset.row));
  document.querySelectorAll("[data-pay]").forEach(b => b.onclick = e => { e.stopPropagation(); setPaid(+b.dataset.pay, true); });
}
async function setPaid(uid, paid) {
  const c = C.chatters.find(x => x.id === uid);
  try { await api("/api/admin/payouts", { body: { period: PERIOD, user_id: uid, paid } }); paid ? VS.ok() : VS.tick();
    notify(paid ? `${c.username} payé` : "Paiement annulé", paid ? E(c.pay) : `${c.username} repasse à payer`, paid ? "ok" : "info");
    if (paid && OPEN === uid) { $("drawer").classList.add("paid"); $("drawer").classList.remove("static"); }
    await loadQ(); } catch (e) { notify("Erreur", e.message, "err"); }
}

/* ----- fiche de paie ----- */
function openFiche(uid) { const c = C.chatters.find(x => x.id === uid); if (!c) return; OPEN = uid; renderFiche(c); $("drawer").classList.add("on"); $("scrim").classList.add("on"); VS.open(); }
function closeFiche() { OPEN = null; $("drawer").classList.remove("on"); $("scrim").classList.remove("on"); }
$("scrim").onclick = closeFiche;
addEventListener("keydown", e => { if (e.key === "Escape" && OPEN != null) closeFiche(); });
function renderFiche(c, refresh) {
  const d = $("drawer"), keepAdd = refresh && d.querySelector(".c-addf.on");
  d.classList.toggle("paid", !!c.paid); if (c.paid) d.classList.add("static");
  const max = Math.max(c.sales, 2000);
  const BD = C.bands ? C.bands.map(([a, b, r]) => [a, b == null ? Infinity : b, r]) : BANDS;
  const tiers = BD.map(([a, b, r], k) => { const part = Math.max(0, Math.min(c.sales, b) - a), span = Math.min(b, max) - a;
    return `<div class="c-trr"><span>${r} %${b === Infinity ? " et +" : ""}</span><span class="t"><i data-w="${part && span > 0 ? Math.max(4, Math.min(100, part / span * 100)) : 0}" style="background:${k === BD.length - 1 ? "#5fd3a2" : "#bdbdbd"}"></i></span><span>${part ? E(part * r / 100) : "—"}</span></div>`; }).join("");
  d.innerHTML = `<span class="c-stamp">PAYÉ</span><div class="c-dh"><span class="c-av">${esc(c.username[0])}</span><div><b>${esc(c.username)}</b><small>Fiche de paie · ${esc(C.period.label)}</small></div><button class="c-x" aria-label="Fermer">✕</button></div>
    <div class="c-dtot"><small>TOTAL ${c.paid ? "PAYÉ" : "À PAYER"}</small><span id="dTot">${E(c.pay)}</span></div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><span class="c-tag ${c.rate >= 15 ? "v" : "w"}"><i></i>Palier ${c.rate} %${c.prime ? ` + prime ${c.prime} €` : ""}</span><span class="c-tag w"><i></i>${hrs(c.hours)} pointées${c.renfortHours ? ` · ${hrs(c.renfortHours)} de renfort` : ""}</span></div>
    <div class="c-lab" style="margin-top:20px">Commission par tranche · sur ${E(c.sales)} ${C.base === "brut" ? "brut" : "net"}</div><div class="c-tiers">${tiers}</div>
    <div class="c-lines">
      <div class="c-ln"><span>Ventes validées<small>${c.salesCount} vente${c.salesCount > 1 ? "s" : ""} · ${E(c.salesBrut)} brut</small></span><b>${E(c.sales)} ${C.base === "brut" ? "brut" : "net"}</b></div>
      <div class="c-ln"><span>Commission</span><b>${E(c.commission)}</b></div>
      ${c.prime ? `<div class="c-ln"><span>Prime de palier</span><b>+${E(c.prime)}</b></div>` : ""}
      ${c.adjustments.map(a => `<div class="c-ln adj ${a.amount < 0 ? "n" : ""}"><span>${a.amount > 0 ? "Prime" : "Retenue"}<small>${esc(a.reason || "Sans motif")}${a.by ? " · par " + esc(a.by) : ""}</small></span><span style="display:flex;align-items:center"><b>${a.amount > 0 ? "+" : ""}${E(a.amount)}</b>${locked() ? "" : `<button class="del" data-adel="${a.id}" aria-label="Supprimer">✕</button>`}</span></div>`).join("")}
    </div>
    ${locked() ? `<div class="c-mut" style="margin-top:12px">Période clôturée : rouvre-la pour modifier la fiche.</div>` : `<button class="c-sb" id="addT" style="margin-top:12px">+ Ajouter une prime ou une retenue</button>
    <div class="c-addf${keepAdd ? " on" : ""}"><div class="c-chips" id="aSign"><button class="on" data-s="1">+ Prime</button><button data-s="-1">− Retenue</button></div>
      <div class="row" style="margin-top:8px"><input class="amt" id="aAmt" value="20" inputmode="decimal" aria-label="Montant"><input id="aWhy" maxlength="160" placeholder="Motif (visible sur la fiche du chatter)"></div>
      <div class="c-chips" id="aSugg"><button>Meilleur chatter de la semaine</button><button>Objectif atteint</button><button>Absence non prévenue</button><button>Retards répétés</button></div>
      <button class="c-sb w" id="aGo" style="margin-top:10px;width:100%;height:36px">Ajouter</button></div>`}
    ${c.paid ? `<div class="c-paidok"><span>✓ Payé le ${dShort(c.paid.at)} · ${E(c.paid.amount)}</span><button class="c-sb" id="unpay">Annuler</button></div>${Math.abs(c.paid.amount - c.pay) > .01 ? `<div class="c-mut" style="margin-top:8px;color:#e0a3a3">Le total a changé depuis le paiement (${E(c.pay - c.paid.amount)}).</div>` : ""}` : ""}
    <div class="c-dacts"><button class="c-gbtn" id="copyR">Copier le récap</button>${c.paid ? "" : `<button class="c-wbtn" id="payB" ${c.pay > 0 ? "" : "disabled"}>Marquer comme payé</button>`}</div>`;
  d.querySelector(".c-x").onclick = closeFiche;
  requestAnimationFrame(() => requestAnimationFrame(() => d.querySelectorAll("[data-w]").forEach(i => i.style.width = i.dataset.w + "%")));
  const pb = $("payB"); if (pb) pb.onclick = () => setPaid(c.id, true);
  const up = $("unpay"); if (up) up.onclick = () => setPaid(c.id, false);
  $("copyR").onclick = async () => {
    const txt = [`StellADS · Paie de ${c.username} · ${C.period.label}`, `Ventes validées : ${E(c.sales)} (${c.salesCount} ventes)`, `Palier : ${c.rate} %`, `Commission : ${E(c.commission)}`,
      c.prime ? `Prime de palier : +${E(c.prime)}` : "", ...c.adjustments.map(a => `${a.amount > 0 ? "Prime" : "Retenue"} : ${a.amount > 0 ? "+" : ""}${E(a.amount)} (${a.reason || "sans motif"})`), `TOTAL : ${E(c.pay)}${c.paid ? ` · payé le ${dShort(c.paid.at)}` : ""}`].filter(Boolean).join("\n");
    try { await navigator.clipboard.writeText(txt); notify("Récap copié", "Tu peux le coller dans un message", "ok"); } catch (e) { notify("Impossible de copier", "", "err"); }
  };
  d.querySelectorAll("[data-adel]").forEach(b => b.onclick = async () => { await api(`/api/admin/adjustments/${b.dataset.adel}`, { method: "DELETE" }); VS.tick(); await loadQ(); });
  const at = $("addT"); if (!at) return;
  at.onclick = () => d.querySelector(".c-addf").classList.toggle("on");
  const sign = $("aSign"); sign.querySelectorAll("button").forEach(b => b.onclick = () => { sign.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); VS.tick(); });
  $("aSugg").querySelectorAll("button").forEach(b => b.onclick = () => { $("aWhy").value = b.textContent; const neg = /Absence|Retard/.test(b.textContent);
    sign.querySelectorAll("button").forEach(x => x.classList.toggle("on", x.dataset.s === (neg ? "-1" : "1"))); $("aAmt").value = neg ? 10 : 20; VS.tick(); });
  $("aGo").onclick = async () => {
    const s = +sign.querySelector("button.on").dataset.s, v = Math.abs(parseNum($("aAmt").value) || 0) * s;
    if (!v) return notify("Montant invalide", "", "err");
    try { await api("/api/admin/adjustments", { body: { period: PERIOD, user_id: c.id, amount: v, reason: $("aWhy").value } }); VS.ok();
      notify(v > 0 ? "Prime ajoutée" : "Retenue ajoutée", `${c.username} · ${v > 0 ? "+" : ""}${E(v)}`, v > 0 ? "ok" : "info");
      d.querySelector(".c-addf").classList.remove("on"); await loadQ();
      const last = $("drawer").querySelectorAll(".c-ln.adj"); if (last.length) last[last.length - 1].classList.add("new");
    } catch (e) { notify("Erreur", e.message, "err"); }
  };
}

/* ----- créatrices ----- */
function renderCreators() {
  const tops = {}; C.lines.forEach(l => { (tops[l.model_id] = tops[l.model_id] || []).push(l); });
  $("creators").innerHTML = !C.models.length ? `<div class="c-empty">Aucune créatrice : ajoute-en dans Gestion.</div>` : C.models.map((m, k) => {
    const tp = (tops[m.id] || []).filter(l => l.validatedBrut > 0).sort((a, b) => b.validatedBrut - a.validatedBrut).slice(0, 2);
    const paidAll = m.creatorPaid > 0 && m.creatorPaid >= m.creatorPay - .01;
    return `<div class="c-cr${m.missing.length ? " warn" : ""}" style="animation-delay:${.05 + k * .05}s" data-cr="${m.id}">
      <div class="r1"><span class="c-av">${esc(m.name[0])}</span><div><b>${esc(m.name)}</b><small><input class="pct" data-cpct="${m.id}" value="${fix2(m.creator_pct)}" inputmode="decimal" aria-label="Pourcentage reversé à ${esc(m.name)}"> % du net reversé</small></div>
        <div class="ca"><small>CA NET</small><span class="cab">${E(m.net)}</span><small style="letter-spacing:0;margin-top:2px">brut ${E(m.brut)}</small></div></div>
      ${m.legacy ? `<div class="c-legacy">CA saisi d'un bloc : <b>${E(m.brut)}</b> brut. Remplis une entrée ci-dessous pour passer au calcul par sources (chatting automatique + entrées nettes).</div>` : ""}
      <div class="c-srs">
        <div class="c-sr auto"><span>Chatting <em class="c-tag v" style="font-style:normal"><i></i>auto · ${m.chatCount} vente${m.chatCount > 1 ? "s" : ""}</em></span><b>${E(m.chatNet)}</b></div>
        <div class="c-sr sub"><span>${E(m.chatBrut)} brut − ${fix2(C.fee)} % de la plateforme</span></div>
        ${SRCS.map(([k, l]) => `<div class="c-sr${m.sources[k] == null && !m.legacy ? " miss" : ""}"><span>${l}</span><label><input data-src="${k}" data-m="${m.id}" value="${m.sources[k] == null ? "" : fix2(m.sources[k])}" placeholder="${m.legacy ? "0" : "à saisir"}" inputmode="decimal" aria-label="${l} de ${esc(m.name)} (net)"> €</label></div>`).join("")}
      </div>
      <div class="c-mut" style="margin-top:6px;font-size:11px">Abonnements, Live, Collections et Média push : montants nets, comptés tels quels</div>
      <div class="vs"><span>Sa part<b>${E(m.creatorPay)}</b></span><span>Déjà versé<b>${E(m.creatorPaid)}</b></span><span>Reste à verser<b>${E(Math.max(0, m.creatorPay - m.creatorPaid))}</b></span></div>
      <div class="vb"><i data-w="${m.creatorPay > 0 ? Math.min(100, m.creatorPaid / m.creatorPay * 100) : 0}"></i></div>
      <div class="ft"><div class="c-tops">${tp.map(l => `<span><b>${esc(l.username)}</b> ${E(l.validatedBrut)}</span>`).join("")}</div>
        ${paidAll ? `<span class="c-tag v" title="Versé le ${dShort(m.creatorPaidAt)}"><i></i>Tout est versé</span>${locked() ? "" : ` <button class="c-sb" data-unvers="${m.id}" title="Annuler">↺</button>`}` : m.creatorPay > 0 ? `<button class="c-sb" data-vers="${m.id}">Marquer versé</button>` : ""}</div></div>`; }).join("");
  requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll("#creators [data-w]").forEach(i => i.style.width = i.dataset.w + "%")));
  document.querySelectorAll("[data-src]").forEach(inp => inp.onchange = async () => {
    const v = parseNum(inp.value); if (v !== "" && (isNaN(v) || v < 0)) { inp.value = ""; return notify("Montant invalide", "", "err"); }
    try { await api("/api/admin/revenue-source", { method: "PUT", body: { period: PERIOD, model_id: +inp.dataset.m, source: inp.dataset.src, amount: v } });
      inp.classList.add("saved"); VS.tick(); const id = inp.dataset.m, k = inp.dataset.src; await loadQ();
      const cab = document.querySelector(`[data-cr="${id}"] .cab`); if (cab) { cab.classList.add("bump"); }
      const nx = SRCS.map(s => s[0]), ni = document.querySelector(`[data-src="${nx[nx.indexOf(k) + 1]}"][data-m="${id}"]`); if (ni && document.activeElement === document.body) ni.focus();
    } catch (e) { notify("Erreur", e.message, "err"); }
  });
  document.querySelectorAll("[data-src]").forEach(inp => inp.addEventListener("keydown", e => { if (e.key === "Enter") inp.blur(); }));
  if (window.RK !== "founder") document.querySelectorAll("[data-cpct]").forEach(inp => { inp.disabled = true; inp.title = "Réservé au Fondateur"; });
  document.querySelectorAll("[data-cpct]").forEach(inp => inp.onchange = async () => { try { await api(`/api/admin/models/${inp.dataset.cpct}/pct`, { method: "PUT", body: { creator_pct: parseNum(inp.value) } }); await loadQ(); } catch (e) { notify("Erreur", e.message, "err"); } });
  document.querySelectorAll("[data-vers]").forEach(b => b.onclick = async () => { await api("/api/admin/creator-paid", { body: { period: PERIOD, model_id: +b.dataset.vers } }); VS.ok(); notify("Part versée", C.models.find(m => m.id === +b.dataset.vers).name, "ok"); loadQ(); });
  document.querySelectorAll("[data-unvers]").forEach(b => b.onclick = async () => { await api("/api/admin/creator-paid", { body: { period: PERIOD, model_id: +b.dataset.unvers, paid: false } }); loadQ(); });
}

/* ----- clôture ----- */
function renderChecks() {
  const full = C.models.filter(m => !m.missing.length).length, P = payable().filter(c => c.pay > 0), paid = P.filter(c => c.paid).length;
  const ck = (cls, ic, txt) => `<span><i class="${cls}">${ic}</i>${txt}</span>`;
  $("checks").innerHTML = ck(full === C.models.length ? "ok" : "ko", full === C.models.length ? "✓" : "!", `CA complet : ${full} / ${C.models.length} créatrice${C.models.length > 1 ? "s" : ""}`)
    + ck(C.pending.n ? "ko" : "ok", C.pending.n ? C.pending.n : "✓", C.pending.n ? `Vente${C.pending.n > 1 ? "s" : ""} en attente` : "Aucune vente en attente")
    + ck(paid === P.length ? "ok" : "mid", paid === P.length ? "✓" : paid, `Chatters payés : ${paid} / ${P.length}`)
    + (C.running ? ck("mid", "◷", "La quinzaine n'est pas finie") : "");
  $("lockTxt").textContent = C.locked ? `Le ${dShort(C.locked.at)}${C.locked.by ? " par " + C.locked.by : ""} · chiffres figés` : "";
  const b = $("closeBtn"); b.textContent = "Clôturer la période"; delete b.dataset.force;
  if (window.RK !== "founder") { b.disabled = true; b.textContent = "Clôture réservée au Fondateur"; b.title = "Seul le Fondateur peut clôturer une période"; const r = $("reopenBtn"); if (r) { r.disabled = true; r.title = "Réservé au Fondateur"; } }
}
$("closeBtn").onclick = async () => {
  const b = $("closeBtn"), P = payable().filter(c => c.pay > 0);
  const issues = [C.models.some(m => m.missing.length) && "CA incomplet", C.pending.n && `${C.pending.n} vente(s) en attente`, P.some(c => !c.paid) && "chatters pas tous payés", C.running && "quinzaine pas finie"].filter(Boolean);
  if (issues.length && !b.dataset.force) { b.dataset.force = 1; b.textContent = "Clôturer quand même"; notify("Avant de clôturer", issues.join(" · "), "info"); return; }
  try { await api(`/api/admin/periods/${PERIOD}/close`, { body: {} }); VS.lock(); notify("Période clôturée", "Plus aucune modification possible sur cette quinzaine", "ok"); await loadQ(); } catch (e) { notify("Erreur", e.message, "err"); }
};
$("reopenBtn").onclick = async () => { await api(`/api/admin/periods/${PERIOD}/reopen`, { body: {} }); VS.tick(); notify("Période rouverte", "Les chiffres sont de nouveau calculés en direct", "info"); loadQ(); };

/* ----- réglages et détail ----- */
function renderMore() {
  $("feeInp").value = fix2(C.fee); $("modeSel").value = C.mode; $("baseSel").value = C.base; $("goalCa").value = fix2(C.goals.ca);
  $("linesTable").innerHTML = !C.lines.length ? `<div class="c-empty">${C.mode === "ventes" ? "Aucune vente validée sur cette période." : "Aucune heure pointée sur cette période."}</div>` :
    `<table><tr><th>Chatter</th><th>Créatrice</th><th class="n">Heures</th>${C.mode === "ventes" ? '<th class="n">Ventes validées (brut)</th>' : ""}<th class="n">Calcul auto</th><th class="n">Montant retenu</th><th class="n">Commission</th></tr>` +
    C.lines.map(l => `<tr><td><b>${esc(l.username)}</b></td><td>${esc(l.model_name)}</td><td class="n">${hrs(l.hours)}</td>${C.mode === "ventes" ? `<td class="n">${E(l.validatedBrut)}</td>` : ""}<td class="n">${E(l.auto)}</td>
      <td class="n"><input class="money" inputmode="decimal" data-attr="${l.user_id}:${l.model_id}" value="${l.override == null ? "" : fix2(l.override)}" placeholder="${fix2(l.auto)}" ${locked() ? "disabled" : ""} aria-label="Montant retenu"></td><td class="n">${E(l.pay)}</td></tr>`).join("") + "</table>";
  document.querySelectorAll("[data-attr]").forEach(inp => inp.onchange = async () => { const [u, m] = inp.dataset.attr.split(":"), v = parseNum(inp.value);
    try { await api("/api/admin/attribution", { method: "PUT", body: { period: PERIOD, user_id: u, model_id: m, amount: v === "" ? null : v } }); loadQ(); } catch (e) { notify("Erreur", e.message, "err"); } });
}
const saveSet = async (body) => { try { await api("/api/admin/settings", { method: "PUT", body }); VS.tick(); notify("Réglage enregistré", "", "ok"); loadQ(); } catch (e) { notify("Erreur", e.message, "err"); } };
$("feeInp").onchange = () => saveSet({ platform_fee: parseNum($("feeInp").value), period: PERIOD });
$("modeSel").onchange = () => saveSet({ attribution_mode: $("modeSel").value });
$("baseSel").onchange = () => saveSet({ commission_base: $("baseSel").value });
$("goalCa").onchange = () => saveSet({ goal_ca: parseNum($("goalCa").value) });

/* ======================= MOIS ======================= */
async function loadM(m) {
  M = await api("/api/admin/compta/month" + (m || MONTH ? `?month=${m || MONTH}` : "")); MONTH = M.month;
  root.classList.remove("locked");
  const lab = M.label.charAt(0).toUpperCase() + M.label.slice(1), t = M.totals;
  $("pLab").textContent = lab; $("mLab").textContent = lab;
  $("mTrend").outerHTML = `<span id="mTrend">${trendHtml(t.brut, M.prevBrut)}</span>`;
  countTo($("mBrut"), t.brut, N0, 1100); countTo($("mNet"), t.net); if (window.RK === "assistant") $("mMargin").closest(".c-sub").style.display = "none"; else countTo($("mMargin"), t.margin);
  srcBar($("mSrc"), t.sources, t.sources.legacy); flowBar($("mFlow"), $("mLeg"), t, C ? C.fee : 25);
  const allLocked = M.halves.every(h => h.locked), allPaid = M.halves.every(h => h.paid >= h.payable);
  $("mState").innerHTML = allLocked ? `<span class="c-tag v"><i></i>Clôturé${allPaid ? " · payé" : ""}</span>` : `<span class="c-tag w"><i></i>${M.halves.some(h => h.locked) ? "1 quinzaine clôturée" : "En cours"}</span>`;
  const mx = Math.max(1, ...M.halves.map(h => h.totals.brut));
  $("mHalves").innerHTML = M.halves.map(h => `<div data-goq="${h.key}" title="Ouvrir cette quinzaine"><small>${esc(h.label)}</small><b>${E(h.totals.brut)}</b><span class="c-qb"><i data-w="${h.totals.brut / mx * 100}"></i></span>
    ${window.RK === "assistant" ? "" : `<em style="color:${h.totals.margin >= 0 ? "#5fd3a2" : "#e07a7a"}">Marge ${E(h.totals.margin)}</em>`}<span class="c-tag ${h.locked ? "v" : "w"}"><i></i>${h.locked ? "Clôturée" : "Ouverte"} · ${h.paid}/${h.payable} payés</span></div>`).join("");
  const pm = Math.max(1, ...M.chatters.map(c => c.pay));
  $("mPay").innerHTML = !M.chatters.length ? `<div class="c-empty">Aucune paie ce mois-ci.</div>` : M.chatters.map(c => `<div><span>${esc(c.username)}</span><span class="t"><i data-w="${c.pay / pm * 100}"></i></span><b>${E(c.pay)}</b>
    <span class="st">${c.paidAll ? '<span class="c-tag v"><i></i>Payé</span>' : '<span class="c-tag w"><i></i>À payer</span>'}</span></div>`).join("");
  $("mPayTot").textContent = `Total ${E(t.chatters)}`;
  $("mCreators").innerHTML = M.models.map(m => `<div class="c-mrow"><div><b>${esc(m.name)}</b><small>Net ${E(m.net)} · brut ${E(m.brut)}</small></div><div style="text-align:right"><b>${E(m.creatorPay)}</b><small>${m.creatorPaid >= m.creatorPay - .01 && m.creatorPay > 0 ? "tout est versé" : `reste ${E(Math.max(0, m.creatorPay - m.creatorPaid))}`}</small></div></div>`).join("") || `<div class="c-empty">Aucune créatrice.</div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => $("vM").querySelectorAll("[data-w]").forEach(i => i.style.width = i.dataset.w + "%")));
  document.querySelectorAll("[data-goq]").forEach(d => d.onclick = () => { PERIOD = d.dataset.goq; setView("q"); });
}

/* ======================= navigation ======================= */
function setView(v) {
  VIEW = v; document.querySelectorAll("[data-pm]").forEach(b => b.classList.toggle("on", b.dataset.pm === v));
  $("vQ").classList.toggle("hidden", v !== "q"); $("vM").classList.toggle("hidden", v !== "m");
  v === "q" ? loadQ() : loadM();
}
document.querySelectorAll("[data-pm]").forEach(b => b.onclick = () => { if (b.dataset.pm !== VIEW) { VS.tick(); setView(b.dataset.pm); } });
$("prevP").onclick = () => VIEW === "q" ? loadQ(C.period.prev) : loadM(M.prev);
$("nextP").onclick = () => VIEW === "q" ? loadQ(C.period.next) : loadM(M.next);

// Export CSV lisible par Excel (point-virgule, virgule décimale, accents)
$("exportBtn").onclick = () => {
  const n = v => v == null ? "" : String(Math.round(v * 100) / 100).replace(".", ",");
  const q = s => `"${String(s ?? "").replace(/"/g, '""')}"`;
  let rows, name;
  if (VIEW === "m") {
    rows = [[`StellADS — Récap ${M.label}`], [], ["RÉSUMÉ"], ["CA brut", n(M.totals.brut)], ["CA net", n(M.totals.net)], ["Part des créatrices", n(M.totals.creators)], ["Paie des chatters", n(M.totals.chatters)], ["Marge de l'agence", n(M.totals.margin)], [],
      ["QUINZAINES"], ["Période", "CA brut", "CA net", "Marge", "Clôturée"], ...M.halves.map(h => [h.label, n(h.totals.brut), n(h.totals.net), n(h.totals.margin), h.locked ? "oui" : "non"]), [],
      ["PAIE DES CHATTERS"], ["Chatter", "Ventes", "Paie du mois", "1re quinzaine", "2e quinzaine", "Tout payé"], ...M.chatters.map(c => [c.username, n(c.sales), n(c.pay), n(c.halves[0]?.pay), n(c.halves[1]?.pay), c.paidAll ? "oui" : "non"]), [],
      ["CRÉATRICES"], ["Créatrice", "CA brut", "CA net", "Sa part", "Déjà versé"], ...M.models.map(m => [m.name, n(m.brut), n(m.net), n(m.creatorPay), n(m.creatorPaid)])];
    name = `stellads-compta-${M.month}.csv`;
  } else {
    rows = [[`StellADS — Compta ${C.period.label}${C.locked ? " (clôturée)" : ""}`], [],
      ["CRÉATRICES"], ["Créatrice", "Chatting brut", "Chatting net", "Abonnements", "Live", "Collections", "Média push", "CA net", "CA brut", "% créatrice", "Sa part", "Déjà versé"],
      ...C.models.map(m => [m.name, n(m.chatBrut), n(m.chatNet), n(m.sources.abo), n(m.sources.live), n(m.sources.coll), n(m.sources.push), n(m.net), n(m.brut), n(m.creator_pct), n(m.creatorPay), n(m.creatorPaid)]),
      ["Total", "", "", "", "", "", "", n(C.totals.net), n(C.totals.brut), "", n(C.totals.creators)], [],
      ["PAIE DES CHATTERS"], ["Chatter", "Ventes", "Palier %", "Commission", "Prime de palier", "Ajustements", "Total", "Heures", "Payé le"],
      ...payable().map(c => [c.username, n(c.sales), n(c.rate), n(c.commission), n(c.prime), n(c.adjTotal), n(c.pay), n(c.hours), c.paid ? new Date(c.paid.at).toLocaleDateString("fr-FR") : ""]),
      ["Total", "", "", "", "", "", n(C.totals.chatters)], [],
      ["PRIMES ET RETENUES"], ["Chatter", "Montant", "Motif"], ...C.chatters.flatMap(c => c.adjustments.map(a => [c.username, n(a.amount), a.reason])), [],
      ["RÉSUMÉ"], ["CA brut", n(C.totals.brut)], ["CA net", n(C.totals.net)], ["Plateforme", n(C.totals.platform)], ["Marge de l'agence", n(C.totals.margin)]];
    name = `stellads-compta-${C.period.key}.csv`;
  }
  const csv = "﻿" + rows.map(r => r.map(q).join(";")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
};

(async () => {
  const me = await api("/api/me");
  if (me.role !== "admin") { location.href = "/paie"; return; }
  renderShell("compta", me);
  await loadQ();
})();
