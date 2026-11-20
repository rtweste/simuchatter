// Entretien manager : la dernière étape avant de passer chatter. Fenêtre animée, enregistrement au fil de l'eau.
const ENTRETIEN = window.ENTRETIEN = (() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const CHK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const HINT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';
  const RATE_LBL = ["", "Pas du tout convaincu", "Peu convaincu", "Correct", "Très bien", "Excellent"];
  const toneOf = (q, v) => q.options ? (q.options.find(o => o.v === v) || {}).tone : null;
  // petits sons (même réglage que le reste du site)
  let ac = null; const snd = (fs, len = .12, pk = .03, type = "sine") => { try { if (localStorage.getItem("stSound") === "0") return; } catch (e) {}
    try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state !== "running") ac.resume(); const t0 = ac.currentTime + .01;
      fs.forEach((f, i) => { const o = ac.createOscillator(), g = ac.createGain(), t = t0 + i * .06; o.type = type; o.frequency.value = f; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(pk, t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + len); o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + len + .05); }); } catch (e) {} };
  const tick = () => snd([2637], .05, .02, "triangle"), pop = () => snd([1568, 2093], .09, .025), done = () => snd([1318.5, 1975.5, 2637, 3520], .6, .05);

  function open(user, origin, onChange) {
    let D, ans = {}, decision = null, cur = 0, root, saving = null, dirty = {}, closed = false;
    const box = () => root.querySelector(".iv-box");
    api(`/api/admin/users/${user.id}/interview`).then(d => { D = d; ans = JSON.parse(JSON.stringify(d.answers || {})); delete ans._test; decision = d.decision; build(); }).catch(e => alert(e.message));
    const Q = () => D.questions, N = () => Q().length;
    const answered = q => { const a = ans[q.id]; return !!a && (q.type === "slots" ? (a.v || []).length > 0 : q.type === "rating" ? a.v >= 1 : !!(q.options || []).find(o => o.v === a.v)); };
    const nDone = () => Q().filter(answered).length;

    function build() {
      const t = user.training || {}, st = t.stats || {};
      root = document.createElement("div"); root.className = "iv"; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Entretien avec " + user.username);
      const name = [...user.username].map((c, i) => `<span style="--i:${i}">${esc(c)}</span>`).join("");
      const r = 15, C = 2 * Math.PI * r;
      root.innerHTML = `<div class="iv-scrim"></div><div class="iv-box"><span class="iv-handle"></span><canvas class="iv-fx"></canvas>
        <header class="iv-top"><span class="iv-av" data-in style="--d:0">${esc(user.username[0].toUpperCase())}</span>
          <div data-in style="--d:1"><h3>Entretien avec <em>${name}</em></h3><small>${t.done ?? "?"} / ${t.total ?? "?"} critères · score moyen ${st.avg5 ?? "—"} · ${t.course && t.course.complete ? "formation messagerie terminée" : "formation messagerie en cours"}</small></div>
          <div class="iv-prog" data-in style="--d:2"><span class="iv-save"><i></i><span>Enregistré</span></span>
            <span class="iv-cnt"><span class="roll"><span>${Array.from({ length: N() + 1 }, (_, i) => `<span>${i}</span>`).join("")}</span></span><small>/ ${N()}</small></span>
            <svg class="iv-ring" viewBox="0 0 38 38"><circle class="bg" cx="19" cy="19" r="${r}"/><circle class="fg" cx="19" cy="19" r="${r}" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>
            <button class="iv-x" aria-label="Fermer">✕</button></div></header>
        <div class="iv-bd"><nav class="iv-nav"><span class="iv-ind"></span>
          ${Q().map((q, i) => `<button data-go="${i}" data-in style="--d:${i + 2}"><span class="iv-dot">${CHK}<b>${i + 1}</b></span><span>${esc(q.cat)}</span></button>`).join("")}
          <span class="sep"></span><button class="fin" data-go="${N()}" data-in style="--d:${N() + 2}"><span class="iv-dot">${CHK}<b>✦</b></span><span>Décision</span></button></nav>
          <main class="iv-stage"></main></div>
        <footer class="iv-ft"><button class="iv-btn" data-prev>← Précédent</button><span class="pips">${Array.from({ length: N() + 1 }, () => "<i></i>").join("")}</span><button class="iv-btn w" data-next>Suivant →</button></footer></div>`;
      document.body.appendChild(root); document.body.style.overflow = "hidden";
      root.querySelector(".iv-x").onclick = () => close();
      root.querySelector(".iv-scrim").onclick = () => close();
      root.querySelectorAll("[data-go]").forEach(b => b.onclick = () => { tick(); go(+b.dataset.go); });
      root.querySelector("[data-prev]").onclick = () => { tick(); go(cur - 1); };
      root.querySelector("[data-next]").onclick = () => { if (cur === N()) return finish(); pop(); go(cur + 1); };
      document.addEventListener("keydown", key);
      drag();
      // ouverture : la fenêtre part du bouton qui l'a ouverte (FLIP) puis se déploie avec un ressort
      requestAnimationFrame(() => { root.classList.add("on"); const b = box();
        if (!reduce && origin && b.animate) { const o = origin.getBoundingClientRect(), f = b.getBoundingClientRect(), mob = innerWidth <= 760;
          const from = mob ? `translateY(100%)` : `translate(${o.left + o.width / 2 - (f.left + f.width / 2)}px, ${o.top + o.height / 2 - (f.top + f.height / 2)}px) scale(${Math.max(.08, o.width / f.width)}, ${Math.max(.05, o.height / f.height)})`;
          b.animate([{ transform: from, opacity: mob ? 1 : 0, borderRadius: "40px" }, { transform: "none", opacity: 1, borderRadius: mob ? "24px 24px 0 0" : "24px" }],
            { duration: mob ? 520 : 700, easing: "cubic-bezier(.2,1.25,.3,1)" }); }
        const first = Q().findIndex(q => !answered(q)); go(first === -1 ? N() : first, true); refresh(); });
    }

    // ----- navigation entre les étapes -----
    function go(i, first) {
      i = Math.max(0, Math.min(N(), i)); const dir = i >= cur ? 1 : -1; const stage = root.querySelector(".iv-stage"), old = stage.querySelector(".iv-sec");
      cur = i; const sec = document.createElement("section"); sec.className = "iv-sec"; sec.innerHTML = i === N() ? finalHTML() : qHTML(Q()[i], i); stage.appendChild(sec);
      wire(sec, i);
      if (old) { if (!reduce && old.animate) old.animate([{ opacity: 1, transform: "none", filter: "blur(0)" }, { opacity: 0, transform: `translateX(${-50 * dir}px) scale(.98)`, filter: "blur(6px)" }], { duration: 280, easing: "cubic-bezier(.4,0,.6,1)", fill: "forwards" }).onfinish = () => old.remove(); else old.remove(); }
      if (!reduce && sec.animate && !first) sec.animate([{ opacity: 0, transform: `translateX(${70 * dir}px)`, filter: "blur(8px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], { duration: 520, easing: "cubic-bezier(.2,1,.3,1)" });
      requestAnimationFrame(() => sec.classList.add("show"));
      root.querySelectorAll(".iv-nav button").forEach(b => b.classList.toggle("cur", +b.dataset.go === i));
      moveInd(); refresh();
      // fait défiler seulement la barre d'étapes (scrollIntoView ferait aussi glisser la fenêtre)
      const nb = root.querySelector(".iv-nav button.cur"), nav = root.querySelector(".iv-nav");
      if (nb && innerWidth <= 760) nav.scrollTo({ left: nb.offsetLeft - (nav.clientWidth - nb.offsetWidth) / 2, behavior: reduce ? "auto" : "smooth" });
      root.querySelector(".iv-box").scrollLeft = 0; stage.scrollLeft = 0;
    }
    function moveInd() {
      const ind = root.querySelector(".iv-ind"), b = root.querySelector(".iv-nav button.cur"), nav = root.querySelector(".iv-nav"); if (!b) return;
      if (innerWidth <= 760) { ind.style.transform = `translateX(${b.offsetLeft}px)`; ind.style.width = b.offsetWidth + "px"; ind.style.height = b.offsetHeight + "px"; }
      else { ind.style.transform = `translateY(${b.offsetTop}px)`; ind.style.height = b.offsetHeight + "px"; ind.style.width = ""; }
      // petit étirement façon « goutte » pendant le déplacement
      if (!reduce && ind.animate) ind.animate([{ filter: "brightness(1)" }, { filter: "brightness(1.6)" }, { filter: "brightness(1)" }], { duration: 500 });
    }

    // ----- contenu d'une question -----
    function qHTML(q, i) {
      const a = ans[q.id] || {}; let body = "";
      if (q.type === "slots") {
        const sel = a.v || [];
        body = `<div class="iv-slots st" style="--d:3">${D.slots.map(s => `<button class="iv-slot${sel.includes(s.id) ? " on" : ""}" data-slot="${esc(s.id)}"><span class="tk"><svg viewBox="0 0 24 24" width="12" height="12"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><b>${esc(s.label)}</b><small>${s.start} → ${s.end}</small></button>`).join("")}</div>
          <div class="iv-bar st" style="--d:4"><span>00 h</span><span class="tl">${[6, 12, 18].map(h => `<em style="left:${h / 24 * 100}%"></em>`).join("")}<span data-tl></span></span><span>24 h</span></div>`;
      } else if (q.type === "rating") {
        body = `<div class="iv-rate st" style="--d:3">${[1, 2, 3, 4, 5].map(n => `<button data-rate="${n}" style="--i:${n}" class="${a.v >= n ? "f" : ""}"><span>${n}</span></button>`).join("")}</div><div class="iv-rlab st" style="--d:4">${a.v ? `<b>${a.v} / 5</b> · ${RATE_LBL[a.v]}` : "Choisis une note de 1 à 5"}</div>`;
      } else {
        body = `<div class="iv-opts st" style="--d:3"><span class="iv-glide"></span>${q.options.map((o, k) => `<button class="iv-opt ${o.tone}${a.v === o.v ? " sel" : ""}" data-opt="${o.v}"><i></i>${esc(o.label)}<kbd>${k + 1}</kbd></button>`).join("")}</div>`;
      }
      return `<div class="iv-cat st ${q.id === "situ" ? "o" : ""}" style="--d:0"><i></i>${i + 1} · ${esc(q.cat.toUpperCase())}</div><h2 class="iv-q st" style="--d:1">${esc(q.q)}</h2>
        ${q.hint ? `<div class="iv-hint st" style="--d:2">${HINT}<span>${esc(q.hint)}</span></div>` : ""}${body}
        <div class="iv-note st" style="--d:5"><label>${q.type === "rating" ? "COMMENTAIRE" : "NOTES"} · FACULTATIF</label><textarea maxlength="800" placeholder="${q.type === "rating" ? "Ton impression, visible par les managers seulement…" : "Ce qu'il a répondu, ce que tu as remarqué…"}">${esc(a.note || "")}</textarea></div>`;
    }
    function wire(sec, i) {
      if (i === N()) return wireFinal(sec);
      const q = Q()[i]; const set = patch => { ans[q.id] = { ...(ans[q.id] || { note: "" }), ...patch }; dirty[q.id] = 1; save(); refresh(); };
      if (q.type === "slots") {
        const tl = sec.querySelector("[data-tl]");
        const paintTl = () => { const sel = (ans[q.id] || {}).v || []; tl.innerHTML = D.slots.filter(s => sel.includes(s.id)).map((s, k) => { const h = x => { const [a, b] = x.split(":").map(Number); return a + b / 60; }; let a = h(s.start), b = h(s.end); if (b <= a) b += 24;
          return [[a, Math.min(b, 24)], ...(b > 24 ? [[0, b - 24]] : [])].map(([x, y]) => `<i style="left:${x / 24 * 100}%;width:${(y - x) / 24 * 100}%;animation-delay:${k * 40}ms"></i>`).join(""); }).join(""); };
        paintTl();
        sec.querySelectorAll("[data-slot]").forEach(b => b.onclick = e => { const r = b.getBoundingClientRect(); b.style.setProperty("--x", (e.clientX - r.left) + "px"); b.style.setProperty("--y", (e.clientY - r.top) + "px");
          const sel = new Set((ans[q.id] || {}).v || []); sel.has(b.dataset.slot) ? sel.delete(b.dataset.slot) : sel.add(b.dataset.slot); b.classList.toggle("on"); tick();
          set({ v: D.slots.map(s => s.id).filter(x => sel.has(x)) }); paintTl(); });
      } else if (q.type === "rating") {
        const bs = [...sec.querySelectorAll("[data-rate]")], lab = sec.querySelector(".iv-rlab");
        bs.forEach(b => { b.onmouseenter = () => bs.forEach(x => x.classList.toggle("pv", +x.dataset.rate <= +b.dataset.rate && !x.classList.contains("f")));
          b.onclick = () => { const n = +b.dataset.rate; bs.forEach(x => x.classList.toggle("f", +x.dataset.rate <= n)); lab.innerHTML = `<b>${n} / 5</b> · ${RATE_LBL[n]}`; pop(); set({ v: n }); }; });
        sec.querySelector(".iv-rate").onmouseleave = () => bs.forEach(x => x.classList.remove("pv"));
      } else {
        const wrap = sec.querySelector(".iv-opts"), gl = wrap.querySelector(".iv-glide");
        const place = (b, inst) => { if (!b) { gl.classList.remove("on"); return; } if (inst) gl.style.transition = "none";
          gl.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop - 5}px)`; gl.style.width = b.offsetWidth + "px"; gl.style.height = b.offsetHeight + "px";
          gl.className = "iv-glide on " + toneOf(q, b.dataset.opt); if (inst) requestAnimationFrame(() => gl.style.transition = ""); };
        requestAnimationFrame(() => place(wrap.querySelector(".sel"), true));
        wrap.querySelectorAll("[data-opt]").forEach(b => b.onclick = () => { wrap.querySelectorAll(".iv-opt").forEach(x => x.classList.toggle("sel", x === b)); place(b); pop(); set({ v: b.dataset.opt });
          if (!reduce && b.animate) b.animate([{ transform: "scale(1)" }, { transform: "scale(1.06)" }, { transform: "scale(1)" }], { duration: 380, easing: "cubic-bezier(.34,1.56,.64,1)" });
          // passe tout seul à la question suivante (comme un vrai formulaire guidé)
          clearTimeout(sec._auto); sec._auto = setTimeout(() => { if (cur === i && !closed) go(i + 1); }, 650); });
      }
      const ta = sec.querySelector("textarea"); const fit = () => { ta.style.height = "auto"; ta.style.height = Math.min(220, ta.scrollHeight + 2) + "px"; }; fit();
      ta.oninput = () => { fit(); ans[q.id] = { ...(ans[q.id] || { v: q.type === "slots" ? [] : null }), note: ta.value }; dirty[q.id] = 1; save(800); };
      ta.onfocus = () => clearTimeout(sec._auto);
    }

    // ----- dernière étape : récapitulatif et décision -----
    function finalHTML() {
      const val = q => { const a = ans[q.id]; if (!answered(q)) return `<b class="no">Pas encore répondu</b>`;
        if (q.type === "slots") return `<b>${a.v.map(esc).join(" · ")}</b>`; if (q.type === "rating") return `<b class="${a.v >= 4 ? "ok" : a.v >= 3 ? "mid" : "bad"}">${a.v} / 5</b>`;
        const o = q.options.find(o => o.v === a.v); return `<b class="${o.tone}">${esc(o.label)}</b>`; };
      return `<div class="iv-cat st" style="--d:0"><i></i>DERNIÈRE ÉTAPE</div><h2 class="iv-q st" style="--d:1">Ta décision pour ${esc(user.username)}</h2>
        <div class="iv-rec">${Q().map((q, k) => `<div class="st" style="--d:${k + 2}" data-jump="${k}"><small>${esc(q.cat.toUpperCase())}</small>${val(q)}</div>`).join("")}</div>
        <div class="iv-dec st" style="--d:9"><span class="iv-dthumb"></span>${Object.entries(D.decisions).map(([k, l]) => `<button data-dec="${k}" class="${decision === k ? "sel" : ""}">${esc(l)}</button>`).join("")}</div>
        <div class="iv-warn st" style="--d:10"></div>`;
    }
    function wireFinal(sec) {
      sec.querySelectorAll("[data-jump]").forEach(d => d.onclick = () => { tick(); go(+d.dataset.jump); });
      const th = sec.querySelector(".iv-dthumb"), bs = [...sec.querySelectorAll("[data-dec]")];
      const place = (b, inst) => { if (!b) return; if (inst) th.style.transition = "none"; th.style.width = b.offsetWidth + "px"; th.style.transform = `translateX(${b.offsetLeft - 6}px)`; th.className = "iv-dthumb on " + b.dataset.dec; if (inst) requestAnimationFrame(() => th.style.transition = ""); };
      requestAnimationFrame(() => place(bs.find(b => b.dataset.dec === decision), true));
      bs.forEach(b => b.onclick = () => { decision = b.dataset.dec; bs.forEach(x => x.classList.toggle("sel", x === b)); place(b); pop(); dirty._d = 1; save(); refresh(); });
      refresh();
    }

    // ----- état général : compteur, anneau, pastilles, bouton -----
    function refresh() {
      if (!root) return; const n = nDone(), C = 2 * Math.PI * 15;
      root.querySelector(".iv-ring .fg").style.strokeDashoffset = C * (1 - n / N());
      root.querySelector(".iv-cnt .roll>span").style.transform = `translateY(${-n * 1.2}em)`;
      root.querySelectorAll(".iv-nav button[data-go]").forEach(b => { const k = +b.dataset.go; const ok = k < N() ? answered(Q()[k]) : (n === N() && !!decision);
        if (ok && !b.classList.contains("ok") && !reduce && b.querySelector(".iv-dot").animate) b.querySelector(".iv-dot").animate([{ transform: "scale(.6)" }, { transform: "scale(1.25)" }, { transform: "scale(1.08)" }], { duration: 450, easing: "cubic-bezier(.34,1.56,.64,1)" });
        b.classList.toggle("ok", ok); });
      root.querySelectorAll(".iv-ft .pips i").forEach((p, k) => { p.classList.toggle("cur", k === cur); p.classList.toggle("ok", k < N() && answered(Q()[k])); });
      root.querySelector("[data-prev]").disabled = cur === 0;
      const nx = root.querySelector("[data-next]");
      if (cur === N()) { const miss = N() - n; nx.textContent = miss ? `Encore ${miss} question${miss > 1 ? "s" : ""}` : !decision ? "Choisis une décision" : "Terminer l'entretien";
        nx.disabled = !!miss || !decision; nx.classList.toggle("ready", !miss && !!decision);
        if (!miss && decision) nx.textContent = decision === "hire" ? `Recruter ${user.username}` : decision === "refused" ? "Refuser et désactiver" : "Enregistrer l'entretien";
        const w = root.querySelector(".iv-warn"); if (w) { w.style.color = decision === "hire" ? "var(--g)" : decision === "refused" ? "var(--r)" : "";
          w.textContent = decision === "hire" ? `${user.username} devient chatter tout de suite : il aura accès au planning, aux ventes et à sa paie.` : decision === "refused" ? `Son compte est désactivé tout de suite et sa candidature refusée. Tu pourras le réactiver depuis l'onglet « Désactivés ».` : decision === "review" ? "Il reste en formation : tu pourras refaire l'entretien plus tard." : ""; } }
      else { nx.disabled = false; nx.textContent = cur === N() - 1 ? "Voir le récap →" : "Suivant →"; nx.classList.toggle("ready", answered(Q()[cur])); }
    }

    // ----- enregistrement automatique -----
    function save(wait = 250) {
      clearTimeout(saving); const s = root.querySelector(".iv-save"); s.className = "iv-save on busy"; s.querySelector("span").textContent = "Enregistrement…";
      saving = setTimeout(async () => { const body = { answers: {} }; Object.keys(dirty).forEach(k => { if (k !== "_d") body.answers[k] = ans[k] || null; }); if (dirty._d) body.decision = decision; dirty = {};
        try { const r = await api(`/api/admin/users/${user.id}/interview`, { method: "PUT", body }); s.className = "iv-save on ok"; s.querySelector("span").textContent = "Enregistré"; onChange && onChange(r.summary, false); }
        catch (e) { s.className = "iv-save on"; s.querySelector("span").textContent = "Pas enregistré"; } }, wait);
      return new Promise(r => setTimeout(r, wait + 50));
    }
    async function finish() {
      const btn = root.querySelector("[data-next]"); btn.classList.remove("ready"); btn.classList.add("busy"); clearTimeout(saving);
      try { const body = { answers: {}, decision, done: true }; Q().forEach(q => body.answers[q.id] = ans[q.id] || null);
        const r = await api(`/api/admin/users/${user.id}/interview`, { method: "PUT", body });
        btn.classList.add("done"); btn.classList.toggle("rf", decision === "refused"); if (decision === "refused") snd([660, 523], .3, .04, "triangle"); else { done(); if (decision === "hire") confetti(); } onChange && onChange(r.summary, true, r.outcome);
        setTimeout(() => close(true), 1500);
      } catch (e) { btn.classList.remove("busy"); const w = root.querySelector(".iv-warn"); if (w) w.textContent = e.message; }
    }

    // ----- confettis (canvas) -----
    function confetti() {
      if (reduce) return; const cv = root.querySelector(".iv-fx"), b = box().getBoundingClientRect(), dpr = devicePixelRatio || 1; cv.width = b.width * dpr; cv.height = b.height * dpr; const x = cv.getContext("2d"); x.scale(dpr, dpr);
      const btn = root.querySelector("[data-next]").getBoundingClientRect(), ox = btn.left - b.left + btn.width / 2, oy = btn.top - b.top + btn.height / 2;
      const cols = ["#5fd3a2", "#f5f5f5", "#9be8c6", "#3fae80"]; const P = Array.from({ length: 120 }, () => { const a = -Math.PI / 2 + (Math.random() - .5) * 2.2, v = 7 + Math.random() * 9;
        return { x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * Math.PI, vr: (Math.random() - .5) * .4, w: 4 + Math.random() * 5, h: 7 + Math.random() * 7, c: cols[Math.random() * cols.length | 0], life: 1 }; });
      const t0 = performance.now(); (function f(t) { x.clearRect(0, 0, b.width, b.height); P.forEach(p => { p.vy += .32; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life = 1 - (t - t0) / 1600;
        x.save(); x.globalAlpha = Math.max(0, p.life); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2))); x.restore(); });
        if (t - t0 < 1600) requestAnimationFrame(f); else x.clearRect(0, 0, b.width, b.height); })(t0);
    }

    // ----- fermeture (vers le bouton d'origine) et glisser vers le bas sur mobile -----
    function close(finished) {
      if (closed || !root) return; closed = true; document.removeEventListener("keydown", key); clearTimeout(saving);
      if (Object.keys(dirty).length) save(0);
      const b = box(), r = root; r.classList.remove("on");
      if (!reduce && b.animate) { const mob = innerWidth <= 760; let to = mob ? "translateY(100%)" : "scale(.94) translateY(12px)";
        if (!mob && origin && document.body.contains(origin)) { const o = origin.getBoundingClientRect(), f = b.getBoundingClientRect(); to = `translate(${o.left + o.width / 2 - (f.left + f.width / 2)}px, ${o.top + o.height / 2 - (f.top + f.height / 2)}px) scale(${Math.max(.08, o.width / f.width)}, ${Math.max(.05, o.height / f.height)})`; }
        b.animate([{ transform: getComputedStyle(b).transform === "none" ? "none" : getComputedStyle(b).transform, opacity: 1 }, { transform: to, opacity: 0 }], { duration: finished ? 520 : 380, easing: "cubic-bezier(.5,0,.75,0)", fill: "forwards" }).onfinish = () => r.remove(); }
      else r.remove();
      document.body.style.overflow = "";
    }
    function key(e) {
      if (e.target.tagName === "TEXTAREA") { if (e.key === "Escape") e.target.blur(); return; }
      if (e.key === "Escape") close(); else if (e.key === "ArrowRight") go(cur + 1); else if (e.key === "ArrowLeft") go(cur - 1);
      else if (/^[1-5]$/.test(e.key) && cur < N()) { const q = Q()[cur], sec = root.querySelector(".iv-sec:last-child");
        if (q.type === "rating") sec.querySelector(`[data-rate="${e.key}"]`)?.click(); else if (q.options) sec.querySelectorAll("[data-opt]")[+e.key - 1]?.click(); }
    }
    function drag() {
      const h = root.querySelector(".iv-top"); let y0 = null, dy = 0;
      h.addEventListener("pointerdown", e => { if (innerWidth > 760 || e.target.closest("button")) return; y0 = e.clientY; dy = 0; box().style.transition = "none"; });
      addEventListener("pointermove", e => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); box().style.transform = `translateY(${dy}px)`; });
      addEventListener("pointerup", () => { if (y0 == null) return; y0 = null; const b = box(); b.style.transition = "transform .45s cubic-bezier(.34,1.56,.64,1)";
        if (dy > 120) { b.style.transition = ""; close(); } else b.style.transform = ""; });
    }
    addEventListener("resize", () => { if (root && !closed) { moveInd(); } });
  }
  return { open };
})();
