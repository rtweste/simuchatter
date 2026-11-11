// « Demande à StellADS » : l'assistant des chatters (bulle en bas à droite, sur toutes les pages)
(() => {
  if (window.ASSIST) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const KEY = "stAssist", load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || "[]"); } catch (e) { return []; } }, save = m => { try { sessionStorage.setItem(KEY, JSON.stringify(m.slice(-20))); } catch (e) {} };
  let msgs = load(), open = false, busy = false, root;
  const SUG = ["Comment déclarer une vente ?", "Combien je gagne cette quinzaine ?", "Quand est mon prochain shift ?", "Combien j'ai de points de sanction ?", "Il me manque combien pour le palier suivant ?"];
  const SPARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';
  const md = t => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
  function mount(me) {
    window.ASSIST = true;
    root = document.createElement("div"); root.className = "as";
    root.innerHTML = `<button class="as-fab" type="button" aria-label="Demande à StellADS">${SPARK}<span class="as-ping"></span></button>
      <section class="as-panel" role="dialog" aria-label="Demande à StellADS"><header><span class="as-ic">${SPARK}</span><div><b>Demande à <em>StellADS</em></b><small>Réponses à partir des règles de l'agence et de tes chiffres</small></div><button class="as-x" aria-label="Fermer">✕</button></header>
        <div class="as-list" aria-live="polite"></div><div class="as-sug"></div>
        <form class="as-in"><textarea rows="1" maxlength="600" placeholder="Pose ta question…"></textarea><button aria-label="Envoyer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6l6 6-6 6"/></svg></button></form></section>`;
    document.body.appendChild(root);
    const fab = root.querySelector(".as-fab"), panel = root.querySelector(".as-panel"), list = root.querySelector(".as-list"), ta = root.querySelector("textarea"), form = root.querySelector("form");
    try { if (!localStorage.getItem("stAssistSeen")) root.classList.add("new"); } catch (e) {}
    const toggle = v => { open = v ?? !open; root.classList.toggle("open", open); if (open) { root.classList.remove("new"); try { localStorage.setItem("stAssistSeen", "1"); } catch (e) {} paint(); setTimeout(() => ta.focus(), 250); } };
    fab.onclick = () => toggle(); root.querySelector(".as-x").onclick = () => toggle(false);
    document.addEventListener("keydown", e => { if (e.key === "Escape" && open) toggle(false); });
    function paint(anim) {
      list.innerHTML = msgs.length ? "" : `<div class="as-hello"><span class="as-big">${SPARK}</span><b>Salut ${esc(me.username)} 👋</b><p>Je réponds à tes questions sur l'agence : ventes, paie, planning, sanctions, règles… Si je ne sais pas, je transmets au manager.</p></div>`;
      msgs.forEach((m, i) => { const el = document.createElement("div"); el.className = "as-m " + (m.role === "user" ? "me" : "bot") + (anim && i === msgs.length - 1 ? " pop" : "");
        el.innerHTML = m.role === "user" ? md(m.content) : `${md(m.content)}${m.err ? "" : `<div class="as-act">${m.sent ? '<span class="ok">✓ Transmis au manager</span>' : `<button data-esc="${i}">Transmettre au manager</button>`}</div>`}`; list.appendChild(el); });
      if (busy) { const t = document.createElement("div"); t.className = "as-m bot typing"; t.innerHTML = "<i></i><i></i><i></i>"; list.appendChild(t); }
      list.scrollTop = list.scrollHeight;
      list.querySelectorAll("[data-esc]").forEach(b => b.onclick = async () => { const i = +b.dataset.esc, q = (msgs.slice(0, i).reverse().find(m => m.role === "user") || {}).content || "";
        b.disabled = true; try { await api("/api/assistant/escalate", { body: { question: q, id: msgs[i].id } }); msgs[i].sent = true; save(msgs); paint(); } catch (e) { b.disabled = false; } });
      root.querySelector(".as-sug").innerHTML = msgs.length > 1 ? "" : SUG.map(s => `<button type="button">${esc(s)}</button>`).join("");
      root.querySelectorAll(".as-sug button").forEach(b => b.onclick = () => ask(b.textContent));
    }
    async function ask(q) {
      q = q.trim(); if (!q || busy) return; msgs.push({ role: "user", content: q }); busy = true; ta.value = ""; fit(); save(msgs); paint(true);
      try { const r = await api("/api/assistant", { body: { history: msgs.filter(m => !m.err).map(m => ({ role: m.role, content: m.content })) } }); msgs.push({ role: "assistant", content: r.answer, id: r.id }); }
      catch (e) { msgs.push({ role: "assistant", content: e.message || "Je n'arrive pas à répondre pour le moment.", err: true }); }
      busy = false; save(msgs); paint(true);
    }
    const fit = () => { ta.style.height = "auto"; ta.style.height = Math.min(120, ta.scrollHeight) + "px"; };
    ta.oninput = fit; ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(ta.value); } };
    form.onsubmit = e => { e.preventDefault(); ask(ta.value); };
  }
  window.ASSIST_MOUNT = mount;
})();
