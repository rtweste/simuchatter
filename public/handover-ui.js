// Passation de shift : fenêtre de fin de shift + carte reçue par le chatter suivant
const HANDOVER = window.HANDOVER = (() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const CK = '<svg viewBox="0 0 24 24" width="13" height="13"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const TONE = { media: "o", relance: "g", paid: "g", sensible: "r", big: "g" };
  const ago = ms => { const m = Math.round((Date.now() - ms) / 6e4); return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`; };
  const DKEY = "stHandDraft";
  const draftGet = mid => { try { const d = JSON.parse(localStorage.getItem(DKEY) || "null"); return d && d.mid === mid && Date.now() - d.t < 864e5 ? d : null; } catch (e) { return null; } };
  const draftSet = (mid, items, note) => { try { localStorage.setItem(DKEY, JSON.stringify({ mid, items, note, t: Date.now() })); } catch (e) {} };
  const draftClear = () => { try { localStorage.removeItem(DKEY); } catch (e) {} };

  /* ---------- fin de shift ----------
     Renvoie une promesse : true = terminer le shift (passation envoyée ou « rien à signaler »), false = annulé */
  async function beforeOut() {
    let H; try { H = await api("/api/handover"); } catch (e) { return true; }
    if (!H.current) return true;
    const cur = H.current, d = draftGet(cur.model_id);
    let items = d ? d.items : [], note = d ? d.note : "";
    return new Promise(resolve => {
      const root = document.createElement("div"); root.className = "ho"; root.setAttribute("role", "dialog");
      const nx = cur.next ? `Envoyé à <b>${esc(cur.next.username)}</b> · shift ${esc(cur.next.start)}` : "Visible par le prochain chatter sur " + esc(cur.model);
      root.innerHTML = `<div class="ho-sc"></div><div class="ho-bx"><span class="ho-handle"></span>
        <div class="ho-hd"><span class="ho-av">${esc(cur.model[0])}</span><div><h3>Passation de <em>shift</em></h3><small>${esc(cur.model)} · le prochain chatter verra ces notes en arrivant</small></div><button class="ho-x" aria-label="Annuler">✕</button></div>
        <div class="ho-bd"><div class="ho-lab"><span>FANS À SUIVRE</span><span data-n></span></div><div data-list></div>
          <button class="ho-add" type="button">＋ Ajouter un fan</button>
          <div class="ho-lab" style="margin-top:6px"><span>MOT POUR LE PROCHAIN CHATTER · FACULTATIF</span></div>
          <textarea class="ho-tx ho-gen" maxlength="600" placeholder="Ambiance du shift, story postée, chose à savoir…">${esc(note)}</textarea></div>
        <div class="ho-ft"><button class="ho-sk" type="button" data-skip>Rien à signaler</button><small>${nx}</small><button class="ho-go" type="button" data-go>Terminer le shift →</button></div></div>`;
      document.body.appendChild(root); document.body.style.overflow = "hidden";
      const list = root.querySelector("[data-list]"), gen = root.querySelector(".ho-gen");
      const save = () => draftSet(cur.model_id, items, note);
      const paint = () => {
        root.querySelector("[data-n]").textContent = items.length ? `${items.length} fan${items.length > 1 ? "s" : ""}` : "";
        root.querySelector("[data-go]").textContent = items.length || note.trim() ? "Envoyer et terminer →" : "Terminer le shift →";
      };
      const row = (it, k, fresh) => {
        const el = document.createElement("div"); el.className = "ho-fan" + (it.prio ? " hot" : "");
        el.innerHTML = `<div class="r1"><input class="ho-nm" maxlength="40" placeholder="Pseudo du fan" value="${esc(it.fan)}"><button type="button" class="ho-star" aria-label="Prioritaire" title="Prioritaire">★</button><button type="button" class="ho-del" aria-label="Retirer">✕</button></div>
          <div class="ho-tags">${Object.entries(H.tags).map(([t, l]) => `<button type="button" data-t="${t}" class="${TONE[t] || "g"}${it.tags.includes(t) ? " on" : ""}">${esc(l)}</button>`).join("")}</div>
          <textarea class="ho-tx" maxlength="400" placeholder="Ce que le prochain doit savoir sur lui…">${esc(it.note)}</textarea>`;
        const nm = el.querySelector(".ho-nm"), ta = el.querySelector("textarea");
        nm.oninput = () => { it.fan = nm.value; save(); };
        ta.oninput = () => { it.note = ta.value; ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight + 2) + "px"; save(); };
        el.querySelector(".ho-star").onclick = () => { it.prio = !it.prio; el.classList.toggle("hot", it.prio); save(); };
        el.querySelectorAll("[data-t]").forEach(b => b.onclick = () => { const t = b.dataset.t; it.tags = it.tags.includes(t) ? it.tags.filter(x => x !== t) : [...it.tags, t]; b.classList.toggle("on"); save(); });
        el.querySelector(".ho-del").onclick = () => { items = items.filter(x => x !== it); save(); paint();
          if (!reduce && el.animate) el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(30px)" }], { duration: 250, fill: "forwards" }).onfinish = () => el.remove(); else el.remove(); };
        list.appendChild(el);
        if (fresh) { if (!reduce && el.animate) el.animate([{ opacity: 0, transform: "translateY(-8px) scale(.98)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: "cubic-bezier(.34,1.56,.64,1)" }); nm.focus(); }
      };
      const add = () => { const it = { fan: "", tags: [], note: "", prio: false }; items.push(it); row(it, items.length - 1, true); paint(); };
      items.forEach((it, k) => row(it, k)); if (!items.length) add(); paint();
      root.querySelector(".ho-add").onclick = add;
      gen.oninput = () => { note = gen.value; save(); paint(); };
      requestAnimationFrame(() => root.classList.add("on"));
      const end = ok => { root.classList.remove("on"); root.classList.add("out"); document.body.style.overflow = ""; setTimeout(() => root.remove(), 380); resolve(ok); };
      root.querySelector(".ho-x").onclick = () => end(false);
      root.querySelector(".ho-sc").onclick = () => end(false);
      root.querySelector("[data-skip]").onclick = () => { draftClear(); end(true); };
      root.querySelector("[data-go]").onclick = async e => {
        const b = e.currentTarget, filled = items.filter(i => i.fan.trim());
        if (items.some(i => !i.fan.trim() && (i.note.trim() || i.tags.length))) { const bad = [...list.children][items.findIndex(i => !i.fan.trim() && (i.note.trim() || i.tags.length))]; bad?.querySelector(".ho-nm").focus(); bad?.classList.add("shk"); setTimeout(() => bad?.classList.remove("shk"), 500); return; }
        b.disabled = true; b.classList.add("busy");
        try { if (filled.length || note.trim()) await api("/api/handover", { body: { items: filled, note } }); draftClear(); end(true); }
        catch (er) { b.disabled = false; b.classList.remove("busy"); alert(er.message); }
      };
    });
  }

  /* ---------- carte reçue par le chatter suivant (accueil) ---------- */
  let last = null;
  async function inbox(host) {
    if (!host) return; let H; try { H = await api("/api/handover"); } catch (e) { return; }
    document.querySelectorAll(".hoc").forEach(x => x.remove());
    const ib = H.inbox; if (!ib || !ib.items.length && !ib.note) return;
    const c = document.createElement("section"); c.className = "hoc" + (last === ib.handover_id ? "" : " new"); last = ib.handover_id;
    const tag = t => `<span class="${TONE[t] || "g"}">${esc(H.tags[t] || t)}</span>`;
    const paint = () => {
      const open = ib.items.filter(i => !i.done).length;
      c.innerHTML = `<div class="hd"><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4-4 4"/><path d="M21 7H9a4 4 0 0 0-4 4v1"/><path d="M7 21l-4-4 4-4"/><path d="M3 17h12a4 4 0 0 0 4-4v-1"/></svg></span>
          <div><h3>Passation de <em>${esc(ib.from || "l'équipe")}</em></h3><small>${esc(ib.model)}${ib.at ? " · laissée " + ago(ib.at) : ""}</small></div>${ib.items.length ? `<span class="cnt${open ? "" : " ok"}">${ib.items.length - open} / ${ib.items.length} suivi${ib.items.length - open > 1 ? "s" : ""}</span>` : ""}</div>
        ${ib.note ? `<div class="gen">${esc(ib.note)}</div>` : ""}
        <div class="ls">${ib.items.map(i => `<div class="it${i.prio ? " hot" : ""}${i.done ? " done" : ""}" data-id="${i.id}" role="checkbox" aria-checked="${i.done}" tabindex="0"><span class="ck">${CK}</span><div><b>${esc(i.fan)}</b><span class="tg">${i.tags.map(tag).join("")}${i.prio ? '<span class="g">★ Prioritaire</span>' : ""}${i.old ? `<span class="x">de ${esc(i.from)} · ${ago(i.at)}</span>` : ""}</span>${i.note ? `<p>${esc(i.note)}</p>` : ""}</div></div>`).join("")}</div>
        <div class="ft"><span>${open ? "Coche un fan quand tu t'en es occupé" : "Tous les fans sont suivis 👌"}</span><button type="button" data-ok>Tout est noté ✓</button></div>`;
      c.querySelectorAll(".it").forEach(el => { const go = async () => { const i = ib.items.find(x => x.id === +el.dataset.id); i.done = !i.done; paint();
          try { await api(`/api/handover/items/${i.id}`, { body: { done: i.done } }); } catch (e) { i.done = !i.done; paint(); } };
        el.onclick = go; el.onkeydown = e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); go(); } }; });
      c.querySelector("[data-ok]").onclick = async () => { if (ib.handover_id) api("/api/handover/seen", { body: { handover_id: ib.handover_id } }).catch(() => {});
        if (ib.items.some(i => !i.done && i.prio) && !c.dataset.sure) { c.dataset.sure = 1; c.querySelector("[data-ok]").textContent = "Il reste un prioritaire · confirmer"; return; }
        if (!reduce && c.animate) c.animate([{ opacity: 1, transform: "none", maxHeight: c.offsetHeight + "px" }, { opacity: 0, transform: "scale(.98)", maxHeight: "0px", marginBottom: "0px", paddingTop: "0px", paddingBottom: "0px" }], { duration: 420, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" }).onfinish = () => c.remove(); else c.remove(); };
    };
    paint(); host.parentNode.insertBefore(c, host);
  }
  return { beforeOut, inbox };
})();
