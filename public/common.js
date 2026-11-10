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
