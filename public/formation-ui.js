// Accueil du stagiaire (rôle « En formation ») : checklist, progression, simulation
const TRAINEE = window.TRAINEE = (() => {
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z"/></svg>';
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DIFF = d => ({ facile: "Facile", normal: "Normal", difficile: "Difficile" }[d] || d);
  function ring(done, total) {
    const S = 170, r = S / 2 - 12, c = 2 * Math.PI * r;
    return `<div class="tr-ring"><svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><circle cx="${S / 2}" cy="${S / 2}" r="${r}" fill="none" stroke="#1f1f1f" stroke-width="13"/>
      <circle class="arc" cx="${S / 2}" cy="${S / 2}" r="${r}" fill="none" stroke="${done === total && total ? "#5fd3a2" : "#e6e6e6"}" stroke-width="13" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${c.toFixed(1)}" data-off="${(c * (1 - (total ? done / total : 0))).toFixed(1)}"/></svg>
      <div class="rv"><b>${done}<span> / ${total}</span></b><small>CRITÈRES</small></div></div>`;
  }
  function spark(vals, goal) {
    if (vals.length < 2) return `<div class="tr-mut" style="padding:18px 0">Ta courbe apparaîtra après 2 sessions terminées.</div>`;
    const W = 300, H = 70, y = v => H - (Math.max(30, Math.min(100, v)) - 30) / 70 * H, pts = vals.map((s, i) => [i / (vals.length - 1) * W, y(s)]);
    const yg = y(goal);
    return `<svg class="tr-spk" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Scores des dernières sessions"><line x1="0" x2="${W}" y1="${yg.toFixed(1)}" y2="${yg.toFixed(1)}" stroke="#3a3a3a" stroke-dasharray="4 5" vector-effect="non-scaling-stroke"/>
      <path class="sp" d="M${pts.map(p => p.map(n => n.toFixed(1)).join(" ")).join(" L")}" fill="none" stroke="#ededed" stroke-width="2.5" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>
      ${pts.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="${vals[i] >= goal ? "#5fd3a2" : "#e6e6e6"}" vector-effect="non-scaling-stroke"/>`).join("")}</svg>
      <div class="tr-gl">objectif ${goal}</div>`;
  }
  async function render(root, me) {
    root.innerHTML = `<div class="tr"><div class="tr-ld">Chargement…</div></div>`;
    let T, A = [];
    try { [T, A] = await Promise.all([api("/api/training"), api("/api/my-assignments").catch(() => [])]); }
    catch (e) { root.innerHTML = `<div class="tr"><div class="tr-ld">${esc(e.message)}</div></div>`; return; }
    const left = Math.max(0, (me.dailyLimit || 0) - (me.usedToday || 0)), st = T.stats, goal = (T.criteria.find(c => c.key === "avg") ? +T.criteria.find(c => c.key === "avg").label.match(/\d+/)[0] : 70);
    const miss = T.total - T.done;
    const crit = T.criteria.map((c, i) => `<div class="tr-ck${c.ok ? " ok" : ""}" style="--d:${(.12 + i * .05).toFixed(2)}s"><span class="bx">${c.ok ? CHECK : ""}</span><div>${esc(c.label)}${c.sub ? `<small>${esc(c.sub)}</small>` : ""}</div>
      <div class="v${c.ok ? "" : " no"}">${esc(c.value)}${c.ok ? "" : `<span class="mini"><i style="width:${Math.round(c.pct * 100)}%"></i></span>`}</div></div>`).join("");
    const asg = A.length ? A.slice(0, 3).map(a => `<div class="tr-asg"><span class="av">${esc((a.created_by_name || "M")[0].toUpperCase())}</span><div><b>${esc(a.label || a.persona)} · ${esc(DIFF(a.difficulty))}</b><small>Assigné par ${esc(a.created_by_name || "le manager")} · objectif ${a.goal}${a.due_at ? ` · avant le ${new Date(a.due_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}` : ""}</small></div><a class="tr-sb" href="/app">Commencer</a></div>`).join("")
      : `<div class="tr-mut">Aucun entraînement assigné pour l'instant. Ton manager peut t'en proposer depuis le Simu Chatter.</div>`;
    root.innerHTML = `<div class="tr">
      <div class="tr-hd"><div><div class="tr-eb">EN FORMATION · JOUR ${T.day}</div><h1 class="tr-ttl">Salut <em>${esc(me.username)}.</em></h1></div><span class="tr-badge${T.ready ? " ok" : ""}"><i></i>${T.ready ? "Prêt à valider" : "En formation"}</span></div>
      <div class="tr-g2"><div class="tr-col">
        <section class="tr-card"><div class="tr-hero">${ring(T.done, T.total)}<div><h2>${T.ready ? "Tous tes critères sont <em>verts</em>" : `Encore <em>${miss} critère${miss > 1 ? "s" : ""}</em> avant de devenir chatter`}</h2>
          <p>${T.ready ? "Ton manager a été prévenu : il valide ta formation, et tu auras accès au planning, aux ventes et à ta paie." : "Quand tout est vert, ton manager valide ta formation : tu auras alors accès au planning, aux ventes et à ta paie."}</p></div></div>
          <div class="tr-cks">${crit}</div></section></div>
      <div class="tr-col">
        <section class="tr-card" style="--d:.06s"><div class="tr-cta"><div><h3>Prochaine <em>simulation</em></h3><div class="tr-mut">${left} simulation${left > 1 ? "s" : ""} restante${left > 1 ? "s" : ""} aujourd'hui</div></div><a class="tr-wbtn${left ? "" : " off"}" href="/app">${PLAY}Lancer une simulation</a></div>
          <div class="tr-tip"><span>💡</span><span>${T.tip}</span></div></section>
        <section class="tr-card" style="--d:.1s"><div class="tr-ch"><h3>Ma <em>progression</em></h3><span class="tr-mut">${st.trend.length} dernière${st.trend.length > 1 ? "s" : ""} session${st.trend.length > 1 ? "s" : ""}</span></div><div class="tr-sw">${spark(st.trend, goal)}</div>
          <div class="tr-st4"><div><small>Score moyen (5 dern.)</small><b>${st.avg5 ?? "—"}</b></div><div><small>Meilleur score</small><b class="g">${st.best ?? "—"}</b></div><div><small>Sessions terminées</small><b>${st.sessions}</b></div><div><small>Réponse moyenne</small><b>${st.rt != null ? st.rt + " s" : "—"}</b></div></div>
          <div class="tr-lab">PROFILS DE FANS RÉUSSIS</div><div class="tr-fans">${T.fans.map(f => `<span class="${f.ok ? "ok" : ""}" title="${esc(f.name)}">${f.ok ? "✓ " : ""}${esc(f.label)}</span>`).join("")}</div></section>
        <section class="tr-card" style="--d:.14s"><div class="tr-ch"><h3>Entraînements <em>assignés</em></h3>${A.length ? `<span class="tr-tag">${A.length} à faire</span>` : ""}</div>${asg}</section>
      </div></div></div>`;
    const go = () => { root.querySelectorAll(".tr-ring .arc").forEach(a => a.style.strokeDashoffset = a.dataset.off); root.querySelectorAll(".tr-spk .sp").forEach(p => p.style.strokeDashoffset = 0); };
    if (reduce) { root.querySelectorAll(".tr-ring .arc,.tr-spk .sp").forEach(a => a.style.transition = "none"); go(); } else setTimeout(go, 250);
  }
  return { render };
})();
