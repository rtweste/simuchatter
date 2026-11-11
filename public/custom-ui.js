// Contenus personnalisés : formulaire (déclaration de vente), suivi des demandes, écran « c'est prêt »
window.CUSTOM = (() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const KI = {
    video: '<rect x="3" y="6" width="13" height="12" rx="3"/><path d="M16 10.5l5-3v9l-5-3z"/>',
    photos: '<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-9 8"/>',
    audio: '<path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    autre: '<path d="M12 3l2.2 5.6L20 11l-5.8 2.4L12 19l-2.2-5.6L4 11l5.8-2.4z"/>'
  };
  const LBL = { video: "Vidéo", photos: "Photos", audio: "Audio", autre: "Autre" };
  const svg = (p, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const fmtDur = s => { if (s == null) return ""; const m = Math.floor(s / 60), r = s % 60; return m ? `${m} min${r ? " " + String(r).padStart(2, "0") : ""}` : `${r} s`; };
  const dayFmt = t => new Date(t).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const left = t => { const d = t - Date.now(), a = Math.abs(d), h = Math.floor(a / 3.6e6), j = Math.floor(h / 24);
    const s = j >= 1 ? `${j} j ${h % 24} h` : h >= 1 ? `${h} h ${String(Math.floor(a % 3.6e6 / 6e4)).padStart(2, "0")}` : `${Math.max(1, Math.floor(a / 6e4))} min`; return d < 0 ? `en retard de ${s}` : `dans ${s}`; };

  /* ------------------------------ formulaire ------------------------------ */
  const S = { on: false, kind: "video", dur: 180, qty: 5, due: null, dueKey: "2d", urgent: false };
  const dueOf = k => { const d = new Date(); if (k === "today") { d.setHours(23, 0, 0, 0); return d.getTime(); }
    const n = { "1d": 1, "2d": 2, "3d": 3, "7d": 7 }[k] || 2; d.setDate(d.getDate() + n); d.setHours(20, 0, 0, 0); return d.getTime(); };
  function formHTML() {
    return `<div class="cu"><div class="cu-tg" id="cuTg" role="switch" aria-checked="false" tabindex="0"><span class="ic">${svg(KI.video)}</span><div><b>Contenu personnalisé</b><small>Le fan a commandé un contenu sur mesure</small></div><span class="cu-sw"><i></i></span></div>
      <div class="cu-pn" id="cuPn"><div><div class="cu-in">
        <div class="cu-r" style="--i:0"><div class="cu-lab">Pseudo du fan</div><label class="cu-at"><span>@</span><input id="cuFan" maxlength="60" placeholder="pseudo exact sur Twizz" autocomplete="off"></label></div>
        <div class="cu-r" style="--i:1"><div class="cu-lab">Type de contenu</div><div class="cu-k" id="cuK">${Object.keys(LBL).map(k => `<button type="button" data-k="${k}" class="${k === S.kind ? "on" : ""}">${svg(KI[k], 1.8)}${LBL[k]}</button>`).join("")}</div></div>
        <div class="cu-r" style="--i:2" id="cuDurW"><div class="cu-lab"><span id="cuDurL">Durée</span><em>glisse la règle</em></div>
          <div class="cu-dur" id="cuDur"><div class="v" id="cuDurV"></div><div class="cu-rl"><div class="tr" id="cuTr"></div></div></div>
          <div class="cu-qs" id="cuQs">${[30, 60, 180, 300, 600, 900].map(s => `<button type="button" data-s="${s}">${fmtDur(s)}</button>`).join("")}</div></div>
        <div class="cu-r" style="--i:2" id="cuQtyW" hidden><div class="cu-lab">Nombre de photos</div><div class="cu-ph"><div class="stk" id="cuStk">${"<i></i>".repeat(6)}</div><div class="ctl"><button type="button" data-q="-1" aria-label="Moins">−</button><b id="cuQty"></b><button type="button" data-q="1" aria-label="Plus">+</button></div></div></div>
        <div class="cu-r" style="--i:3"><div class="cu-lab">Livraison au fan</div><div class="cu-dl" id="cuDl">${[["today", "Ce soir"], ["1d", "Demain"], ["2d", "Dans 2 j"], ["3d", "Dans 3 j"], ["7d", "1 semaine"], ["pick", "Choisir…"]].map(([k, l]) => `<button type="button" data-d="${k}" class="${k === S.dueKey ? "on" : ""}">${l}</button>`).join("")}</div>
          <input class="vt-fi dt hidden" id="cuDate" type="datetime-local" aria-label="Date de livraison">
          <div class="cu-due" id="cuDue"></div></div>
        <div class="cu-r" style="--i:4"><div class="cu-lab"><span>La demande du fan</span><em id="cuCnt">0 / 1500</em></div><div class="cu-tx"><textarea id="cuReq" maxlength="1500" placeholder="Ce qu'il veut exactement : tenue, lieu, ce qu'elle dit, prénom à prononcer, ambiance…"></textarea>
          <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" stroke="#262626"/><circle class="f" cx="10" cy="10" r="8" stroke-dasharray="50.3" stroke-dashoffset="50.3"/></svg></div>
          <div class="cu-hint">Décris la demande de façon factuelle. Le manager la reçoit dans le Studio, et la vidéo te revient ici dès qu'elle est prête.</div></div>
      </div></div></div></div>`;
  }
  function drawRuler() {
    const tr = document.getElementById("cuTr"); if (!tr) return; let h = "";
    for (let s = 0; s <= 1200; s += 15) h += `<i class="${s % 60 === 0 ? "M" : s % 30 === 0 ? "m" : ""}">${s % 60 === 0 ? `<b>${s / 60}′</b>` : ""}</i>`;
    tr.innerHTML = h;
  }
  const PX = 8 / 15;   // pixels par seconde
  function setDur(v, anim) {
    S.dur = Math.max(15, Math.min(1200, Math.round(v / 15) * 15)); const tr = document.getElementById("cuTr"); if (!tr) return;
    tr.style.transition = anim && !reduce ? "transform .5s cubic-bezier(.2,.9,.25,1)" : "none"; tr.style.transform = `translateX(${-S.dur * PX - .75}px)`;
    const m = Math.floor(S.dur / 60), r = S.dur % 60;
    document.getElementById("cuDurV").innerHTML = m ? `${m}<small>min</small>${r ? ` ${String(r).padStart(2, "0")}<small>s</small>` : ""}` : `${r}<small>s</small>`;
    document.querySelectorAll("#cuQs button").forEach(b => b.classList.toggle("on", +b.dataset.s === S.dur));
  }
  function setQty(q) {
    S.qty = Math.max(1, Math.min(200, q)); document.getElementById("cuQty").textContent = S.qty;
    const n = Math.min(6, S.qty); document.querySelectorAll("#cuStk i").forEach((el, i) => { const k = i - (n - 1) / 2;
      el.style.opacity = i < n ? 1 : 0; el.style.transform = i < n ? `translateX(${k * 11}px) rotate(${k * 9}deg) translateY(${Math.abs(k) * 2}px)` : "scale(.6)"; el.style.zIndex = i; });
  }
  function setKind(k) {
    S.kind = k; document.querySelectorAll("#cuK button").forEach(b => b.classList.toggle("on", b.dataset.k === k));
    document.querySelector("#cuTg .ic").innerHTML = svg(KI[k]);
    document.getElementById("cuDurW").hidden = !(k === "video" || k === "audio"); document.getElementById("cuQtyW").hidden = k !== "photos";
    document.getElementById("cuDurL").textContent = k === "audio" ? "Durée de l'audio" : "Durée de la vidéo";
  }
  function setDue(key) {
    S.dueKey = key; document.querySelectorAll("#cuDl button").forEach(b => b.classList.toggle("on", b.dataset.d === key));
    const inp = document.getElementById("cuDate"); inp.classList.toggle("hidden", key !== "pick");
    if (key === "pick") { if (!inp.value) { const d = new Date(dueOf("2d")); inp.value = new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); } S.due = new Date(inp.value).getTime(); }
    else S.due = dueOf(key);
    paintDue();
  }
  function paintDue() {
    const el = document.getElementById("cuDue"); if (!el) return; const d = new Date(S.due);
    el.innerHTML = `<span class="cal"><span>${d.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "")}</span><b>${d.getDate()}</b></span><div>Pour <b>${dayFmt(S.due)}</b>${d.getHours() ? " · " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : ""}<br><span style="color:#9a9a9a;font-size:12px">${left(S.due)}</span></div>
      <button type="button" class="cu-urg ${S.urgent ? "on" : ""}" id="cuUrg"><span>🔥</span>Urgent</button>`;
    el.classList.remove("flip"); void el.offsetWidth; el.classList.add("flip");
    document.getElementById("cuUrg").onclick = () => { S.urgent = !S.urgent; document.getElementById("cuUrg").classList.toggle("on", S.urgent); };
  }
  function bindForm() {
    drawRuler(); setDur(S.dur); setQty(S.qty); setKind(S.kind); setDue(S.dueKey);
    const tg = document.getElementById("cuTg"), tog = () => { S.on = !S.on; tg.classList.toggle("on", S.on); tg.setAttribute("aria-checked", S.on); document.getElementById("cuPn").classList.toggle("on", S.on);
      if (S.on) setTimeout(() => { tg.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); }, 250); };
    tg.onclick = tog; tg.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tog(); } };
    document.querySelectorAll("#cuK button").forEach(b => b.onclick = () => setKind(b.dataset.k));
    document.querySelectorAll("#cuQs button").forEach(b => b.onclick = () => setDur(+b.dataset.s, true));
    document.querySelectorAll("#cuQtyW [data-q]").forEach(b => b.onclick = () => setQty(S.qty + +b.dataset.q));
    document.querySelectorAll("#cuDl button").forEach(b => b.onclick = () => setDue(b.dataset.d));
    document.getElementById("cuDate").onchange = e => { S.due = new Date(e.target.value).getTime(); paintDue(); };
    const ta = document.getElementById("cuReq"), ring = document.querySelector(".cu-tx .f");
    ta.oninput = () => { const n = ta.value.length; document.getElementById("cuCnt").textContent = `${n} / 1500`; ring.style.strokeDashoffset = 50.3 * (1 - Math.min(1, n / 1500)); ring.style.stroke = n > 1400 ? "#ff7ab6" : ""; };
    // règle de durée : glisser (avec inertie)
    const dur = document.getElementById("cuDur"); let x0 = null, d0 = 0, vx = 0, lx = 0, lt = 0;
    dur.addEventListener("pointerdown", e => { x0 = e.clientX; d0 = S.dur; lx = e.clientX; lt = performance.now(); vx = 0; dur.setPointerCapture(e.pointerId); });
    dur.addEventListener("pointermove", e => { if (x0 == null) return; const now = performance.now(); vx = (e.clientX - lx) / Math.max(1, now - lt); lx = e.clientX; lt = now; setDur(d0 - (e.clientX - x0) / PX); });
    const up = () => { if (x0 == null) return; x0 = null; if (Math.abs(vx) > .2 && !reduce) setDur(S.dur - vx * 220 / PX, true); };
    dur.addEventListener("pointerup", up); dur.addEventListener("pointercancel", up);
    dur.addEventListener("wheel", e => { e.preventDefault(); setDur(S.dur + Math.sign(e.deltaY || e.deltaX) * 15, true); }, { passive: false });
  }
  function reset() {
    S.on = false; S.urgent = false; const tg = document.getElementById("cuTg"); if (!tg) return; tg.classList.remove("on"); tg.setAttribute("aria-checked", "false"); document.getElementById("cuPn").classList.remove("on");
    document.getElementById("cuFan").value = ""; document.getElementById("cuReq").value = ""; document.getElementById("cuReq").oninput(); setKind("video"); setDur(180); setQty(5); setDue("2d");
  }
  // renvoie null si pas de contenu perso ; lève une erreur si incomplet
  function read() {
    if (!S.on) return null;
    const fan = document.getElementById("cuFan").value.trim().replace(/^@/, ""), request = document.getElementById("cuReq").value.trim();
    if (!fan) { document.getElementById("cuFan").focus(); throw new Error("Contenu perso : indique le pseudo du fan."); }
    if (request.length < 8) { document.getElementById("cuReq").focus(); throw new Error("Contenu perso : décris la demande du fan."); }
    if (!S.due || isNaN(S.due)) throw new Error("Contenu perso : choisis la date de livraison.");
    return { fan, request, kind: S.kind, duration: S.kind === "video" || S.kind === "audio" ? S.dur : null, qty: S.kind === "photos" ? S.qty : null, due_at: S.due, urgent: S.urgent };
  }
  const submit = (saleId, data) => api("/api/customs", { body: { sale_id: saleId, ...data } });

  /* ------------------------------ suivi chatter ------------------------------ */
  const STEPS = ["Demandé", "En prod.", "Prêt", "Envoyé"], IDX = { todo: 0, prod: 1, ready: 2, delivered: 3 };
  const cdChip = c => { if (c.status === "delivered") return `<span class="cu-cd ok"><i></i>envoyé</span>`; if (c.status === "ready") return `<span class="cu-cd ok"><i></i>prêt</span>`;
    if (!c.due_at) return ""; const d = c.due_at - Date.now(); return `<span class="cu-cd ${d < 0 ? "late" : d < 864e5 ? "soon" : ""}"><i></i>${left(c.due_at).replace("dans ", "")}</span>`; };
  const fileUrl = (c, dl) => `/api/customs/${c.id}/file${dl ? "?dl=1" : ""}`;
  const media = c => !c.file ? "" : c.file.mime.startsWith("video") ? `<video src="${fileUrl(c)}#t=0.5" preload="metadata" muted playsinline></video>`
    : c.file.mime.startsWith("image") ? `<img src="${fileUrl(c)}" alt="">` : `<div style="display:grid;place-items:center;height:100%;font-size:30px">${c.file.mime.startsWith("audio") ? "🎧" : "📦"}</div>`;
  function itemHTML(c, i) {
    const k = IDX[c.status] ?? 0, spec = c.kind === "photos" && c.qty ? `${c.qty} photos` : c.duration ? fmtDur(c.duration) : c.kindLabel;
    return `<div class="cu-it ${c.status}" style="--i:${i}" data-cu="${c.id}"><div class="cu-hd"><span class="cu-av">${svg(KI[c.kind] || KI.autre)}<em>${esc(c.model_name[0])}</em></span>
      <div class="t"><b>@${esc(c.fan)}</b><small>${esc(c.model_name)} · ${esc(spec)}${c.amount ? " · " + eur(c.amount) : ""}${c.urgent ? " · 🔥 urgent" : ""}</small></div>${cdChip(c)}</div>
      <div class="cu-rq">${esc(c.request)}</div>
      <div class="cu-tl" style="--p:${k / 3}"><span class="ln"><b style="--p:${k / 3}"></b></span>${STEPS.map((s, j) => `<div class="${j < k || (k === 3 && j === 3) ? "ok" : j === k ? "cur" : ""}"><i></i>${s}</div>`).join("")}</div>
      ${c.mgr_note ? `<div class="cu-note">💬 ${esc(c.mgr_note)}</div>` : ""}
      ${c.status === "ready" || (c.status === "delivered" && c.file) ? `<div class="cu-med"><div class="cu-vid" data-play="${c.id}">${media(c)}<div class="pl"><span>${svg('<path d="M7 4.5v15l12-7.5z" fill="#111" stroke="none"/>')}</span></div></div>
        <div class="cu-act"><a class="dl" href="${fileUrl(c, 1)}" download>${svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>')}Télécharger</a>
        ${c.status === "ready" ? `<button class="snt" data-sent="${c.id}">${svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>')}Envoyé au fan</button><small>Touche quand le fan l'a reçu</small>` : `<small>Envoyé le ${new Date(c.delivered_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</small>`}</div></div>` : ""}
    </div>`;
  }
  let LIST = [];
  async function mountMine(host) {
    let d; try { d = await api("/api/customs/mine"); } catch (e) { return; } const R = { ready: 0, prod: 1, todo: 1, delivered: 3 }; LIST = d.customs.sort((a, b) => (R[a.status] ?? 2) - (R[b.status] ?? 2) || (a.due_at || 9e15) - (b.due_at || 9e15));
    if (!LIST.length) { host.innerHTML = ""; host.hidden = true; return; }
    host.hidden = false;
    host.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h3>Mes contenus <em>perso</em></h3><span class="vt-lab">${d.ready ? `${d.ready} prêt${d.ready > 1 ? "s" : ""} à envoyer` : `${LIST.filter(c => c.status !== "delivered").length} en cours`}</span></div><div class="cu-mine cu">${LIST.map(itemHTML).join("")}</div>`;
    // la ligne de progression se remplit à l'arrivée
    host.querySelectorAll(".cu-tl .ln b").forEach(b => { const p = b.style.getPropertyValue("--p"); b.style.setProperty("--p", 0); requestAnimationFrame(() => requestAnimationFrame(() => b.style.setProperty("--p", p))); });
    host.querySelectorAll("[data-sent]").forEach(b => b.onclick = async () => { b.disabled = true; try { await api(`/api/customs/${b.dataset.sent}/delivered`, { body: {} }); notify("Contenu envoyé", "Bravo, la demande est bouclée ✨", "ok"); mountMine(host); } catch (e) { notify("Erreur", e.message, "err"); b.disabled = false; } });
    host.querySelectorAll("[data-play]").forEach(v => v.onclick = () => { const c = LIST.find(x => x.id === +v.dataset.play); c && reveal(c, true); });
    const fresh = LIST.find(c => c.status === "ready" && !c.seen); if (fresh) setTimeout(() => reveal(fresh), 500);
  }

  /* ------------------------------ écran « c'est prêt » ------------------------------ */
  function reveal(c, replay) {
    const el = document.createElement("div"); el.className = "cu-rv cu";
    const isV = c.file && c.file.mime.startsWith("video"), isI = c.file && c.file.mime.startsWith("image");
    el.innerHTML = `<span class="leak l1"></span><span class="leak l2"></span><div class="strip s1">${"<i></i>".repeat(16)}</div><div class="strip s2">${"<i></i>".repeat(16)}</div>
      <div class="bx"><div class="k">${replay ? "Contenu perso" : "Livraison du Studio"}</div><h2>${replay ? "" : "C'est prêt pour "}<span>@${esc(c.fan)}</span></h2>
      <div class="frame">${isV ? `<video src="${fileUrl(c)}" autoplay muted loop playsinline controls></video>` : isI ? `<img src="${fileUrl(c)}" alt="">` : `<div class="fi">${c.file && c.file.mime.startsWith("audio") ? "🎧" : "📦"}</div>`}<span class="gl"></span></div>
      <div class="meta">${esc(c.model_name)} · ${esc(c.kindLabel)}${c.duration ? " · " + fmtDur(c.duration) : ""}${c.file ? " · " + (c.file.size / 1048576).toFixed(1).replace(".", ",") + " Mo" : ""}</div>
      ${c.mgr_note ? `<div class="cu-note" style="text-align:left">💬 ${esc(c.mgr_note)}</div>` : ""}
      <div class="bt"><button class="ltr">${replay ? "Fermer" : "Plus tard"}</button><a class="dl" href="${fileUrl(c, 1)}" download>Télécharger</a></div></div>`;
    document.body.appendChild(el); requestAnimationFrame(() => el.classList.add("on"));
    const bx = el.querySelector(".bx"), fr = el.querySelector(".frame");
    if (!reduce) { bx.animate([{ opacity: 0, transform: "translateY(40px) scale(.9)", filter: "blur(12px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], { duration: 900, easing: "cubic-bezier(.16,1,.3,1)", fill: "both" });
      fr.animate([{ transform: "perspective(900px) rotateY(-100deg) scale(.7)", opacity: 0 }, { transform: "perspective(900px) rotateY(10deg) scale(1.02)", opacity: 1, offset: .7 }, { transform: "perspective(900px) rotateY(0) scale(1)", opacity: 1 }], { duration: 1300, delay: 250, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" });
      el.addEventListener("pointermove", e => { const r = el.getBoundingClientRect(); fr.style.setProperty("--ry", ((e.clientX / r.width - .5) * 18).toFixed(1) + "deg"); fr.style.setProperty("--rx", (-(e.clientY / r.height - .5) * 14).toFixed(1) + "deg"); }); }
    const close = () => { el.classList.remove("on"); setTimeout(() => el.remove(), 400); };
    el.querySelector(".ltr").onclick = close; el.addEventListener("click", e => { if (e.target === el) close(); });
    if (!c.seen) api(`/api/customs/${c.id}/seen`, { body: {} }).catch(() => {}), c.seen = true;
  }

  return { formHTML, bindForm, reset, read, submit, mountMine, reveal, KI, LBL, fmtDur, left, svg };
})();
