// Gestion › Équipe : importer des chatters en une fois (liens d'invitation) + suivi du lancement
window.LAUNCHUI = (() => {
  const N = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const SV = (d, s = 16, w = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"></path></svg>`;
  const UP = "M12 16V4M7 9l5-5 5 5M5 20h14", COPY = "M9 9h11v11H9zM5 15V4h11", LINK = "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1", BELL = "M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0", CHK = "M5 12.5l4.5 4.5L19 7.5", SHARE = "M12 3v12M8 7l4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6";
  let L = null, open = false, RK = null, wrap = null;
  const say = (t, g) => { const el = document.getElementById("toast"); if (!el) return; el.innerHTML = (g ? "✓ " : "") + t; el.classList.toggle("g", !!g); el.classList.add("on"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), 3000); };
  const copy = async t => { try { await navigator.clipboard.writeText(t); return true; } catch (e) { const a = document.createElement("textarea"); a.value = t; document.body.appendChild(a); a.select(); document.execCommand("copy"); a.remove(); return true; } };
  const msg = (u, link) => `Salut ${N(u)} ! On passe sur StellADS 🚀\nTon accès perso (valable 7 jours) : ${link}\nTu choisis ton mot de passe et tu te laisses guider, ça prend 1 minute.`;
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
  async function load() { try { RK = window.RK; L = await api("/api/admin/launch"); draw(); } catch (e) {} }
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
        <div class="fl"><span class="lab">RÔLE</span><div class="chs tx" data-role><button class="on" data-v="chatter">Chatter</button><button data-v="trainee">Élève en formation</button></div></div>
        ${teams.length ? `<div class="fl" data-teamf><span class="lab">TEAM LEADER (FACULTATIF)</span><div class="chs tx" data-team><button class="on" data-v="">Aucun</button>${teams.map(t => `<button data-v="${t.id}">Équipe ${esc(N(t.username))}</button>`).join("")}</div></div>` : ""}
        ${models.length ? `<div class="fl"><span class="lab">CRÉATRICES HABITUELLES (FACULTATIF)</span><div class="chs tx" data-mod>${models.map(m => `<button data-v="${m.id}">${esc(m.name)}</button>`).join("")}</div><div class="mut" style="margin-top:6px">Sinon, chacun choisit les siennes à sa première connexion.</div></div>` : ""}
        <button class="send" data-go>Créer les comptes</button></div><div class="lc-res" style="display:none"></div></div>`;
    (document.getElementById("root") || document.body).appendChild(wrap);
    const close = () => { wrap.querySelector(".sheet").classList.remove("on"); wrap.querySelector(".scrim").classList.remove("on"); setTimeout(() => { wrap.remove(); wrap = null; }, 400); load(); };
    wrap.querySelector(".scrim").onclick = close; wrap.querySelector(".x").onclick = close;
    const ta = wrap.querySelector("#lcNames"), cnt = wrap.querySelector("#lcCount"); setTimeout(() => ta.focus(), 300);
    ta.oninput = () => { const n = ta.value.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).length; cnt.textContent = n ? `${n} compte${n > 1 ? "s" : ""} à créer` : "Colle la liste de tes chatters Discord : chacun reçoit un lien perso pour choisir son mot de passe."; };
    wrap.querySelectorAll("[data-role] button, [data-team] button").forEach(b => b.onclick = () => { b.parentElement.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
      if (b.parentElement.dataset.role !== undefined) { const tf = wrap.querySelector("[data-teamf]"); if (tf) tf.style.display = b.dataset.v === "trainee" ? "none" : ""; } });
    wrap.querySelectorAll("[data-mod] button").forEach(b => b.onclick = () => b.classList.toggle("on"));
    wrap.querySelector("[data-go]").onclick = async e => {
      const role = wrap.querySelector("[data-role] .on").dataset.v, team = role === "chatter" ? (wrap.querySelector("[data-team] .on") || {}).dataset?.v || null : null;
      e.target.disabled = true; e.target.textContent = "Création…";
      try { const r = await api("/api/admin/invites/bulk", { body: { names: ta.value, role, team, models: [...wrap.querySelectorAll("[data-mod] .on")].map(b => +b.dataset.v) } }); results(r); }
      catch (x) { say(esc(x.message)); e.target.disabled = false; e.target.textContent = "Créer les comptes"; } };
  }
  function results(r) {
    const ok = r.results.filter(x => x.link), ko = r.results.filter(x => !x.link), box = wrap.querySelector(".lc-res");
    wrap.querySelector(".lc-form").style.display = "none"; box.style.display = "block";
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
