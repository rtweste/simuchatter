// Alertes du shift en cours, pour les managers : pauses trop longues, chatters qui n'ont pas pointé, shifts à reprendre,
// échanges à valider, renforts sans réponse, aides fan sans réponse, ventes et contenus perso qui attendent.
module.exports = function mount(app, db, auth, admin, ctx) {
  const { planning, gest } = ctx;
  const AG = () => { try { return gest.agency(); } catch (e) { return {}; } };
  const has = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const mins = ms => Math.max(0, Math.round(ms / 60000));
  const dur = m => m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? " " + String(m % 60).padStart(2, "0") : ""}`;
  const parisDate = ms => new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const day = ms => new Date(ms).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", timeZone: "Europe/Paris" });
  const hm = ms => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

  function alerts() {
    const now = Date.now(), a = AG(), out = [];
    const push = (o) => out.push({ lvl: 1, ...o });
    // 1. pauses qui dépassent la durée autorisée
    if (has("pauses")) {
      const max = +a.pauseMax || 15;
      db.prepare(`SELECT p.id, p.start_at, p.bonus, u.username, u.id uid FROM pauses p JOIN users u ON u.id = p.user_id JOIN clocks c ON c.id = p.clock_id
        WHERE p.end_at IS NULL AND c.end_at IS NULL`).all().forEach(p => {
        const m = mins(now - p.start_at); if (m < max + (p.bonus || 0)) return;
        push({ key: "pause:" + p.id, kind: "pause", lvl: m >= max * 1.5 ? 2 : 1, at: p.start_at + max * 60000, who: p.username,
          title: `${p.username} est en pause depuis ${dur(m)}`, sub: `Maximum autorisé : ${max} min`, actions: [{ label: "Lui écrire", href: "/chat" }] });
      });
    }
    // 1 bis. en shift mais pas dans le salon vocal (obligatoire)
    try { if (ctx.voice) ctx.voice.missing().forEach(c => push({ key: "voice:" + c.user_id + ":" + c.start_at, kind: "voice", at: c.start_at + 5 * 60e3, who: c.username,
      title: `${c.username} n'est pas dans le salon vocal`, sub: `En shift depuis ${dur(mins(now - c.start_at))}`, actions: [{ label: "Lui écrire", href: "/chat" }] })); } catch (e) {}
    // 2. shifts commencés sans pointage, 3. échanges à reprendre ou à valider, 4. renforts demandés sans réponse
    try {
      const today = parisDate(now), thr = +a.missedAlert || 10;
      planning.decorate(db.prepare(`${planning.SHIFT_SQL} WHERE s.date BETWEEN ? AND ?`).all(addDays(today, -1), today))
        .filter(s => s.state === "missing" && s.late >= thr && !(s.swap && s.swap.status === "open")).forEach(s => {
          push({ key: "miss:" + s.id, kind: "late", lvl: s.late >= 30 ? 2 : 1, at: s.start_ms + thr * 60000, who: s.username,
            title: `${s.username} n'a pas pointé`, sub: `${s.model_name} · shift de ${s.start} · ${dur(s.late)} de retard`,
            actions: [{ label: "Demander un renfort", post: "/api/admin/help", body: { shift_id: s.id }, done: "Renfort demandé" }, { label: "Planning", href: "/planning" }] });
        });
      db.prepare(`SELECT w.*, s.date, s.start, s.end, m.name model_name, f.username from_name, t.username to_name FROM shift_swaps w JOIN shifts s ON s.id = w.shift_id
        JOIN models m ON m.id = s.model_id JOIN users f ON f.id = w.from_user LEFT JOIN users t ON t.id = w.to_user WHERE w.status IN ('open','requested')`).all().forEach(w => {
        const st = planning.shiftSpan(w)[0], left = st - now; if (left < -3.6e6) return;
        if (w.status === "open") { if (left > 12 * 3.6e6) return;
          push({ key: "swapo:" + w.id, kind: "swap", lvl: left < 2 * 3.6e6 ? 2 : 1, at: w.created_at, who: w.from_name,
            title: left > 0 ? `Shift à reprendre dans ${dur(mins(left))}` : "Shift commencé sans remplaçant", sub: `${w.from_name} · ${w.model_name} · ${day(st)} ${w.start}–${w.end} · personne ne l'a repris`,
            actions: [{ label: "Planning", href: "/planning" }] });
        } else push({ key: "swapr:" + w.id, kind: "swap", lvl: left < 2 * 3.6e6 ? 2 : 1, at: w.created_at, who: w.to_name,
          title: `Échange à valider : ${w.from_name} → ${w.to_name}`, sub: `${w.model_name} · ${day(st)} ${w.start}–${w.end}`,
          actions: [{ label: "Valider", post: `/api/admin/swaps/${w.id}`, body: { decision: "approve" }, done: "Échange validé", main: true }, { label: "Refuser", post: `/api/admin/swaps/${w.id}`, body: { decision: "refuse" }, done: "Échange refusé" }] });
      });
      if (has("help_requests")) db.prepare(`SELECT h.id, h.created_at, m.name model_name FROM help_requests h JOIN models m ON m.id = h.model_id
        WHERE h.resolved_at IS NULL AND h.created_at BETWEEN ? AND ?`).all(now - 12 * 3.6e6, now - 10 * 60000).forEach(h => {
          // un renfort a-t-il pointé sur cette créatrice depuis la demande ?
          if (db.prepare("SELECT 1 FROM clocks c JOIN help_requests h ON h.model_id = c.model_id WHERE h.id = ? AND c.start_at >= h.created_at").get(h.id)) return;
          push({ key: "help:" + h.id, kind: "help", at: h.created_at + 10 * 60000, title: `Renfort demandé pour ${h.model_name}`, sub: `Personne n'a répondu depuis ${dur(mins(now - h.created_at))}`,
            actions: [{ label: "Planning", href: "/planning" }] });
        });
    } catch (e) { console.error("alertes planning", e.message); }
    // 5. aides fan 🆘 restées sans réponse
    if (has("chat_messages")) {
      db.prepare(`SELECT m.id, m.channel_id, m.created_at, u.username FROM chat_messages m JOIN users u ON u.id = m.user_id
        WHERE m.kind = 'sos' AND m.deleted_at IS NULL AND m.created_at BETWEEN ? AND ?`).all(now - 6 * 3.6e6, now - 5 * 60000).forEach(m => {
        const r = db.prepare("SELECT COUNT(*) n FROM chat_messages WHERE thread_root = ? AND deleted_at IS NULL AND user_id != (SELECT user_id FROM chat_messages WHERE id = ?)").get(m.id, m.id).n;
        if (r) return; const w = mins(now - m.created_at);
        push({ key: "sos:" + m.id, kind: "sos", lvl: w >= 15 ? 2 : 1, at: m.created_at + 5 * 60000, who: m.username,
          title: `Aide fan de ${m.username} sans réponse`, sub: `Demandée il y a ${dur(w)} dans le chat d'équipe`, actions: [{ label: "Répondre", href: `/chat?c=${m.channel_id}`, main: true }] });
      });
    }
    // 6. ventes à valider qui attendent depuis plus d'une heure
    const ps = db.prepare("SELECT COUNT(*) n, MIN(created_at) t FROM sales WHERE status = 'pending' AND created_at < ?").get(now - 3.6e6);
    if (ps.n) push({ key: "sales:" + ps.t, kind: "sales", lvl: now - ps.t > 6 * 3.6e6 ? 2 : 1, at: ps.t + 3.6e6,
      title: `${ps.n} vente${ps.n > 1 ? "s" : ""} à valider`, sub: `La plus ancienne attend depuis ${dur(mins(now - ps.t))}`, actions: [{ label: "Valider les ventes", href: "/ventes", main: true }] });
    // 7. contenus personnalisés en retard
    if (has("customs")) {
      const cs = db.prepare("SELECT COUNT(*) n, MIN(due_at) t FROM customs WHERE status IN ('todo','prod') AND due_at IS NOT NULL AND due_at < ?").get(now);
      if (cs.n) push({ key: "custom:" + cs.t, kind: "custom", lvl: 2, at: cs.t,
        title: `${cs.n} contenu${cs.n > 1 ? "s" : ""} perso en retard`, sub: `Promis pour le ${day(cs.t)} à ${hm(cs.t)}`, actions: [{ label: "Ouvrir le Studio", href: "/studio", main: true }] });
    }
    // 8. primes de parrainage à valider
    if (has("referrals")) {
      const rf = db.prepare("SELECT COUNT(*) n, MIN(eligible_at) t FROM referrals WHERE status = 'to_validate'").get();
      if (rf.n) push({ key: "ref:" + rf.t + ":" + rf.n, kind: "ref", at: rf.t || now, title: `${rf.n} prime${rf.n > 1 ? "s" : ""} de parrainage à valider`, sub: "Le filleul a terminé son premier mois", actions: [{ label: "Voir", href: "/parrainage", main: true }] });
    }
    return out.sort((x, y) => y.lvl - x.lvl || y.at - x.at);
  }
  app.get("/api/admin/alerts", auth, admin, (req, res) => { try { res.json({ now: Date.now(), items: alerts() }); } catch (e) { console.error("alertes", e.message); res.json({ now: Date.now(), items: [] }); } });
  return { alerts };
};
