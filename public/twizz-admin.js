// Réglages fondateur : carte « Twizz » (connexion au CRM, créatrices, ventes automatiques)
(() => {
  let D = null, EL = null, busy = false;
  const E = n => (Math.round(n * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const T = ms => new Date(ms).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const ago = ms => { const m = Math.round((Date.now() - ms) / 60e3); return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : T(ms); };
  const ST = { imported: ["Commission", "#5fd3a2"], no_chatter: ["Sans chatter", "#f0b54a"], ca_only: ["CA agence", "#9aa"], before_auto: ["Avant activation", "#777"], refund: ["Remboursée", "#e07a7a"], free: ["Gratuit", "#666"], pending: ["…", "#777"] };
  const css = `<style>.twz .pill{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;font:800 11px Inter,sans-serif;letter-spacing:.04em}
.twz .row2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0}
.twz .sec{font:800 10.5px Inter,sans-serif;letter-spacing:.14em;color:#6f6f6f;text-transform:uppercase;margin:16px 0 8px}
.twz .map{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #1c1c1c;font-size:13px}.twz .map b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.twz select{height:34px;border-radius:10px;border:1px solid #2a2a2a;background:#141414;color:#eee;font:600 12.5px Inter,sans-serif;padding:0 8px;max-width:200px}
.twz .ty{display:flex;flex-wrap:wrap;gap:6px}.twz .ty label{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:10px;border:1px solid #2a2a2a;background:#141414;font:700 12.5px Inter,sans-serif;color:#bbb;cursor:pointer}
.twz .ty label.on{border-color:rgba(95,211,162,.5);background:rgba(95,211,162,.1);color:#fff}
.twz .sw{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;border:1px solid #262626;background:#121212;margin-top:12px}
.twz .sw button{margin-left:auto;width:50px;height:28px;border-radius:999px;border:0;background:#2a2a2a;position:relative;cursor:pointer;flex:none}.twz .sw button i{position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#888;transition:.2s}
.twz .sw button.on{background:#5fd3a2}.twz .sw button.on i{left:25px;background:#fff}.twz .sw button[disabled]{opacity:.4;cursor:not-allowed}
.twz .tx{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #1a1a1a;font-size:12.5px;color:#bbb}.twz .tx .n{margin-left:auto;font-weight:800;color:#fff;white-space:nowrap}
.twz .tx small{color:#777}.twz .warn{padding:12px 14px;border-radius:14px;background:rgba(240,181,74,.08);border:1px solid rgba(240,181,74,.35);font-size:13px;line-height:1.5;color:#e9d6b0}
.twz .err{padding:12px 14px;border-radius:14px;background:rgba(224,122,122,.08);border:1px solid rgba(224,122,122,.4);font-size:13px;line-height:1.5;color:#f1c4c4;margin-top:10px}
.twz .nc{padding:10px 0;border-bottom:1px solid #1c1c1c;font-size:12.5px}.twz .nc .a{display:flex;gap:6px;margin-top:6px}.twz .nc .a button{height:32px;border-radius:9px;border:1px solid #2a2a2a;background:#1a1a1a;color:#ddd;font:700 12px Inter,sans-serif;padding:0 10px;cursor:pointer}</style>`;
  function card() {
    if (!D) return `<div class="card twz" style="--d:.15s"><div class="ch"><h3>Connexion <em>Twizz</em></h3></div><div class="mut" style="padding:16px 0">Chargement…</div></div>`;
    const st = D.status || {}, ok = st.ok === true, mapped = D.creators.filter(c => c.model_id).length;
    const pill = !D.configured ? ["Pas configuré", "#f0b54a"] : st.ok === true ? ["Connecté", "#5fd3a2"] : st.ok === false ? ["Erreur", "#e07a7a"] : ["Jamais testé", "#999"];
    const paused = st.pausedUntil && st.pausedUntil > Date.now();
    return css + `<div class="card twz" id="twizz" style="--d:.15s"><div class="ch"><h3>Connexion <em>Twizz</em></h3><span class="pill" style="background:${pill[1]}22;color:${pill[1]}">● ${pill[0]}</span></div>
      <div class="mut" style="line-height:1.5">Le site lit les ventes de chaque créatrice sur ton CRM Twizz Business (lecture seule, une requête toutes les quelques secondes au plus, toutes les ${D.syncMin} min).</div>
      ${!D.configured ? `<div class="warn" style="margin-top:12px"><b>Étape 1 :</b> sur Railway → ton service → <b>Variables</b>, ajoute <code>TWIZZ_EMAIL</code> et <code>TWIZZ_PASSWORD</code> (les identifiants de ton CRM Twizz Business). Railway redémarre le site, puis reviens ici et clique « Tester la connexion ».</div>` : ""}
      ${st.ok === false && st.error ? `<div class="err"><b>Dernière erreur</b> (${ago(st.at)}) : ${esc(st.error)}${paused ? `<br>Pause automatique jusqu'à ${T(st.pausedUntil).split(" ").pop()} pour ne pas insister.` : ""}</div>` : ""}
      <div class="row2"><button class="bkb g" data-tw="test" type="button" ${D.configured ? "" : "disabled"}>Tester la connexion</button><button class="bkb" data-tw="sync" type="button" ${ok && mapped ? "" : "disabled"}>Synchroniser maintenant</button></div>
      ${st.lastSync ? `<div class="mut">Dernière synchro : ${ago(st.lastSync)} · aujourd'hui : <b style="color:#fff">${D.today.n} vente${D.today.n > 1 ? "s" : ""} · ${E(D.today.net)} net</b></div>` : ""}
      ${D.creators.length ? `<div class="sec">Créatrices Twizz → créatrices du site</div>${D.creators.map(c => `<div class="map"><b>${esc(c.label)}</b><select data-map="${esc(c.twizz_id)}"><option value="">— Ne pas importer —</option>${D.models.map(m => `<option value="${m.id}" ${m.id === c.model_id ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></div>`).join("")}` : ""}
      <div class="sec">Ventes qui donnent une commission au chatter</div>
      <div class="ty">${Object.entries(D.typeLabels).map(([k, l]) => `<label class="${D.types.includes(k) ? "on" : ""}"><input type="checkbox" data-ty="${k}" ${D.types.includes(k) ? "checked" : ""} hidden>${esc(l)}</label>`).join("")}</div>
      <div class="mut" style="margin-top:6px">Les autres ventes comptent dans le CA de l'agence, sans commission.</div>
      <div class="sw"><div><b style="font-size:13.5px">Ventes automatiques</b><div class="mut" style="margin-top:2px;line-height:1.45">${D.on ? `Activées depuis le ${T(D.since)}. Chaque vente arrive toute seule : au chatter qui a envoyé le PPV depuis la messagerie, sinon au chatter en shift sur la créatrice, sinon au CA de l'agence. La compta du mois se remplit depuis Twizz. Les chatters ne déclarent plus que les contenus perso et les Snap.` : ok && mapped ? "À l'activation, les ventes et la compta se font toutes seules. Le CA du mois en cours est repris depuis le 1er ; les commissions ne comptent que les ventes faites après l'activation (pas de doublon avec les ventes déjà déclarées)." : "Teste d'abord la connexion et associe au moins une créatrice."}</div></div>
        <button type="button" data-tw="on" class="${D.on ? "on" : ""}" ${D.on || (ok && mapped) ? "" : "disabled"} aria-label="Ventes automatiques"><i></i></button></div>
      ${D.noChatter.length ? `<div class="sec">Ventes sans chatter pointé (${D.noChatter.length})</div>${D.noChatter.slice(0, 8).map(t => `<div class="nc"><b>${esc(t.model || "?")}</b> · ${E(t.net)} net · ${T(t.at)} · ${esc(t.fan_name || "fan")}
        <div class="a"><select data-as="${esc(t.id)}"><option value="">Choisir le chatter…</option>${D.chatters.map(u => `<option value="${u.id}">${esc(u.username)}</option>`).join("")}</select><button data-asgo="${esc(t.id)}">Attribuer</button><button data-asnone="${esc(t.id)}">Laisser au CA</button></div></div>`).join("")}` : ""}
      ${D.tx.length ? `<div class="sec">Dernières transactions</div>${D.tx.slice(0, 10).map(t => { const s = ST[t.state] || ["?", "#777"]; return `<div class="tx"><span style="color:${s[1]};font-weight:800;font-size:11px;width:92px;flex:none">${s[0]}</span><span>${esc(t.model || "?")} · ${esc(D.typeLabels[t.type] || t.type)}${t.username ? ` · <b style="color:#fff">${esc(t.username)}</b>` : ""}<br><small>${T(t.at)}</small></span><span class="n">${E(t.net)}</span></div>`; }).join("")}` : ""}
    </div>`;
  }
  async function act(fn, okMsg) { if (busy) return; busy = true; try { D = await fn(); paint(); if (okMsg) notify(okMsg, "", "ok"); } catch (e) { notify("Twizz", e.message, "err"); await load(); } finally { busy = false; } }
  function paint() {
    if (!EL || !EL.isConnected) return; EL.innerHTML = card();
    const b = s => EL.querySelector(s);
    b('[data-tw="test"]')?.addEventListener("click", e => { e.target.textContent = "Connexion en cours…"; act(async () => { const r = await api("/api/admin/twizz/test", { body: {} }); notify("Connexion Twizz réussie ✓", `${r.account} · ${r.creators} créatrice${r.creators > 1 ? "s" : ""}`, "ok"); return r; }); });
    b('[data-tw="sync"]')?.addEventListener("click", e => { e.target.textContent = "Synchro…"; act(async () => { const r = await api("/api/admin/twizz/sync", { body: {} }); notify("Synchro terminée", r.added ? `${r.added} nouvelle${r.added > 1 ? "s" : ""} transaction${r.added > 1 ? "s" : ""}` : "Rien de nouveau", "ok"); return r; }); });
    b('[data-tw="on"]')?.addEventListener("click", () => { const on = !D.on;
      if (on && !confirm("Activer les ventes automatiques ?\n\nChaque vente Twizz faite à partir de maintenant sera ajoutée toute seule, et la compta du mois se remplira depuis Twizz. Les chatters ne déclareront plus que les contenus perso et les Snap.")) return;
      if (!on && !confirm("Couper les ventes automatiques ? Les chatters devront de nouveau déclarer leurs ventes, et la compta se saisira de nouveau à la main.")) return;
      act(() => api("/api/admin/twizz/config", { body: { on } }), on ? "Ventes automatiques activées" : "Ventes automatiques coupées"); });
    EL.querySelectorAll("[data-map]").forEach(s => s.onchange = () => act(() => api("/api/admin/twizz/map", { body: { twizz_id: s.dataset.map, model_id: s.value ? +s.value : null } }), "Créatrice associée"));
    EL.querySelectorAll("[data-ty]").forEach(c => c.parentElement.onclick = e => { e.preventDefault(); const t = c.dataset.ty, L = D.types.includes(t) ? D.types.filter(x => x !== t) : [...D.types, t];
      act(() => api("/api/admin/twizz/config", { body: { types: L } })); });
    EL.querySelectorAll("[data-asgo]").forEach(bt => bt.onclick = () => { const v = EL.querySelector(`[data-as="${CSS.escape(bt.dataset.asgo)}"]`).value; if (!v) return notify("Choisis un chatter", "", "info");
      act(() => api(`/api/admin/twizz/tx/${encodeURIComponent(bt.dataset.asgo)}/assign`, { body: { user_id: +v } }), "Vente attribuée"); });
    EL.querySelectorAll("[data-asnone]").forEach(bt => bt.onclick = () => act(() => api(`/api/admin/twizz/tx/${encodeURIComponent(bt.dataset.asnone)}/assign`, { body: { none: true } }), "Laissée au CA de l'agence"));
  }
  async function load() { try { D = await api("/api/admin/twizz"); } catch (e) {} paint(); }
  window.TWZ = { mount(el) { EL = el; if (!el) return; if (D) paint(); else { paint(); load(); } } };
})();
