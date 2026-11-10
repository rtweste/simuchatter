/* ==========================================================================
   Accueil manager : animations avancées
   - FeedFX : fil « Activité en direct » (ressorts, rouleaux, néon, étincelles)
   - LogoAurora : bloc logo avec aurore animée
   ========================================================================== */
(() => {
const COL = { g: "#5fd3a2", o: "#e0a050", r: "#e07a7a", "": "#bdbdbd" };
const IC = {
  e: '<path d="M18 7.5A7 7 0 1 0 18 16.5"/><path d="M4 10.5h9M4 13.5h9"/>',
  c: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  s: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/>'
};
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const escH = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const agoTxt = t => { const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.floor(m / 60)} h` : `il y a ${Math.floor(m / 1440)} j`; };
const keyOf = e => e.t + "|" + e.who + "|" + (e.short || e.text);
const S = (v, k = 170, c = 20) => ({ v: 0, x: v, t: v, k, c });
const step = (s, dt) => { const a = -s.k * (s.x - s.t) - s.c * s.v; s.v += a * dt; s.x += s.v * dt; };

function roll(el, n) {
  const s = String(n); if (el.dataset.v === s) return; const first = !el.dataset.v; el.dataset.v = s;
  el.innerHTML = s.split("").map(d => `<span class="fx-dg"><span style="transform:translateY(${first ? -d * 10 : 10}%)">${[...Array(10).keys()].join("<br>")}</span></span>`).join("");
  if (!first) requestAnimationFrame(() => requestAnimationFrame(() => el.querySelectorAll(".fx-dg > span").forEach((sp, i) => {
    sp.style.transition = `transform .9s cubic-bezier(.2,1.4,.4,1) ${i * .06}s`; sp.style.transform = `translateY(${-s[i] * 10}%)`; })));
}
function scramble(el, txt, dur) {
  const ch = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*", t0 = performance.now();
  const tick = () => { const p = Math.min(1, (performance.now() - t0) / dur), n = Math.floor(p * txt.length);
    el.textContent = txt.slice(0, n) + txt.slice(n).replace(/[^\s]/g, () => ch[Math.floor(Math.random() * ch.length)]);
    if (p < 1) requestAnimationFrame(tick); else el.textContent = txt; };
  tick();
}

window.FeedFX = function (root, initial, live) {
  const H = 54, GAP = 8, STEP = H + GAP;
  let MAXV = 4, flt = "A", items = [], onShift = [];
  const norm = e => ({ id: keyOf(e), t0: e.t, t: e.k || "c", cls: e.cls || "", who: e.who, short: e.short || e.text, sub: e.sub || "",
    amt: e.amt != null && e.k === "e" ? e.amt : null });
  items = initial.map(norm);
  root.innerHTML = `<div class="fx-hd"><h3>Activité <em>en direct</em></h3><span class="fx-live"><i></i>en direct</span></div>
    <div class="fx-shift"><span class="fx-sl"><i></i><span class="fx-sn"></span><span>en shift</span></span><span class="fx-avs"></span><span class="fx-names"></span></div>
    <div class="fx-tabs" role="tablist"><span class="fx-ind"></span>${[["A", "Tout"], ["E", "Ventes"], ["C", "Shifts"], ["S", "Simu"]].map(([k, l]) => `<button type="button" role="tab" data-k="${k}">${l}<span class="fx-cnt"><span class="fx-cr"></span></span></button>`).join("")}</div>
    <div class="fx-list"><div class="fx-stage"></div><div class="fx-empty">Rien pour l'instant. Les ventes, pointages et simulations apparaîtront ici.</div></div><canvas class="fx-cv" aria-hidden="true"></canvas>`;
  const stage = root.querySelector(".fx-stage"), list = root.querySelector(".fx-list"), ind = root.querySelector(".fx-ind"), tabs = root.querySelector(".fx-tabs");
  const cv = root.querySelector(".fx-cv"), cx = cv.getContext("2d"), empty = root.querySelector(".fx-empty");
  const btns = [...root.querySelectorAll(".fx-tabs button")];
  const avs = root.querySelector(".fx-avs"), names = root.querySelector(".fx-names"), sn = root.querySelector(".fx-sn"), strip = root.querySelector(".fx-shift");
  const cards = new Map();
  let parts = [];
  const burst = (x, y, color, n = 22) => { if (reduce) return; for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (Math.random() - .5) * Math.PI * 1.4, sp = 90 + Math.random() * 220;
    parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, r: 1 + Math.random() * 2.2, color }); } };
  const amtHTML = it => {
    if (it.amt == null) return "";
    const s = (it.cls === "r" ? "" : "+") + Number(it.amt).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
    return `<span class="fx-amt" style="color:${COL[it.cls]}">${s.split("").map(ch => /\d/.test(ch) ? `<span class="fx-dg"><span data-d="${ch}">${[...Array(10).keys()].join("<br>")}</span></span>` : `<span>${ch === " " || ch === " " ? "&nbsp;" : escH(ch)}</span>`).join("")}<span>&nbsp;€</span></span>`;
  };
  function build(it, born) {
    const el = document.createElement("div"); el.className = "fx-nt"; el.style.setProperty("--cl", COL[it.cls]);
    el.innerHTML = `<span class="fx-ic ${it.cls}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[it.t] || IC.c}</svg></span>
      <span class="fx-tx"><span><b class="fx-who">${escH(it.who)}</b> <span class="fx-sh">${escH(it.short)}</span></span><small>${escH(it.sub)}${it.sub ? " · " : ""}<span class="fx-ago" data-t="${it.t0}">${agoTxt(it.t0)}</span></small></span>${amtHTML(it)}`;
    stage.appendChild(el);
    const c = { el, it, y: S(0, 210, 22), o: S(1, 160, 22), sc: S(1, 190, 18), b: S(0, 120, 20), xo: S(0, 200, 22), gone: false };
    cards.set(it.id, c);
    const digits = el.querySelectorAll(".fx-amt [data-d]");
    if (!born || reduce) { digits.forEach(sp => sp.style.transform = `translateY(${-sp.dataset.d * 10}%)`); return c; }
    el.classList.add("fx-new", "fx-neon"); setTimeout(() => el.classList.remove("fx-neon"), 2600);
    c.y.x = -24; c.o.x = 0; c.sc.x = .97;
    scramble(el.querySelector(".fx-who"), it.who, 520); scramble(el.querySelector(".fx-sh"), it.short, 700);
    setTimeout(() => digits.forEach((sp, i) => { sp.style.transition = `transform 1s cubic-bezier(.2,1.3,.4,1) ${i * .08}s`; sp.style.transform = `translateY(${-sp.dataset.d * 10}%)`; }), 250);
    if (it.amt != null && it.cls !== "r") setTimeout(() => { const a = el.querySelector(".fx-amt"); if (!a || !root.isConnected) return; const r = a.getBoundingClientRect(), rr = root.getBoundingClientRect(); burst(r.left - rr.left + r.width / 2, r.top - rr.top + r.height / 2, COL[it.cls]); }, 900);
    return c;
  }
  const visible = () => items.filter(x => flt === "A" || x.t === flt.toLowerCase()).slice(0, MAXV);
  let gen = 0;
  function layout(stagger, dir) {
    const g = ++gen;   // un nouveau filtre annule les déplacements prévus par le précédent
    MAXV = Math.max(2, Math.floor((list.clientHeight + GAP + 24) / STEP));
    const vis = visible(), ids = new Set(vis.map(v => v.id));
    empty.style.display = vis.length ? "none" : "flex";
    vis.forEach((it, i) => {
      let c = cards.get(it.id);
      if (c && c.gone) { c.el.remove(); cards.delete(it.id); c = null; }
      if (!c) { c = build(it, false); c.o.x = 0; c.xo.x = dir ? 26 * dir : 0; c.y.x = i * STEP; c.b.x = 4; }
      const go = () => { c.y.t = i * STEP; c.o.t = i === MAXV - 1 && items.length > MAXV ? .55 : 1; c.sc.t = 1; c.b.t = 0; c.xo.t = 0; c.el.style.zIndex = 10 - i; };
      stagger ? setTimeout(() => { if (g === gen && cards.get(it.id) === c) go(); }, i * 55) : go();
    });
    cards.forEach((c, id) => { if (!ids.has(id) && !c.gone) { c.gone = true; c.el.style.zIndex = 0; c.el.style.pointerEvents = "none"; c.o.t = 0; c.b.t = 8; c.sc.t = .9; c.xo.t = dir ? -26 * dir : 0; if (!dir) c.y.t += 30; setTimeout(() => { if (cards.get(id) === c) { c.el.remove(); cards.delete(id); } else c.el.remove(); }, 650); } });
  }
  const iL = S(0, 260, 24), iR = S(0, 260, 24);
  function tabsUpd(bumpK) {
    const counts = { A: items.length, E: items.filter(x => x.t === "e").length, C: items.filter(x => x.t === "c").length, S: items.filter(x => x.t === "s").length };
    btns.forEach(b => { const k = b.dataset.k; b.classList.toggle("on", k === flt); b.setAttribute("aria-selected", k === flt); roll(b.querySelector(".fx-cr"), counts[k]);
      if (bumpK && (k === "A" || k === bumpK)) { const c = b.querySelector(".fx-cnt"); c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump"); } });
    const b = btns.find(x => x.dataset.k === flt), tr = tabs.getBoundingClientRect(), r = b.getBoundingClientRect();
    const L = r.left - tr.left, R = r.right - tr.left, right = R > iR.t;
    iL.k = right ? 120 : 300; iR.k = right ? 300 : 120; iL.c = right ? 17 : 26; iR.c = right ? 26 : 17;
    iL.t = L; iR.t = R; if (!ind.dataset.ok) { iL.x = L; iR.x = R; ind.dataset.ok = 1; }
  }
  btns.forEach(b => b.addEventListener("click", () => { if (b.dataset.k === flt) return; const o = "AECS".indexOf(flt) < "AECS".indexOf(b.dataset.k) ? 1 : -1; flt = b.dataset.k; tabsUpd(); layout(true, o); }));
  // chatters en shift
  function setLive(l, animate) {
    const next = l.map(x => [x.username, x.model_name]);
    const added = next.filter(n => !onShift.some(o => o[0] === n[0])), removed = onShift.filter(o => !next.some(n => n[0] === o[0]));
    onShift = next; roll(sn, onShift.length);
    const have = new Map([...avs.children].map(a => [a.dataset.w, a]));
    onShift.slice(0, 6).forEach(([w, m]) => { if (have.has(w)) return; const a = document.createElement("span"); a.className = "fx-av" + (animate ? " fx-avin" : ""); a.dataset.w = w; a.textContent = (w[0] || "?").toUpperCase(); a.title = w + " · " + m; avs.appendChild(a); });
    have.forEach((a, w) => { if (!onShift.some(x => x[0] === w)) { a.classList.add("fx-avout"); setTimeout(() => a.remove(), 600); } });
    names.innerHTML = onShift.length ? onShift.map(([w, m]) => `<b>${escH(w)}</b> · ${escH(m)}`).join(", ") : "personne en shift pour l'instant";
    strip.classList.toggle("off", !onShift.length);
    if (animate && (added.length || removed.length)) { strip.classList.remove("fx-fli", "fx-flo"); void strip.offsetWidth; strip.classList.add(added.length ? "fx-fli" : "fx-flo"); }
  }
  // nouvelles activités (les plus anciennes d'abord, une par une)
  function push(feed) {
    const known = new Set(items.map(i => i.id));
    const fresh = feed.map(norm).filter(e => !known.has(e.id)).sort((a, b) => a.t0 - b.t0);
    fresh.forEach((it, k) => setTimeout(() => {
      if (!root.isConnected) return;
      items.unshift(it); items = items.slice(0, 30);
      if (flt !== "A" && it.t !== flt.toLowerCase()) { tabsUpd(it.t.toUpperCase()); return; }
      build(it, true); tabsUpd(it.t.toUpperCase()); layout(false);
      let i = 0; cards.forEach(o => { if (o.it !== it && !o.gone) { o.y.v += -40 - i * 12; i++; } });
    }, k * 1100));
  }
  setLive(live, false); tabsUpd(); layout(false);
  addEventListener("resize", () => { tabsUpd(); layout(false); });
  setInterval(() => root.querySelectorAll(".fx-ago").forEach(a => a.textContent = agoTxt(+a.dataset.t)), 30000);
  let last = performance.now();
  const loop = now => {
    if (!root.isConnected) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    for (let k = 0; k < 3; k++) { const d = dt / 3; cards.forEach(c => [c.y, c.o, c.sc, c.b, c.xo].forEach(s => step(s, d))); step(iL, d); step(iR, d); }
    cards.forEach(c => {
      const o = Math.max(0, Math.min(1, c.o.x)), b = Math.max(0, c.b.x);
      c.el.style.transform = `translate3d(${c.xo.x.toFixed(2)}px,${c.y.x.toFixed(2)}px,0) scale(${c.sc.x.toFixed(4)})`;
      c.el.style.opacity = o.toFixed(3); c.el.style.filter = b > .05 ? `blur(${b.toFixed(2)}px)` : "none";
    });
    ind.style.transform = `translateX(${iL.x.toFixed(2)}px)`; ind.style.width = Math.max(10, iR.x - iL.x).toFixed(2) + "px";
    if (parts.length || cv.dataset.dirty) {
      const W = root.clientWidth + 40, Hh = root.clientHeight + 40;
      if (cv.width !== W * 2) { cv.width = W * 2; cv.height = Hh * 2; }
      cx.setTransform(2, 0, 0, 2, 0, 0); cx.clearRect(0, 0, W, Hh);
      parts = parts.filter(p => p.life > 0);
      parts.forEach(p => { p.vy += 520 * dt; p.vx *= .985; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 1.1;
        cx.globalAlpha = Math.max(0, p.life); cx.fillStyle = p.color; cx.beginPath(); cx.arc(p.x + 20, p.y + 20, p.r, 0, 7); cx.fill(); });
      cx.globalAlpha = 1; cv.dataset.dirty = parts.length ? "1" : "";
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return { push, setLive: l => setLive(l, true) };
};

window.LogoAurora = function (root) {
  root.innerHTML = `<span class="halo"></span><canvas aria-hidden="true"></canvas><div class="lgw">${LOGO_SVG}<div class="shn">${LOGO_SVG}</div></div>`;
  const cv = root.querySelector("canvas"), cx = cv.getContext("2d"), wrap = root.querySelector(".lgw");
  let W = 0, H = 0;
  const resize = () => { const r = root.getBoundingClientRect(); W = r.width; H = r.height; cv.width = W * 2; cv.height = H * 2; };
  resize(); addEventListener("resize", resize);
  let ptx = 0, pty = 0, pxs = 0, pys = 0;
  root.addEventListener("pointermove", e => { const r = root.getBoundingClientRect(); ptx = (e.clientX - r.left) / W - .5; pty = (e.clientY - r.top) / H - .5; });
  root.addEventListener("pointerleave", () => { ptx = pty = 0; });
  // les lettres montent une à une
  const letters = [...wrap.querySelectorAll("svg:first-of-type .lt")], star = wrap.querySelector("svg:first-of-type .star");
  letters.forEach((p, i) => { p.style.opacity = "0"; p.style.transform = "translateY(24px)"; p.style.filter = "blur(8px)"; p.style.transformBox = "fill-box";
    p.style.transition = `opacity .9s ease ${.3 + i * .09}s, transform 1.1s cubic-bezier(.2,1.2,.3,1) ${.3 + i * .09}s, filter .9s ease ${.3 + i * .09}s`; });
  if (star) { star.style.opacity = "0"; star.style.transition = "opacity .4s ease 1.3s"; }
  requestAnimationFrame(() => requestAnimationFrame(() => { letters.forEach(p => { p.style.opacity = "1"; p.style.transform = "none"; p.style.filter = "none"; }); if (star) star.style.opacity = "1"; }));
  setTimeout(() => root.classList.add("lg-live"), 2000);
  const st = Array.from({ length: 50 }, () => ({ x: Math.random(), y: Math.random(), z: .3 + Math.random() * .7, ph: Math.random() * 6.28 }));
  const bands = [[0, 70, 26, "255,255,255", .05], [1.7, 58, 34, "200,210,230", .045], [3.1, 80, 22, "255,255,255", .035], [4.4, 50, 40, "180,190,210", .04]];
  const t0 = performance.now();
  const loop = now => {
    if (!root.isConnected) return;
    const t = (now - t0) / 1000;
    if (root.offsetParent === null) { requestAnimationFrame(loop); return; }   // caché (téléphone) : on ne dessine rien
    if (Math.abs(root.clientWidth - W) > 1) resize();
    pxs += (ptx - pxs) * .06; pys += (pty - pys) * .06;
    cx.setTransform(2, 0, 0, 2, 0, 0); cx.clearRect(0, 0, W, H);
    const intro = Math.min(1, t / 1.5), tt = reduce ? 0 : t;
    cx.globalCompositeOperation = "lighter"; cx.filter = "blur(14px)";
    bands.forEach(([ph, amp, th, col, al]) => { for (let k = 0; k < 3; k++) {
      cx.beginPath();
      for (let x = -20; x <= W + 20; x += 8) { const y = H * .55 + Math.sin(x * .012 + tt * .6 + ph) * amp * .5 + Math.sin(x * .021 - tt * .9 + ph * 2) * amp * .25 - pys * 20 - k * th * .4; x === -20 ? cx.moveTo(x, y) : cx.lineTo(x, y); }
      cx.lineWidth = th * (1 - k * .25); cx.strokeStyle = `rgba(${col},${(al * intro).toFixed(3)})`; cx.stroke(); } });
    cx.filter = "none"; cx.globalCompositeOperation = "source-over";
    st.forEach(s => { const a = (.3 + .7 * (.5 + .5 * Math.sin(tt * 1.5 + s.ph))) * s.z * intro;
      cx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`; cx.beginPath(); cx.arc(s.x * W - pxs * 24 * s.z, s.y * H - pys * 14 * s.z, .5 + s.z, 0, 6.29); cx.fill(); });
    wrap.style.transform = `translate(${(pxs * 10).toFixed(2)}px,${(pys * 6).toFixed(2)}px) rotateY(${(pxs * 8).toFixed(2)}deg) rotateX(${(-pys * 8).toFixed(2)}deg)`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};
})();
