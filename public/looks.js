// Cosmétiques Stella's : appliqués partout où un membre apparaît (chat, carte de profil, classement, ventes).
// Les éléments portent l'id du membre (data-uid / data-lk-uid) ; on ajoute les classes au fil des affichages.
window.LOOKS = (() => {
  let MAP = {}, ready = false, t = 0;
  const FR = { frame_halo: "halo", frame_aurora: "aurora", frame_crown: "crown" }, NM = { name_gold: "gold", name_ice: "ice" };
  const of = uid => MAP[uid] || null;
  async function load() {
    try { const c = JSON.parse(sessionStorage.getItem("lk") || "null"); if (c && Date.now() - c.t < 60e3) { MAP = c.m; ready = true; apply(document); } } catch (e) {}
    try { const r = await fetch("/api/stellas/looks", { credentials: "same-origin" }); if (r.ok) { MAP = await r.json(); ready = true; try { sessionStorage.setItem("lk", JSON.stringify({ t: Date.now(), m: MAP })); } catch (e) {} apply(document); } } catch (e) {}
  }
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function frame(el, uid, pc) {
    const l = of(uid), f = l && FR[l.frame], pre = pc ? "lk-pc-" : "lk-fr-";
    [...el.classList].filter(c => c.startsWith(pre) || (!pc && c === "lk-fr")).forEach(c => el.classList.remove(c));
    if (f) { if (!pc) el.classList.add("lk-fr"); el.classList.add(pre + f); }
  }
  function name(el, uid) {
    const l = of(uid), n = l && NM[l.name];
    el.classList.remove("lk-n-gold", "lk-n-ice"); if (n) el.classList.add("lk-n-" + n);
    const nx = el.nextElementSibling, cur = nx && nx.classList.contains("lk-title") ? nx : null, want = l && l.title && !el.closest(".ct-stk") ? l.title : "";
    if (cur && cur.textContent === want) return;   // déjà à jour : on ne touche pas la page (sinon l'observateur repartirait en boucle)
    if (cur) cur.remove(); if (want) el.insertAdjacentHTML("afterend", `<span class="lk-title">${esc(want)}</span>`);
  }
  function apply(root) {
    if (!ready || !root || !root.querySelectorAll) return;
    root.querySelectorAll(".gut[data-uid] .ct-av").forEach(a => frame(a, a.closest(".gut").dataset.uid));
    root.querySelectorAll("[data-lk-uid]").forEach(a => frame(a, a.dataset.lkUid));
    root.querySelectorAll("b.pc-n[data-uid]").forEach(b => name(b, b.dataset.uid));
    root.querySelectorAll("[data-lk-name]").forEach(b => name(b, b.dataset.lkName));
    root.querySelectorAll(".pcd[data-uid]").forEach(c => { const uid = c.dataset.uid, l = of(uid);
      const av = c.querySelector(".pc-av"); if (av) frame(av, uid, true);
      const bn = c.querySelector(".pc-ban"); if (bn) bn.classList.toggle("lk-bn-nebula", !!(l && l.banner === "banner_nebula"));
      const nm = c.querySelector("[data-pcn]"); if (nm) { nm.classList.remove("lk-n-gold", "lk-n-ice"); if (l && NM[l.name]) nm.classList.add("lk-n-" + NM[l.name]); }
      const old = c.querySelector(".lk-title.pc"), want = l && l.title ? l.title : "";
      if (!(old && old.textContent === want) && !(!old && !want)) { if (old) old.parentElement.remove();
        const hd = c.querySelector(".pc-hd"); if (hd && want) hd.insertAdjacentHTML("afterend", `<div style="margin:8px 0 2px"><span class="lk-title pc" style="margin:0">${esc(want)}</span></div>`); } });
    root.querySelectorAll(".ct-sale[data-suid]").forEach(s => { const l = of(s.dataset.suid); s.classList.toggle("lk-stars", !!(l && l.fx === "fx_stars")); });
  }
  // nouvelles portions de page : on applique après chaque rendu
  const mo = new MutationObserver(ms => { if (!ready) return; clearTimeout(t); t = setTimeout(() => apply(document), 30); });
  const start = () => { mo.observe(document.body, { childList: true, subtree: true }); load(); };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
  return { of, apply, reload: () => { try { sessionStorage.removeItem("lk"); } catch (e) {} return load(); }, stars: uid => { const l = of(uid); return !!(l && l.fx === "fx_stars"); } };
})();
