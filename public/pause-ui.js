// Pauses pendant le shift : pastille flottante sur toutes les pages + écran de pause plein écran
window.PAUSEUI = (() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let S = null, root, ov, pill, timer, cvs, raf, holdRaf, msgI = 0, lastTxt = "";
  const MSG = ["Bois un grand verre d'eau 💧", "Lève-toi et étire-toi deux minutes 🙆", "Regarde au loin, repose tes yeux 👀", "Respire profondément : 4 s inspire, 6 s expire 🌬️", "Tes fans t'attendent à ton retour 😉"];
  const pad = n => String(n).padStart(2, "0");
  const elapsed = () => S && S.open ? (Date.now() - S.open.start_at) / 1000 : 0;
  const CUP = `<svg viewBox="0 0 74 70" aria-hidden="true"><defs><clipPath id="pzCl"><path d="M14 24h38l-4 34a8 8 0 0 1-8 7H26a8 8 0 0 1-8-7z"/></clipPath><linearGradient id="pzL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8b98a"/><stop offset="1" stop-color="#8a5a3a"/></linearGradient></defs>
    <g class="st"><path d="M26 18c-4-4 4-7 0-12"/><path d="M34 18c-4-4 4-7 0-12"/><path d="M42 18c-4-4 4-7 0-12"/></g>
    <g clip-path="url(#pzCl)"><g class="liq" id="pzLiq"><path class="wv" fill="url(#pzL)" d="M0 30 q6 -4 12 0 t12 0 t12 0 t12 0 t12 0 t12 0 t12 0 V70 H0z"/></g></g>
    <path d="M14 24h38l-4 34a8 8 0 0 1-8 7H26a8 8 0 0 1-8-7z" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/><path d="M51 31h4a7 7 0 0 1 0 14h-6" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>`;
  const R = 130, CIRC = 2 * Math.PI * R;

  function build() {
    root = document.createElement("div"); root.className = "pz";
    root.innerHTML = `<button class="pz-pill" id="pzPill" aria-label="Voir ma pause"><span style="position:relative;display:inline-flex"><svg class="r" viewBox="0 0 40 40"><circle class="b" cx="20" cy="20" r="16"/><circle class="f" id="pzPf" cx="20" cy="20" r="16" stroke-dasharray="100.5" stroke-dashoffset="0"/></svg>
        <svg class="cup" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16M8 3v2M12 3v2"/></svg></span><span><small>EN PAUSE</small><b id="pzPt">00:00</b></span></button>
      <div class="pz-ov" id="pzOv" role="dialog" aria-modal="true" aria-label="Pause"><canvas id="pzCv"></canvas><div class="gr"></div><button class="pz-x" id="pzX" aria-label="Réduire">↙</button>
        <div class="pz-box"><div class="pz-k">Pause <b id="pzN">1</b> sur <span id="pzC">2</span></div>
          <div class="pz-dial"><svg viewBox="0 0 300 300"><defs><linearGradient id="pzG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--p1)"/><stop offset="1" stop-color="var(--p2)"/></linearGradient></defs>
            ${Array.from({ length: 60 }, (_, i) => { const a = i / 60 * Math.PI * 2, r1 = 146, r2 = i % 5 ? 141 : 136; return `<line class="tk" x1="${150 + Math.cos(a) * r1}" y1="${150 + Math.sin(a) * r1}" x2="${150 + Math.cos(a) * r2}" y2="${150 + Math.sin(a) * r2}"/>`; }).join("")}
            <circle class="bg" cx="150" cy="150" r="${R}"/><circle class="fl" id="pzFl" cx="150" cy="150" r="${R}" stroke-dasharray="${CIRC}" stroke-dashoffset="0"/><circle class="hd" id="pzHd" cx="${150 + R}" cy="150" r="6"/></svg>
            <div class="ct"><div class="pz-cupw">${CUP}</div><div class="pz-time" id="pzT"></div><div class="pz-sub" id="pzS"></div></div></div>
          <div class="pz-dots" id="pzD"></div><div class="pz-msg" id="pzM"></div>
          <button class="pz-hold" id="pzH">Reprendre mon shift<small>maintiens appuyé</small></button><button class="pz-min" id="pzBonus" hidden style="color:#f3d9a4">+15 min avec ma pause bonus</button><button class="pz-min" id="pzMin">Réduire, je reste en pause</button></div></div>`;
    document.body.appendChild(root); ov = root.querySelector("#pzOv"); pill = root.querySelector("#pzPill"); cvs = root.querySelector("#pzCv");
    pill.onclick = () => openOv(pill); root.querySelector("#pzX").onclick = closeOv; root.querySelector("#pzMin").onclick = closeOv;
    root.querySelector("#pzBonus").onclick = async () => { try { await api("/api/stellas/pause-bonus", { body: {} }); notify("+15 min de pause ✓", "Pause bonus utilisée", "ok"); refresh(); } catch (e) { notify("Impossible", e.message, "err"); } };
    addEventListener("keydown", e => { if (e.key === "Escape" && ov.classList.contains("on")) closeOv(); });
    bindHold();
  }
  /* ---------- chiffres qui roulent ---------- */
  function setTime(txt) {
    const el = root.querySelector("#pzT"); if (el.children.length !== txt.length) { el.innerHTML = [...txt].map(c => /\d/.test(c) ? `<span class="d"><span>${c}</span></span>` : `<span class="${c === "+" ? "pl" : "s"}">${c}</span>`).join(""); lastTxt = txt; return; }
    [...txt].forEach((c, i) => { if (lastTxt[i] === c || !/\d/.test(c)) return; const box = el.children[i]; if (reduce) { box.firstChild.textContent = c; return; }
      const o = box.lastElementChild; o.className = "out"; const n = document.createElement("span"); n.className = "in"; n.textContent = c; box.appendChild(n); setTimeout(() => o.remove(), 450); });
    lastTxt = txt;
  }
  /* ---------- rafraîchissement chaque seconde ---------- */
  function tick() {
    if (!root) return; const on = !!(S && S.open); pill.classList.toggle("on", on && !ov.classList.contains("on"));
    paintBtn(); if (!on) return;
    const pb = root.querySelector("#pzBonus"); if (pb) { pb.hidden = !(S.bonusLeft > 0); if (S.bonusLeft > 0) pb.textContent = `+15 min avec ma pause bonus${S.bonusLeft > 1 ? ` (${S.bonusLeft})` : ""}`; }
    const e = elapsed(), max = S.max * 60, rem = max - e, over = rem < 0, frac = Math.max(0, Math.min(1, rem / max));
    root.classList.toggle("over", over); pill.classList.toggle("over", over);
    const t = Math.abs(Math.round(rem)), txt = `${over ? "+" : ""}${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
    root.querySelector("#pzPt").textContent = txt; root.querySelector("#pzPf").style.strokeDashoffset = 100.5 * (1 - frac);
    if (!ov.classList.contains("on")) return;
    setTime(txt); root.querySelector("#pzS").textContent = over ? `de dépassement · limite ${S.max} min` : `restantes sur ${S.max} min`;
    root.querySelector("#pzFl").style.strokeDashoffset = CIRC * (1 - frac);
    const a = -frac * Math.PI * 2; const hd = root.querySelector("#pzHd"); hd.setAttribute("cx", 150 + Math.cos(-a) * R); hd.setAttribute("cy", 150 + Math.sin(-a) * R);
    root.querySelector("#pzLiq").style.transform = `translateY(${(1 - frac) * 36}px)`;
    const cur = S.used - 1; root.querySelector("#pzN").textContent = S.used; root.querySelector("#pzC").textContent = S.count;
    root.querySelector("#pzD").innerHTML = Array.from({ length: S.count }, (_, i) => `<i class="${i < cur ? "u" : i === cur ? "c" : ""}" style="--f:${1 - frac}"></i>`).join("");
    if (Math.floor(e / 12) !== msgI) { msgI = Math.floor(e / 12); const m = root.querySelector("#pzM"); const txt2 = over ? "Ta pause est terminée : reprends ton shift, le manager est prévenu ⏰" : MSG[msgI % MSG.length];
      if (m.textContent !== txt2) { if (!reduce) m.animate([{ opacity: 0, transform: "translateY(8px)", filter: "blur(4px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], { duration: 600, easing: "cubic-bezier(.2,.9,.25,1)" }); m.textContent = txt2; } }
  }
  function paintBtn() {
    const b = document.getElementById("pzBtn"); if (!b || !S) return;
    if (!S.enabled) { b.hidden = true; return; } b.hidden = false;
    const ic = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16M8 3v2M12 3v2"/></svg>`;
    const html = S.open ? `${ic}En pause` : S.left ? `${ic}Pause <em>· ${S.left}/${S.count}</em>` : `${ic}Plus de pause`;
    if (b.innerHTML !== html) b.innerHTML = html; b.classList.add("pz-start"); b.disabled = !S.open && !S.left;
    b.onclick = () => S.open ? openOv(b) : start(b);
  }
  /* ---------- fond animé (aurore + poussières de lumière) ---------- */
  function aurora() {
    cancelAnimationFrame(raf); if (reduce) return; const x = cvs.getContext("2d"); let W, H; const fit = () => { const d = Math.min(1.5, devicePixelRatio || 1); W = innerWidth; H = innerHeight; cvs.width = W * d; cvs.height = H * d; x.setTransform(d, 0, 0, d, 0, 0); }; fit();
    const dust = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), r: .5 + Math.random() * 1.8, v: .00006 + Math.random() * .00018, p: Math.random() * 6 }));
    let col = [125, 211, 252], col2 = [179, 136, 255];
    (function f(t) { if (!ov.classList.contains("on")) return; const over = root.classList.contains("over"), tg = over ? [255, 107, 107] : [125, 211, 252], tg2 = over ? [255, 154, 92] : [179, 136, 255];
      col = col.map((v, i) => v + (tg[i] - v) * .03); col2 = col2.map((v, i) => v + (tg2[i] - v) * .03);
      x.fillStyle = "#05070c"; x.fillRect(0, 0, W, H); x.globalCompositeOperation = "lighter";
      const br = .5 + .5 * Math.sin(t * .0009);   // respiration lente
      [[col, .3 + .2 * Math.sin(t * .0003), .25 + .1 * Math.cos(t * .0004), .55], [col2, .7 + .2 * Math.cos(t * .00025), .75 + .1 * Math.sin(t * .00035), .6], [col, .5 + .3 * Math.sin(t * .0002 + 2), .5, .35]].forEach(([c, px, py, rr]) => {
        const g = x.createRadialGradient(px * W, py * H, 0, px * W, py * H, Math.max(W, H) * rr * (.9 + br * .2)); g.addColorStop(0, `rgba(${c.map(v => v | 0)},${.22 + br * .08})`); g.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = g; x.fillRect(0, 0, W, H); });
      dust.forEach(d => { d.y -= d.v * 16; if (d.y < -.02) d.y = 1.02; const a = .25 + .35 * Math.abs(Math.sin(t * .001 + d.p)); x.fillStyle = `rgba(255,255,255,${a})`; x.beginPath(); x.arc(d.x * W + Math.sin(t * .0005 + d.p) * 12, d.y * H, d.r, 0, 7); x.fill(); });
      x.globalCompositeOperation = "source-over"; raf = requestAnimationFrame(f); })(performance.now());
    addEventListener("resize", fit);
  }
  function setOrigin(el) { const r = el ? el.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 }; ov.style.setProperty("--ox", r.left + r.width / 2 + "px"); ov.style.setProperty("--oy", r.top + r.height / 2 + "px"); }
  function openOv(from) { setOrigin(from); lastTxt = ""; root.querySelector("#pzT").innerHTML = ""; ov.classList.remove("out"); ov.classList.add("on"); document.body.classList.add("modal-open"); msgI = -1; tick(); aurora();
    if (!reduce) root.querySelectorAll(".pz-k,.pz-dial,.pz-dots,.pz-msg,.pz-hold,.pz-min").forEach((el, i) => el.animate([{ opacity: 0, transform: "translateY(30px) scale(.96)", filter: "blur(10px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], { duration: 900, delay: 300 + i * 90, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" })); }
  function closeOv() { setOrigin(pill.classList.contains("on") || S?.open ? pill : null); ov.classList.add("out"); ov.classList.remove("on"); document.body.classList.remove("modal-open"); setTimeout(tick, 50); }
  /* ---------- reprendre : maintenir appuyé ---------- */
  function bindHold() {
    const b = root.querySelector("#pzH"); let t0 = 0, done = false;
    const set = v => b.style.setProperty("--h", v);
    const down = e => { e.preventDefault(); if (done) return; t0 = performance.now(); cancelAnimationFrame(holdRaf);
      (function f(t) { const p = Math.min(1, (t - t0) / (reduce ? 1 : 850)); set(p); if (p >= 1) { done = true; resume(); return; } holdRaf = requestAnimationFrame(f); })(t0); };
    const up = () => { if (done) return; cancelAnimationFrame(holdRaf); set(0); };
    b.addEventListener("pointerdown", down); b.addEventListener("pointerup", up); b.addEventListener("pointerleave", up); b.addEventListener("pointercancel", up);
    b.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); done = true; resume(); } });
    b._reset = () => { done = false; set(0); };
  }
  async function resume() {
    const b = root.querySelector("#pzH"); try { const r = await api("/api/pause/end", { body: {} }); const min = Math.round(elapsed() / 60); S = r.state;
      closeOv(); notify("Bon retour !", min > S.max ? `Pause de ${min} min : dépassement de ${min - S.max} min` : `Pause de ${Math.max(1, min)} min · ${S.left} pause${S.left > 1 ? "s" : ""} restante${S.left > 1 ? "s" : ""}`, min > S.max ? "info" : "ok");
    } catch (e) { notify("Impossible de reprendre", e.message, "err"); }
    b._reset(); tick();
  }
  async function start(from) {
    try { const r = await api("/api/pause/start", { body: {} }); S = r.state; try { SND.shift(); } catch (e) {} openOv(from); }
    catch (e) { notify("Pause impossible", e.message, "err"); }
  }
  async function refresh() { try { S = await api("/api/pause/me"); } catch (e) { return; } tick(); }
  function mount(me) { if (root) return; build(); refresh(); clearInterval(timer); timer = setInterval(() => { tick(); }, 1000); setInterval(() => { if (!document.hidden) refresh(); }, 30e3);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); }); }
  return { mount, start, refresh, paintBtn, get state() { return S; } };
})();
