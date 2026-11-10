/* =====================================================================
   StellADS — effets du simulateur : sons (Web Audio) + rapport animé
   ===================================================================== */
const FX = (() => {
  /* ---------------- Sons ---------------- */
  let ctx = null, out = null;
  const soundOn = () => { try { return localStorage.getItem("stSound") !== "0"; } catch (e) { return true; } };
  function audio() {
    if (!soundOn()) return null;
    try {
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
      if (!ctx) { ctx = new C(); out = ctx.createGain(); out.gain.value = 0.2; out.connect(ctx.destination); }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    } catch (e) { return null; }
  }
  // à appeler pendant un clic : les navigateurs n'autorisent le son qu'après une action
  function unlock() { const c = audio(); if (c) { const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); } }
  function tone(f, at, len, peak, type, glideTo) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || "sine"; o.frequency.setValueAtTime(f, at); if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, at + len * 0.9);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.012, len / 4)); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g); g.connect(out); o.start(at); o.stop(at + len + 0.05);
  }
  function noise(at, len, peak, hp) {
    const n = Math.max(1, Math.floor(ctx.sampleRate * len)), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buf; f.type = "highpass"; f.frequency.value = hp || 2500; g.gain.value = peak;
    src.connect(f); f.connect(g); g.connect(out); src.start(at);
  }
  const S = {
    // vente d'un PPV : deux notes cristallines + léger scintillement
    sale() { if (!audio()) return; const t = ctx.currentTime + 0.02;
      [[1318.5, 0, 0.9, .35], [1975.5, 0.09, 1.1, .35], [2637, 0.2, 0.5, .08], [3951, 0.26, 0.35, .08], [3136, 0.31, 0.3, .08]].forEach(([f, d, l, p]) => tone(f, t + d, l, p)); },
    fill(i, score, len) { if (!audio()) return; const t = ctx.currentTime + 0.01, L = len / 1000, notes = [1046.5, 1174.7, 1318.5, 1568, 1760, 2093, 2349];
      tone(300 + i * 40, t, L, 0.035, "triangle", 300 + i * 40 + score * 60);
      tone(notes[i % notes.length], t + L - 0.03, 0.55, score >= 8 ? 0.28 : 0.18); tone(notes[i % notes.length] * 2, t + L - 0.02, 0.3, 0.05); },
    drone(len) { if (!audio()) return; tone(70, ctx.currentTime + 0.01, len / 1000, 0.12, "sawtooth", 140); },
    tick(strong) { if (!audio()) return; noise(ctx.currentTime + 0.005, 0.022, strong ? 0.3 : 0.14, strong ? 3200 : 2200); },
    lock(big) { if (!audio()) return; const t = ctx.currentTime + 0.01; tone(big ? 170 : 150, t, 0.25, 0.6, "sine", 55); noise(t, 0.04, 0.5, 1500); },
    win() { if (!audio()) return; const t = ctx.currentTime + 0.02;
      tone(110, t, 0.6, 0.5, "sine", 45);
      [523.3, 659.3, 784, 1046.5, 1318.5, 1568, 2093].forEach((f, i) => { tone(f, t + i * 0.055, 0.5, 0.2, "triangle"); tone(f * 2, t + i * 0.055, 0.25, 0.04); });
      [1046.5, 1318.5, 1568, 2093].forEach(f => { tone(f, t + 0.42, 1.8, 0.16); tone(f * 1.004, t + 0.42, 1.8, 0.08); });
      for (let k = 0; k < 14; k++) { const at = t + 0.45 + k * 0.07 + Math.random() * 0.04, f = 3500 + Math.random() * 1800; tone(f, at, 0.12, 0.05, "square"); tone(f * 1.5, at + 0.02, 0.1, 0.03); } },
    soft() { if (!audio()) return; const t = ctx.currentTime + 0.02; [784, 987.8, 1318.5].forEach((f, i) => tone(f, t + i * 0.07, 0.9, 0.12)); },
    coin(k) { if (!audio()) return; const t = ctx.currentTime + 0.01, f = 2400 + k * 180; tone(f, t, 0.18, 0.12, "triangle"); tone(f * 1.5, t + 0.03, 0.22, 0.06); noise(t, 0.03, 0.12, 4000); },
    tile(i) { if (!audio()) return; const t = ctx.currentTime + 0.01; tone(880 + i * 110, t, 0.16, 0.07); noise(t, 0.02, 0.08, 2500); },
    flip() { if (!audio()) return; const t = ctx.currentTime + 0.01;
      const n = Math.floor(ctx.sampleRate * 0.45), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / n);
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = buf; f.type = "bandpass"; f.Q.value = 1.2; f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(3500, t + 0.4); g.gain.value = 0.35;
      src.connect(f); f.connect(g); g.connect(out); src.start(t);
      tone(1568, t + 0.42, 0.7, 0.12); tone(2349, t + 0.46, 0.6, 0.06); }
  };
  const buzz = p => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };

  /* ---------------- Outils ---------------- */
  const ease = x => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const q4 = x => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 4);
  const STAR = "M12 1.5 14.2 9.8 22.5 12 14.2 14.2 12 22.5 9.8 14.2 1.5 12 9.8 9.8Z";
  const strip = n => Array.from({ length: n }, (_, i) => `<span>${i % 10}</span>`).join("");
  const SHORT = { "accroche": "Accroche", "personnalisation": "Écoute", "écoute": "Écoute", "respect du personnage": "Personnage", "personnage": "Personnage",
    "technique": "Vente", "vente": "Vente", "objection": "Objections", "éthique": "Éthique" };
  const shortName = n => { const l = String(n || "").toLowerCase(); for (const k in SHORT) if (l.includes(k)) return SHORT[k]; return n; };
  const SV = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="sic"';
  const ICO = {
    coin: `<svg ${SV}><circle cx="12" cy="12" r="8.5" pathLength="60"/><path d="M15 9.2a3.6 3.6 0 1 0 0 5.6M8 11h5M8 13h5" pathLength="60"/></svg>`,
    clock: `<svg ${SV}><circle cx="12" cy="12" r="8.5" pathLength="60"/><path class="hand" d="M12 7.5V12l3 2" pathLength="60"/></svg>`,
    lock: `<svg ${SV}><path class="shk" d="M8 11V8a4 4 0 0 1 8 0v3" pathLength="60"/><rect x="5.5" y="11" width="13" height="9.5" rx="2" pathLength="60"/></svg>`,
    bulb: `<svg ${SV}><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" pathLength="60"/></svg>`
  };
  // petit compteur : une colonne par chiffre
  const miniCounter = (value, unit) => {
    const str = String(value);
    return str.split("").map(ch => /\d/.test(ch) ? `<span class="mcol" data-d="${ch}"><span class="strip">${strip(20)}</span></span>` : `<span>${esc(ch)}</span>`).join("") + (unit ? `<em>${esc(unit)}</em>` : "");
  };

  /* ---------------- Rapport ---------------- */
  let raf = null;
  function report(root, sim, opts = {}) {
    cancelAnimationFrame(raf);
    const r = sim.report || {}, score = Math.max(0, Math.min(100, Number(sim.score) || 0));
    const crits = (r.criteria || []).slice(0, 6).map(c => ({ name: shortName(c.name), s: Math.max(0, Math.min(10, Math.round(Number(c.score) || 0))) }));
    const ppvs = (sim.log || []).filter(l => l.who === "ppv"), bought = ppvs.filter(p => p.status === "acheté").length;
    const jackpot = score >= 80;
    const title = score >= 80 ? "Excellent<br>travail" : score >= 65 ? "Bon<br>travail" : score >= 50 ? "Peut mieux<br>faire" : "À<br>retravailler";
    const prev = opts.prevScore, delta = prev == null ? null : score - prev;
    const rt = sim.avgRt, rtLabel = rt == null ? "" : rt <= 60 ? "Rapide" : rt <= 120 ? "Correct" : "Lent";
    const rtFill = rt == null ? 0 : Math.max(8, Math.min(100, (150 - rt) / 150 * 100));
    const best = r.best && r.best.message ? r.best : null;
    const scoreTxt = String(score).padStart(2, "0");
    const digits = scoreTxt.split("").map(Number);
    const CIRC = 352;

    const deltaHTML = delta == null ? `<span class="cmpv neutral">Première simu</span>`
      : `<span class="cmpv ${delta < 0 ? "down" : delta === 0 ? "neutral" : ""}">${delta === 0 ? "" : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${delta > 0 ? "M12 19V5M5 12l7-7 7 7" : "M12 5v14M5 12l7 7 7-7"}"/></svg>`}<b data-delta>${delta > 0 ? "+" : delta < 0 ? "−" : "="}${Math.abs(delta) || ""}</b> vs dernière simu</span>`;
    const coins = sim.revenue > 0 ? [[-18, 0], [12, .09], [-6, .18], [20, .27], [-14, .36]].map(([x, d]) => `<i class="coin" style="--x:${x}px;--d:${d}s"></i>`).join("") : "";
    const dots = ppvs.slice(0, 8).map((p, i) => `<i class="${p.status === "acheté" ? "ok" : ""}" style="transition-delay:${1 + i * 0.08}s"></i>`).join("");

    root.innerHTML = `
    <div class="rp ${jackpot ? "is-jack" : "is-land"}">
      <div class="rp-top">
        <div class="hero">
          <div class="halo"></div><span class="ripple"></span><span class="ripple" style="animation-delay:.2s"></span><span class="ripple" style="animation-delay:.4s"></span>
          <div class="flashg"></div><div class="trace glow"></div><div class="trace"></div>
          <div class="ringw">
            <svg width="128" height="128" viewBox="0 0 128 128" aria-hidden="true"><circle class="bg" cx="64" cy="64" r="56" fill="none" stroke-width="8"/><circle class="fg" cx="64" cy="64" r="56" fill="none" stroke-width="8" style="stroke-dasharray:${CIRC};stroke-dashoffset:${CIRC}"/></svg>
            <div class="num" role="img" aria-label="Score ${score} sur 100"><div class="odo idle">${digits.map(() => `<span class="col"><span class="strip">${strip(40)}</span></span>`).join("")}</div><small>/ 100</small></div>
          </div>
          <div class="hside">
            <span class="win">${title}</span>
            ${deltaHTML}
            <p class="verdict">${esc(r.verdict || "")}</p>
          </div>
        </div>
        ${r.ethics_flag ? `<div class="flag">⚠️ <b>Point éthique :</b> ${esc(r.ethics_flag)}</div>` : ""}
        ${crits.length ? `<div class="card crits"><h3>Détail par critère</h3><div class="crg">${crits.map(c => `
          <div class="cr"><div class="row"><span>${esc(c.name)}${c.s === 10 ? '<em class="tagp">Parfait</em>' : ""}</span><b><span class="pop">0</span><span class="of">/10</span></b></div><div class="bar"><i></i></div></div>`).join("")}</div></div>` : ""}
        <div class="stats2">
          <div class="st revc">${ICO.coin}<div class="v"><b data-rev>0 €</b></div><small>Revenu</small>${coins}</div>
          <div class="st">${ICO.clock}<div class="v">${rt == null ? "<b>—</b>" : miniCounter(rt, "s")}</div><small>Réponse</small><span class="bar2"><i></i></span></div>
          <div class="st">${ICO.lock}<div class="v">${miniCounter(bought, "/" + ppvs.length)}</div><small>PPV achetés</small><span class="dots">${dots}</span></div>
          <div class="st">${ICO.bulb}<div class="v">${miniCounter(sim.hints || 0)}</div><small>Conseils</small><span class="cap ${sim.hints ? "" : "gold"}">${sim.hints ? `−${sim.hints * 3} pts` : `<svg width="9" height="9" viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR}" fill="currentColor"/></svg>Sans aide`}</span></div>
        </div>
        ${best ? `<div class="flip"><div class="flin">
          <div class="face back"><svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR}" fill="currentColor"/></svg><small>Ton meilleur message</small></div>
          <div class="face front"><h3>Ton meilleur message</h3><div class="q">${esc(best.message)}</div><p>${esc(best.why || "")}</p></div>
        </div></div>` : ""}
        <div class="rp-actions"><button class="again" data-new>Nouvelle simulation</button><button class="more" data-more aria-expanded="false">Voir l'analyse complète</button></div>
      </div>
      <div class="rp-detail hidden">${detailHTML(sim)}</div>
      <div class="spot"></div>
      ${opts.animate ? `<button class="skip" data-skip>Passer</button>` : ""}
    </div>`;

    const $q = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];
    const rp = $q(".rp"), fg = $q(".ringw .fg"), cols = $$(".odo .col .strip"), colEls = $$(".odo .col"), odo = $q(".odo");
    const critEls = $$(".cr").map(el => ({ el, val: el.querySelector(".pop"), bar: el.querySelector(".bar i") }));
    const tiles = $$(".st"), revEl = $q("[data-rev]"), deltaEl = $q("[data-delta]"), bar2 = $q(".bar2 i");
    const minis = tiles.map(t => [...t.querySelectorAll(".mcol")].map(m => ({ s: m.querySelector(".strip"), d: Number(m.dataset.d) })));
    $q("[data-new]").onclick = () => opts.onNew && opts.onNew();
    $q("[data-more]").onclick = e => { const d = $q(".rp-detail"), o = d.classList.toggle("hidden"); e.currentTarget.setAttribute("aria-expanded", !o); e.currentTarget.textContent = o ? "Voir l'analyse complète" : "Masquer l'analyse"; if (!o) d.scrollIntoView({ behavior: "smooth", block: "start" }); };

    // couleurs des jauges
    critEls.forEach((c, i) => { const s = crits[i].s, col = s === 10 ? "#d6bd86" : s >= 6 ? "#e6e6e6" : "#b98f5e"; c.bar.style.background = col; c.val.style.color = col; });

    // ----- chronologie -----
    const N = crits.length, START = 700, FILL = 650, GAP = 180, SPIN = 1700, LAG = digits.length > 1 ? 500 : 0;
    const RS = START + N * (FILL + GAP) + 200, J = RS + SPIN;
    const targets = digits.map((d, i) => (i === digits.length - 1 ? 30 : 20) + d);
    const durs = digits.map((_, i) => i === digits.length - 1 ? SPIN : SPIN - LAG);
    const played = {}; let last = [];
    const delta0 = Math.abs(delta || 0);

    function setSpot() {
      const a = rp.getBoundingClientRect(), b = $q(".ringw").getBoundingClientRect();
      rp.style.setProperty("--sx", (b.left - a.left + b.width / 2) + "px"); rp.style.setProperty("--sy", (b.top - a.top + b.height / 2) + "px");
    }
    const roll = (e, from, dur, target) => { const x = Math.min(1, Math.max(0, (e - from) / dur)); const v = x > 0 && x < 1 ? target * 4 * Math.pow(1 - x, 3) / dur : 0; return { y: 0.1 - target * q4(x), b: Math.min(2.5, v * 60 * 0.3) }; };

    function frame(el, quiet) {
      const sound = !quiet;
      // jauges
      critEls.forEach((c, i) => {
        const st = START + i * (FILL + GAP), x = (el - st) / FILL, v = ease(x) * crits[i].s;
        c.val.textContent = Math.round(v); c.bar.style.width = (v * 10) + "%";
        c.el.classList.toggle("on", x > 0); c.el.classList.toggle("done", x >= 1); c.el.classList.toggle("perfect", crits[i].s === 10 && x >= 1);
        if (sound && x > 0 && !played["f" + i]) { played["f" + i] = 1; S.fill(i, crits[i].s, FILL); }
      });
      // compteur principal
      const e = el - RS, spinning = e >= 0 && e < SPIN;
      if (e >= 0 && !played.spot) { played.spot = 1; setSpot(); if (sound) S.drone(SPIN); }
      odo.classList.toggle("idle", e < 0);
      rp.classList.toggle("spinning", spinning && !quiet);
      cols.forEach((s, i) => {
        const x = Math.max(0, e) / durs[i], p = targets[i] * q4(x), v = x > 0 && x < 1 ? targets[i] * 4 * Math.pow(1 - x, 3) / durs[i] : 0;
        s.style.transform = `translateY(${(0.1 - p).toFixed(3)}em)`; s.style.filter = `blur(${Math.min(4.5, v * 60 * 0.45).toFixed(2)}px)`;
        const f = Math.floor(p + 0.5);
        if (sound && spinning && last[i] !== undefined && f !== last[i]) S.tick(i === cols.length - 1);
        last[i] = f;
        const locked = e >= durs[i];
        if (locked && !played["l" + i]) { played["l" + i] = 1; colEls[i].classList.add("lock"); setTimeout(() => colEls[i].classList.remove("lock"), 520);
          if (sound) { S.lock(i === cols.length - 1); buzz(i === cols.length - 1 && jackpot ? [60, 40, 140] : 30); } }
      });
      fg.style.strokeDashoffset = (CIRC * (1 - score / 100 * ease(Math.max(0, e) / SPIN))).toFixed(1);
      // fin
      const end = el >= J;
      if (end && !played.end) { played.end = 1; rp.classList.add("done-spin"); if (sound) jackpot ? S.win() : S.soft(); }
      const k = d => el >= J + d;
      rp.classList.toggle("j2", k(300)); rp.classList.toggle("j3", k(700)); rp.classList.toggle("j4", k(1300)); rp.classList.toggle("j5", k(1900));
      if (deltaEl && delta) deltaEl.textContent = (delta > 0 ? "+" : "−") + Math.round(delta0 * ease((el - J - 350) / 800));
      revEl.textContent = Math.round(sim.revenue * ease((el - J - (coins ? 1250 : 600)) / 700)) + " €";
      // cases
      [500, 660, 820, 980].forEach((d, i) => { const on = el >= J + d; tiles[i].classList.toggle("on", on); if (sound && on && !played["t" + i]) { played["t" + i] = 1; S.tile(i); } });
      if (sound && coins) [0, 90, 180, 270, 360].forEach((d, i) => { if (el >= J + 700 + d + 520 && !played["c" + i]) { played["c" + i] = 1; S.coin(i); } });
      minis.forEach((list, ti) => list.forEach((m, j) => { const p = roll(el, J + [500, 660, 820, 980][ti] + 100, 1000 + j * 200, 10 + m.d); m.s.style.transform = `translateY(${p.y.toFixed(3)}em)`; m.s.style.filter = `blur(${p.b.toFixed(2)}px)`; }));
      if (bar2) bar2.style.width = (rtFill * ease((el - J - 900) / 1100)) + "%";
      if (sound && best && k(1300) && !played.flip) { played.flip = 1; S.flip(); }
      return el < J + 2400;
    }

    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!opts.animate || reduce) { rp.classList.add("static"); frame(1e9, true); return; }
    const t0 = performance.now(); let skipped = false;
    const skip = $q("[data-skip]");
    skip.onclick = () => { skipped = true; cancelAnimationFrame(raf); rp.classList.add("static"); rp.classList.remove("spinning"); frame(1e9, true); skip.remove(); };
    const step = now => { if (skipped) return; if (frame(now - t0)) raf = requestAnimationFrame(step); else skip.remove(); };
    raf = requestAnimationFrame(step);
  }

  function detailHTML(sim) {
    const r = sim.report || {};
    const crit = (r.criteria || []).map(c => `<div class="crit"><div class="row"><b>${esc(c.name)}</b><b>${esc(c.score)}/10</b></div><p>${esc(c.comment)}</p></div>`).join("");
    const rw = (r.rewrites || []).map(x => `<div class="rewrite"><div class="o">✗ ${esc(x.original)}</div><div class="n">✓ ${esc(x.better)}</div><div style="color:var(--muted);margin-top:4px">${esc(x.why)}</div></div>`).join("");
    return `
      <div class="card"><h2>Points forts</h2><ul>${(r.strengths || []).map(s => `<li>${esc(s)}</li>`).join("")}</ul>
        <h2 style="margin-top:14px">À améliorer</h2><ul>${(r.improvements || []).map(s => `<li>${esc(s)}</li>`).join("")}</ul>
        ${sim.hints ? `<p class="sub" style="margin:12px 0 0">Score avant pénalité des conseils : ${esc(r.rawScore)} − ${sim.hints * 3} pts.</p>` : ""}</div>
      ${crit ? `<div class="card"><h2>Commentaires par critère</h2>${crit}</div>` : ""}
      ${rw ? `<div class="card"><h2>Réécritures suggérées</h2>${rw}</div>` : ""}
      <div class="card"><h2>Transcription</h2><pre class="transcript">${esc(transcriptText(sim.log))}</pre></div>`;
  }

  return { unlock, sound: S, report, soundOn, setSound: on => { try { localStorage.setItem("stSound", on ? "1" : "0"); } catch (e) {} } };
})();
