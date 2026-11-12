// Accueil : Wrapped du mois prêt, « Mes recrues » (team leader), « Ton team leader » (recrue)
const TEAMUI = window.TEAMUI = (() => {
  const eur = n => Math.round(n || 0).toLocaleString("fr-FR") + " €";
  const ago = ms => { if (!ms) return "jamais"; const d = Math.floor((Date.now() - ms) / 864e5); return d < 1 ? "aujourd'hui" : d === 1 ? "hier" : `il y a ${d} j`; };
  async function mount(host, me) {
    if (!host || !me || me.role === "admin") return;
    document.querySelectorAll(".tlx,.wrx").forEach(x => x.remove());
    // 1) Wrapped prêt (en haut de l'accueil)
    try { const r = await api("/api/wrapped/ready"); if (r.ready) { const c = document.createElement("a"); c.className = "wrx"; c.href = "/wrapped?m=" + r.month;
      c.innerHTML = `<span class="g"></span><span class="e">🎁</span><div><b>Ton Wrapped de ${esc(r.label.split(" ")[0])} est prêt</b><small>${eur(r.total)} vendus · découvre ton mois en story</small></div><span class="go">Voir →</span>`;
      host.parentNode.insertBefore(c, host); } } catch (e) {}
    // 2) team leader
    let d; try { d = await api("/api/team-lead"); } catch (e) { return; }
    const after = el => host.parentNode.insertBefore(el, host.nextSibling);
    if (d.leader) { const unseen = d.tips.filter(t => !t.seen).length, c = document.createElement("section"); c.className = "tlx me";
      c.innerHTML = `<div class="hd"><span class="ic">🧭</span><div><h3>Ton team leader : <em>${esc(d.leader.username)}</em></h3><small>Il t'accompagne pendant tes débuts. Pose-lui tes questions !</small></div>${unseen ? `<span class="nw">${unseen} nouveau${unseen > 1 ? "x" : ""}</span>` : ""}</div>
        ${d.tips.length ? `<div class="tips">${d.tips.map(t => `<div class="${t.seen ? "" : "un"}"><span>💬</span><p>${esc(t.text)}<small>${ago(t.at)}</small></p></div>`).join("")}</div>` : `<div class="mut0">Pas encore de conseil : ${esc(d.leader.username)} t'en laissera ici.</div>`}`;
      after(c); if (unseen) setTimeout(() => api("/api/team-lead/seen", { body: {} }).catch(() => {}), 2500); }
    if (me.rk === "tl") { const c = document.createElement("a"); c.className = "tlx tlgo"; c.href = "/equipe";
      c.innerHTML = `<div class="hd"><span class="ic">🧭</span><div><h3>Tu es <em>Team Leader</em></h3><small>Ventes, shifts, pauses, formation et alertes de ton équipe, avec conseils, entraînements et renforts en un geste.</small></div><span class="nw" style="background:#ededed;color:#0a0a0a">Mon équipe →</span></div>`;
      after(c); }
    else if (d.recruits.length) { const c = document.createElement("section"); c.className = "tlx";
      c.innerHTML = `<div class="hd"><span class="ic">🧭</span><div><h3>Mes <em>recrues</em></h3><small>Tu es team leader : aide-les à atteindre <b>${eur(d.target)}</b> de ventes nettes sur une quinzaine → <b>+${eur(d.prime)}</b> de prime pour toi</small></div></div>
        <div class="rl">${d.recruits.map(r => { const pct = Math.min(100, Math.round(r.goal.net / Math.max(1, r.goal.target) * 100));
          return `<div class="rc" data-id="${r.id}"><div class="r1"><span class="av">${esc(r.username[0].toUpperCase())}</span><div><b>${esc(r.username)}</b><small>${r.role === "trainee" ? (r.training ? `en formation · ${r.training.done}/${r.training.total} critères` : "en formation") : `chatter · dernier shift ${ago(r.lastShift)}`}</small></div>${r.goal.done ? '<span class="ok">🎉 Objectif atteint</span>' : ""}</div>
            ${r.role === "chatter" ? `<div class="gl"><span>Objectif · ${eur(r.goal.net)} / ${eur(r.goal.target)}</span><i><em style="width:${r.goal.done ? 100 : pct}%"></em></i></div>` : ""}
            <div class="st"><span><b>${eur(r.sales14)}</b> vendus · 14 j</span><span class="${r.refused14 ? "w" : ""}"><b>${r.refused14}</b> refusée${r.refused14 > 1 ? "s" : ""}</span><span class="${r.late14 + r.abs14 ? "w" : ""}"><b>${r.late14 + r.abs14}</b> retard${r.late14 + r.abs14 > 1 ? "s" : ""}/abs.</span></div>
            <div class="in"><input maxlength="400" placeholder="Laisser un conseil à ${esc(r.username)}…"><button>Envoyer</button></div>
            ${r.tips.length ? `<small class="lt">Dernier conseil ${ago(r.tips[0].at)} : « ${esc(r.tips[0].text)} »${r.tips[0].seen ? " · lu ✓" : ""}</small>` : ""}</div>`; }).join("")}</div>`;
      after(c);
      c.querySelectorAll(".rc").forEach(rc => { const inp = rc.querySelector("input"), b = rc.querySelector(".in button");
        const send = async () => { const t = inp.value.trim(); if (t.length < 3) return inp.focus(); b.disabled = true;
          try { await api("/api/team-lead/tip", { body: { recruitId: +rc.dataset.id, text: t } }); inp.value = ""; b.textContent = "✓ Envoyé"; setTimeout(() => { b.textContent = "Envoyer"; b.disabled = false; }, 1600); mount(host, me); } catch (e) { b.disabled = false; } };
        b.onclick = send; inp.onkeydown = e => { if (e.key === "Enter") send(); }; }); }
  }
  return { mount };
})();
