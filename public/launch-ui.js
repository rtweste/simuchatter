// Gestion › Équipe : importer des chatters en une fois (liens d'invitation) + suivi du lancement
window.LAUNCHUI = (() => {
  const N = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const SV = (d, s = 16, w = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"></path></svg>`;
  const UP = "M12 16V4M7 9l5-5 5 5M5 20h14", COPY = "M9 9h11v11H9zM5 15V4h11", LINK = "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1", BELL = "M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0", CHK = "M5 12.5l4.5 4.5L19 7.5", SHARE = "M12 3v12M8 7l4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6";
  let L = null, open = false, RK = null, wrap = null;
  const say = (t, g) => { const el = document.getElementById("toast"); if (!el) return; el.innerHTML = (g ? "✓ " : "") + t; el.classList.toggle("g", !!g); el.classList.add("on"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), 3000); };
  const copy = async t => { try { await navigator.clipboard.writeText(t); return true; } catch (e) { const a = document.createElement("textarea"); a.value = t; document.body.appendChild(a); a.select(); document.execCommand("copy"); a.remove(); return true; } };
  const msg = (u, link) => /bienvenue/.test(link) && TR ? `Salut ${N(u)} ! Voici ton accès à la formation StellADS ✨\n${link}\nTu choisis ton mot de passe et tu commences ta formation tout de suite.` : `Salut ${N(u)} ! On passe sur StellADS 🚀\nTon accès perso (valable 7 jours) : ${link}\nTu choisis ton mot de passe et tu te laisses guider, ça prend 1 minute.`;
  let TR = false;
  const ring = (v, tot, lab, col, i) => { const p = tot ? v / tot : 0, r = 26, c = 2 * Math.PI * r;
    return `<div class="lc-k" style="animation-delay:${i * .06}s"><svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="${r}" fill="none" stroke="#1f1f1f" stroke-width="6"/><circle class="lc-arc" cx="32" cy="32" r="${r}" fill="none" stroke="${col}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${c.toFixed(1)}" data-o="${(c * (1 - p)).toFixed(1)}" transform="rotate(-90 32 32)"/></svg><div><b>${v}<small> / ${tot}</small></b><span>${lab}</span></div></div>`; };
  function card() {
    const t = L.totals, pending = L.people.filter(p => !p.joined), late = L.people.filter(p => p.joined && !p.notifs);
    return `<div class="card lc rl" id="launchCard"><div class="ch"><h3>Lancement <em>de l’équipe</em></h3><div style="display:flex;gap:8px;flex-wrap:wrap">${["founder", "manager"].includes(RK) ? `<button class="gbtn" data-imp>${SV(UP)}Importer des chatters</button>` : ""}<button class="sb" data-tog>${open ? "Masquer la liste" : "Voir qui en est où"}</button></div></div>
      <div class="lc-ks">${ring(t.joined, t.accounts, "comptes activés", "#ededed", 0)}${ring(t.onboarded, t.accounts, "configurés", "#9be8c6", 1)}${ring(t.notifs, t.accounts, "notifications", "#5fd3a2", 2)}${ring(t.installed, t.accounts, "appli installée", "#b8a4ff", 3)}</div>
      ${!L.push ? '<div class="lc-warn">Les notifications ne sont pas encore prêtes sur le serveur.</div>' : ""}
      ${pending.length || late.length ? `<div class="lc-sum">${pending.length ? `<span><b>${pending.length}</b> pas encore venu${pending.length > 1 ? "s" : ""}</span>` : ""}${late.length ? `<span><b>${late.length}</b> sans notifications</span>` : ""}${pending.length && ["founder", "manager"].includes(RK) ? `<button class="sb w" data-relance>Copier les relances</button>` : ""}</div>` : '<div class="lc-sum ok"><span>Tout le monde est prêt ✨</span></div>'}
      ${open ? `<div class="lc-list">${L.people.map((p, i) => { const st = !p.joined ? (p.expired ? ["r", "Lien expiré"] : p.noInvite ? ["r", "Pas de lien"] : ["w", "Invité"]) : !p.onboarded ? ["w", "Activé"] : p.notifs ? ["v", "Prêt"] : ["w", "Sans notifications"];
        return `<div class="lc-p" style="animation-delay:${Math.min(.4, i * .03)}s"><span class="av">${esc(p.username[0].toUpperCase())}</span><div style="min-width:0;flex:1"><b>${esc(N(p.username))}${p.role === "trainee" ? ' <span class="rb e">Élève</span>' : p.tl ? ' <span class="rb t">Team Leader</span>' : ""}</b>
          <div class="lc-steps"><i class="${p.joined ? "ok" : ""}" title="Compte activé"></i><i class="${p.onboarded ? "ok" : ""}" title="Configuré"></i><i class="${p.installed ? "ok" : ""}" title="Appli installée"></i><i class="${p.notifs ? "ok" : ""}" title="Notifications"></i></div></div>
          <span class="tag ${st[0]}">${st[1]}</span>${["founder", "manager"].includes(RK) ? `<button class="sb" data-inv="${p.id}" title="Nouveau lien d’invitation">${SV(LINK, 14)}</button>` : ""}</div>`; }).join("") || '<div class="mut">Aucun chatter pour l’instant.</div>'}</div>
        <div class="lc-leg"><span><i class="ok"></i>activé</span><span><i class="ok"></i>configuré</span><span><i class="ok"></i>appli</span><span><i class="ok"></i>notifications</span></div>` : ""}</div>`;
  }
  function draw() {
    const host = document.querySelector('.pane[data-p="team"]'); if (!host || !L) return;
    const old = document.getElementById("launchCard"); const html = card();
    if (old) old.outerHTML = html; else host.insertAdjacentHTML("afterbegin", html);
    const c = document.getElementById("launchCard");
    requestAnimationFrame(() => c.querySelectorAll(".lc-arc").forEach(a => a.style.strokeDashoffset = a.dataset.o));
    c.querySelector("[data-tog]").onclick = () => { open = !open; draw(); };
    c.querySelector("[data-imp]")?.addEventListener("click", sheet);
    c.querySelector("[data-relance]")?.addEventListener("click", relance);
    c.querySelectorAll("[data-inv]").forEach(b => b.onclick = () => invite(+b.dataset.inv, b));
  }
  async function load() { try { RK = window.RK; fxButton(); L = await api("/api/admin/launch"); draw(); } catch (e) {} }
  /* ---------- comptes formation express ---------- */
  const QR = "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM18 18h3v3h-3zM14 20h2M20 14v2", LIST = "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01", FULL = "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5";
  function fxButton() { if (!["founder", "manager"].includes(window.RK) || document.getElementById("fxBtn")) return; const ab = document.getElementById("addBtn"); if (!ab) return;
    ab.insertAdjacentHTML("beforebegin", `<button class="gbtn" id="fxBtn" style="margin-left:auto;margin-right:8px">${SV(QR)}Comptes formation</button>`); document.getElementById("fxBtn").onclick = () => express(); }
  let FX = null, fxPoll = null;
  async function express(tab) {
    wrap?.remove(); clearInterval(fxPoll); wrap = document.createElement("div"); wrap.className = "lc-wrap";
    wrap.innerHTML = `<div class="scrim on"></div><div class="sheet on rl lc-sh fx" role="dialog" aria-modal="true" aria-label="Comptes formation"><div class="shd"><b>Comptes <em>formation</em></b><button class="x" aria-label="Fermer">✕</button></div>
      <div class="tb2 full" data-fxt><span class="ind"></span><button class="on" data-t="s">${SV(QR, 15)}Session d’entretien</button><button data-t="l">${SV(LIST, 15)}Liste de prénoms</button></div><div class="fx-body"></div></div>`;
    (document.getElementById("root") || document.body).appendChild(wrap);
    const close = () => { clearInterval(fxPoll); wrap.querySelector(".sheet").classList.remove("on"); wrap.querySelector(".scrim").classList.remove("on"); setTimeout(() => { wrap?.remove(); wrap = null; }, 400); };
    wrap.querySelector(".scrim").onclick = close; wrap.querySelector(".x").onclick = close;
    const tb = wrap.querySelector("[data-fxt]"), ind = tb.querySelector(".ind"), bs = [...tb.querySelectorAll("button")];
    const mv = b => { ind.style.width = b.offsetWidth + "px"; ind.style.transform = `translateX(${b.offsetLeft - 3}px)`; };
    bs.forEach(b => b.onclick = () => { bs.forEach(x => x.classList.toggle("on", x === b)); mv(b); b.dataset.t === "s" ? sessTab() : listTab(); });
    setTimeout(() => mv(bs[0]), 50);
    try { FX = (await api("/api/admin/trainee-sessions")).session; } catch (e) { FX = null; }
    sessTab();
  }
  const left = ms => { const m = Math.max(0, Math.round((ms - Date.now()) / 60000)); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`; };
  function sessTab() {
    clearInterval(fxPoll); const box = wrap.querySelector(".fx-body");
    if (!FX || FX.closed) {
      box.innerHTML = `<p class="mut" style="line-height:1.55;font-size:13px;margin:14px 0 4px">Pour vos entretiens à la chaîne : affiche ce QR code (ou envoie le lien dans le groupe). Chaque candidat crée lui-même son compte élève avec son prénom, en 30 secondes. Tu vois les comptes arriver en direct.</p>
        <div class="fl"><span class="lab">DURÉE DE LA SESSION</span><div class="chs tx" data-h><button data-v="2">2 h</button><button class="on" data-v="3">3 h</button><button data-v="5">5 h</button><button data-v="8">Journée</button></div></div>
        <div class="fl"><span class="lab">NOMBRE DE COMPTES MAX</span><div class="chs tx" data-m><button data-v="10">10</button><button class="on" data-v="25">25</button><button data-v="40">40</button><button data-v="60">60</button></div></div>
        <button class="send" data-open>Ouvrir la session</button>`;
      box.querySelectorAll("[data-h] button, [data-m] button").forEach(b => b.onclick = () => b.parentElement.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)));
      box.querySelector("[data-open]").onclick = async e => { e.target.disabled = true;
        try { FX = await api("/api/admin/trainee-sessions", { body: { hours: +box.querySelector("[data-h] .on").dataset.v, max: +box.querySelector("[data-m] .on").dataset.v } }); say("Session ouverte · affiche le QR code ou envoie le lien", true); sessTab(); }
        catch (x) { say(esc(x.message)); e.target.disabled = false; } };
      return;
    }
    const seen = new Set(FX.users.map(u => u.id));
    box.innerHTML = `<div class="fx-live"><div class="fx-qr"><img src="/api/admin/trainee-sessions/${FX.token}/qr.svg" alt="QR code de la session"><span class="fx-scan"></span></div>
        <div class="fx-info"><span class="tag v live"><i></i>Session ouverte</span><b class="fx-n"><span data-n>${FX.users.length}</span><small> / ${FX.max} comptes</small></b><span class="mut" data-left>Ferme dans ${left(FX.expiresAt)}</span>
          <div class="fx-link"><span>${esc(FX.link.replace(/^https?:\/\//, ""))}</span><button class="sb" data-cp>${SV(COPY, 14)}</button></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="sb" data-big>${SV(FULL, 14)} Afficher en grand</button><button class="sb r" data-close>Fermer la session</button></div></div></div>
      <div class="lab" style="margin:16px 0 8px">COMPTES CRÉÉS</div><div class="fx-list" data-list>${FX.users.map(u => fxRow(u)).join("") || '<div class="mut fx-empty">En attente des premiers candidats…</div>'}</div>`;
    box.querySelector("[data-cp]").onclick = async () => { await copy(FX.link); say("Lien copié · colle-le dans le groupe de l’entretien", true); };
    box.querySelector("[data-close]").onclick = async () => { if (!confirm("Fermer la session ? Le lien et le QR code ne marcheront plus.")) return; await api(`/api/admin/trainee-sessions/${FX.token}/close`, { body: {} }).catch(() => {}); FX.closed = true; say(`Session fermée · ${FX.users.length} compte${FX.users.length > 1 ? "s" : ""} créé${FX.users.length > 1 ? "s" : ""}`, true); sessTab(); };
    box.querySelector("[data-big]").onclick = () => big();
    fxPoll = setInterval(async () => { if (!wrap) return clearInterval(fxPoll);
      try { const d = await api(`/api/admin/trainee-sessions/${FX.token}`); FX = d; const list = box.querySelector("[data-list]"); if (!list) return;
        box.querySelector("[data-n]").textContent = d.users.length; box.querySelector("[data-left]").textContent = d.closed ? "Session terminée" : `Ferme dans ${left(d.expiresAt)}`;
        d.users.filter(u => !seen.has(u.id)).reverse().forEach(u => { seen.add(u.id); list.querySelector(".fx-empty")?.remove(); list.insertAdjacentHTML("afterbegin", fxRow(u, true)); say(`${esc(u.username)} vient de créer son compte`, true); });
        const bg = document.querySelector(".fx-big [data-n]"); if (bg) bg.textContent = d.users.length;
        if (d.closed) { clearInterval(fxPoll); sessTab(); } } catch (e) {} }, 4000);
  }
  const fxRow = (u, nw) => `<div class="lc-l${nw ? " fx-new" : ""}"><span class="av">${esc(u.username[0].toUpperCase())}</span><div style="min-width:0;flex:1"><b>${esc(u.username)}</b><small>Compte élève créé à ${new Date(u.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</small></div><span class="tag v">Élève</span></div>`;
  function big() {
    const o = document.createElement("div"); o.className = "fx-big"; o.innerHTML = `<div class="fx-bq"><img src="/api/admin/trainee-sessions/${FX.token}/qr.svg" alt="QR code"></div><div class="fx-bt"><span>Scanne pour créer ton compte formation</span><b><span data-n>${FX.users.length}</span> / ${FX.max}</b><small>${esc(FX.link.replace(/^https?:\/\//, ""))}</small></div><button aria-label="Fermer">✕</button>`;
    document.body.appendChild(o); requestAnimationFrame(() => o.classList.add("on"));
    const c = () => { o.classList.remove("on"); setTimeout(() => o.remove(), 350); }; o.querySelector("button").onclick = c; o.onclick = e => { if (e.target === o) c(); };
  }
  function listTab() {
    clearInterval(fxPoll); const box = wrap.querySelector(".fx-body");
    box.innerHTML = `<div class="lc-form"><div class="fl"><label class="lab" for="fxNames" style="display:block">PRÉNOMS · UN PAR LIGNE</label><textarea class="ta" id="fxNames" rows="7" placeholder="Sarah&#10;Lucas&#10;Emma&#10;…"></textarea><div class="mut" style="margin-top:6px">Chaque élève reçoit un lien perso pour choisir son mot de passe. Pratique si tu as déjà la liste de l’entretien.</div></div>
      <button class="send" data-go>Créer les comptes élèves</button></div><div class="lc-res" style="display:none"></div>`;
    box.querySelector("[data-go]").onclick = async e => { e.target.disabled = true; e.target.textContent = "Création…";
      try { const r = await api("/api/admin/invites/bulk", { body: { names: box.querySelector("#fxNames").value, role: "trainee" } }); TR = true; results(r); }
      catch (x) { say(esc(x.message)); e.target.disabled = false; e.target.textContent = "Créer les comptes élèves"; } };
  }
  async function invite(id, b) {
    b.disabled = true; try { const r = await api("/api/admin/invites/" + id, { body: {} }); await copy(msg(r.username, r.link)); say(`Nouveau lien pour ${esc(N(r.username))} copié · colle-le dans votre conversation`, true); load(); } catch (e) { say(esc(e.message)); } b.disabled = false; }
  async function relance() {
    const ps = L.people.filter(p => !p.joined); if (!ps.length) return;
    if (!confirm(`Créer un nouveau lien pour ${ps.length} personne${ps.length > 1 ? "s" : ""} et copier les messages de relance ? Les anciens liens ne marcheront plus.`)) return;
    const out = []; for (const p of ps) { try { const r = await api("/api/admin/invites/" + p.id, { body: {} }); out.push(msg(r.username, r.link)); } catch (e) {} }
    await copy(out.join("\n\n")); say(`${out.length} relance${out.length > 1 ? "s" : ""} copiée${out.length > 1 ? "s" : ""} · colle-les sur Discord`, true); load();
  }
  /* ---------- import ---------- */
  async function sheet() {
    let teams = [], models = [];
    try { const [r, m] = await Promise.all([api("/api/admin/roles"), api("/api/models")]); teams = r.teams; models = m; } catch (e) {}
    wrap?.remove(); wrap = document.createElement("div"); wrap.className = "lc-wrap";
    wrap.innerHTML = `<div class="scrim on"></div><div class="sheet on rl lc-sh" role="dialog" aria-modal="true" aria-label="Importer des chatters"><div class="shd"><b>Importer des <em>chatters</em></b><button class="x" aria-label="Fermer">✕</button></div>
      <div class="lc-form"><div class="fl"><label class="lab" for="lcNames" style="display:block">PSEUDOS · UN PAR LIGNE</label><textarea class="ta" id="lcNames" rows="7" placeholder="karim&#10;ines&#10;yanis&#10;…"></textarea><div class="mut" id="lcCount" style="margin-top:6px">Colle la liste de tes chatters Discord : chacun reçoit un lien perso pour choisir son mot de passe.</div></div>
        ${teams.length ? `<div class="fl" data-teamf><span class="lab">TEAM LEADER (FACULTATIF)</span><div class="chs tx" data-team><button class="on" data-v="">Aucun</button>${teams.map(t => `<button data-v="${t.id}">Équipe ${esc(N(t.username))}</button>`).join("")}</div></div>` : ""}
        ${models.length ? `<div class="fl"><span class="lab">CRÉATRICES HABITUELLES (FACULTATIF)</span><div class="chs tx" data-mod>${models.map(m => `<button data-v="${m.id}">${esc(m.name)}</button>`).join("")}</div><div class="mut" style="margin-top:6px">Sinon, chacun choisit les siennes à sa première connexion.</div></div>` : ""}
        <button class="send" data-go>Créer les comptes</button></div><div class="lc-res" style="display:none"></div></div>`;
    (document.getElementById("root") || document.body).appendChild(wrap);
    const close = () => { wrap.querySelector(".sheet").classList.remove("on"); wrap.querySelector(".scrim").classList.remove("on"); setTimeout(() => { wrap.remove(); wrap = null; }, 400); load(); };
    wrap.querySelector(".scrim").onclick = close; wrap.querySelector(".x").onclick = close;
    const ta = wrap.querySelector("#lcNames"), cnt = wrap.querySelector("#lcCount"); setTimeout(() => ta.focus(), 300);
    ta.oninput = () => { const n = ta.value.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).length; cnt.textContent = n ? `${n} compte${n > 1 ? "s" : ""} à créer` : "Colle la liste de tes chatters Discord : chacun reçoit un lien perso pour choisir son mot de passe."; };
    wrap.querySelectorAll("[data-team] button").forEach(b => b.onclick = () => b.parentElement.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)));
    wrap.querySelectorAll("[data-mod] button").forEach(b => b.onclick = () => b.classList.toggle("on"));
    wrap.querySelector("[data-go]").onclick = async e => {
      const role = "chatter", team = (wrap.querySelector("[data-team] .on") || {}).dataset?.v || null;
      e.target.disabled = true; e.target.textContent = "Création…";
      try { TR = false; const r = await api("/api/admin/invites/bulk", { body: { names: ta.value, role, team, models: [...wrap.querySelectorAll("[data-mod] .on")].map(b => +b.dataset.v) } }); results(r); }
      catch (x) { say(esc(x.message)); e.target.disabled = false; e.target.textContent = "Créer les comptes"; } };
  }
  function results(r) {
    const ok = r.results.filter(x => x.link), ko = r.results.filter(x => !x.link), box = wrap.querySelector(".lc-res");
    wrap.querySelector(".lc-form").style.display = "none"; box.style.display = "block"; wrap.querySelector("[data-fxt]")?.style.setProperty("display", "none");
    box.innerHTML = `<div class="lc-done"><span class="ic">${SV(CHK, 22, 3)}</span><div><b>${ok.length} compte${ok.length > 1 ? "s" : ""} créé${ok.length > 1 ? "s" : ""}</b><small>Envoie à chacun son lien perso (valable ${r.days} jours)</small></div></div>
      ${ok.length ? `<button class="send" data-all style="margin-top:12px">${SV(COPY)} Copier tous les messages</button>` : ""}
      <div class="lc-links">${ok.map((x, i) => `<div class="lc-l" style="animation-delay:${Math.min(.5, i * .04)}s"><span class="av">${esc(x.username[0].toUpperCase())}</span><div style="min-width:0;flex:1"><b>${esc(x.username)}</b><small>${esc(x.link.replace(/^https?:\/\//, ""))}</small></div><button class="sb" data-c="${i}" aria-label="Copier le message de ${esc(x.username)}">${SV(COPY, 14)}</button>${navigator.share ? `<button class="sb" data-s="${i}" aria-label="Partager">${SV(SHARE, 14)}</button>` : ""}</div>`).join("")}
      ${ko.map(x => `<div class="lc-l ko"><span class="av">!</span><div style="min-width:0;flex:1"><b>${esc(x.username || x.input)}</b><small>${esc(x.error)}</small></div>${x.existing ? `<button class="sb" data-ex="${x.existing}">Nouveau lien</button>` : ""}</div>`).join("")}</div>
      <button class="gbtn" data-fin style="width:100%;margin-top:12px">Terminer</button>`;
    box.querySelector("[data-all]")?.addEventListener("click", async () => { await copy(ok.map(x => msg(x.username, x.link)).join("\n\n")); say("Messages copiés · colle-les sur Discord", true); });
    box.querySelectorAll("[data-c]").forEach(b => b.onclick = async () => { const x = ok[+b.dataset.c]; await copy(msg(x.username, x.link)); b.innerHTML = SV(CHK, 14, 3); say(`Message pour ${esc(x.username)} copié`, true); });
    box.querySelectorAll("[data-s]").forEach(b => b.onclick = () => { const x = ok[+b.dataset.s]; navigator.share({ text: msg(x.username, x.link) }).catch(() => {}); });
    box.querySelectorAll("[data-ex]").forEach(b => b.onclick = () => invite(+b.dataset.ex, b));
    box.querySelector("[data-fin]").onclick = () => wrap.querySelector(".scrim").click();
  }
  return { load };
})();
