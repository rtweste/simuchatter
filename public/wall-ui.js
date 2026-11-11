// Mur des meilleures ventes de la semaine (accueil)
const WALL = window.WALL = (() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const eur = n => (Math.round(n * 100) / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " €";
  const MED = ["🥇", "🥈", "🥉"];
  async function mount(host, isAdmin) {
    if (!host) return; let d; try { d = await api("/api/wall"); } catch (e) { return; }
    document.querySelectorAll(".wl").forEach(x => x.remove());
    const c = document.createElement("section"); c.className = "wl an"; setTimeout(() => c.classList.remove("an"), 1400);
    const paint = () => {
      c.innerHTML = `<div class="wl-h"><div><h3>Les plus belles ventes <em>de la semaine</em></h3><small>Le top ${d.items.length || 6} des ventes validées depuis lundi · partage ta technique, l'équipe apprend</small></div><span class="wl-tr">🏆</span></div>
        ${d.items.length ? `<div class="wl-l">${d.items.map((s, i) => `<article class="wl-c${i < 3 ? " top" : ""}${s.mine ? " mine" : ""}" style="--i:${i}" data-id="${s.id}">
          <div class="wl-r"><span class="md">${MED[i] || "#" + s.rank}</span><span class="am">${eur(s.amount)}</span>${isAdmin ? `<button class="hd" data-hide title="Retirer du mur">✕</button>` : ""}</div>
          <div class="wl-w"><b>${esc(s.username)}</b> · ${esc(s.model_name)}${s.mine ? ' <span class="me">toi</span>' : ""}</div>
          ${s.tech ? `<p class="wl-q">« ${esc(s.tech)} »</p>` : s.mine ? `<div class="wl-in"><input maxlength="160" placeholder="Comment tu l'as vendue ? En une phrase"><button data-tech>Partager</button></div>` : `<p class="wl-q no">Technique pas encore partagée</p>`}
          <button class="wl-k${s.liked ? " on" : ""}" data-kudo aria-label="Bravo"><span>🔥</span><b>${s.kudos || ""}</b></button></article>`).join("")}</div>`
        : `<div class="wl-e">Pas encore de vente validée cette semaine. La première ouvre le mur !</div>`}`;
      c.querySelectorAll(".wl-c").forEach(a => { const id = +a.dataset.id;
        a.querySelector("[data-kudo]").onclick = async e => { const b = e.currentTarget; if (!reduce) { b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); fire(b); }
          try { d = (await api(`/api/wall/${id}/kudo`, { body: {} })).wall; setTimeout(paint, 380); } catch (er) {} };
        const t = a.querySelector("[data-tech]"); if (t) { const inp = a.querySelector(".wl-in input"); const go = async () => { try { d = (await api(`/api/wall/${id}/tech`, { body: { text: inp.value } })).wall; paint(); } catch (er) { inp.placeholder = er.message; inp.value = ""; } };
          t.onclick = go; inp.onkeydown = e => { if (e.key === "Enter") go(); }; }
        const h = a.querySelector("[data-hide]"); if (h) h.onclick = async () => { if (!h.dataset.sure) { h.dataset.sure = 1; h.textContent = "Retirer ?"; return; } try { d = (await api(`/api/admin/wall/${id}/hide`, { body: {} })).wall; paint(); } catch (er) {} };
      });
    };
    paint(); host.parentNode.insertBefore(c, host.nextSibling);
  }
  // petites flammes qui s'envolent du bouton
  function fire(b) { const r = b.getBoundingClientRect(); for (let i = 0; i < 6; i++) { const f = document.createElement("span"); f.className = "wl-f"; f.textContent = "🔥"; f.style.left = (r.left + r.width / 2) + "px"; f.style.top = (r.top + r.height / 2) + "px"; document.body.appendChild(f);
    const dx = (Math.random() - .5) * 80, dy = -50 - Math.random() * 60; f.animate([{ transform: "translate(-50%,-50%) scale(.6)", opacity: 1 }, { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.1)`, opacity: 0 }], { duration: 700 + Math.random() * 300, easing: "cubic-bezier(.2,.9,.25,1)" }).onfinish = () => f.remove(); } }
  return { mount };
})();
