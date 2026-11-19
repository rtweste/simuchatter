// Socle commun des salles de contrôle : données en direct (ou démo), détection des ventes, sons, sélecteur de version
const SALLE = window.SALLE = (() => {
  const P = new URLSearchParams(location.search), DEMO = P.has("demo");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const eur = n => Math.round(n).toLocaleString("fr-FR") + " €";
  /* ---------- sons (synthétisés, aucun fichier) ---------- */
  let ac = null, on = false, master = null;
  try { on = localStorage.getItem("salleSon") !== "0"; } catch (e) { on = true; }
  // le navigateur n'autorise le son qu'après un geste : le premier clic ou touche n'importe où le débloque
  const unlock = () => { if (on) try { ctx(); } catch (e) {} };
  ["pointerdown", "keydown"].forEach(ev => addEventListener(ev, unlock, { passive: true }));
  const ctx = () => { if (!ac) { ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.gain.value = .5; master.connect(ac.destination); } if (ac.state !== "running") ac.resume(); return ac; };
  function tone(f, t, len, pk, type, glide) { const a = ctx(), o = a.createOscillator(), g = a.createGain(); o.type = type || "sine"; o.frequency.setValueAtTime(f, t); if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + len);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(pk, t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + len); o.connect(g); g.connect(master); o.start(t); o.stop(t + len + .05); }
  function noise(t, len, pk, hp) { const a = ctx(), b = a.createBuffer(1, a.sampleRate * len, a.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(); f.type = "highpass"; f.frequency.value = hp || 1200; g.gain.value = pk; s.buffer = b; s.connect(f); f.connect(g); g.connect(master); s.start(t); }
  const SND = {
    sale(big) { if (!on) return; const t = ctx().currentTime + .02;
      noise(t, .35, .05, 3000); tone(80, t, .5, .25, "sine", 40);                                   // impact
      (big ? [1046.5, 1318.5, 1568, 2093, 2637] : [1318.5, 1975.5, 2637]).forEach((f, i) => tone(f, t + .06 + i * .06, big ? 1.1 : .6, .07, i % 2 ? "triangle" : "sine")); },
    whoosh() { if (!on) return; const t = ctx().currentTime + .01; noise(t, .5, .035, 800); tone(300, t, .45, .02, "sine", 1200); },
    tick() { if (!on) return; tone(2637, ctx().currentTime + .01, .05, .02, "triangle"); },
    record() { if (!on) return; const t = ctx().currentTime + .02; [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => tone(f, t + i * .09, .9, .06, "triangle")); }
  };
  /* ---------- démo : ventes simulées (rien n'est enregistré) ---------- */
  const NAMES = ["karim2", "sofia", "tom", "yanis", "ines", "nina"], MODELS = ["Léa", "Mia", "Inna", "Jade"], AMTS = [15, 20, 25, 25, 30, 40, 40, 50, 60, 80, 120];
  let S = null, lastT = 0;
  function demoBase(real) {
    const d = real || { ca: 0, validated: 0, pending: 0, count: 0, avg: 0, yesterday: 900, record: 1400, board: [], models: [], live: [], events: [], feed: [] };
    if (!d.live.length) d.live = NAMES.slice(0, 4).map((n, i) => ({ user_id: i + 1, username: n, model_name: MODELS[i % 4], start_at: Date.now() - (40 + i * 37) * 60e3, reinforce: 0 }));
    if (!d.board.length) { d.board = NAMES.slice(0, 5).map((n, i) => ({ id: i + 1, username: n, ca: [320, 260, 190, 140, 90][i], n: [7, 6, 5, 4, 2][i] })); d.models = MODELS.map((m, i) => ({ id: i + 1, name: m, ca: [420, 300, 180, 100][i], n: 6 - i }));
      d.ca = d.board.reduce((t, b) => t + b.ca, 0); d.count = d.board.reduce((t, b) => t + b.n, 0); d.validated = Math.round(d.ca * .7); d.pending = d.ca - d.validated; d.avg = Math.round(d.ca / d.count); }
    d.feed = d.feed || []; d.day0 = d.day0 || (() => { const x = new Date(); x.setHours(0, 0, 0, 0); return x.getTime(); })();
    const el = Date.now() - d.day0;
    if (!d.series || d.series.length < 6) { d.series = []; let acc = 0; d.board.forEach(b => { let left = b.ca; while (left > 0) { const a = Math.min(left, AMTS[Math.random() * AMTS.length | 0]); left -= a; d.series.push([Math.random() * el * .97, a, b.id]); } }); d.series.sort((p, q) => p[0] - q[0]); }
    if (!d.seriesY || d.seriesY.length < 6) { d.seriesY = []; for (let i = 0; i < 40; i++) d.seriesY.push([Math.random() * 864e5, AMTS[Math.random() * AMTS.length | 0]]); d.seriesY.sort((p, q) => p[0] - q[0]); }
    return d;
  }
  function demoSale() {
    const b = S.board[Math.random() * Math.min(S.board.length, 6) | 0] || { id: 9, username: "nina", ca: 0, n: 0 }, amount = AMTS[Math.random() * AMTS.length | 0];
    const live = S.live.find(l => l.username === b.username), model = live ? live.model_name : MODELS[Math.random() * 4 | 0];
    b.ca += amount; b.n++; if (!S.board.includes(b)) S.board.push(b); S.board.sort((x, y) => y.ca - x.ca);
    let m = S.models.find(x => x.name === model); if (!m) S.models.push(m = { id: 99, name: model, ca: 0, n: 0 }); m.ca += amount; m.n++; S.models.sort((x, y) => y.ca - x.ca);
    S.ca += amount; S.pending += amount; S.count++; S.avg = Math.round(S.ca / S.count);
    const e = { id: Date.now(), amount, username: b.username, user_id: b.id, model_name: model, kind: "declared", at: Date.now(), status: "pending", created_at: Date.now() };
    S.feed.unshift(e); S.feed = S.feed.slice(0, 14); S.series.push([Date.now() - S.day0, amount, b.id]); return e;
  }
  /* ---------- boucle ---------- */
  async function start(h) {
    let me; try { me = await api("/api/me"); } catch (e) { return; }
    if (me.role !== "admin" || me.rk === "assistant") { location.href = "/home"; return; }
    chrome(h);
    if (DEMO) {
      let real = null; try { real = await api("/api/admin/control"); } catch (e) {}
      S = demoBase(real); h.state(S, true);
      const loop = () => { const e = demoSale(); h.sale(e, S); setTimeout(() => h.state(S, false), 600); setTimeout(loop, 3800 + Math.random() * 2600); };
      setTimeout(loop, 2200); return;
    }
    const seen = new Set(); let first = true;
    const poll = async () => { try { const d = await api("/api/admin/control"); h.state(d, first);
        d.events.slice().reverse().forEach(e => { const k = e.id + ":" + e.kind; if (seen.has(k)) return; seen.add(k); if (!first) h.sale(e, d); }); first = false; } catch (e) {}
      setTimeout(poll, 4000); };
    poll();
  }
  /* ---------- habillage commun : porte du son, sélecteur de versions, plein écran ---------- */
  function chrome(h) {
    const st = document.createElement("style"); st.textContent = `
    .sx-gate{position:fixed;inset:0;z-index:999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.72);backdrop-filter:blur(8px);font-family:Inter,system-ui,sans-serif}
    .sx-gate button{padding:20px 30px;border-radius:20px;border:1px solid rgba(255,255,255,.18);background:#0b0b0b;color:#fff;font:800 17px Inter;cursor:pointer;box-shadow:0 0 80px rgba(95,211,162,.18)}
    .sx-gate small{display:block;color:#8f8f8f;font-weight:500;font-size:12.5px;margin-top:6px}
    .sx-bar{position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:998;display:flex;gap:6px;padding:6px;border-radius:14px;background:rgba(10,10,10,.75);border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(10px);font-family:Inter,system-ui,sans-serif;opacity:.25;transition:opacity .3s}
    .sx-bar:hover{opacity:1}.sx-bar a,.sx-bar button{height:30px;padding:0 11px;border-radius:9px;border:0;background:transparent;color:#bbb;font:700 12px Inter;cursor:pointer;text-decoration:none;display:flex;align-items:center}
    .sx-bar a.on{background:#f5f5f5;color:#0a0a0a}.sx-bar .demo{color:#e8b65c}`;
    document.head.appendChild(st);
    const cur = location.pathname.replace(/\.html$/, ""), V = [["/salle", "Classique"], ["/salle-orbite", "Orbite"], ["/salle-bourse", "Bourse"], ["/salle-scene", "Scène"]];
    const bar = document.createElement("div"); bar.className = "sx-bar";
    bar.innerHTML = V.map(([u, l]) => `<a href="${u}${DEMO ? "?demo" : ""}" class="${cur === u ? "on" : ""}">${l}</a>`).join("") + `<a href="${cur}${DEMO ? "" : "?demo"}" class="demo">${DEMO ? "● Démo" : "Démo"}</a><button data-snd>${on ? "🔊" : "🔇"}</button><button data-fs>⛶</button><a href="/admin">✕</a>`;
    document.body.appendChild(bar);
    bar.querySelector("[data-snd]").onclick = ev => { on = !on; try { localStorage.setItem("salleSon", on ? "1" : "0"); } catch (e) {} ev.currentTarget.textContent = on ? "🔊" : "🔇"; if (on) { try { ctx(); SND.tick(); } catch (e) {} } };
    bar.querySelector("[data-fs]").onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    const g = document.createElement("div"); g.className = "sx-gate"; g.innerHTML = `<button type="button">▶ Lancer la salle de contrôle<small>${DEMO ? "mode démo : des ventes fictives tombent toutes les quelques secondes" : "avec le son à chaque vente"}</small></button>`;
    // un clic n'importe où sur l'écran d'accueil lance la salle avec le son (selon le réglage 🔊 / 🔇)
    document.body.appendChild(g); g.onclick = () => { if (on) try { ctx(); SND.tick(); } catch (e) {} g.remove(); h.go && h.go(); };
  }
  return { start, SND, eur, reduce, DEMO };
})();
