// Simu Chatter : écran de départ « écran verrouillé » (les messages du fan arrivent en notifications, glisser pour répondre)
window.SIMLOCK = (() => {
  const ACC = { nouveau: "#7cc4ff", radin: "#b8a4ff", baleine: "#ffd23f", froid: "#5fd3a2", agressif: "#ff8a7a", fragile: "#c9c9d6" };
  const BG = { nouveau: "#2c3a52", radin: "#3d3350", baleine: "#4a3b2a", froid: "#2d4440", agressif: "#4a2c32", fragile: "#3a3a46" };
  const LV = { 1: "Facile", 2: "Moyen", 3: "Avancé" }, LVC = { 1: "#5fd3a2", 2: "#ffb14a", 3: "#ff7a7a" };
  const DIFF = [["facile", "Facile", "Fan patient et indulgent : idéal pour s'entraîner aux bases."], ["normal", "Normal", "Réaliste : il réagit comme un vrai abonné."], ["difficile", "Difficile", "Exigeant : il décroche vite si tu le perds."]];
  // aperçus : ce que le fan pourrait écrire en ouvrant (illustration, la vraie conversation est jouée par l'IA)
  const SC = {
    nouveau: { facile: ["coucou", "je viens de m'abonner, j'adore ton style"], normal: ["salut ça va ?", "je viens de m'abonner, tu fais quoi ce soir ?"], difficile: ["slt", "jsuis nouveau, c'est quoi le délire avec les PPV ?"] },
    radin: { facile: ["hey", "t'aurais pas une petite photo offerte pour un nouveau ?"], normal: ["25 € la vidéo c'est abusé", "sur d'autres comptes c'est 10 €"], difficile: ["franchement c'est trop cher ici", "soit tu baisses soit je me désabonne"] },
    baleine: { facile: ["coucou toi", "ça fait plaisir de te retrouver ce soir"], normal: ["hello", "t'as pensé à moi cette semaine ?"], difficile: ["la dernière fois tu m'as dit l'inverse", "j'aime pas quand c'est pas cohérent"] },
    agressif: { facile: ["t'es là ?"], normal: ["allo", "réponds vite jai pas que ça à faire"], difficile: ["bon tu réponds ou quoi", "ça fait 2 min que j'attends là"] },
    fragile: { facile: ["coucou, t'es là ?", "t'es la seule à qui je parle en ce moment"], normal: ["salut… journée compliquée", "heureusement que t'es là"], difficile: ["j'ai plus trop d'argent ce mois-ci", "mais je veux pas te perdre"] }
  };
  const J = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"], M = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const e = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SV = (d, s = 18, w = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const bars = lv => `<span class="lk-lvb" style="--lc:${LVC[lv] || "#888"}">${[1, 2, 3].map(k => `<i class="${k <= lv ? "on" : ""}"></i>`).join("")}</span>`;

  function mount(el, o) {
    if (el._lk && el.isConnected && el.firstChild) { el._lk.select(o.selected); el._lk.setDiff(o.difficulty); el._lk.reset(); return el._lk; }
    const P = o.personas, msgs = p => (SC[p.id] || {})[cur.dif] || (p.opens ? ["salut"] : []);
    const cur = { i: Math.max(0, P.findIndex(p => p.id === o.selected)), dif: o.difficulty || "normal" };
    const timers = new Set(); let run = 0, since = 0;
    const later = (ms, f) => { const t = setTimeout(() => { timers.delete(t); f(); }, ms); timers.add(t); return t; };
    const row = (p, i) => `<button type="button" class="lk-row" data-i="${i}" aria-pressed="false" style="--bg:${BG[p.id] || "#333"};--c:${ACC[p.id] || "#ededed"}"><span class="av">${e(p.name[0])}<span class="bd"></span></span>
      <span class="tx"><b>${e(p.name)} <span>· ${e(p.label)}</span></b><span class="pv">${p.opens ? "…" : "Vu il y a 3 semaines"}</span></span><span class="tm">${bars(p.level)}${LV[p.level] || ""}</span></button>`;
    el.innerHTML = `<div class="lk">
      <div class="lk-chips" role="group" aria-label="Choisir un fan">${P.map(row).join("")}</div>
      <div class="lk-left"><div class="lk-ph"><div class="lk-wall"></div><div class="lk-wall2"></div>
        <div class="lk-isl" aria-hidden="true"><span class="av" data-pa></span><span data-in></span><span class="eq"><i></i><i></i><i></i></span></div>
        <div class="lk-lock"><div class="lk-date"></div><div class="lk-clock"></div><div class="lk-stack" aria-live="polite"></div></div>
        <div class="lk-chat"><div class="tp"><span class="av" data-pa></span><b data-pn></b></div><div class="lk-cm"></div><div class="cp">Écris en tant que la créatrice…</div></div>
        <div class="lk-sl"><span class="fill"></span><span class="txt">Glisse pour répondre</span><button type="button" class="lk-knob" aria-label="Glisser pour répondre et lancer la simulation (ou appuyer sur Entrée)">${SV("M5 12h14M13 6l6 6-6 6", 22, 2.4)}</button></div>
      </div></div>
      <div class="lk-right">
        <div class="lk-lab"><span>CHOISIS TON FAN</span><span>${P.length} CONVERSATIONS</span></div>
        <div class="lk-list" role="group" aria-label="Choisir un fan">${P.map(row).join("")}</div>
        <div class="lk-two"><div class="lk-card"><div class="lk-lab">DIFFICULTÉ</div>
          <div class="lk-seg" role="radiogroup" aria-label="Difficulté"><span class="ind"></span>${DIFF.map(([d, l]) => `<button type="button" role="radio" data-d="${d}" aria-checked="false">${l}</button>`).join("")}</div>
          <div class="lk-dh"></div><div class="lk-goal"><b>OBJECTIF · </b><span data-pg></span></div></div>
          <div class="lk-card lk-chr"><div class="lk-lab" style="justify-content:center">CHRONO</div><div class="rg"><svg viewBox="0 0 104 104" aria-hidden="true"><circle cx="52" cy="52" r="46" fill="none" stroke="#222" stroke-width="7"/><circle class="pr" cx="52" cy="52" r="46"/></svg><b data-cs>0:00</b></div><small>depuis son dernier message. En session, ton temps de réponse compte.</small></div></div>
        <div class="lk-foot"><span id="quota"></span><div class="err" id="startErr" role="alert"></div></div>
      </div></div>`;
    const q = s => el.querySelector(s), qa = s => [...el.querySelectorAll(s)], root = q(".lk"), ph = q(".lk-ph"), isl = q(".lk-isl");
    const clock = () => { const d = new Date(); q(".lk-clock").textContent = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); q(".lk-date").textContent = J[d.getDay()] + " " + d.getDate() + " " + M[d.getMonth()]; };
    const tick = () => { if (!el.isConnected) return stop(); since++; q("[data-cs]").textContent = Math.floor(since / 60) + ":" + String(since % 60).padStart(2, "0");
      q(".lk-chr .pr").style.strokeDashoffset = 289 * (1 - Math.min(1, since / 60)); root.style.setProperty("--cc", since < 20 ? "#5fd3a2" : since < 45 ? "#ffb14a" : "#ff7a7a"); };
    clock(); const iv = [setInterval(clock, 10000), setInterval(tick, 1000)];
    const stop = () => { iv.forEach(clearInterval); timers.forEach(clearTimeout); };
    const unread = {};
    const restack = () => { const ns = qa(".lk-n.in:not(.gone)").reverse(); ns.forEach((n, k) => { n.style.setProperty("--k", Math.min(k, 3)); n.classList.toggle("old", k > 0); n.classList.toggle("top", k === 0); n.style.visibility = k > 3 ? "hidden" : ""; }); };
    const clear = cb => { const ns = qa(".lk-n"); ns.forEach((n, k) => later(k * 60, () => n.classList.add("gone"))); later(ns.length * 60 + 420, () => { ns.forEach(n => n.remove()); cb && cb(); }); };
    const badge = i => qa(`.lk-row[data-i="${i}"] .bd`).forEach(b => { unread[i] = (unread[i] || 0); b.textContent = unread[i]; b.classList.add("on"); b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); });
    const play = () => { const tok = ++run, p = P[cur.i], st = q(".lk-stack"); st.querySelector(".lk-empty")?.remove();
      const ms = msgs(p); q(".lk-cm").innerHTML = ms.map(m => `<div>${e(m)}</div>`).join("") + `<div class="me">${p.opens ? "Hey " + e(p.name) + " !" : "Coucou toi, ça fait longtemps…"}</div>`;
      if (!ms.length) { since = 0; const em = document.createElement("div"); em.className = "lk-empty"; em.innerHTML = `Aucune notification.<br>${e(p.name)} ne t’a pas écrit depuis 3 semaines :<br>c’est à toi d’ouvrir.`; st.appendChild(em); return; }
      let t = 500; ms.forEach(m => { later(t, () => { if (tok !== run) return; isl.classList.add("ping"); later(1500, () => isl.classList.remove("ping"));
          const n = document.createElement("div"); n.className = "lk-n"; n.innerHTML = `<span class="ic"><b>S</b><i>${e(p.name[0])}</i></span><div><div class="hd2"><span>STELLADS</span><span>maintenant</span></div><strong>${e(p.name)}</strong><p>${e(m)}</p></div>`;
          st.appendChild(n); requestAnimationFrame(() => { n.classList.add("in"); restack(); }); since = 0; unread[cur.i] = (unread[cur.i] || 0) + 1; badge(cur.i); qa(`.lk-row[data-i="${cur.i}"] .pv`).forEach(v => v.textContent = m); });
        t += 1700 + m.length * 18; });
      later(t + 6000, () => { if (tok === run) clear(() => { if (tok === run) play(); }); }); };
    const select = id => { const i = typeof id === "number" ? id : Math.max(0, P.findIndex(p => p.id === id)); const p = P[i]; cur.i = i;
      root.style.setProperty("--fc", ACC[p.id] || "#ededed"); ph.style.setProperty("--pbg", BG[p.id] || "#333");
      qa(".lk-row").forEach(r => { const on = +r.dataset.i === i; r.classList.toggle("on", on); r.setAttribute("aria-pressed", on); });
      unread[i] = 0; qa(`.lk-row[data-i="${i}"] .bd`).forEach(b => b.classList.remove("on"));
      qa("[data-pa]").forEach(a => a.textContent = p.name[0]); q("[data-pn]").textContent = p.name; q("[data-in]").textContent = p.name + " t'écrit…";
      const g = q(".lk-goal"); g.classList.add("sw"); later(240, () => { q("[data-pg]").textContent = p.goal || p.desc || ""; g.classList.remove("sw"); });
      const ch = q(`.lk-chips .lk-row[data-i="${i}"]`); if (ch && ch.parentNode.scrollWidth > ch.parentNode.clientWidth) ch.parentNode.scrollTo({ left: ch.offsetLeft - 4, behavior: "smooth" });
      run++; clear(() => play()); };
    const setDiff = d => { const i = Math.max(0, DIFF.findIndex(x => x[0] === d)); const changed = cur.dif !== DIFF[i][0]; cur.dif = DIFF[i][0];
      qa(".lk-seg button").forEach((b, k) => { b.classList.toggle("on", k === i); b.setAttribute("aria-checked", k === i); }); q(".lk-seg .ind").style.transform = `translateX(${i * 100}%)`; q(".lk-dh").textContent = DIFF[i][2];
      if (changed) { run++; clear(() => play()); } };
    qa(".lk-row").forEach(r => r.addEventListener("click", () => { const i = +r.dataset.i; if (i === cur.i) return; select(i); o.onSelect && o.onSelect(P[i].id); }));
    qa(".lk-seg button").forEach(b => b.addEventListener("click", () => { setDiff(b.dataset.d); o.onDiff && o.onDiff(cur.dif); }));
    // glisser pour répondre = lancer
    const sl = q(".lk-sl"), knob = q(".lk-knob"); let drag = false, x0 = 0, busy = false;
    const max = () => sl.getBoundingClientRect().width - 64;
    const setX = x => { sl.style.setProperty("--x", x + "px"); sl.style.setProperty("--p", (x / Math.max(1, max())).toFixed(3)); };
    const reset = () => { busy = false; ph.classList.remove("unlock"); setX(0); };
    const launch = async () => { if (busy) return; busy = true; setX(max()); ph.classList.add("unlock"); await new Promise(r => setTimeout(r, 750));
      try { await o.onLaunch(); } catch (err) { /* l'erreur est affichée par la page */ } finally { later(400, reset); } };
    knob.addEventListener("pointerdown", ev => { if (busy) return; drag = true; x0 = ev.clientX; sl.classList.add("drag"); knob.setPointerCapture(ev.pointerId); });
    knob.addEventListener("pointermove", ev => { if (drag) setX(Math.max(0, Math.min(max(), ev.clientX - x0))); });
    const up = ev => { if (!drag) return; drag = false; sl.classList.remove("drag"); if (ev.clientX - x0 > max() * .8) launch(); else setX(0); };
    knob.addEventListener("pointerup", up); knob.addEventListener("pointercancel", () => { drag = false; sl.classList.remove("drag"); setX(0); });
    knob.addEventListener("click", ev => { if (ev.detail === 0) launch(); });   // clavier (Entrée / Espace)
    setDiff(cur.dif); select(cur.i);
    el._lk = { select, setDiff, reset, stop };
    return el._lk;
  }
  return { mount };
})();
