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
  const LOCK = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V8a3 3 0 0 0-6 0z"/></svg>';
  const fmt = s => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  function courseCard(C, simDone, simTotal) {
    if (!C || !C.total) return "";
    if (!C.unlocked) return `<section class="tr-card co-card co-lock" style="--d:.08s"><div class="co-lk">${LOCK}</div><div><div class="tr-eb">ÉTAPE SUIVANTE</div><h3>Formation <em>messagerie</em></h3>
      <div class="tr-mut" style="margin-top:4px">${C.total} vidéos pour maîtriser la plateforme. Elles se débloquent quand tes critères du simulateur sont verts (${simDone} / ${simTotal}).</div></div></section>`;
    const pct = Math.round(C.done / C.total * 100);
    const list = C.videos.map(v => `<button class="co-v${v.done ? " ok" : ""}${v.locked ? " lk" : ""}${C.next && C.next.id === v.id ? " nx" : ""}" data-v="${v.id}" ${v.locked ? "disabled" : ""}>
      <span class="co-n">${v.done ? CHECK : v.locked ? LOCK : v.n}</span><span class="co-t"><b>${esc(v.title)}</b><small>${v.done ? "Vue jusqu'au bout · revoir" : v.locked ? "Termine la vidéo précédente" : v.pos > 3 ? `Reprendre à ${fmt(v.pos)}` : v.quiz ? `À regarder · ${v.quiz.length} exercices` : "À regarder"}</small></span>
      <span class="co-pl">${v.locked ? "" : PLAY}</span></button>`).join("");
    return `<section class="tr-card co-card" style="--d:.08s"><div class="tr-ch"><h3>Formation <em>messagerie</em></h3><span class="tr-tag${C.complete ? " g" : ""}">${C.complete ? "Terminée ✓" : `${C.done} / ${C.total} vidéos`}</span></div>
      <div class="co-bar"><i style="width:${pct}%"></i></div>
      <div class="tr-mut" style="margin:8px 0 4px">${C.complete ? "Bravo : toutes les vidéos sont vues. Ton manager peut valider ta formation." : "Regarde chaque vidéo jusqu'au bout pour débloquer la suivante. Pas d'avance rapide."}</div>
      <div class="co-list">${list}</div></section>`;
  }
  /* lecteur : pas d'avance rapide, progression enregistrée côté serveur */
  function player(C, id, onClose) {
    const idx = C.videos.findIndex(v => v.id === id), v0 = C.videos[idx]; if (!v0 || v0.locked) return;
    const replay = v0.done || v0.free, ov = document.createElement("div"), LBL = C.label || "FORMATION MESSAGERIE", solo = !v0.n; ov.className = "co-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", v0.title);
    ov.innerHTML = `<div class="co-w"><div class="co-hd"><div><div class="tr-eb">${solo ? LBL : `${LBL} · VIDÉO ${v0.n} / ${C.total}`}</div><div class="co-ti">${esc(v0.title)}</div></div><button class="co-x" aria-label="Fermer">✕</button></div>
      <div class="co-vd"><video playsinline preload="auto" src="${v0.src}"></video>
        <div class="co-ps"><svg width="26" height="26" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg></div>
        <div class="co-cv" data-start><button class="co-play" aria-label="Lancer la vidéo">${PLAY}</button><b>${v0.pos > 3 ? `Reprendre à ${fmt(v0.pos)}` : "Lancer la vidéo"}</b><small>Monte le son 🔊</small></div>
        <div class="co-cv off" data-end><div class="co-ok">${CHECK}</div><b style="font-size:22px">${idx + 1 < C.total || solo ? "Vidéo terminée" : C.endTitle || "Formation messagerie terminée"}</b><small>${solo || v0.free ? "" : idx + 1 < C.total ? `La vidéo ${idx + 2} est débloquée.` : C.endText || "Ton manager va être prévenu."}</small>
          <div style="display:flex;gap:10px;margin-top:6px"><button class="co-gh" data-close>Fermer</button>${idx + 1 < C.total && !solo ? `<button class="co-go" data-next>Vidéo suivante →</button>` : ""}</div></div>
        <div class="co-cv off" data-err><b>La vidéo ne se charge pas</b><small>Vérifie ta connexion et réessaie.</small><button class="co-gh" data-close>Fermer</button></div></div>
      <div class="co-ft"><span class="co-tb"><i></i></span><span class="co-tm">—</span></div>${replay ? "" : `<div class="co-note">${LOCK}Pas d'avance rapide : regarde jusqu'au bout pour débloquer la suite.${v0.quiz ? " Un exercice à réussir à la fin de chaque chapitre." : ""}</div>`}</div>`;
    document.body.appendChild(ov); document.body.style.overflow = "hidden"; requestAnimationFrame(() => ov.classList.add("on"));
    const v = ov.querySelector("video"), bar = ov.querySelector(".co-tb i"), tm = ov.querySelector(".co-tm"), ps = ov.querySelector(".co-ps");
    let maxT = replay ? 1e9 : v0.pos, started = false, lastSent = 0, finished = false, nextVid = null, qzOpen = false;
    // exercices : la vidéo s'arrête à la fin de chaque chapitre tant que son exercice n'est pas réussi
    const parts = replay ? [] : (v0.quiz || []).map(p => ({ ...p })), gate = () => parts.find(p => !p.passed), box = ov.querySelector(".co-vd");
    const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    async function quiz(g) {
      if (qzOpen) return; qzOpen = true; v.pause(); ps.classList.remove("on"); await send(true);
      const el = document.createElement("div"); el.className = "co-qz"; box.appendChild(el); box.classList.add("qz");
      const shut = () => { el.remove(); box.classList.remove("qz"); qzOpen = false; };
      const head = `<div class="tr-eb">EXERCICE ${g.n} / ${parts.length} · ${esc(g.title).toUpperCase()}</div>`;
      let Q; el.innerHTML = head + `<div class="qz-ld">Chargement…</div>`;
      try { Q = await api(`/api/course/${v0.id}/quiz/${g.id}`); } catch (e) { el.innerHTML = head + `<div class="qz-ld">${esc(e.message)}</div><div class="qz-bt"><button class="co-gh" data-rt>Réessayer</button></div>`; el.querySelector("[data-rt]").onclick = () => { shut(); quiz(g); }; return; }
      const run = () => { const ans = []; let k = 0;
        const ask = () => { const q = Q.qs[k], order = shuffle(q.opts.map((t, i) => i));
          el.innerHTML = head + `<div class="qz-dots">${Q.qs.map((_, i) => `<i class="${i < k ? "d" : i === k ? "c" : ""}"></i>`).join("")}</div><div class="qz-q">${esc(q.q)}</div>
            <div class="qz-os">${order.map(i => `<button class="qz-o" data-i="${i}">${esc(q.opts[i])}</button>`).join("")}</div><div class="qz-ft">Question ${k + 1} sur ${Q.qs.length} · il faut tout réussir pour continuer</div>`;
          el.querySelectorAll(".qz-o").forEach(b => b.onclick = () => { ans[k] = +b.dataset.i; k++; k < Q.qs.length ? ask() : check(); }); };
        const check = async () => { el.innerHTML = head + `<div class="qz-ld">Correction…</div>`; let R;
          try { R = await api(`/api/course/${v0.id}/quiz/${g.id}`, { body: { answers: ans } }); } catch (e) { el.innerHTML = head + `<div class="qz-ld">${esc(e.message)}</div><div class="qz-bt"><button class="co-gh" data-rt>Réessayer</button></div>`; el.querySelector("[data-rt]").onclick = check; return; }
          if (R.passed) { g.passed = true; const last = !gate();
            el.innerHTML = head + `<div class="co-ok">${CHECK}</div><div class="qz-q" style="text-align:center">Exercice réussi</div><div class="qz-ft" style="text-align:center">${last ? "Tous les exercices sont validés. Place à la conclusion." : "Le chapitre suivant est débloqué."}</div><div class="qz-bt"><button class="co-go" data-go>Continuer la vidéo →</button></div>`;
            burst(el.querySelector(".co-ok")); el.querySelector("[data-go]").onclick = () => { shut(); v.play().catch(() => {}); }; return; }
          const bad = R.results.filter(r => !r.ok).length;
          el.innerHTML = head + `<div class="qz-q">${bad} erreur${bad > 1 ? "s" : ""} : on reprend</div><div class="qz-rs">${Q.qs.map((q, i) => `<div class="qz-r${R.results[i].ok ? " ok" : ""}"><span>${R.results[i].ok ? "✓" : "✕"}</span><div><b>${esc(q.q)}</b>${R.results[i].ok ? "" : `<small>${esc(R.results[i].why)}</small>`}</div></div>`).join("")}</div>
            <div class="qz-bt"><button class="co-gh" data-rev>Revoir le chapitre</button><button class="co-go" data-rt>Refaire l'exercice</button></div>`;
          el.querySelector("[data-rt]").onclick = run;
          el.querySelector("[data-rev]").onclick = () => { shut(); v.currentTime = Math.max(0, g.from || 0); v.play().catch(() => {}); }; };
        ask(); };
      run();
    }
    const send = (force) => { if (replay || !v.duration) return; const now = Date.now(); if (!force && now - lastSent < 5000) return; lastSent = now;
      return api(`/api/course/${v0.id}/progress`, { body: { pos: Math.min(maxT, v.duration), dur: v.duration } }).catch(() => null); };
    v.addEventListener("loadedmetadata", () => { if (!replay && v0.pos > 3 && v0.pos < v.duration - 2) v.currentTime = v0.pos; });
    const start = () => { ov.querySelector("[data-start]").classList.add("off"); started = true; v.play().catch(() => {}); };
    ov.querySelector("[data-start]").onclick = start;
    v.addEventListener("timeupdate", () => { const g = gate();
      if (g && v.currentTime >= g.at) { if (!v.seeking) maxT = Math.max(maxT, g.at); if (!qzOpen) { v.pause(); if (Math.abs(v.currentTime - g.at) > .05) v.currentTime = g.at; if (started) quiz(g); } return; }
      if (!v.seeking) maxT = Math.max(replay ? 0 : maxT, v.currentTime); bar.style.width = (v.currentTime / (v.duration || 1) * 100) + "%"; tm.textContent = v.duration ? `${fmt(v.duration - v.currentTime)} restantes` : "—"; send(false); });
    v.addEventListener("seeking", () => { if (!replay && v.currentTime > maxT + .5) v.currentTime = maxT; });
    v.addEventListener("click", () => { if (!started || qzOpen) return; v.paused ? v.play() : v.pause(); });
    v.addEventListener("pause", () => { if (!v.ended && !qzOpen) { ps.classList.add("on"); send(true); } }); v.addEventListener("play", () => { if (qzOpen) return void v.pause(); ps.classList.remove("on"); });
    v.addEventListener("ended", async () => { if (finished) return; finished = true; maxT = v.duration;
      const r = replay ? null : await send(true); const T = r && r.training; if (T && T.course) nextVid = T.course.videos[idx + 1] || null; else nextVid = C.videos[idx + 1] || null;
      ov.querySelector("[data-end]").classList.remove("off"); burst(ov.querySelector(".co-ok")); });
    v.addEventListener("error", () => ov.querySelector("[data-err]").classList.remove("off"));
    const close = (then) => { v.pause(); if (!finished) send(true); ov.classList.remove("on"); setTimeout(() => ov.remove(), 400); document.body.style.overflow = ""; document.removeEventListener("keydown", key); onClose(then); };
    ov.querySelectorAll(".co-x,[data-close]").forEach(b => b.onclick = () => close());
    const nb = ov.querySelector("[data-next]"); if (nb) nb.onclick = () => close(nextVid && !nextVid.locked ? nextVid.id : C.videos[idx + 1].id);
    const key = e => { if (e.key === "Escape") close(); else if (e.key === " " && started && !qzOpen) { e.preventDefault(); v.paused ? v.play() : v.pause(); } };
    document.addEventListener("keydown", key);
  }
  function burst(el) { if (!el || reduce) return; const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (let i = 0; i < 18; i++) { const p = document.createElement("i"), a = i / 18 * 6.283, d = 70 + Math.random() * 60; p.className = "co-pt"; p.style.left = cx + "px"; p.style.top = cy + "px"; document.body.appendChild(p);
      p.animate([{ transform: "translate(-50%,-50%) scale(1)", opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px),calc(-50% + ${Math.sin(a) * d}px)) scale(0)`, opacity: 0 }], { duration: 800, easing: "cubic-bezier(.2,.8,.2,1)" }).onfinish = () => p.remove(); } }
  async function render(root, me) {
    root.innerHTML = `<div class="tr"><div class="tr-ld">Chargement…</div></div>`;
    let T, A = [];
    try { [T, A] = await Promise.all([api("/api/training"), api("/api/my-assignments").catch(() => [])]); }
    catch (e) { root.innerHTML = `<div class="tr"><div class="tr-ld">${esc(e.message)}</div></div>`; return; }
    const left = Math.max(0, (me.dailyLimit || 0) - (me.usedToday || 0)), st = T.stats, goal = (T.criteria.find(c => c.key === "avg") ? +T.criteria.find(c => c.key === "avg").label.match(/\d+/)[0] : 70);
    const miss = T.total - T.done;
    const crit = T.criteria.map((c, i) => `<div class="tr-ck${c.ok ? " ok" : ""}" style="--d:${(.12 + i * .05).toFixed(2)}s"><span class="bx">${c.ok ? CHECK : ""}</span><div>${esc(c.label)}${c.sub ? `<small>${esc(c.sub)}</small>` : ""}</div>
      <div class="v${c.ok ? "" : " no"}">${c.link && !c.ok ? `<a class="tr-tst" href="${c.link}">${c.value === "—" ? "Passer le test" : "Refaire"} →</a>` : esc(c.value)}${c.ok ? "" : `<span class="mini"><i style="width:${Math.round(c.pct * 100)}%"></i></span>`}</div></div>`).join("");
    const asg = A.length ? A.slice(0, 3).map(a => `<div class="tr-asg"><span class="av">${esc((a.created_by_name || "M")[0].toUpperCase())}</span><div><b>${esc(a.label || a.persona)} · ${esc(DIFF(a.difficulty))}</b><small>Assigné par ${esc(a.created_by_name || "le manager")} · objectif ${a.goal}${a.due_at ? ` · avant le ${new Date(a.due_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}` : ""}</small></div><a class="tr-sb" href="/app">Commencer</a></div>`).join("")
      : `<div class="tr-mut">Aucun entraînement assigné pour l'instant. Ton manager peut t'en proposer depuis le Simu Chatter.</div>`;
    root.innerHTML = `<div class="tr">
      <div class="tr-hd"><div><div class="tr-eb">EN FORMATION · JOUR ${T.day}</div><h1 class="tr-ttl">Salut <em>${esc(me.username)}.</em></h1></div><span class="tr-badge${T.ready ? " ok" : ""}"><i></i>${T.ready ? "Prêt à valider" : "En formation"}</span></div>
      <div class="tr-g2"><div class="tr-col">
        <section class="tr-card"><div class="tr-hero">${ring(T.done, T.total)}<div><h2>${T.ready ? "Tous tes critères sont <em>verts</em>" : `Encore <em>${miss} critère${miss > 1 ? "s" : ""}</em> avant de devenir chatter`}</h2>
          <p>${T.ready ? "Ton manager a été prévenu : il valide ta formation, et tu auras accès au planning, aux ventes et à ta paie." : "Quand tout est vert, ton manager valide ta formation : tu auras alors accès au planning, aux ventes et à ta paie."}</p></div></div>
          <div class="tr-cks">${crit}</div></section>
        ${courseCard(T.course, T.criteria.filter(c => c.key !== "course" && c.ok).length, T.criteria.filter(c => c.key !== "course").length)}</div>
      <div class="tr-col">
        <section class="tr-card" style="--d:.06s"><div class="tr-cta"><div><h3>Prochaine <em>simulation</em></h3><div class="tr-mut">${left} simulation${left > 1 ? "s" : ""} restante${left > 1 ? "s" : ""} aujourd'hui</div></div><a class="tr-wbtn${left ? "" : " off"}" href="/app">${PLAY}Lancer une simulation</a></div>
          <div class="tr-tip"><span>💡</span><span>${T.tip}</span></div></section>
        <section class="tr-card" style="--d:.1s"><div class="tr-ch"><h3>Ma <em>progression</em></h3><span class="tr-mut">${st.trend.length} dernière${st.trend.length > 1 ? "s" : ""} session${st.trend.length > 1 ? "s" : ""}</span></div><div class="tr-sw">${spark(st.trend, goal)}</div>
          <div class="tr-st4"><div><small>Score moyen (5 dern.)</small><b>${st.avg5 ?? "—"}</b></div><div><small>Meilleur score</small><b class="g">${st.best ?? "—"}</b></div><div><small>Sessions terminées</small><b>${st.sessions}</b></div><div><small>Réponse moyenne</small><b>${st.rt != null ? st.rt + " s" : "—"}</b></div></div>
          <div class="tr-lab">PROFILS DE FANS RÉUSSIS</div><div class="tr-fans">${T.fans.map(f => `<span class="${f.ok ? "ok" : ""}" title="${esc(f.name)}">${f.ok ? "✓ " : ""}${esc(f.label)}</span>`).join("")}</div></section>
        <section class="tr-card" style="--d:.14s"><div class="tr-ch"><h3>Entraînements <em>assignés</em></h3>${A.length ? `<span class="tr-tag">${A.length} à faire</span>` : ""}</div>${asg}</section>
      </div></div></div>`;
    const after = nextId => render(root, me).then(T2 => { if (nextId && T2 && T2.course) player(T2.course, nextId, after); });
    root.querySelectorAll(".co-v[data-v]").forEach(b => b.onclick = () => player(T.course, b.dataset.v, after));
    const go = () => { root.querySelectorAll(".tr-ring .arc").forEach(a => a.style.strokeDashoffset = a.dataset.off); root.querySelectorAll(".tr-spk .sp").forEach(p => p.style.strokeDashoffset = 0); };
    if (reduce) { root.querySelectorAll(".tr-ring .arc,.tr-spk .sp").forEach(a => a.style.transition = "none"); go(); } else setTimeout(go, 250);
    return T;
  }
  return { render, player, icons: { CHECK, PLAY, LOCK }, fmt };
})();
