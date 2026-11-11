/* =====================================================================
   StellADS — écran d'évaluation : intro « analyse en direct » + rapport
   EVAL.unlock()                         à appeler pendant le clic « Terminer »
   EVAL.intro(root, sim, opts) -> { done(fullSim), fail(msg) }   pendant l'attente de l'IA
   EVAL.page(root, sim, opts)            rapport seul (historique)
   opts : { prev:[my-sims], onBack(), onReplay(sim), personas:[…] }
   ===================================================================== */
const EVAL = (() => {
  const G = "#5fd3a2", W = "#ededed", R = "#e07a7a";
  const scCol = s => s >= 70 ? G : s >= 40 ? W : R, crCol = s => s >= 7 ? G : s >= 5 ? W : R;
  const cl = x => Math.max(0, Math.min(1, x)), eIn = x => Math.pow(cl(x), 3), eIO = x => (x = cl(x)) < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const eExp = x => (x = cl(x)) === 1 ? 1 : 1 - Math.pow(2, -10 * x);
  const sv = (d, s = 16, w = 2.2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const ICO = {
    back: sv("M19 12H5M11 6l-6 6 6 6", 15), arrow: sv("M5 12h14M13 6l6 6-6 6"), replay: sv("M3 12a9 9 0 1 0 3-6.7M3 4v5h5"), up: sv("M12 19V5M5 12l7-7 7 7", 11, 2.6), down: sv("M12 5v14M5 12l7 7 7-7", 11, 2.6),
    chk: sv("M5 12.5l4.5 4.5L19 7.5", 12, 2.6), plus: sv("M12 5v14M5 12h14", 12, 2.6), darr: sv("M12 5v14M6 13l6 6 6-6"), chev: sv("M6 9l6 6 6-6", 14, 2),
    snd: sv("M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13", 17, 1.9), mute: sv("M11 5 6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6", 17, 1.9),
    coin: sv("M15 9.5a3.5 3.5 0 1 0 0 5M8 11h5M8 13.5h5M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18", 13, 1.9), clock: sv("M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18", 13, 1.9),
    lock: sv("M5 11h14v9H5zM8 11V8a4 4 0 0 1 8 0", 13, 1.9), bulb: sv("M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z", 13, 1.9),
    flag: sv("M12 3 2.5 20h19zM12 10v4.5M12 17.5v.01", 20, 1.8),
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" fill="currentColor"/></svg>'
  };
  const SHORT = { "accroche": "Accroche", "personnalisation": "Écoute", "écoute": "Écoute", "respect du personnage": "Personnage", "personnage": "Personnage", "technique": "Vente", "vente": "Vente", "objection": "Objections", "éthique": "Éthique" };
  const short = n => { const l = String(n || "").toLowerCase(); for (const k in SHORT) if (l.includes(k)) return SHORT[k]; return n; };
  const DIFF = d => d ? d.charAt(0).toUpperCase() + d.slice(1) : "";
  const soundPref = () => { try { return localStorage.getItem("stSound") !== "0"; } catch (e) { return true; } };

  /* ================= sons (synthèse Web Audio, aucun fichier) ================= */
  const A = { ctx: null, run: null };
  function ensure() {
    if (A.ctx) { if (A.ctx.state !== "running") A.ctx.resume().catch(() => {}); return A.ctx; }
    const K = window.AudioContext || window.webkitAudioContext; if (!K) return null;
    try { if (navigator.audioSession && navigator.audioSession.type !== "playback") navigator.audioSession.type = "playback"; } catch (e) {}
    const C = new K(); A.ctx = C;
    A.master = C.createGain(); A.master.gain.value = .5;
    const comp = C.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 4; comp.attack.value = .003; comp.release.value = .2;
    A.master.connect(comp); comp.connect(C.destination);
    const len = C.sampleRate * 2.4, ir = C.createBuffer(2, len, C.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    A.verb = C.createConvolver(); A.verb.buffer = ir; const wet = C.createGain(); wet.gain.value = .32; A.verb.connect(wet); wet.connect(A.master);
    A.nbuf = C.createBuffer(1, C.sampleRate * 2, C.sampleRate); const nd = A.nbuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    window.stAudio && stAudio.add(C);
    if (C.state !== "running") C.resume().catch(() => {});
    return C;
  }
  const live = () => soundPref() && A.ctx && A.ctx.state === "running" && A.run;
  function newRun() { if (!A.ctx) return; stopRun(); A.run = A.ctx.createGain(); A.run.connect(A.master); A.run.connect(A.verb); }
  function stopRun() { if (A.run) { const g = A.run; try { g.gain.setTargetAtTime(0, A.ctx.currentTime, .05); } catch (e) {} setTimeout(() => { try { g.disconnect(); } catch (e) {} }, 700); A.run = null; } }
  const T = (d = 0) => A.ctx.currentTime + d;
  const env = (g, t, a, pk, r) => { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + a + r); };
  const tone = (f, t, { type = "sine", g = .1, a = .004, r = .4, to = null, gl = .2 } = {}) => { if (!A.run) return; const o = A.ctx.createOscillator(), n = A.ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + gl); env(n, t, a, g, r); o.connect(n); n.connect(A.run); o.start(t); o.stop(t + a + r + .05); };
  const bell = (f, t, g = .05, r = 1.6) => [[1, 1], [2.756, .32], [5.404, .12], [8.93, .05]].forEach(([m, k]) => tone(f * m, t, { g: g * k, a: .002, r: r / (m * .6 + .4) }));
  const noise = (t, d, { f = 3000, q = 1, type = "bandpass", g = .1, a = .005, to = null } = {}) => { if (!A.run) return; const C = A.ctx, s = C.createBufferSource(), fl = C.createBiquadFilter(), n = C.createGain(); s.buffer = A.nbuf; fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q; if (to) fl.frequency.exponentialRampToValueAtTime(to, t + d); n.gain.setValueAtTime(0, t); n.gain.linearRampToValueAtTime(g, t + a); n.gain.exponentialRampToValueAtTime(.0001, t + d); s.connect(fl); fl.connect(n); n.connect(A.run); s.start(t, Math.random()); s.stop(t + d + .05); };
  const thump = (t, g = .35) => { tone(78, t, { g, a: .002, r: .32, to: 36, gl: .25 }); noise(t, .05, { f: 180, type: "lowpass", g: g * .4 }); };
  const PENTA = [1046.5, 1174.7, 1318.5, 1568, 1760, 2093];
  const S = {
    padStart() { if (!live()) return null; const C = A.ctx, t = T(), out = C.createGain(), lp = C.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 6; lp.frequency.setValueAtTime(220, t); lp.frequency.linearRampToValueAtTime(700, t + 8);
      out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(.035, t + .8); const os = [[110, -8], [110.6, 9], [164.8, 0], [220, 4]].map(([f, d], i) => { const o = C.createOscillator(); o.type = i < 2 ? "sawtooth" : "triangle"; o.frequency.value = f; o.detune.value = d; o.connect(lp); o.start(t); return o; });
      lp.connect(out); out.connect(A.run); return { out, lp, os }; },
    padFinal(p, d) { if (!p || !A.ctx) return; const t = T(); p.lp.frequency.cancelScheduledValues(t); p.lp.frequency.setValueAtTime(p.lp.frequency.value, t); p.lp.frequency.exponentialRampToValueAtTime(2400, t + d);
      p.out.gain.cancelScheduledValues(t); p.out.gain.setValueAtTime(p.out.gain.value, t); p.out.gain.linearRampToValueAtTime(.075, t + d - .12); p.out.gain.linearRampToValueAtTime(0, t + d); p.os.forEach(o => { o.frequency.linearRampToValueAtTime(o.frequency.value * 1.06, t + d); o.stop(t + d + .1); }); },
    padStop(p) { if (!p || !A.ctx) return; const t = T(); try { p.out.gain.setTargetAtTime(0, t, .05); p.os.forEach(o => o.stop(t + .3)); } catch (e) {} },
    beat(k) { if (!live()) return; thump(T(), k); thump(T(.16), k * .6); },
    scan() { if (!live()) return; noise(T(), .03, { f: 7000, q: 2, g: .025 }); tone(2600, T(), { g: .012, r: .05 }); },
    tagGood() { if (!live()) return; bell(1568, T(), .035, 1); bell(2349, T(.07), .028, 1.2); },
    tagBad() { if (!live()) return; tone(392, T(), { type: "triangle", g: .05, r: .25 }); tone(370, T(.08), { type: "triangle", g: .04, r: .3 }); },
    check(i) { if (!live()) return; bell(PENTA[i % 6], T(), .045, 1.2); noise(T(), .02, { f: 9000, g: .015 }); },
    riser(d) { if (!live()) return; noise(T(), d, { f: 300, to: 9000, q: 3, g: .07, a: d * .8 }); tone(180, T(), { type: "sawtooth", g: .03, a: d * .9, r: .08, to: 900, gl: d }); },
    impact(dl) { if (!live()) return; const t = T(dl); thump(t, .6); noise(t, .9, { f: 2400, type: "lowpass", g: .12, to: 200 }); [523.25, 783.99, 1046.5, 1567.98].forEach((f, i) => bell(f, t + .02 + i * .015, .075 - i * .01, 2.6)); noise(t + .03, 1.4, { f: 9500, q: .8, g: .02 }); },
    page(dl, sc, crs) { if (!live()) return; const t = T(dl);
      noise(t, .5, { f: 900, to: 3000, q: .7, g: .03 }); noise(t + .7, 1.1, { f: 400, to: 2600, q: 1.2, g: .05, a: .9 });
      crs.forEach((c, i) => { tone(PENTA[i % 6] * 1.5, t + 1.5 + i * .08, { g: .018, r: .25 }); tone(500, t + .9 + i * .14, { type: "triangle", g: .04, r: .28, to: 500 + c.s * 70, gl: .35 }); });
      let last = -1, lt = -1; for (let k = 0; k <= 190; k++) { const x = k / 190, v = Math.floor(sc * eExp(x)); if (v !== last && (x * 1.9 - lt) > .028) { last = v; lt = x * 1.9; const tt = t + .5 + x * 1.9; noise(tt, .018, { f: 5200 + v * 25, q: 4, g: .05 }); tone(1800 + v * 8, tt, { g: .006, r: .03 }); } }
      tone(330, t + .5, { g: .03, a: 1.6, r: .4, to: 660, gl: 2 });
      const L = t + 2.42; thump(L, .3); (sc >= 70 ? [1046.5, 1318.5, 1568, 2093, 2637] : [1046.5, 1318.5, 1568, 2093]).forEach((f, i) => bell(f, L + i * .012, .045, 2)); noise(L, .6, { f: 10000, q: .7, g: .018 });
      tone(1760, t + 1.6, { g: .05, r: .12, to: 2600, gl: .06 }); noise(t + 1.6, .03, { f: 4000, g: .03 });
      [2.5, 2.62, 2.74].forEach((d, i) => tone(900 + i * 180, t + d, { g: .05, r: .09, to: 1500 + i * 220, gl: .05 }));
      [2.6, 2.72, 2.84, 2.96].forEach((d, i) => { noise(t + d, .04, { f: 2200 + i * 300, q: 3, g: .035 }); tone(660 + i * 110, t + d, { type: "triangle", g: .02, r: .12 }); }); },
    hover() { if (live()) tone(3200, T(), { g: .008, r: .04 }); },
    click() { if (live()) { tone(1400, T(), { g: .04, r: .07, to: 900, gl: .05 }); noise(T(), .02, { f: 5000, g: .02 }); } }
  };
  function unlock() { if (!soundPref()) return; const C = ensure(); if (!C) return; try { const b = C.createBuffer(1, 1, 22050), s = C.createBufferSource(); s.buffer = b; s.connect(C.destination); s.start(0); } catch (e) {} if (!A.run) newRun(); }

  /* ================= données ================= */
  function model(sim, opts) {
    const r = sim.report || {}, score = Math.max(0, Math.min(100, Number(sim.score) || 0));
    const crs = (r.criteria || []).slice(0, 6).map(c => ({ n: short(c.name), full: c.name, s: Math.max(0, Math.min(10, Math.round(Number(c.score) || 0))), cm: c.comment || "" }));
    const prevs = (opts.prev || []).filter(x => x.id !== sim.id && x.started_at < sim.started_at && x.score != null);
    const prev = prevs[0] || null, ppvs = (sim.log || []).filter(l => l.who === "ppv");
    return { r, score, crs, prev, ppvs, bought: ppvs.filter(p => p.status === "acheté").length };
  }
  function ctxLine(sim) {
    const p = sim.persona || {}, mins = sim.ended_at && sim.started_at ? Math.max(1, Math.round((sim.ended_at - sim.started_at) / 60000)) : null;
    return `<div class="ev-ctx">avec <b>${esc(p.name || "")}</b>${p.label ? " · " + esc(p.label) : ""}<span class="ev-sep"></span>en tant que <b>${esc(sim.creator_name || "")}</b><span class="ev-sep"></span><b>${esc(DIFF(sim.difficulty))}</b>${mins ? `<span class="ev-sep"></span>${mins} min` : ""}</div>`;
  }
  const odo = (n, dl = .5, t = 1.9) => { const s = String(n); return `<span class="ev-odo">` + [...s].map((d, i) => { const k = (i < s.length - 1 ? 2 : 3) * 10 + +d;
    return `<span class="c"><span class="s" style="--y:-${k}em;--dl:${(dl + i * .12).toFixed(2)}s;--t:${(t + i * .25).toFixed(2)}s">${Array.from({ length: k + 1 }, (_, j) => `<i>${j % 10}</i>`).join("")}</span></span>`; }).join("") + `</span>`; };
  function radar(crs) {
    const n = crs.length, pt = (i, v, r = 64) => [100 + r * v / 10 * Math.sin(i * 2 * Math.PI / n), 100 - r * v / 10 * Math.cos(i * 2 * Math.PI / n)];
    const poly = v => Array.from({ length: n }, (_, i) => pt(i, v).map(x => x.toFixed(1)).join(",")).join(" ");
    let h = `<svg class="ev-radar" viewBox="-14 -4 228 208" aria-hidden="true">` + [2.5, 5, 7.5, 10].map(v => `<polygon class="gl" points="${poly(v)}"/>`).join("");
    h += crs.map((_, i) => { const [x, y] = pt(i, 10); return `<line x1="100" y1="100" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#1d1d1d"/>`; }).join("");
    h += `<polygon class="obj" points="${poly(7)}"/><g class="poly"><polygon points="${crs.map((c, i) => pt(i, c.s).map(x => x.toFixed(1)).join(",")).join(" ")}" fill="rgba(255,255,255,.08)" stroke="#ededed" stroke-width="1.6" stroke-linejoin="round"/></g>`;
    h += crs.map((c, i) => { const [x, y] = pt(i, c.s); return `<circle class="ev-rpt" style="--dl:${(1.5 + i * .08).toFixed(2)}s" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${crCol(c.s)}" stroke="#111" stroke-width="2"/>`; }).join("");
    h += crs.map((c, i) => { const [x, y] = pt(i, 10, 76), a = Math.abs(x - 100) < 5 ? "middle" : x > 100 ? "start" : "end"; return `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="${a}">${esc(c.n)}</text>`; }).join("");
    return h + `</svg>`;
  }
  function transcript(log) {
    return (log || []).map(l => l.who === "fan" ? `<div class="m">${esc(l.text)}</div>` : l.who === "chatter" ? `<div class="m me">${esc(l.text)}</div>` :
      l.who === "ppv" ? `<div class="m ppv">PPV · « ${esc(l.desc)} » · <b>${esc(l.price)} €</b> · ${esc(l.status)}</div>` : "").join("");
  }

  /* ================= rapport ================= */
  function page(root, sim, opts = {}) {
    const M = model(sim, opts), { r, score, crs, prev, ppvs, bought } = M, sc = scCol(score), C = 2 * Math.PI * 72;
    const lvl = score >= 80 ? "Excellent" : score >= 70 ? "Objectif atteint" : score >= 55 ? "Presque l'objectif" : score >= 40 ? "À consolider" : "À retravailler";
    const big = score >= 80 ? "Excellent <em>travail.</em>" : score >= 70 ? "Très bon <em>travail.</em>" : score >= 55 ? "Bon <em>travail.</em>" : score >= 40 ? "Peut mieux <em>faire.</em>" : "À <em>retravailler.</em>";
    const delta = prev ? score - prev.score : null;
    const pills = [delta == null ? `<span class="ev-pl">Première simu</span>` : `<span class="ev-pl ${delta > 0 ? "g" : delta < 0 ? "r" : ""}">${delta > 0 ? ICO.up : delta < 0 ? ICO.down : ""}${delta > 0 ? "+" : delta < 0 ? "−" : "="}${Math.abs(delta) || ""} vs dernière simu</span>`,
      score >= 70 ? `<span class="ev-pl g">${ICO.chk}Objectif 70 atteint</span>` : `<span class="ev-pl w">Plus que ${70 - score} pt${70 - score > 1 ? "s" : ""} pour 70</span>`,
      sim.hints ? `<span class="ev-pl">Score brut ${esc(r.rawScore)} − ${sim.hints} conseil${sim.hints > 1 ? "s" : ""}</span>` : ""].filter(Boolean).map((p, i) => p.replace('class="ev-pl', `style="--dl:${(2.5 + i * .12).toFixed(2)}s" class="ev-pl`)).join("");
    const rt = sim.avgRt, rtTxt = rt == null ? "" : rt <= 60 ? ["Rapide", "g"] : rt <= 120 ? ["Correct", "w"] : ["Lent", "r"];
    const dRev = prev ? sim.revenue - (prev.revenue || 0) : null;
    const tiles = `<div class="ev-tiles">
      <div class="ev-tl" style="--dl:2.6s"><small>${ICO.coin}Revenu</small><div class="ev-v">${odo(sim.revenue || 0, 2.7, 1.4)}<span class="u">€</span></div><div class="ev-sub ${dRev > 0 ? "g" : dRev < 0 ? "r" : ""}">${dRev == null ? "&nbsp;" : (dRev > 0 ? "+" : dRev < 0 ? "−" : "±") + Math.abs(dRev) + " €"}</div></div>
      <div class="ev-tl" style="--dl:2.72s"><small>${ICO.clock}Réponse</small><div class="ev-v">${rt == null ? "<b>—</b>" : odo(rt, 2.8, 1.4) + '<span class="u">s</span>'}</div><div class="ev-sub ${rtTxt[1] || ""}">${rtTxt[0] || "&nbsp;"}</div></div>
      <div class="ev-tl" style="--dl:2.84s"><small>${ICO.lock}PPV</small><div class="ev-v">${odo(bought, 2.9, 1.2)}<span class="u">/${ppvs.length}</span></div><div class="ev-dots">${ppvs.slice(0, 10).map(p => `<i class="${p.status === "acheté" ? "ok" : ""}"></i>`).join("")}</div></div>
      <div class="ev-tl" style="--dl:2.96s"><small>${ICO.bulb}Conseils</small><div class="ev-v">${odo(sim.hints || 0, 3, 1.2)}</div><div class="ev-sub ${sim.hints ? "w" : "g"}">${sim.hints ? `−${sim.hints * 3} pts` : "Sans aide"}</div></div></div>`;
    const crit = crs.length ? `<section class="ev-card" style="--d:.15s"><h3>Détail par <em>critère</em></h3><div class="ev-crw">${radar(crs)}<div class="ev-crl">${crs.map((c, i) =>
      `<div class="ev-cr" style="--c:${crCol(c.s)}" title="${esc(c.cm)}"><div class="rw">${esc(c.n)}<b>${c.s}<span>/10</span></b></div><div class="ev-bar"><i style="--w:${c.s * 10}%;--dl:${(.9 + i * .14).toFixed(2)}s"></i></div></div>`).join("")}</div></div>
      <div class="ev-legend"><span><i></i>Objectif 7/10</span><span><i class="w"></i>Ta session</span></div></section>` : "";
    const best = r.best && r.best.message ? `<section class="ev-card" style="--d:.25s"><div class="ev-lab">TON MEILLEUR MESSAGE</div><div class="ev-bub"><span class="ev-st">${ICO.star}</span>${esc(r.best.message)}</div>${r.best.why ? `<p class="ev-why">${esc(r.best.why)}</p>` : ""}</section>` : "";
    const ret = (r.strengths || []).slice(0, 3).map(s => `<div class="ev-it g"><span class="ev-ic">${ICO.chk}</span>${esc(s)}</div>`).join("") + (r.improvements || []).slice(0, 3).map(s => `<div class="ev-it w"><span class="ev-ic">${ICO.plus}</span>${esc(s)}</div>`).join("");
    const retC = ret ? `<section class="ev-card" style="--d:.3s"><div class="ev-lab">À RETENIR</div><div class="ev-ret">${ret}</div></section>` : "";
    const rw = (r.rewrites || []).slice(0, 2).map(x => `<div class="ev-rwc"><div class="ev-o"><span class="tg">TOI</span><s>${esc(x.original)}</s></div><div class="arw">${ICO.darr}</div><div class="ev-n"><span class="tg">MIEUX</span>${esc(x.better)}</div>${x.why ? `<div class="wy">${esc(x.why)}</div>` : ""}</div>`).join("");
    const rwC = rw ? `<section class="ev-card" style="--d:.35s"><div class="ev-lab">RÉÉCRITURE${(r.rewrites || []).length > 1 ? "S" : ""} SUGGÉRÉE${(r.rewrites || []).length > 1 ? "S" : ""}</div>${rw}</section>` : "";
    const nMsg = (sim.log || []).filter(l => l.who === "fan" || l.who === "chatter" || l.who === "ppv").length;
    const canReplay = !!opts.onReplay && !!(sim.persona && sim.persona.id);
    root.innerHTML = `<div class="evp has-sticky">
      <button class="ev-back" data-back>${ICO.back}Retour</button>
      <div class="ev-hdr"><div><div class="ev-eb">SIMU CHATTER · RÉSULTAT</div><h1 class="ev-ttl">Ton <em>évaluation.</em></h1>${ctxLine(sim)}</div>
        <div class="ev-acts"><button class="ev-bt ev-snd ${soundPref() ? "" : "off"}" data-snd aria-label="Activer ou couper le son" title="Son">${soundPref() ? ICO.snd : ICO.mute}</button>${canReplay ? `<button class="ev-bt" data-replay>${ICO.replay}Rejouer avec ${esc(sim.persona.name)}</button>` : ""}<button class="ev-bt w" data-new>Nouvelle simulation${ICO.arrow}</button></div></div>
      ${r.ethics_flag ? `<div class="ev-flag">${ICO.flag}<div><b>Point éthique</b>${esc(r.ethics_flag)}</div></div>` : ""}
      <div class="ev-g2"><section class="ev-card ev-hero" style="--d:.05s"><div class="ev-htop">
        <div class="ev-ring" style="--sc:${sc};--scA:${sc}22;--off:${(C * (1 - score / 100)).toFixed(1)}" role="img" aria-label="Score ${score} sur 100"><div class="ev-halo"></div>
          <svg viewBox="0 0 168 168"><circle cx="84" cy="84" r="72" fill="none" stroke="#1d1d1d" stroke-width="10"/><circle class="fg" cx="84" cy="84" r="72" fill="none" stroke="${sc}" stroke-width="10" stroke-linecap="round"/></svg>
          <span class="ev-tick"></span><span class="ev-rip"></span><div class="ctr">${odo(score)}<small>/ 100</small></div></div>
        <div class="ev-hs" style="--sc:${sc}"><span class="ev-lvl">${lvl}</span><div class="ev-big">${big}</div>${r.verdict ? `<p class="ev-vd">${esc(r.verdict)}</p>` : ""}<div class="ev-pills">${pills}</div></div></div>${tiles}</section>${crit}</div>
      ${best || retC || rwC ? `<div class="ev-g3">${best}${retC}${rwC}</div>` : ""}
      ${crs.some(c => c.cm) ? `<details class="ev-card ev-det"><summary>Commentaires par critère<span>Afficher${ICO.chev}</span></summary><div class="in"><div class="ev-cm">${crs.map(c => `<div><b>${esc(c.full)}<span style="color:${crCol(c.s)}">${c.s}/10</span></b>${esc(c.cm)}</div>`).join("")}</div>${sim.hints ? `<p class="ev-why">Score avant pénalité des conseils : ${esc(r.rawScore)} − ${sim.hints * 3} pts.</p>` : ""}</div></details>` : ""}
      <details class="ev-card ev-det"><summary><span style="color:#f5f5f5;font-size:14px;font-weight:800">Transcription de la conversation<i class="ev-nw" style="font-style:normal">${nMsg} MESSAGE${nMsg > 1 ? "S" : ""}</i></span><span>Afficher${ICO.chev}</span></summary><div class="in"><div class="ev-tx">${transcript(sim.log)}</div></div></details>
      <div class="ev-sticky">${canReplay ? `<button class="ev-bt" data-replay aria-label="Rejouer avec ${esc(sim.persona.name)}">${ICO.replay}</button>` : `<button class="ev-bt" data-back2 aria-label="Retour">${ICO.back}</button>`}<button class="ev-bt w" data-new>Nouvelle simulation${ICO.arrow}</button></div>
    </div>`;
    const $$ = s => [...root.querySelectorAll(s)];
    $$("[data-back],[data-back2],[data-new]").forEach(b => b.onclick = () => { S.click(); stopRun(); opts.onBack && opts.onBack(); });
    $$("[data-replay]").forEach(b => b.onclick = () => { S.click(); stopRun(); b.disabled = true; opts.onReplay && opts.onReplay(sim); });
    $$("[data-snd]").forEach(b => b.onclick = () => { const on = !soundPref(); try { localStorage.setItem("stSound", on ? "1" : "0"); } catch (e) {} b.classList.toggle("off", !on); b.innerHTML = on ? ICO.snd : ICO.mute; if (on) { unlock(); S.click(); } else stopRun(); });
    $$(".ev-bt,.ev-back,.ev-det summary").forEach(b => b.addEventListener("pointerenter", S.hover));
    if (opts.sound) S.page(opts.soundDelay || 0, score, crs);
  }

  /* ================= intro « analyse en direct » ================= */
  function intro(root, sim, opts = {}) {
    const lines = (sim.log || []).filter(l => l.who === "fan" || l.who === "chatter").slice(-24);
    const filler = lines.length < 8 ? [...lines, ...lines, ...lines] : lines;
    const CK = ["Accroche & lien", "Personnalisation & écoute", "Respect du personnage", "Technique de vente", "Gestion des objections", "Éthique & respect"];
    root.innerHTML = `<div class="evp"><div class="ev-intro"><div class="ev-ib">
      <div class="ev-ih"><div class="ev-eb">SIMU CHATTER</div><div class="t">Analyse de ta <em>session</em><span>...</span></div>${ctxLine(sim)}</div>
      <div class="ev-ig"><div class="ev-chat"><div class="ev-roll">${filler.map(l => `<div class="m ${l.who === "chatter" ? "me" : ""}">${esc(l.text)}<span class="tg"></span></div>`).join("")}</div><div class="ev-scan"></div></div>
        <div class="ev-side"><div class="ev-lab">ANALYSE EN COURS</div><div class="pc"><b>0</b><span> %</span></div><div class="ev-pb"><i></i></div>${CK.map(n => `<div class="ev-ck"><span class="ev-ic">${ICO.chk}</span>${n}<span class="ev-st"></span></div>`).join("")}</div></div>
      <div class="ev-wait">L'IA relit ta conversation… environ 20 secondes</div><div class="ev-err"></div>
      <div class="ev-ibar"><button class="ev-sm" data-snd hidden>🔇 Activer le son</button><button class="ev-sm" data-skip hidden>Passer →</button></div>
    </div></div><div class="ev-flash"></div></div>`;
    const q = s => root.querySelector(s), qa = s => [...root.querySelectorAll(s)];
    const box = q(".ev-intro"), ib = q(".ev-ib"), roll = q(".ev-roll"), chat = q(".ev-chat"), scan = q(".ev-scan"), ms = qa(".ev-roll .m"), cks = qa(".ev-ck"), pc = q(".pc b"), pb = q(".ev-pb i"), dots = q(".ev-ih .t span"), flash = q(".ev-flash"), wait = q(".ev-wait"), sndB = q("[data-snd]"), skipB = q("[data-skip]");
    const t0 = performance.now(); let full = null, FS = null, RT = null, SHOW = null, dead = false, pct = 0, nok = 0, nextBeat = 250, pad = null, taggedAt = null;
    const hitSet = new Set();
    if (soundPref() && ensure()) { if (!A.run) newRun(); const go = () => { if (!dead && FS == null && !pad) pad = S.padStart(); };
      if (A.ctx.state === "running") go(); else A.ctx.resume().then(go).catch(() => {}); }
    const needBtn = () => soundPref() && !(A.ctx && A.ctx.state === "running");
    setTimeout(() => { if (!dead && needBtn()) sndB.hidden = false; }, 700);
    sndB.onclick = () => { unlock(); if (A.ctx) A.ctx.resume().then(() => { sndB.hidden = true; if (!A.run) newRun(); if (FS == null && !pad) pad = S.padStart(); }); };
    const finalize = t => {   // le résultat est arrivé : dernière ligne droite
      FS = Math.max(t, 2600); RT = FS + 1300; SHOW = RT + 450;
      wait.textContent = "Analyse terminée"; skipB.hidden = false;
      const d = (FS - t) / 1000;
      setTimeout(() => { if (dead) return; S.padFinal(pad, 1.3); S.riser(1.24); S.impact(1.3); }, Math.max(0, FS - t));
      // étiquettes sur les messages : meilleur message (vert) et messages à retravailler
      const r = full.report || {}, bestTxt = r.best && r.best.message, bad = (r.rewrites || []).map(x => x.original);
      const marks = [], seen = new Set();   // dernière occurrence de chaque message (celle qui est à l'écran)
      for (let i = ms.length - 1; i >= 0; i--) { const l = filler[i]; if (!l || l.who !== "chatter" || seen.has(l.text)) continue;
        if (bestTxt && l.text === bestTxt) { seen.add(l.text); marks.push([ms[i], "g", "MEILLEUR MESSAGE"]); } else if (bad.includes(l.text)) { seen.add(l.text); marks.push([ms[i], "w", "À RETRAVAILLER"]); } }
      taggedAt = marks.reverse().slice(0, 5);
      void d;
    };
    const frame = now => {
      if (dead || !root.isConnected) { dead = true; S.padStop(pad); return; }
      const t = now - t0;
      // défilement : lent pendant l'attente, puis jusqu'en bas pendant la dernière ligne droite
      const H = Math.max(0, roll.scrollHeight - chat.offsetHeight);
      const sp = FS == null ? .82 * (1 - Math.exp(-t / 9000)) : .82 * (1 - Math.exp(-FS / 9000)) + (1 - .82 * (1 - Math.exp(-FS / 9000))) * eIO((t - FS) / 1100);
      roll.style.transform = `translateY(${-H * sp}px)`;
      const sh = chat.offsetHeight, per = Math.max(420, 1000 - t / 8), sy = (t % per) / per;
      scan.style.transform = `translateY(${sy * (sh + 60) - 60}px)`;
      const cr = chat.getBoundingClientRect(), k = cr.height / (sh || 1), lineY = cr.top + sy * (sh + 60) * k;
      ms.forEach((m, i) => { const b = m.getBoundingClientRect(), hit = (RT == null || t < RT) && b.top < lineY && b.bottom > lineY - 40 * k; m.classList.toggle("hit", hit);
        if (hit && !hitSet.has(i)) { hitSet.add(i); if (m.classList.contains("me")) S.scan(); } if (!hit) hitSet.delete(i); });
      // pourcentage : tend vers 92 % en attendant, puis 100 %
      pct = FS == null ? 92 * (1 - Math.exp(-t / 4000)) : Math.max(pct, 92 * (1 - Math.exp(-FS / 4000)) + (100 - 92 * (1 - Math.exp(-FS / 4000))) * eIO((t - FS) / 1100));
      pc.textContent = Math.min(100, Math.round(pct)); pb.style.width = Math.min(100, pct) + "%";
      const th = [14, 30, 46, 62, 78, 99.5], n = th.filter(x => pct >= x).length;
      cks.forEach((c, i) => { c.classList.toggle("ok", i < n); c.classList.toggle("run", i === n && (FS == null ? i < 5 : true) && (RT == null || t < RT)); });
      if (n > nok) { S.check(n - 1); nok = n; }
      if (taggedAt && t >= FS) taggedAt.forEach(([m, c, txt], j) => { if (!m.classList.contains("tag") && t >= FS + 150 + j * 170) { const tg = m.querySelector(".tg"); tg.className = "tg " + c; tg.textContent = txt; m.classList.add("tag"); c === "g" ? S.tagGood() : S.tagBad(); } });
      // battements de cœur
      if (soundPref() && t >= nextBeat && (RT == null || t < RT - 500)) { const p = FS == null ? cl(t / 12000) : 1; S.beat(.2 + .2 * p + (FS != null ? .1 : 0)); nextBeat = t + (FS == null ? 900 - 250 * p : Math.max(300, 600 - (t - FS) * .25)); }
      dots.textContent = ".".repeat(1 + Math.floor(t / 380) % 3);
      box.style.setProperty("--vg", (FS == null ? .2 + .35 * (1 - Math.exp(-t / 5000)) : .55 + .25 * eIn((t - FS) / 1300)).toFixed(3));
      if (RT != null) { const out = eIO((t - RT + 150) / 450); ib.style.opacity = 1 - out; ib.style.filter = `blur(${out * 12}px)`; ib.style.transform = `scale(${1 - out * .05})`;
        flash.style.opacity = t >= RT ? Math.max(0, .9 * (1 - (t - RT) / 550)) : 0;
        if (t >= SHOW) { dead = true; flash.style.opacity = 0; window.scrollTo(0, 0); page(root, full, { ...opts, sound: true }); return; } }
      if (full && FS == null) finalize(t);
      requestAnimationFrame(frame);
    };
    skipB.onclick = () => { if (!full || dead) return; S.click(); dead = true; S.padStop(pad); stopRun(); newRun(); window.scrollTo(0, 0); page(root, full, { ...opts, sound: true }); };
    requestAnimationFrame(frame);
    return {
      done(s) { full = s; },
      fail(msg) { dead = true; S.padStop(pad); stopRun(); q(".ev-err").textContent = msg; wait.textContent = ""; }
    };
  }
  return { unlock, intro, page, sound: S };
})();
