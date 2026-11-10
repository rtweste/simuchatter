// Fonctions partagées entre les pages
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmtDate = t => new Date(t).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
const scoreColor = s => s >= 70 ? "var(--good)" : s >= 50 ? "var(--warn)" : "var(--bad)";
const LEVEL = { 1: ["Facile", "t1"], 2: ["Moyen", "t2"], 3: ["Avancé", "t3"] };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin"
  });
  if (res.status === 401 && !opts.noRedirect && !path.includes("/login")) { location.href = "/"; throw new Error("Non connecté"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Erreur " + res.status);
  return data;
}

/* ===== Portail StellADS : rubriques =====
   Pour ajouter une rubrique : ajoutez une ligne ici et créez la page correspondante.
   roles : qui la voit ("admin", "chatter"). */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/>',
  team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  euro: '<path d="M18 7.5A7 7 0 1 0 18 16.5"/><path d="M4 10.5h9M4 13.5h9"/>'
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ""}</svg>`;
const MODULES = [
  { id: "home", label: "Accueil", href: "/home", icon: "home", section: null, roles: ["admin", "chatter"] },
  { id: "simu", label: "Simu Chatter", short: "Simu", href: "/app", icon: "chat", section: "Formation", roles: ["admin", "chatter"],
    desc: "Entraînez-vous face à un fan simulé par l'IA et recevez une évaluation détaillée." },
  { id: "planning", label: "Planning", href: "/planning", icon: "calendar", section: "Organisation", roles: ["admin", "chatter"],
    desc: "Créneaux de la semaine et pointage des shifts." },
  { id: "ventes", label: "Ventes", href: "/ventes", icon: "receipt", section: "Organisation", roles: ["admin", "chatter"],
    desc: "Déclarez vos ventes avec la capture d'écran. Le manager les valide." },
  { id: "compta", label: "Compta", href: "/compta", icon: "euro", section: "Manager", roles: ["admin"],
    desc: "Revenus par période de 15 jours, part des créatrices, commissions des chatters." },
  { id: "admin", label: "Gestion", href: "/admin", icon: "team", section: "Manager", roles: ["admin"],
    desc: "Équipe, créatrices et résultats des simulations." }
];
const eur = n => (n == null || isNaN(n)) ? "—" : Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const hrs = h => { const m = Math.round((h || 0) * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };
const LOGO_SVG = `<svg aria-hidden="true" focusable="false" viewBox="-4 -4 703.5 76.8" xmlns="http://www.w3.org/2000/svg" fill="#fff" aria-label="StellADS" role="img"><g class="letters"><path class="lt lt0" d="M27.8 69.8Q19.8 69.8 14.0 66.75Q8.200000000000001 63.699999999999996 3.8000000000000003 58.199999999999996L8.9 53.199999999999996Q12.4 58.099999999999994 17.05 60.5Q21.700000000000003 62.9 28.1 62.9Q34.7 62.9 38.800000000000004 59.9Q42.900000000000006 56.9 42.900000000000006 51.599999999999994Q42.900000000000006 47.5 41.0 44.849999999999994Q39.1 42.199999999999996 36.05 40.55Q33.0 38.89999999999999 29.3 37.599999999999994Q25.6 36.3 21.950000000000003 34.849999999999994Q18.3 33.4 15.200000000000001 31.199999999999996Q12.100000000000001 28.999999999999993 10.25 25.599999999999994Q8.4 22.199999999999996 8.4 16.89999999999999Q8.4 11.299999999999997 11.100000000000001 7.299999999999997Q13.8 3.299999999999997 18.5 1.1499999999999986Q23.200000000000003 -1.0 29.200000000000003 -1.0Q35.9 -1.0 41.150000000000006 1.5999999999999943Q46.400000000000006 4.199999999999989 49.900000000000006 8.599999999999994L44.900000000000006 13.599999999999994Q41.7 9.799999999999997 37.900000000000006 7.799999999999997Q34.1 5.799999999999997 29.0 5.799999999999997Q23.0 5.799999999999997 19.4 8.599999999999994Q15.8 11.399999999999991 15.8 16.39999999999999Q15.8 20.299999999999997 17.65 22.699999999999996Q19.5 25.099999999999994 22.6 26.699999999999996Q25.700000000000003 28.299999999999997 29.35 29.549999999999997Q33.0 30.799999999999997 36.7 32.3Q40.400000000000006 33.8 43.45 36.099999999999994Q46.5 38.39999999999999 48.400000000000006 41.949999999999996Q50.300000000000004 45.5 50.300000000000004 51.0Q50.300000000000004 59.9 44.25 64.85Q38.2 69.8 27.8 69.8Z"/><path class="lt lt1" d="M113.30000000000001 68.8V1.8999999999999915H120.70000000000002V68.8ZM89.10000000000001 6.699999999999996V0.0H144.9V6.699999999999996Z"/><path class="lt lt2" d="M187.40000000000003 68.8V0.0H194.70000000000002V68.8ZM192.20000000000002 68.8V62.099999999999994H232.70000000000002V68.8ZM192.20000000000002 36.8V30.299999999999997H229.50000000000003V36.8ZM192.20000000000002 6.699999999999996V0.0H232.10000000000002V6.699999999999996Z"/><path class="lt lt3" d="M276.3 68.8V0.0H283.6V68.8ZM281.1 68.8V62.099999999999994H319.0V68.8Z"/><path class="lt lt4" d="M361.7 68.8V0.0H369.0V68.8ZM366.5 68.8V62.099999999999994H404.4V68.8Z"/><path class="lt lt5" d="M469.4 0.0 441.99999999999994 68.8H449.99999999999994L473.69999999999993 8.1H470.79999999999995L494.69999999999993 68.8H502.49999999999994L474.9 0.0Z"/><path class="lt lt6" d="M549.4999999999999 68.8V62.0H569.6999999999999Q577.8 62.0 584.0 58.45Q590.1999999999999 54.9 593.6999999999999 48.64999999999999Q597.1999999999999 42.39999999999999 597.1999999999999 34.3Q597.1999999999999 26.199999999999996 593.6999999999999 19.999999999999996Q590.1999999999999 13.799999999999997 584.0 10.249999999999996Q577.8 6.699999999999996 569.6999999999999 6.699999999999996H549.6999999999999V0.0H569.9Q577.4 0.0 583.75 2.549999999999997Q590.0999999999999 5.099999999999994 594.8499999999999 9.749999999999993Q599.5999999999999 14.399999999999991 602.1999999999999 20.64999999999999Q604.8 26.89999999999999 604.8 34.4Q604.8 41.699999999999996 602.1999999999999 48.0Q599.5999999999999 54.3 594.8999999999999 58.949999999999996Q590.1999999999999 63.599999999999994 583.8499999999999 66.19999999999999Q577.4999999999999 68.8 570.0999999999999 68.8ZM544.9999999999999 68.8V0.0H552.3V68.8Z"/><path class="lt lt7" d="M667.8999999999999 69.8Q659.8999999999999 69.8 654.0999999999999 66.75Q648.3 63.699999999999996 643.8999999999999 58.199999999999996L648.9999999999999 53.199999999999996Q652.4999999999999 58.099999999999994 657.1499999999999 60.5Q661.8 62.9 668.1999999999999 62.9Q674.8 62.9 678.8999999999999 59.9Q682.9999999999999 56.9 682.9999999999999 51.599999999999994Q682.9999999999999 47.5 681.0999999999999 44.849999999999994Q679.1999999999999 42.199999999999996 676.1499999999999 40.55Q673.0999999999999 38.89999999999999 669.3999999999999 37.599999999999994Q665.6999999999999 36.3 662.05 34.849999999999994Q658.3999999999999 33.4 655.3 31.199999999999996Q652.1999999999999 28.999999999999993 650.3499999999999 25.599999999999994Q648.4999999999999 22.199999999999996 648.4999999999999 16.89999999999999Q648.4999999999999 11.299999999999997 651.1999999999998 7.299999999999997Q653.8999999999999 3.299999999999997 658.5999999999999 1.1499999999999986Q663.3 -1.0 669.3 -1.0Q675.9999999999999 -1.0 681.2499999999999 1.5999999999999943Q686.4999999999999 4.199999999999989 689.9999999999999 8.599999999999994L684.9999999999999 13.599999999999994Q681.8 9.799999999999997 678.0 7.799999999999997Q674.1999999999999 5.799999999999997 669.0999999999999 5.799999999999997Q663.0999999999999 5.799999999999997 659.4999999999999 8.599999999999994Q655.8999999999999 11.399999999999991 655.8999999999999 16.39999999999999Q655.8999999999999 20.299999999999997 657.7499999999999 22.699999999999996Q659.5999999999999 25.099999999999994 662.6999999999999 26.699999999999996Q665.8 28.299999999999997 669.4499999999999 29.549999999999997Q673.0999999999999 30.799999999999997 676.8 32.3Q680.4999999999999 33.8 683.55 36.099999999999994Q686.5999999999999 38.39999999999999 688.4999999999999 41.949999999999996Q690.3999999999999 45.5 690.3999999999999 51.0Q690.3999999999999 59.9 684.3499999999999 64.85Q678.3 69.8 667.8999999999999 69.8Z"/></g><path class="star" d="M472.25,35.09 Q472.97,49.51 481.19,50.22 Q472.97,50.94 472.25,65.36 Q471.53,50.94 463.31,50.22 Q471.53,49.51 472.25,35.09Z" style="transform-origin:472.25px 50.22px"/></svg>`;
// Logo animé (reflet qui traverse le mot)
const logoHTML = () => `<span class="lg-sh"><span class="base">${LOGO_SVG}</span><span class="shine">${LOGO_SVG}</span></span>`;
function renderShell(active, me) {
  const el = document.getElementById("sidebar"); if (!el) return;
  const mods = MODULES.filter(m => m.roles.includes(me.role));
  const badge = m => m.id === "ventes" && me.role === "admin";
  let html = `<a class="logo" href="/home" aria-label="StellADS — Accueil">${logoHTML()}</a><nav>`, sec;
  mods.forEach((m, i) => {
    if (m.section && m.section !== sec) { sec = m.section; html += `<div class="sec">${esc(sec)}</div>`; }
    html += `<a href="${m.href}" style="--i:${i}" class="${m.id === active ? "on" : ""}" ${m.id === active ? 'aria-current="page"' : ""}>${icon(m.icon)}<span>${esc(m.label)}</span>${badge(m) ? '<em class="navbadge hidden" data-badge></em>' : ""}</a>`;
  });
  html += `</nav><div class="me"><span class="av">${esc(me.username[0])}</span><div><b>${esc(me.username)}</b><small>${me.role === "admin" ? "Manager" : "Chatter"}</small></div>
    <button onclick="logout()" title="Déconnexion" aria-label="Déconnexion">${icon("logout")}</button></div>`;
  el.innerHTML = html;
  // Le menu de gauche glisse en place une seule fois par session (après l'intro)
  
  // Dock flottant (téléphone)
  let dock = document.getElementById("dock");
  if (!dock) { dock = document.createElement("nav"); dock.id = "dock"; dock.className = "dock"; dock.setAttribute("aria-label", "Navigation principale"); document.body.appendChild(dock); }
  dock.innerHTML = mods.map(m => `<a href="${m.href}" class="di ${m.id === active ? "on" : ""}" ${m.id === active ? 'aria-current="page"' : ""} aria-label="${esc(m.label)}">${icon(m.icon)}<span class="lb">${esc(m.short || m.label)}</span>${badge(m) ? '<em class="navbadge hidden" data-badge></em>' : ""}</a>`).join("");
  // Le menu de gauche et le dock font leur entrée une seule fois par session (après l'intro)
  try { if (!sessionStorage.getItem("stNav")) { el.classList.add("nav-in"); dock.classList.add("dock-in"); sessionStorage.setItem("stNav", "1"); } } catch (e) {}
  dock.querySelectorAll("a").forEach(a => a.addEventListener("click", e => {
    if (a.classList.contains("on") || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    dock.querySelector(".on")?.classList.remove("on");
    a.classList.add("on");
    setTimeout(() => { location.href = a.getAttribute("href"); }, 230); // laisse l'onglet s'ouvrir avant de changer de page
  }));
  if (me.role === "admin") api("/api/admin/sales/count").then(c => updateBadge(c.pending)).catch(() => {});
}
function updateBadge(n) { document.querySelectorAll("[data-badge]").forEach(b => { b.textContent = n; b.classList.toggle("hidden", !n); }); }

async function logout() { await api("/api/logout", { method: "POST" }).catch(() => {}); location.href = "/"; }

// Rendu d'un rapport d'évaluation (utilisé côté chatter et côté manager)
function transcriptText(log) {
  return log.map(l => l.who === "fan" ? `[FAN] ${l.text}` : l.who === "chatter" ? `[CRÉATRICE] ${l.text}` :
    l.who === "ppv" ? `[PPV] « ${l.desc} » — ${l.price} € — ${l.status}` : "").filter(Boolean).join("\n");
}
function renderReport(sim) {
  const r = sim.report || {};
  const ppvs = sim.log.filter(l => l.who === "ppv");
  const crit = (r.criteria || []).map(c => `<div class="crit"><div class="row"><b>${esc(c.name)}</b><b style="color:${scoreColor(c.score * 10)}">${esc(c.score)}/10</b></div>
    <div class="meter" style="margin-top:6px"><div style="width:${Number(c.score) * 10}%;background:${scoreColor(c.score * 10)}"></div></div><p>${esc(c.comment)}</p></div>`).join("");
  const rw = (r.rewrites || []).map(x => `<div class="rewrite"><div class="o">✗ ${esc(x.original)}</div><div class="n">✓ ${esc(x.better)}</div><div style="color:var(--muted);margin-top:4px">${esc(x.why)}</div></div>`).join("");
  return `
  <div class="grid">
    <div class="card">
      <div class="row" style="align-items:flex-end;gap:16px"><div class="score" style="color:${scoreColor(sim.score)}">${sim.score}</div><div style="color:var(--muted);padding-bottom:6px">/ 100${sim.hints ? ` &nbsp;(${r.rawScore} − ${sim.hints * 3} pts de conseils)` : ""}</div></div>
      <p style="margin:10px 0 16px;line-height:1.5">${esc(r.verdict)}</p>
      <div class="row" style="gap:24px;flex-wrap:wrap">
        <div class="kpi"><small>Revenu</small><b style="font-size:16px">${sim.revenue} €</b></div>
        <div class="kpi"><small>Tps réponse moy.</small><b style="font-size:16px">${sim.avgRt !== null ? sim.avgRt + " s" : "—"}</b></div>
        <div class="kpi"><small>PPV achetés</small><b style="font-size:16px">${ppvs.filter(p => p.status === "acheté").length} / ${ppvs.length}</b></div>
        <div class="kpi"><small>Conseils</small><b style="font-size:16px">${sim.hints}</b></div>
      </div>
      ${r.ethics_flag ? `<div class="flag">⚠️ <b>Point éthique :</b> ${esc(r.ethics_flag)}</div>` : ""}
      <h2 style="margin-top:20px">Points forts</h2><ul>${(r.strengths || []).map(s => `<li>${esc(s)}</li>`).join("")}</ul>
      <h2 style="margin-top:14px">À améliorer</h2><ul>${(r.improvements || []).map(s => `<li>${esc(s)}</li>`).join("")}</ul>
    </div>
    <div class="card"><h2>Détail par critère</h2>${crit}</div>
  </div>
  ${rw ? `<div class="card" style="margin-top:20px"><h2>Réécritures suggérées</h2>${rw}</div>` : ""}
  <div class="card" style="margin-top:20px"><h2>Transcription</h2><pre class="transcript">${esc(transcriptText(sim.log))}</pre></div>`;
}

/* ===== Notifications élégantes (glissent du haut de l'écran) =====
   notify("Vente validée", "40 € ajoutés à la compta", "ok" | "info" | "err") */
const NTF_ICONS = { ok: "M5 12.5 10 17.5 19 7", info: "M12 8v5M12 16.5v.01", err: "M6 6l12 12M18 6 6 18" };
function notify(title, sub = "", kind = "ok") {
  let box = document.getElementById("ntfBox");
  if (!box) { box = document.createElement("div"); box.id = "ntfBox"; box.className = "ntfs"; box.setAttribute("role", "status"); box.setAttribute("aria-live", "polite"); document.body.appendChild(box); }
  const n = document.createElement("div"); n.className = "ntf " + kind;
  n.innerHTML = `<span class="ni"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${NTF_ICONS[kind] || NTF_ICONS.ok}"/></svg></span>
    <div class="nt"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div><span class="nl"><i></i></span>`;
  const bye = () => { n.classList.add("out"); setTimeout(() => n.remove(), 300); };
  n.onclick = bye; box.appendChild(n);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(bye, 3400);
}

/* ===== Coche de validation : un cercle et une coche se dessinent sur l'élément ===== */
function stamp(el, kind = "ok") {
  const s = document.createElement("div"); s.className = "stamp " + kind;
  s.innerHTML = kind === "ok"
    ? `<svg width="58" height="58" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="24" cy="24" r="20"/><path d="M15 24.5 21 30.5 33 18"/></svg>`
    : `<svg width="58" height="58" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="24" cy="24" r="20"/><path d="M17 17l14 14M31 17 17 31"/></svg>`;
  if (getComputedStyle(el).position === "static") el.style.position = "relative";
  el.appendChild(s);
  return new Promise(r => setTimeout(r, 1000));
}
// fait disparaître un élément en glissant puis en se repliant
function slideAway(el) {
  return new Promise(r => {
    el.style.maxHeight = el.offsetHeight + "px"; el.classList.add("leave");
    requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add("leaving"); }));
    setTimeout(r, 650);
  });
}

/* ===== Chargements : cartes grises avec un reflet ===== */
const SK = {
  line: (w = "100%", h = 12, mb = 12) => `<div class="sk" style="width:${w};height:${h}px;margin-bottom:${mb}px"></div>`,
  kpis: (n = 4) => `<div class="sk-kpis">${Array.from({ length: n }, () => `<div class="card sk-card">${SK.line("60%", 10, 14)}${SK.line("45%", 20, 0)}</div>`).join("")}</div>`,
  cards: (n = 2, rows = 3) => `<div class="sk-grid">${Array.from({ length: n }, () => `<div class="card sk-card">${SK.line("140px", 14, 20)}${Array.from({ length: rows }, (_, i) => SK.line(["100%", "85%", "92%", "70%"][i % 4])).join("")}</div>`).join("")}</div>`,
  tiles: (n = 6, h = 230) => `<div class="sk-tiles">${Array.from({ length: n }, () => `<div class="card sk-card" style="padding:0;overflow:hidden"><div class="sk" style="height:${h * 0.6}px;border-radius:0"></div><div style="padding:12px">${SK.line("50%", 18, 8)}${SK.line("70%", 10, 0)}</div></div>`).join("")}</div>`,
  table: (n = 5) => `<div class="card sk-card">${SK.line("160px", 14, 20)}${Array.from({ length: n }, () => `<div class="sk-row">${SK.line("22%", 12, 0)}${SK.line("30%", 12, 0)}${SK.line("15%", 12, 0)}</div>`).join("")}</div>`
};

/* ===== Appli installable (écran d'accueil iPhone / installation sur ordinateur) ===== */
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
