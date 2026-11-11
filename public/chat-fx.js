/* =====================================================================
   StellADS — célébration d'un PPV acheté, en 4 niveaux selon le montant
   CHATFX.sale(root, card, price, onRev)  ->  niveau (1 à 4)
     < 20 € : brillance + montant qui s'envole
     20–34 € : cadenas qui éclate + pièces qui volent vers le revenu
     35–59 € : onde de choc + éclats + bannière « GROSSE VENTE » + secousse
     ≥ 60 €  : « JACKPOT » plein écran (faisceaux, montant géant, explosion)
   ===================================================================== */
const CHATFX = (() => {
  const G = "95,211,162";
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  // FX est déclaré avec « const » dans simu-fx.js : il n'est pas accessible via window.FX
  const snd = (name, ...a) => { try { if (typeof FX !== "undefined" && FX.sound[name]) FX.sound[name](...a); } catch (e) {} };
  const buzz = p => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };
  const tierOf = p => p >= 60 ? 4 : p >= 35 ? 3 : p >= 20 ? 2 : 1;
  function sale(root, card, price, onRev) {
    const tier = tierOf(price);
    let revDone = false; const giveRev = () => { if (!revDone) { revDone = true; onRev && onRev(); } };
    if (tier >= 3) { const b = document.createElement("span"); b.className = "tierb"; b.textContent = tier === 4 ? "JACKPOT" : "GROSSE VENTE"; card.querySelector(".pic")?.appendChild(b); }
    card.classList.add("t" + tier);
    if (reduce()) { snd("sale"); giveRev(); return tier; }
    const R0 = root.getBoundingClientRect(), k = R0.width / root.offsetWidth || 1;
    const box = el => { const r = el.getBoundingClientRect(); return { x: (r.left - R0.left) / k, y: (r.top - R0.top) / k, w: r.width / k, h: r.height / k, cx: (r.left - R0.left + r.width / 2) / k, cy: (r.top - R0.top + r.height / 2) / k }; };
    const cb = box(card), tgtEl = [...root.querySelectorAll("[data-revtarget]")].find(e => e.offsetParent && e.getBoundingClientRect().width) || card, tb = box(tgtEl);
    const cl = x => Math.max(0, Math.min(1, x)), eOut = x => 1 - Math.pow(1 - cl(x), 3), eIO = x => (x = cl(x)) < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    const spr = (t, k2 = 170, d = 14) => { if (t <= 0) return 0; const w = Math.sqrt(k2), z = d / (2 * w), wd = w * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + z * w / wd * Math.sin(wd * t)); };
    let L = root.querySelector(":scope > .fxl"); if (!L) { L = document.createElement("div"); L.className = "fxl"; L.innerHTML = "<canvas></canvas>"; root.appendChild(L); }
    const cv = L.querySelector("canvas"), W = root.offsetWidth, H = root.offsetHeight, dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr; const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const P = [], rings = [], t0 = performance.now(); let coinN = 0;
    const spark = (x, y, n, sp = 4, sz = 2) => { for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, v = sp * (.35 + Math.random()); P.push({ k: "s", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, l: 1, d: .012 + Math.random() * .02, s: sz * (.5 + Math.random()), c: Math.random() < .35 ? "255,255,255" : G }); } };
    const shards = (x, y, n, sp = 9) => { for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (Math.random() - .5) * Math.PI * 1.6, v = sp * (.4 + Math.random()); P.push({ k: "h", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, l: 1, d: .006 + Math.random() * .006, s: 4 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - .5) * .3, c: Math.random() < .5 ? "255,255,255" : G }); } };
    const coins = (n, delay, dur) => { for (let i = 0; i < n; i++) P.push({ k: "c", sx: cb.cx + (Math.random() - .5) * cb.w * .6, sy: cb.cy + (Math.random() - .5) * cb.h * .5, t: delay + i * (420 / n) * (tier >= 3 ? 1.6 : 1), dur: dur + Math.random() * 200, bend: (Math.random() - .5) * 260 }); };
    // niveau 1
    const fly = document.createElement("div"); fly.className = "flyamt t" + tier; fly.textContent = "+" + price + " €"; fly.style.left = cb.cx + "px"; fly.style.top = cb.y + "px"; L.appendChild(fly); setTimeout(() => fly.remove(), 1800);
    spark(cb.cx, cb.cy, tier === 1 ? 18 : 30, 3.5);
    if (tier === 1) { snd("sale"); buzz(30); giveRev(); }
    // niveau 2
    if (tier >= 2) { const lk = card.querySelector(".lk .ring") || card.querySelector(".lk"); if (lk) { const lb = box(lk); shards(lb.cx, lb.cy, 10, 5); }
      coins(tier === 2 ? 14 : tier === 3 ? 24 : 40, tier === 4 ? 2600 : 250, 850); rings.push({ x: cb.cx, y: cb.cy, t: 0, max: 120, w: 2 });
      if (tier === 2) { snd("sale"); buzz([30, 40, 30]); } }
    // niveau 3
    if (tier >= 3) {
      rings.push({ x: cb.cx, y: cb.cy, t: 60, max: Math.max(W, H) * .9, w: 3 }, { x: cb.cx, y: cb.cy, t: 220, max: Math.max(W, H) * .6, w: 1.5 });
      shards(cb.cx, cb.y, tier === 4 ? 60 : 70, 11);
      if (tier === 3) { snd("lock", true); snd("sale"); setTimeout(() => snd("soft"), 500); buzz([40, 40, 80]);
        const bn = document.createElement("div"); bn.className = "salebn"; bn.innerHTML = `<small>GROSSE VENTE</small><b>+${price} €</b>`; L.appendChild(bn);
        requestAnimationFrame(() => bn.classList.add("on")); setTimeout(() => bn.classList.remove("on"), 2300); setTimeout(() => bn.remove(), 2900); }
    }
    // niveau 4
    let jp = null;
    if (tier === 4) {
      snd("drone", 1250);
      jp = document.createElement("div"); jp.className = "jackpot";
      jp.innerHTML = `<div class="dim"></div><div class="beams"><i></i><i></i></div><div class="jc"><small>JACKPOT</small><b><span class="pl">+</span><span class="am">0</span><span class="eu">€</span></b><em>Le fan a craqué pour ton contenu</em></div>`;
      L.appendChild(jp); requestAnimationFrame(() => jp.classList.add("on"));
      setTimeout(() => { if (!root.isConnected) return; const b = box(jp.querySelector(".jc")); snd("lock", true); snd("win"); buzz([60, 40, 160]);
        rings.push({ x: b.cx, y: b.cy, t: 0, max: Math.max(W, H), w: 4 }, { x: b.cx, y: b.cy, t: 160, max: Math.max(W, H) * .8, w: 2 }, { x: b.cx, y: b.cy, t: 320, max: Math.max(W, H) * .6, w: 1 });
        spark(b.cx, b.cy, 220, 9, 2.6); shards(b.cx, b.cy, 80, 14); }, 1250);
    }
    const shakeEl = root.querySelector(".cq-main") || root;
    const step = now => {
      const t = now - t0; c.clearRect(0, 0, W, H);
      rings.forEach(r => { const x = (t - r.t) / 900; if (x <= 0 || x >= 1) return; c.strokeStyle = `rgba(${G},${(1 - x) * .8})`; c.lineWidth = r.w * (1 - x) + .3; c.beginPath(); c.arc(r.x, r.y, 10 + eOut(x) * r.max, 0, 7); c.stroke(); });
      c.globalCompositeOperation = "lighter";
      for (let i = P.length - 1; i >= 0; i--) { const p = P[i];
        if (p.k === "c") { const x = (t - p.t) / p.dur; if (x < 0) continue;
          if (x >= 1) { P.splice(i, 1); giveRev(); tgtEl.classList.remove("hit"); void tgtEl.offsetWidth; tgtEl.classList.add("hit"); spark(tb.cx, tb.cy, 3, 2); if (coinN++ % 3 === 0) snd("coin", coinN % 6); continue; }
          const e = eIO(x), mx = (p.sx + tb.cx) / 2 + p.bend, my = Math.min(p.sy, tb.cy) - 120, X = (1 - e) * (1 - e) * p.sx + 2 * (1 - e) * e * mx + e * e * tb.cx, Y = (1 - e) * (1 - e) * p.sy + 2 * (1 - e) * e * my + e * e * tb.cy;
          const g = c.createRadialGradient(X, Y, 0, X, Y, 9); g.addColorStop(0, "rgba(255,255,255,.95)"); g.addColorStop(.4, `rgba(${G},.8)`); g.addColorStop(1, `rgba(${G},0)`); c.fillStyle = g; c.beginPath(); c.arc(X, Y, 9, 0, 7); c.fill(); continue; }
        p.l -= p.d; if (p.l <= 0) { P.splice(i, 1); continue; }
        p.x += p.vx; p.y += p.vy; p.vx *= .97; p.vy = p.vy * .97 + (p.k === "h" ? .22 : .06);
        if (p.k === "h") { p.r += p.vr; c.save(); c.translate(p.x, p.y); c.rotate(p.r); c.fillStyle = `rgba(${p.c},${p.l})`; c.beginPath(); c.moveTo(0, -p.s); c.lineTo(p.s * .6, p.s * .5); c.lineTo(-p.s * .6, p.s * .4); c.closePath(); c.fill(); c.restore(); }
        else { c.fillStyle = `rgba(${p.c},${p.l})`; c.beginPath(); c.arc(p.x, p.y, p.s * p.l + .3, 0, 7); c.fill(); } }
      c.globalCompositeOperation = "source-over";
      const sh = tier === 3 ? Math.max(0, 1 - t / 500) * 5 : tier === 4 ? (t > 1250 && t < 2000 ? (1 - (t - 1250) / 750) * 10 : 0) : 0;
      shakeEl.style.transform = sh > .1 ? `translate(${(Math.random() - .5) * sh}px,${(Math.random() - .5) * sh}px)` : "";
      if (jp) { const am = jp.querySelector(".am"), jc = jp.querySelector(".jc");
        am.textContent = t < 1250 ? Math.floor(Math.random() * 90 + 10) : Math.round(price * eOut((t - 1250) / 900));
        const s = spr((t - 1150) / 1000, 140, 11); if (t < 2650) jc.style.transform = `translate(-50%,-50%) scale(${.4 + .6 * s})`; jc.style.filter = t < 1250 ? `blur(${(1 - t / 1250) * 14}px)` : "none";
        if (t >= 2650 && !jp._fly) { jp._fly = 1; const b = box(jc); jc.style.transition = "transform .75s cubic-bezier(.6,0,.3,1),opacity .75s"; jc.style.transform = `translate(calc(-50% + ${tb.cx - b.cx}px),calc(-50% + ${tb.cy - b.cy}px)) scale(.15)`; jc.style.opacity = "0"; }
        if (t >= 2700) jp.classList.remove("on"); }
      const alive = t < (tier === 4 ? 5200 : tier === 3 ? 3400 : 2600) || P.length;
      if (alive && root.isConnected) requestAnimationFrame(step); else { c.clearRect(0, 0, W, H); shakeEl.style.transform = ""; jp && jp.remove(); giveRev(); }
    };
    requestAnimationFrame(step);
    return tier;
  }
  return { sale, tierOf };
})();
