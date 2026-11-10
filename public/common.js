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
  { id: "simu", label: "Simu Chatter", href: "/app", icon: "chat", section: "Formation", roles: ["admin", "chatter"],
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
function renderShell(active, me) {
  const el = document.getElementById("sidebar"); if (!el) return;
  const mods = MODULES.filter(m => m.roles.includes(me.role));
  let html = `<a class="logo" href="/home"><img src="/logo.svg" alt="StellADS"></a><nav>`, sec;
  for (const m of mods) {
    if (m.section && m.section !== sec) { sec = m.section; html += `<div class="sec">${esc(sec)}</div>`; }
    html += `<a href="${m.href}" class="${m.id === active ? "on" : ""}" ${m.id === active ? 'aria-current="page"' : ""}>${icon(m.icon)}<span>${esc(m.label)}</span>${m.id === "ventes" && me.role === "admin" ? '<em class="navbadge hidden" id="salesBadge"></em>' : ""}</a>`;
  }
  html += `</nav><div class="me"><span class="av">${esc(me.username[0])}</span><div><b>${esc(me.username)}</b><small>${me.role === "admin" ? "Manager" : "Chatter"}</small></div>
    <button onclick="logout()" title="Déconnexion" aria-label="Déconnexion">${icon("logout")}</button></div>`;
  el.innerHTML = html;
  if (me.role === "admin") api("/api/admin/sales/count").then(c => updateBadge(c.pending)).catch(() => {});
}
function updateBadge(n) { const b = document.getElementById("salesBadge"); if (!b) return; b.textContent = n; b.classList.toggle("hidden", !n); }

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
