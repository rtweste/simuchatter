// Fonctions partagées entre les pages
const $ = id => document.getElementById(id);
// Quand l'accueil est affiché dans le cadre de l'ouverture (après l'intro), les liens ouvrent la vraie page
const EMBED = window !== window.top;
if (EMBED) document.head.insertAdjacentHTML("afterbegin", '<base target="_top">');
const go = url => { try { (EMBED ? window.top : window).location.href = url; } catch (e) { location.href = url; } };
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
  if (res.status === 401 && !opts.noRedirect && !path.includes("/login")) { go("/"); throw new Error("Non connecté"); }
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
  { id: "home", label: "Accueil", href: "/home", icon: "home", section: null, roles: ["admin", "chatter", "trainee"] },
  { id: "simu", label: "Simu Chatter", short: "Simu", href: "/app", icon: "chat", section: "Formation", roles: ["admin", "chatter", "trainee"],
    desc: "Entraînez-vous face à un fan simulé par l'IA et recevez une évaluation détaillée." },
  { id: "planning", label: "Planning", href: "/planning", icon: "calendar", section: "Organisation", roles: ["admin", "chatter"],
    desc: "Créneaux de la semaine et pointage des shifts." },
  { id: "ventes", label: "Ventes", href: "/ventes", icon: "receipt", section: "Organisation", roles: ["admin", "chatter"],
    desc: "Déclarez vos ventes avec la capture d'écran. Le manager les valide." },
  { id: "paie", label: "Ma paie", href: "/paie", icon: "euro", section: "Organisation", roles: ["chatter"],
    desc: "Ta paie de la quinzaine : commission, paliers, primes et historique." },
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
  if (me && me.role === "chatter") PLANREM.start();
  // un stagiaire n'a accès qu'à l'accueil et au simulateur
  if (me && me.role === "trainee" && !["home", "simu"].includes(active)) {
    addEventListener("unhandledrejection", e => { if (e.reason && e.reason.redirect) e.preventDefault(); });
    go("/home"); throw Object.assign(new Error("Redirection vers l'accueil"), { redirect: true }); }
  window.ME_SHELL = me; setTimeout(() => { try { INTRO.check(me); } catch (e) {} }, 0);
  const el = document.getElementById("sidebar"); if (!el) return;
  const mods = MODULES.filter(m => m.roles.includes(me.role));
  const badge = m => m.id === "ventes" && me.role === "admin";
  let html = `<div class="sb-top"><a class="logo" href="/home" aria-label="StellADS — Accueil">${logoHTML()}</a><button class="sb-col" type="button" aria-label="Réduire le menu" title="Réduire le menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button></div><nav>`, sec;
  mods.forEach((m, i) => {
    if (m.section && m.section !== sec) { sec = m.section; html += `<div class="sec">${esc(sec)}</div>`; }
    html += `<a href="${m.href}" style="--i:${i}" data-tip="${esc(m.label)}" class="${m.id === active ? "on" : ""}" ${m.id === active ? 'aria-current="page"' : ""}>${icon(m.icon)}<span class="lb">${chars(m.label)}</span><span class="sr">${esc(m.label)}</span>${badge(m) ? '<em class="navbadge hidden" data-badge></em>' : ""}</a>`;
  });
  html += `<span class="nv-line" aria-hidden="true"></span></nav><div class="me"><span class="av">${esc(me.username[0])}</span><div><b>${esc(me.username)}</b><small>${me.role === "admin" ? "Manager" : me.role === "trainee" ? "En formation" : "Chatter"}</small></div>
    ${me.role !== "admin" && INTRO_ON ? `<button onclick="INTRO.show(ME_SHELL,{replay:true})" title="Revoir la présentation" aria-label="Revoir la présentation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l5.5-3.5z" fill="currentColor"/></svg></button>` : ""}<button onclick="logout()" title="Déconnexion" aria-label="Déconnexion" ${me.role !== "admin" && INTRO_ON ? 'style="margin-left:0"' : ""}>${icon("logout")}</button></div>`;
  el.innerHTML = html;
  // mode réduit (ordinateur) : mémorisé d'une page à l'autre
  const col = el.querySelector(".sb-col");
  const setMini = (on, anim) => { el.classList.toggle("mini", on); el.classList.toggle("mini-anim", !!anim); col.setAttribute("aria-label", on ? "Agrandir le menu" : "Réduire le menu"); col.title = col.getAttribute("aria-label");
    document.documentElement.classList.toggle("sb-mini", on); try { localStorage.setItem("stMini", on ? "1" : ""); } catch (_) {} };
  let mini = false; try { mini = localStorage.getItem("stMini") === "1"; } catch (_) {}
  setMini(mini, false);
  col.addEventListener("click", () => { setMini(!el.classList.contains("mini"), true); setTimeout(() => dispatchEvent(new Event("resize")), 560); });
  // Le menu de gauche glisse en place une seule fois par session (après l'intro)
  
  // Dock flottant (téléphone)
  let dock = document.getElementById("dock");
  if (!dock) { dock = document.createElement("nav"); dock.id = "dock"; dock.className = "dock"; dock.setAttribute("aria-label", "Navigation principale"); document.body.appendChild(dock); }
  dock.innerHTML = `<span class="dk-line" aria-hidden="true"></span>` + mods.map(m => `<a href="${m.href}" class="di ${m.id === active ? "on" : ""}" ${m.id === active ? 'aria-current="page"' : ""} aria-label="${esc(m.label)}">${icon(m.icon)}<span class="lb">${chars(m.short || m.label)}</span>${badge(m) ? '<em class="navbadge hidden" data-badge></em>' : ""}</a>`).join("");
  // Le menu de gauche et le dock font leur entrée une seule fois par session (après l'intro)
  try { if (!sessionStorage.getItem("stNav")) { el.classList.add("nav-in"); dock.classList.add("dock-in"); sessionStorage.setItem("stNav", "1"); } } catch (e) {}
  dock.querySelectorAll("a").forEach(a => a.addEventListener("click", e => {
    if (a.classList.contains("on") || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    dock.querySelector(".on")?.classList.remove("on");
    a.classList.add("on"); NAVFX.dock?.to(a, true); const iv = setInterval(() => NAVFX.dock?.to(a, false), 30); setTimeout(() => clearInterval(iv), 460);
    setTimeout(() => go(a.getAttribute("href")), 260); // laisse le trait glisser avant de changer de page
  }));
  // menu de gauche : on note d'où l'on part pour que le trait glisse sur la page suivante
  el.querySelectorAll("nav a").forEach(a => a.addEventListener("click", e => {
    if (a.classList.contains("on") || e.metaKey || e.ctrlKey) return;
    const o = el.querySelector("nav a.on"); try { if (o) sessionStorage.setItem("stNavFrom", JSON.stringify({ y: o.offsetTop, h: o.offsetHeight })); } catch (_) {}
  }));
  NAVFX.side = navLine(el.querySelector("nav"), el.querySelector(".nv-line"), "y");
  NAVFX.dock = navLine(dock, dock.querySelector(".dk-line"), "x");
  if (me.role === "admin") api("/api/admin/sales/count").then(c => updateBadge(c.pending)).catch(() => {});
}
// lettres séparées : elles basculent une à une quand la page devient active
const chars = t => [...String(t)].map((c, i) => `<span class="ch" aria-hidden="true" style="--i:${i}">${c === " " ? "&nbsp;" : esc(c)}</span>`).join("");
const NAVFX = {};
// trait lumineux à ressort : le bord qui avance part en premier, l'indicateur s'étire puis se rétracte
function navLine(wrap, line, ax) {
  if (!wrap || !line) return null;
  const X = ax === "x", S = (x, k) => ({ x, t: x, v: 0, k, c: 21 });
  const P = (el) => X ? [el.offsetLeft + 12, el.offsetLeft + el.offsetWidth - 12] : [el.offsetTop, el.offsetTop + el.offsetHeight];
  const on = wrap.querySelector("a.on"); if (!on) { line.style.opacity = 0; return null; }
  let [a0, z0] = P(on); const A = S(a0, 200), Z = S(z0, 200);
  let from = null; if (!X) try { from = JSON.parse(sessionStorage.getItem("stNavFrom") || "null"); sessionStorage.removeItem("stNavFrom"); } catch (_) {}
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (from && !reduce) { A.x = from.y; Z.x = from.y + from.h; on.querySelector(".lb")?.classList.add("fin"); }
  let raf = 0, last = 0;
  const draw = () => { if (X) { line.style.transform = `translateX(${A.x.toFixed(2)}px)`; line.style.width = Math.max(4, Z.x - A.x).toFixed(2) + "px"; }
    else { line.style.transform = `translateY(${A.x.toFixed(2)}px)`; line.style.height = Math.max(4, Z.x - A.x).toFixed(2) + "px"; } };
  const tick = now => { const dt = Math.min(.05, (now - (last || now)) / 1000); last = now;
    for (let k = 0; k < 3; k++) [A, Z].forEach(s => { s.v += (-s.k * (s.x - s.t) - s.c * s.v) * dt / 3; s.x += s.v * dt / 3; });
    draw(); if (Math.abs(A.x - A.t) + Math.abs(Z.x - Z.t) + Math.abs(A.v) + Math.abs(Z.v) > .05) raf = requestAnimationFrame(tick); else { raf = 0; last = 0; } };
  const to = (el, flip) => { const [a, z] = P(el); if (a > A.x) { Z.k = 320; A.k = 130; } else { A.k = 320; Z.k = 130; } A.t = a; Z.t = z;
    if (flip) { const lb = el.querySelector(".lb"); lb?.classList.remove("fin"); void lb?.offsetWidth; lb?.classList.add("fin"); }
    if (reduce) { A.x = a; Z.x = z; draw(); return; } if (!raf) raf = requestAnimationFrame(tick); };
  draw(); to(on, false);
  addEventListener("resize", () => { const o = wrap.querySelector("a.on"); if (o) { const [a, z] = P(o); A.x = A.t = a; Z.x = Z.t = z; draw(); } });
  return { to };
}
// pastille des ventes à valider : le chiffre défile quand il change
function updateBadge(n) { document.querySelectorAll("[data-badge]").forEach(b => { b.classList.toggle("hidden", !n); const s = String(n), old = b.dataset.v; if (old === s) return; b.dataset.v = s;
  b.innerHTML = s.split("").map(d => `<span class="dg"><span style="transform:translateY(${old ? 10 : -d * 10}%)">${[...Array(10).keys()].join("<br>")}</span></span>`).join("");
  if (old) { requestAnimationFrame(() => requestAnimationFrame(() => b.querySelectorAll(".dg > span").forEach((sp, i) => { sp.style.transition = `transform .9s cubic-bezier(.2,1.4,.4,1) ${i * .06}s`; sp.style.transform = `translateY(${-s[i] * 10}%)`; })));
    b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump"); } }); }

async function logout() { await api("/api/logout", { method: "POST" }).catch(() => {}); go("/"); }

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

/* ---------------- Déblocage du son (Safari / Chrome sur Mac) ----------------
   Les navigateurs ne laissent démarrer le son qu'après un geste (clic, touche).
   Safari peut aussi mettre le son en pause (« interrupted ») après une veille ou un changement de sortie audio.
   À chaque geste, on relance tous les moteurs de son de la page. */
const stAudio = window.stAudio = (() => {
  const list = [];
  const wake = () => list.forEach(c => { try {
    if (c.state !== "running") c.resume().catch(() => {});
    const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0);   // WebKit : un son joué pendant le geste
  } catch (e) {} });
  ["pointerdown", "mousedown", "keydown", "touchend", "click"].forEach(ev => addEventListener(ev, wake, { capture: true, passive: true }));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) list.forEach(c => { try { if (c.state !== "running") c.resume().catch(() => {}); } catch (e) {} }); });
  return { add: c => { if (c && !list.includes(c)) list.push(c); }, wake };
})();

/* ---------------- Sons (discrets : air et cristal) ---------------- */
const SND = window.SND = (() => {
  let ctx = null, out = null;
  const on = () => { try { return localStorage.getItem("stSound") !== "0"; } catch (e) { return true; } };
  function ac() {
    if (!on()) return null;
    try { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
      try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}
      if (!ctx) { ctx = new C(); out = ctx.createGain(); out.gain.value = 0.16; out.connect(ctx.destination); stAudio.add(ctx); }
      if (ctx.state !== "running") ctx.resume().catch(() => {}); return ctx; } catch (e) { return null; }
  }
  let tone = function (f, at, len, peak, type, glide) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || "sine"; o.frequency.setValueAtTime(f, at); if (glide) o.frequency.exponentialRampToValueAtTime(glide, at + len * .9);
    g.gain.setValueAtTime(.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + Math.min(.02, len / 4)); g.gain.exponentialRampToValueAtTime(.0001, at + len);
    o.connect(g); g.connect(out); o.start(at); o.stop(at + len + .05);
  };
  let air = function (at, len, f0, f1, peak, p0, p1) {
    const n = Math.floor(ctx.sampleRate * len), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / n);
    const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buf; bp.type = "bandpass"; bp.Q.value = 1.4; bp.frequency.setValueAtTime(f0, at); bp.frequency.exponentialRampToValueAtTime(f1, at + len);
    g.gain.value = peak; src.connect(bp); bp.connect(g);
    if (ctx.createStereoPanner && p0 != null) { const p = ctx.createStereoPanner(); p.pan.setValueAtTime(p0, at); p.pan.linearRampToValueAtTime(p1, at + len); g.connect(p); p.connect(out); } else g.connect(out);
    src.start(at);
  };
  // attend que le navigateur autorise le son (au plus ~1,5 s)
  async function ready() {
    const c = ac(); if (!c) return null;
    if (c.state !== "running") { try { await Promise.race([c.resume(), new Promise(r => setTimeout(r, 3000))]); } catch (e) {} }
    return c.state === "running" ? c : null;
  }
  return {
    ready,
    // t0 = moment (performance.now) où l'animation a commencé : les sons restent calés même si le son arrive en retard
    async opening(n, t0) {
      const c = await ready(); if (!c) return false;
      const late = (performance.now() - t0) / 1000, t = c.currentTime - late + .03;
      const _tone = tone, _air = air;
      tone = (f, at, ...r) => { if (at >= c.currentTime) _tone(f, at, ...r); };
      air = (at, ...r) => { if (at >= c.currentTime) _air(at, ...r); };
      tone(2637, t + .05, .35, .06); tone(3951, t + .1, .3, .04);
      air(t + .12, 1.0, 700, 4200, .5, -.8, .5); tone(1760, t + .2, .9, .025, "sine", 2637);
      [[1318.5, 0, 1.3, .18], [1975.5, .07, 1.5, .14], [2637, .16, .7, .05], [3951, .22, .5, .03]].forEach(([f, d, l, p]) => tone(f, t + 1.05 + d, l, p));
      [659.3, 784, 880, 987.8, 1174.7, 1318.5, 1568].slice(0, n).forEach((f, i) => tone(f, t + .95 + i * .07, .35, .045, "triangle"));
      [0, 1, 2, 3].forEach(i => tone(1200 + i * 90, t + 2.25 + i * .12, .08, .05, "triangle"));
      air(t + 2.5, 1.1, 2500, 8000, .22, .6, -.4); tone(2093, t + 2.7, 1.2, .03); tone(3136, t + 2.78, 1, .02);
      tone = _tone; air = _air;
      return true;
    },
    // petit son de bienvenue, si le navigateur a bloqué l'ouverture sonore
    welcome() { const c = ac(); if (!c) return; const t = c.currentTime + .03; [[1318.5, 0, 1.1, .14], [1975.5, .08, 1.3, .1], [2637, .18, .6, .04]].forEach(([f, d, l, p]) => tone(f, t + d, l, p)); },
    shift() { const c = ac(); if (!c) return; const t = c.currentTime + .02; air(t, .6, 500, 3000, .35, -.6, .6); tone(987.8, t + .5, .5, .12); tone(1318.5, t + .57, .6, .1); },
    unlock: ac
  };
})();


/* ---------------- Rappels de planning (chatters) ----------------
   Vérifie chaque minute : shift dans 30 min, shift commencé sans pointage, shift à reprendre.
   Affiche une notification dans l'appli et, si autorisé, une notification de l'appareil. */
const PLANREM = (() => {
  let on = false;
  const seen = k => { try { const m = JSON.parse(localStorage.getItem("stRem") || "{}"); if (m[k]) return true; m[k] = Date.now();
    Object.keys(m).forEach(x => { if (Date.now() - m[x] > 3 * 864e5) delete m[x]; }); localStorage.setItem("stRem", JSON.stringify(m)); return false; } catch (e) { return false; } };
  const hm = ms => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  function push(title, body, url) {
    notify(title, body, "info");
    try { if (window.Notification && Notification.permission === "granted" && navigator.serviceWorker)
      navigator.serviceWorker.ready.then(r => r.showNotification(title, { body, icon: "/icon-192.png", badge: "/icon-192.png", tag: title, data: { url: url || "/planning" } })).catch(() => {}); } catch (e) {}
  }
  async function check() {
    let d; try { d = await api("/api/planning/ping"); } catch (e) { return; }
    if (!d || !d.prefs) return;
    const now = Date.now(), n = d.next;
    if (n && d.prefs.before && n.state === "future" && n.start_ms - now <= (d.remind || 30) * 60000 && n.start_ms - now > 0 && !seen("b" + n.id + n.start_ms))
      push("Ton shift commence bientôt", `${n.model_name} · ${n.start} → ${n.end} · dans ${Math.max(1, Math.round((n.start_ms - now) / 60000))} min`);
    if (n && d.prefs.missed && n.state === "missing" && now - n.start_ms >= 5 * 60000 && !seen("m" + n.id + n.start_ms))
      push("Tu n'as pas encore pointé", `Ton shift sur ${n.model_name} a commencé à ${hm(n.start_ms)}`);
    if (d.prefs.swaps) (d.swaps || []).filter(w => now - w.created_at < 6 * 3.6e6).forEach(w => { if (!seen("s" + w.id))
      push("Un shift est à reprendre", `${w.from_name} · ${w.model_name} · ${w.start} → ${w.end}`); });
  }
  return { start() { if (on) return; on = true; setTimeout(check, 2500); setInterval(() => { if (!document.hidden) check(); }, 60000); document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); }); } };
})();

/* =====================================================================
   Vidéo de présentation : obligatoire une fois, à la première connexion d'un chatter
   ===================================================================== */
// vidéo d'accueil : activée quand on la mettra en ligne (fichier /video/presentation-chatters.mp4)
const INTRO_ON = false;
const INTRO = window.INTRO = (() => {
  const SRC = "/video/presentation-chatters.mp4";
  let box = null;
  const css = `
  .in-ov{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(5,5,5,.94);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);opacity:0;transition:opacity .5s}
  .in-ov.on{opacity:1}
  .in-w{width:min(1100px,100%);display:flex;flex-direction:column;gap:18px;transform:translateY(16px) scale(.98);transition:transform .7s cubic-bezier(.2,.9,.2,1)}
  .in-ov.on .in-w{transform:none}
  .in-hd{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .in-eb{font-size:11px;letter-spacing:.18em;color:#7a7a7a;font-weight:700}
  .in-t{font-family:Inter,sans-serif;font-weight:900;letter-spacing:-.045em;font-size:clamp(28px,4.4vw,46px);line-height:1.04;margin-top:6px;color:#f5f5f5}
  .in-t em{font-style:italic;background:linear-gradient(100deg,#fff,#8a8a8a 55%,#e6e6e6);-webkit-background-clip:text;background-clip:text;color:transparent;padding-right:.08em}
  .in-sub{font-size:13px;color:#8a8a8a;font-weight:600;max-width:340px}
  .in-v{position:relative;aspect-ratio:16/9;border-radius:22px;overflow:hidden;background:#000;border:1px solid #232323;box-shadow:0 40px 120px -30px rgba(0,0,0,.9)}
  .in-v video{display:block;width:100%;height:100%;object-fit:contain;background:#000}
  .in-cv{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:radial-gradient(circle at 50% 45%,rgba(20,20,20,.55),rgba(0,0,0,.85));transition:opacity .4s;text-align:center;padding:20px}
  .in-cv.off{opacity:0;pointer-events:none}
  .in-play{width:86px;height:86px;border-radius:50%;border:0;background:#ededed;color:#0a0a0a;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 0 0 0 rgba(255,255,255,.4);animation:inPulse 2s infinite}
  .in-play svg{width:34px;height:34px;margin-left:5px}
  @keyframes inPulse{0%{box-shadow:0 0 0 0 rgba(255,255,255,.35)}70%{box-shadow:0 0 0 22px rgba(255,255,255,0)}100%{box-shadow:0 0 0 0 rgba(255,255,255,0)}}
  .in-cv b{font-weight:900;font-size:18px;color:#fff}.in-cv small{font-size:13px;color:#8a8a8a;font-weight:600}
  .in-ft{display:flex;align-items:center;gap:14px}
  .in-bar{flex:1;height:6px;border-radius:4px;background:#1f1f1f;overflow:hidden}.in-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#bdbdbd,#fff);border-radius:4px}
  .in-tm{font-size:12px;font-weight:800;color:#8a8a8a;font-variant-numeric:tabular-nums;min-width:86px;text-align:right}
  .in-go{height:52px;border:0;border-radius:15px;padding:0 26px;background:#ededed;color:#0a0a0a;font-weight:900;font-size:16px;cursor:pointer;font-family:inherit}
  .in-ghost{height:44px;border:1px solid #2a2a2a;border-radius:13px;padding:0 18px;background:#161616;color:#e6e6e6;font-weight:800;font-size:14px;cursor:pointer;font-family:inherit}
  .in-ps{position:absolute;left:50%;top:50%;width:70px;height:70px;margin:-35px 0 0 -35px;border-radius:50%;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;color:#fff;opacity:0;transition:opacity .25s;pointer-events:none}
  .in-ps.on{opacity:1}
  @media (max-width:640px){.in-ov{padding:14px}.in-v{border-radius:16px}.in-sub{display:none}}`;
  const fmt = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  function show(me, opts = {}) {
    if (box) return;
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    box = document.createElement("div"); box.className = "in-ov"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "Vidéo de présentation");
    box.innerHTML = `<div class="in-w">
      <div class="in-hd"><div><div class="in-eb">BIENVENUE</div><div class="in-t">Salut <em>${esc(me.username)}.</em></div></div>
        <div class="in-sub">Avant de commencer, regarde cette présentation de 2 minutes : elle t'explique tout le site.</div></div>
      <div class="in-v"><video playsinline preload="auto" src="${SRC}"></video>
        <div class="in-ps"><svg width="26" height="26" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg></div>
        <div class="in-cv" data-start><button class="in-play" aria-label="Lancer la présentation"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12.5-7.5z"/></svg></button><b>Lancer la présentation</b><small>Monte le son 🔊</small></div>
        <div class="in-cv off" data-end><b style="font-size:24px">Tu es prêt.</b><small>Tu peux la revoir quand tu veux depuis le menu.</small><div style="display:flex;gap:10px;margin-top:6px"><button class="in-ghost" data-again>Revoir</button><button class="in-go" data-go>C'est parti</button></div></div>
        <div class="in-cv off" data-err><b>La vidéo ne se charge pas</b><small>Vérifie ta connexion. Tu pourras la regarder plus tard depuis le menu.</small><button class="in-go" data-go>Continuer</button></div></div>
      <div class="in-ft"><span class="in-bar"><i></i></span><span class="in-tm">—</span>${opts.replay ? '<button class="in-ghost" data-close>Fermer</button>' : ""}</div></div>`;
    document.body.appendChild(box); document.body.style.overflow = "hidden";
    requestAnimationFrame(() => box.classList.add("on"));
    const v = box.querySelector("video"), bar = box.querySelector(".in-bar i"), tm = box.querySelector(".in-tm"), ps = box.querySelector(".in-ps");
    let maxT = 0, started = false;
    const start = () => { box.querySelector("[data-start]").classList.add("off"); box.querySelector("[data-end]").classList.add("off"); started = true; v.play().catch(() => {}); };
    box.querySelector("[data-start]").onclick = start;
    v.addEventListener("timeupdate", () => { if (!v.seeking) maxT = Math.max(maxT, v.currentTime); bar.style.width = (v.currentTime / (v.duration || 1) * 100) + "%"; tm.textContent = v.duration ? `${fmt(v.duration - v.currentTime)} restantes` : "—"; });
    // pas d'avance rapide : on revient au plus loin déjà regardé
    v.addEventListener("seeking", () => { if (!opts.replay && v.currentTime > maxT + .5) v.currentTime = maxT; });
    v.addEventListener("click", () => { if (!started) return; if (v.paused) v.play(); else v.pause(); });
    v.addEventListener("pause", () => { if (!v.ended) ps.classList.add("on"); }); v.addEventListener("play", () => ps.classList.remove("on"));
    v.addEventListener("ended", () => { box.querySelector("[data-end]").classList.remove("off"); if (!opts.replay) api("/api/me/intro-seen", { body: {} }).catch(() => {}); });
    v.addEventListener("error", () => box.querySelector("[data-err]").classList.remove("off"));
    box.querySelector("[data-again]").onclick = () => { v.currentTime = 0; start(); };
    box.querySelectorAll("[data-go], [data-close]").forEach(b => b.onclick = close);
    document.addEventListener("keydown", key);
  }
  function key(e) { if (!box) return; const v = box.querySelector("video"); if (e.key === " " && !box.querySelector("[data-start]").classList.contains("off")) return;
    if (e.key === " ") { e.preventDefault(); v.paused ? v.play() : v.pause(); } }
  function close() { if (!box) return; const b = box; b.querySelector("video").pause(); b.classList.remove("on"); setTimeout(() => b.remove(), 500); box = null; document.body.style.overflow = ""; document.removeEventListener("keydown", key); }
  return { show, check: me => { if (INTRO_ON && me && me.role !== "admin" && !me.introSeen && !EMBED) show(me); } };
})();
