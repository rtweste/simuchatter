// Défis de la semaine : carte sur l'accueil des chatters, écran « défi réussi », bandeau de la salle de contrôle
window.CHALL = (() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fmt = (m, v) => m === "ca" ? eur(v).replace(",00", "") : `${Math.round(v)}`;
  const unitL = (m, v) => m === "ca" ? "" : m === "count" ? (v > 1 ? " ventes" : " vente") : (v > 1 ? " contenus" : " contenu");
  const left = ms => { const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    return [[d, d > 1 ? "jours" : "jour"], [h, "heures"], [m, "min"]]; };
  const ago = t => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : `il y a ${Math.floor(m / 60)} h`; };
  const AV = ["#9be8c6,#5fd3a2", "#d7c4ff,#b388ff", "#bfe6ff,#7dd3fc", "#ffe9a6,#ffd23f", "#ffc2d0,#ff7a9c", "#c8f7c5,#7bd389"];
  const av = (n, i) => `<span class="ch-av" style="background:linear-gradient(135deg,${AV[(i ?? n.length) % AV.length]})" title="${esc(n)}">${esc((n || "?")[0].toUpperCase())}</span>`;
  const BADGE = {
    fusee: ["Fusée", '<path d="M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2"/><path d="M9 12a12 12 0 0 1 10-9 12 12 0 0 1-9 10z"/><path d="M9 12l3 3M14.5 9.5h.01"/>'],
    couronne: ["Couronne", '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>'],
    eclair: ["Éclair", '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'],
    diamant: ["Diamant", '<path d="M6 3h12l3 6-9 12L3 9zM3 9h18"/>']
  };
  const svg = (p, s = 20, w = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  let tick = null;

  /* ---------- accueil ---------- */
  async function mount(host) {
    if (!host) return; let d; try { d = await api("/api/challenges"); } catch (e) { return; }
    document.querySelectorAll(".chx").forEach(x => x.remove());
    const team = d.active.filter(c => c.scope === "team"), solo = d.active.filter(c => c.scope === "solo");
    if (d.active.length) {
      const w = document.createElement("section"); w.className = "chx"; w.setAttribute("aria-label", "Défis de la semaine");
      w.innerHTML = (team.length ? teamCard(team[0]) : "") + `<div class="ch-side">${solo.map(soloCard).join("")}${team.slice(1).map(miniTeam).join("")}${pastCard(d.recent)}</div>`;
      host.parentNode.insertBefore(w, host);
      requestAnimationFrame(() => w.querySelectorAll("[data-w]").forEach(el => { el.style.width = el.dataset.w; }));
      w.querySelectorAll("[data-off]").forEach(el => requestAnimationFrame(() => { el.style.strokeDashoffset = el.dataset.off; }));
      clearInterval(tick); tick = setInterval(() => { if (!document.hidden) w.querySelectorAll("[data-end]").forEach(el => { const L = left(+el.dataset.end - Date.now()); el.querySelectorAll("b").forEach((b, i) => { b.textContent = L[i][0]; }); el.querySelectorAll("small").forEach((s, i) => { s.textContent = L[i][1]; }); }); }, 20e3);
    }
    // défi réussi : écran de fête, une seule fois
    let seen = {}; try { seen = JSON.parse(localStorage.getItem("stChSeen") || "{}"); } catch (e) {}
    const c = d.celebrate.find(x => !seen[x.key]); if (c) setTimeout(() => celebrate(c, () => { seen[c.key] = Date.now(); try { localStorage.setItem("stChSeen", JSON.stringify(seen)); } catch (e) {} }), 900);
  }
  function countdown(c) { return `<div class="ch-cd" data-end="${c.end_at}">${left(c.left).map(([v, u]) => `<div><b>${v}</b><small>${u}</small></div>`).join("")}</div>`; }
  function teamCard(c, o = {}) {
    const b = BADGE[c.badge] || BADGE.fusee, done = !!c.reached_at, rest = Math.max(0, c.target - c.value);
    const steps = [25, 50, 75, 100].map(p => `<span class="ch-st ${c.pct >= p ? "on" : ""}" style="left:${p}%"><i></i><em>${fmt(c.metric, c.target * p / 100)}${unitL(c.metric, c.target * p / 100)}</em></span>`).join("");
    const sub = c.mine > 0 ? `<b>${fmt(c.metric, c.mine)}${unitL(c.metric, c.mine)}</b><span>${c.share} % du défi${c.rank ? ` · ${c.rank}${c.rank === 1 ? "ᵉʳ" : "ᵉ"}` : ""}</span>` : `<b>Pas encore</b><span>ta prochaine vente compte</span>`;
    const est = c.prime > 0 ? (c.estPrime > 0 ? `${done ? "Tu toucheras" : "Si le défi est réussi, tu touches environ"} <b>${eur(c.estPrime)}</b>${done ? " à la fin du défi." : "."}` : `Chaque vente compte pour ta part de la prime.`) : "Pas de prime sur ce défi : c'est pour la gloire.";
    const last = c.feed[0];
    return `<article class="ch-team ${done ? "won" : ""}">
      <div class="ch-hd"><div><span class="ch-kick">${svg('<path d="M5 21V4h11l-1.6 4L16 12H5"/>', 14, 2.2)}${done ? "DÉFI RÉUSSI · ÇA CONTINUE" : "DÉFI D'ÉQUIPE"}${c.model_name ? " · " + esc(c.model_name.toUpperCase()) : ""}</span>
        <h2>${esc(c.title.replace(/ (d'ici .*)$/, ""))} <em>${esc((c.title.match(/ (d'ici .*)$/) || [, ""])[1])}</em></h2></div>
        <div class="ch-left"><small>IL RESTE</small>${countdown(c)}</div></div>
      <div class="ch-num"><div><b>${fmt(c.metric, c.value)}${unitL(c.metric, c.value)}</b><span> / ${fmt(c.metric, c.target)}${unitL(c.metric, c.target)}</span></div><em>${done ? "Objectif atteint" : `${Math.round(c.pct)} % · encore ${fmt(c.metric, rest)}${unitL(c.metric, rest)}`}</em></div>
      <div class="ch-bar"><span class="ch-fill" data-w="${Math.max(2, c.pct)}%"></span>${steps}</div>
      <div class="ch-row">
        ${o.admin ? `<div class="ch-tile"><small>EN TÊTE</small>${c.top.length ? `<div class="ch-lead">${c.top.slice(0, 3).map((t, i) => `<div>${av(t.username, i)}<b>${esc(t.username)}</b><span>${fmt(c.metric, t.value)}${unitL(c.metric, t.value)}${t.prime ? ` · ~${eur(t.prime)}` : ""}</span></div>`).join("")}</div>` : `<p>Personne n'a encore contribué.</p>`}</div>`
          : `<div class="ch-tile"><small>TA PART</small><div class="ch-part">${sub}</div><p>${est}</p></div>`}
        <div class="ch-tile gold"><span class="ch-medal">${svg(b[1], 26)}</span><div><small>RÉCOMPENSE</small><b>${c.prime > 0 ? `${eur(c.prime).replace(",00", "")} partagés + badge « ${b[0]} »` : `Badge « ${b[0]} »`}</b><span>${c.prime > 0 ? (c.split === "equal" ? "À parts égales entre ceux qui ont vendu" : "Répartis selon la part de chacun") : "Pour tous ceux qui ont participé"}</span></div></div>
      </div>
      <div class="ch-foot"><div class="ch-avs">${c.top.map((t, i) => av(t.username, i)).join("")}</div><span>${c.contributors ? `<b>${c.contributors} chatter${c.contributors > 1 ? "s" : ""}</b> ${c.contributors > 1 ? "ont" : "a"} déjà contribué` : "Personne n'a encore contribué : lance-toi !"}${last ? ` · dernière : <b class="g">${esc(last.username)} +${fmt(c.metric, last.v)}${c.metric === "ca" ? "" : unitL(c.metric, last.v)}</b> ${ago(last.at)}` : ""}</span></div>
    </article>`;
  }
  function soloCard(c, o = {}) {
    if (o.admin) { const ok = c.top.filter(t => t.value >= c.target);
      return `<article class="ch-solo"><small>DÉFI PERSO EN COURS</small><b class="t" style="display:block;margin:8px 0 6px">${esc(c.title)}</b><p>${ok.length} chatter${ok.length > 1 ? "s" : ""} à l'objectif sur ${c.contributors} participant${c.contributors > 1 ? "s" : ""}${c.prime > 0 ? ` · ${eur(c.prime).replace(",00", "")} chacun` : ""}</p>
        <div class="ch-lead" style="margin-top:12px">${c.top.slice(0, 5).map((t, i) => `<div>${av(t.username, i)}<b>${esc(t.username)}</b><span>${fmt(c.metric, t.value)} / ${fmt(c.metric, c.target)}${t.value >= c.target ? " ✓" : ""}</span></div>`).join("")}</div>${countdown(c)}</article>`; }
    const C = 276.5, off = C * (1 - Math.min(1, c.value / c.target)), rest = Math.max(0, c.target - c.value);
    return `<article class="ch-solo ${c.won ? "won" : ""}"><small>TON DÉFI PERSO</small><div class="ch-sr">
      <div class="ch-ring"><svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true"><circle cx="52" cy="52" r="44" class="bg"/><circle cx="52" cy="52" r="44" class="fg" style="stroke-dasharray:${C};stroke-dashoffset:${C}" data-off="${off}" transform="rotate(-90 52 52)"/></svg>
        <b>${c.metric === "ca" ? Math.round(c.pct) + "%" : `${Math.round(c.value)}/${Math.round(c.target)}`}</b></div>
      <div><b class="t">${esc(c.title.replace(/ chacun/, ""))}</b><p>${c.won ? `Objectif atteint ! ${c.prime > 0 ? `<b>+${eur(c.prime).replace(",00", "")}</b> à la fin du défi.` : ""}` : `Encore ${fmt(c.metric, rest)}${unitL(c.metric, rest)}${c.prime > 0 ? ` pour gagner <b>+${eur(c.prime).replace(",00", "")}</b>` : ""}`}</p></div></div></article>`;
  }
  function miniTeam(c) { return `<article class="ch-solo"><small>AUTRE DÉFI D'ÉQUIPE</small><b class="t" style="display:block;margin:8px 0 10px">${esc(c.title)}</b><div class="ch-bar sm"><span class="ch-fill" data-w="${Math.max(2, c.pct)}%"></span></div><p style="margin-top:8px">${fmt(c.metric, c.value)}${unitL(c.metric, c.value)} / ${fmt(c.metric, c.target)}${unitL(c.metric, c.target)}</p></article>`; }
  function pastCard(list) {
    if (!list || !list.length) return "";
    return `<article class="ch-past"><small>DÉFIS PRÉCÉDENTS</small>${list.slice(0, 3).map(c => `<div class="ch-pr"><span class="${c.won ? "ok" : ""}">${c.won ? svg('<path d="M5 12.5 10 17.5 19 7"/>', 14, 3) : "–"}</span><div><b>${esc(c.title)}</b><small>${c.won ? `Réussi${c.estPrime > 0 ? ` · +${eur(c.estPrime)} pour toi` : ""}` : `Pas atteint · ${fmt(c.metric, c.value)}${unitL(c.metric, c.value)} sur ${fmt(c.metric, c.target)}${unitL(c.metric, c.target)}`}</small></div></div>`).join("")}</article>`;
  }

  /* ---------- défi réussi ---------- */
  function celebrate(c, onClose) {
    const b = BADGE[c.badge] || BADGE.fusee, top = c.top.slice(0, 3), pod = [top[1], top[0], top[2]].filter(Boolean);
    const ov = document.createElement("div"); ov.className = "ch-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", "Défi réussi");
    ov.innerHTML = `<div class="ch-cel"><div class="ch-rays"></div>
      <div class="ch-badge"><i></i><i></i><span class="ch-coin"><span>${svg(b[1], 72, 1.6)}</span></span><em>BADGE ${esc(b[0].toUpperCase())}</em></div>
      <h2>Défi <em>réussi !</em></h2><p>${esc(c.title)}. ${c.scope === "team" ? `L'équipe a atteint ${fmt(c.metric, c.value)}${unitL(c.metric, c.value)}.` : "Tu as atteint ton objectif."}</p>
      <div class="ch-cr">${c.estPrime > 0 ? `<div class="g"><small>TA PRIME</small><b>+${eur(c.estPrime)}</b><span>${c.closed_at ? "ajoutée à ta paie" : "versée à la fin du défi"}</span></div>` : ""}<div><small>TA PART</small><b>${c.scope === "team" ? c.share + " %" : fmt(c.metric, c.mine) + unitL(c.metric, c.mine)}</b><span>${c.rank ? `${c.rank}${c.rank === 1 ? "ᵉʳ" : "ᵉ"} de l'équipe` : ""}</span></div></div>
      ${c.scope === "team" && pod.length ? `<div class="ch-pod">${pod.map(t => { const r = top.indexOf(t) + 1; return `<div class="r${r}">${av(t.username, r)}<small>${esc(t.username)} · ${fmt(c.metric, t.value)}</small><span>${r}</span></div>`; }).join("")}</div>` : ""}
      <div class="ch-bt"><button type="button" class="ch-share">Partager dans le chat d'équipe</button><button type="button" class="ch-close">Fermer</button></div></div>`;
    document.body.appendChild(ov); requestAnimationFrame(() => ov.classList.add("on"));
    const close = () => { ov.classList.remove("on"); setTimeout(() => ov.remove(), 400); onClose && onClose(); };
    ov.querySelector(".ch-close").onclick = close; ov.addEventListener("click", e => { if (e.target === ov) close(); });
    document.addEventListener("keydown", function k(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", k); } });
    ov.querySelector(".ch-share").onclick = async e => { const bt = e.target; bt.disabled = true;
      try { const boot = await api("/api/chat/boot"), g = (boot.channels || []).find(x => x.slug === "general"); if (!g) throw new Error("Salon introuvable");
        await api(`/api/chat/c/${g.id}/messages`, { body: { body: `Défi réussi : ${c.title} ! Bravo l'équipe 🚀` } }); notify("Partagé dans #général", "", "ok"); bt.textContent = "Partagé ✓"; }
      catch (er) { notify("Impossible de partager", er.message || "", "err"); bt.disabled = false; } };
    ov.querySelector(".ch-close").focus({ preventScroll: true });
  }

  /* ---------- salle de contrôle ---------- */
  function salle() {
    if (document.querySelector(".ch-salle")) return;
    const el = document.createElement("div"); el.className = "ch-salle"; document.body.appendChild(el);
    let last = null;
    const draw = c => {
      if (!c) { el.classList.remove("on"); return; } el.classList.add("on");
      const n = 30, on = Math.round(Math.min(1, c.value / c.target) * n), f = c.feed[0], L = left(c.left);
      el.innerHTML = `<div class="cs-l"><span class="cs-dot"></span><b>${c.reached_at ? "DÉFI RÉUSSI" : "DÉFI EN COURS"}</b><span class="cs-t">${esc(c.title)}</span></div>
        <div class="cs-n"><b>${fmt(c.metric, c.value)}${unitL(c.metric, c.value)}</b><span>/ ${fmt(c.metric, c.target)}</span><em>${Math.round(c.pct)} %</em></div>
        <div class="cs-seg">${Array.from({ length: n }, (_, i) => `<i class="${i < on ? "on" : ""}${i === on - 1 ? " edge" : ""}"></i>`).join("")}</div>
        <div class="cs-r"><span>${L[0][0] ? L[0][0] + " j " : ""}${String(L[1][0]).padStart(2, "0")} h ${String(L[2][0]).padStart(2, "0")}</span>${f ? `<small>${esc(f.username)} +${fmt(c.metric, f.v)}${c.metric === "ca" ? "" : unitL(c.metric, f.v)}</small>` : ""}</div>`;
      if (last && f && last !== f.at) { el.classList.remove("ping"); void el.offsetWidth; el.classList.add("ping"); }
      last = f ? f.at : last;
    };
    const poll = () => api("/api/admin/challenges/live").then(r => draw(r.challenge)).catch(() => {});
    poll(); setInterval(() => { if (!document.hidden) poll(); }, 15e3);
  }
  return { mount, salle, celebrate, teamCard, soloCard, BADGE };
})();
