// Défis de la semaine : objectifs d'équipe ou perso (chiffre, nombre de ventes, contenus perso), progression en direct,
// récompense versée sur la paie à la fin du défi.
module.exports = function mount(app, db, auth, admin, ctx) {
  const { compta, gest } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS challenges (id INTEGER PRIMARY KEY, scope TEXT NOT NULL, metric TEXT NOT NULL, title TEXT NOT NULL, target REAL NOT NULL,
      model_id INTEGER, start_at INTEGER NOT NULL, end_at INTEGER NOT NULL, prime REAL NOT NULL DEFAULT 0, split TEXT NOT NULL DEFAULT 'prorata', badge TEXT,
      status TEXT NOT NULL DEFAULT 'active', reached_at INTEGER, closed_at INTEGER, created_at INTEGER NOT NULL, created_by INTEGER);
    CREATE TABLE IF NOT EXISTS challenge_results (challenge_id INTEGER NOT NULL, user_id INTEGER NOT NULL, value REAL NOT NULL, share REAL NOT NULL, prime REAL NOT NULL DEFAULT 0, won INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (challenge_id, user_id));`);
  const r2 = n => Math.round(n * 100) / 100;
  const eur = n => (Math.round(n * 100) / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " €";
  const BADGES = ["fusee", "couronne", "eclair", "diamant"];
  const has = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const dayName = ms => new Date(ms).toLocaleDateString("fr-FR", { weekday: "long", timeZone: "Europe/Paris" });
  const unit = (metric, n) => metric === "ca" ? eur(n) : metric === "count" ? `${Math.round(n)} vente${n > 1 ? "s" : ""}` : `${Math.round(n)} contenu${n > 1 ? "s" : ""} perso`;
  function makeTitle(c, model) {
    const end = Date.now() + 7 * 864e5 > c.end_at ? `d'ici ${dayName(c.end_at)}` : `d'ici le ${new Date(c.end_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" })}`;
    const what = c.scope === "team" ? (c.metric === "ca" ? `${eur(c.target)} d'équipe` : unit(c.metric, c.target)) : `${unit(c.metric, c.target)} chacun`;
    return `${what}${model ? " sur " + model : ""} ${end}`;
  }
  // contributions par chatter sur la fenêtre du défi
  function contributions(c, until) {
    const to = Math.min(until || Date.now(), c.end_at), mf = c.model_id ? " AND model_id = " + (+c.model_id) : "";
    if (c.metric === "customs") {
      if (!has("customs")) return [];
      return db.prepare(`SELECT c.user_id, u.username, COUNT(*) v FROM customs c JOIN users u ON u.id = c.user_id WHERE c.created_at BETWEEN ? AND ?${mf.replace("model_id", "c.model_id")} GROUP BY c.user_id ORDER BY v DESC`).all(c.start_at, to);
    }
    const agg = c.metric === "ca" ? "SUM(s.amount)" : "COUNT(*)";
    return db.prepare(`SELECT s.user_id, u.username, ${agg} v FROM sales s JOIN users u ON u.id = s.user_id WHERE s.status <> 'refused' AND s.sold_at BETWEEN ? AND ?${mf.replace("model_id", "s.model_id")} GROUP BY s.user_id ORDER BY v DESC`).all(c.start_at, to);
  }
  function feedOf(c) {
    const mf = c.model_id ? " AND s.model_id = " + (+c.model_id) : "";
    if (c.metric === "customs") return has("customs") ? db.prepare(`SELECT u.username, 1 v, c.created_at at, m.name model_name FROM customs c JOIN users u ON u.id = c.user_id JOIN models m ON m.id = c.model_id WHERE c.created_at BETWEEN ? AND ?${mf.replace("s.model_id", "c.model_id")} ORDER BY c.created_at DESC LIMIT 6`).all(c.start_at, c.end_at) : [];
    return db.prepare(`SELECT u.username, ${c.metric === "ca" ? "s.amount" : "1"} v, s.created_at at, m.name model_name FROM sales s JOIN users u ON u.id = s.user_id JOIN models m ON m.id = s.model_id WHERE s.status <> 'refused' AND s.sold_at BETWEEN ? AND ?${mf} ORDER BY s.created_at DESC LIMIT 6`).all(c.start_at, c.end_at);
  }
  const modelName = id => id ? (db.prepare("SELECT name FROM models WHERE id = ?").get(id) || {}).name || null : null;
  // part de prime estimée pour chacun si le défi est réussi
  function primeShares(c, rows) {
    if (!(c.prime > 0)) return {};
    const out = {};
    if (c.scope === "solo") { rows.forEach(r => { if (r.v >= c.target) out[r.user_id] = c.prime; }); return out; }
    const tot = rows.reduce((t, r) => t + r.v, 0); if (!tot) return out;
    rows.forEach(r => { out[r.user_id] = c.split === "equal" ? r2(c.prime / rows.length) : r2(c.prime * r.v / tot); });
    return out;
  }
  function view(c, uid) {
    const now = Date.now(), rows = c.status === "active" || !c.closed_at ? contributions(c) : db.prepare("SELECT r.user_id, u.username, r.value v, r.prime, r.won FROM challenge_results r JOIN users u ON u.id = r.user_id WHERE r.challenge_id = ? ORDER BY r.value DESC").all(c.id);
    const total = rows.reduce((t, r) => t + r.v, 0), me = rows.find(r => r.user_id === uid), rank = me ? rows.indexOf(me) + 1 : null;
    const value = c.scope === "team" ? total : (me ? me.v : 0), shares = c.closed_at ? Object.fromEntries(rows.map(r => [r.user_id, r.prime || 0])) : primeShares(c, rows);
    return { id: c.id, scope: c.scope, metric: c.metric, title: c.title, target: c.target, value: r2(value), pct: Math.min(100, Math.round(value / c.target * 1000) / 10),
      start_at: c.start_at, end_at: c.end_at, left: Math.max(0, c.end_at - now), prime: c.prime, split: c.split, badge: c.badge, model_name: modelName(c.model_id),
      status: c.status, reached_at: c.reached_at, closed_at: c.closed_at, contributors: rows.length,
      mine: me ? r2(me.v) : 0, share: total && me ? Math.round(me.v / total * 1000) / 10 : 0, rank, estPrime: uid ? (shares[uid] || 0) : 0,
      won: c.scope === "solo" ? !!(me && me.v >= c.target) : !!c.reached_at,
      top: rows.slice(0, 6).map(r => ({ username: r.username, value: r2(r.v), prime: shares[r.user_id] || 0 })), feed: c.closed_at ? [] : feedOf(c) };
  }
  // avancement : objectif atteint, puis clôture et versement des primes à la fin
  function sweep() { try {
    const now = Date.now();
    db.prepare("SELECT * FROM challenges WHERE status IN ('active','done') AND closed_at IS NULL").all().forEach(c => {
      const rows = contributions(c), total = rows.reduce((t, r) => t + r.v, 0);
      if (!c.reached_at && c.scope === "team" && total >= c.target) {
        db.prepare("UPDATE challenges SET reached_at = ?, status = 'done' WHERE id = ?").run(Math.min(now, c.end_at), c.id);
        gest.log(null, "a", `Défi réussi : **${c.title}**`, `${unit(c.metric, total)} atteints · prime versée à la fin du défi`);
      }
      if (c.end_at > now) return;
      const solo = c.scope === "solo", won = solo ? rows.some(r => r.v >= c.target) : total >= c.target, shares = won ? primeShares(c, rows) : {};
      const pkey0 = compta.periodOfDate(compta.parisDate(c.end_at - 1)), pkey = compta.isLocked && compta.isLocked(pkey0) ? compta.periodOfDate(compta.parisDate(now)) : pkey0;
      const tx = db.transaction(() => {
        rows.forEach(r => { const p = shares[r.user_id] || 0, w = solo ? r.v >= c.target : won;
          db.prepare("INSERT OR REPLACE INTO challenge_results (challenge_id, user_id, value, share, prime, won) VALUES (?,?,?,?,?,?)").run(c.id, r.user_id, r.v, total ? r.v / total : 0, p, w ? 1 : 0);
          if (p > 0) db.prepare("INSERT INTO pay_adjust (period, user_id, amount, reason, created_at, created_by) VALUES (?,?,?,?,?,?)").run(pkey, r.user_id, p, `Défi réussi · ${c.title}`.slice(0, 160), now, null); });
        db.prepare("UPDATE challenges SET status = ?, closed_at = ?, reached_at = COALESCE(reached_at, ?) WHERE id = ?").run(won ? "done" : "failed", now, won && !solo ? c.end_at : null, c.id);
      }); tx();
      gest.log(null, "a", won ? `Défi terminé et réussi : **${c.title}**` : `Défi terminé sans être atteint : **${c.title}**`,
        won ? `${Object.values(shares).filter(x => x > 0).length} prime(s) ajoutée(s) à la paie · ${eur(Object.values(shares).reduce((t, x) => t + x, 0))}` : `${unit(c.metric, solo ? (rows[0] ? rows[0].v : 0) : total)} sur ${unit(c.metric, c.target)}`);
    });
  } catch (e) { console.error("défis", e.message); } }
  setInterval(sweep, 2 * 60e3).unref(); setTimeout(sweep, 8e3).unref();

  /* ----- chatters ----- */
  app.get("/api/challenges", auth, (req, res) => {
    sweep(); const uid = req.user.id, now = Date.now();
    const active = db.prepare("SELECT * FROM challenges WHERE status IN ('active','done') AND closed_at IS NULL AND start_at <= ? ORDER BY scope = 'team' DESC, end_at").all(now).map(c => view(c, uid));
    const recent = db.prepare("SELECT * FROM challenges WHERE closed_at IS NOT NULL AND status IN ('done','failed') ORDER BY closed_at DESC LIMIT 4").all().map(c => view(c, uid));
    // à fêter : défi réussi récemment auquel j'ai participé
    const celebrate = [...active, ...recent].filter(v => v.won && v.mine > 0 && ((v.scope === "solo" && !v.closed_at) || ((v.reached_at || v.closed_at) && now - (v.closed_at || v.reached_at) < 4 * 864e5)))
      .map(v => ({ ...v, key: `${v.id}:${v.closed_at ? "c" : "r"}` }));
    res.json({ active, recent, celebrate, badges: BADGES });
  });

  /* ----- manager ----- */
  app.get("/api/admin/challenges", auth, admin, (req, res) => {
    sweep(); const now = Date.now(), wk = now - 7 * 864e5;
    const last = { ca: db.prepare("SELECT COALESCE(SUM(amount),0) v FROM sales WHERE status <> 'refused' AND sold_at BETWEEN ? AND ?").get(wk - 7 * 864e5, wk).v,
      count: db.prepare("SELECT COUNT(*) v FROM sales WHERE status <> 'refused' AND sold_at BETWEEN ? AND ?").get(wk - 7 * 864e5, wk).v,
      customs: has("customs") ? db.prepare("SELECT COUNT(*) v FROM customs WHERE created_at BETWEEN ? AND ?").get(wk - 7 * 864e5, wk).v : 0 };
    const week = { ca: db.prepare("SELECT COALESCE(SUM(amount),0) v FROM sales WHERE status <> 'refused' AND sold_at > ?").get(wk).v,
      count: db.prepare("SELECT COUNT(*) v FROM sales WHERE status <> 'refused' AND sold_at > ?").get(wk).v,
      customs: has("customs") ? db.prepare("SELECT COUNT(*) v FROM customs WHERE created_at > ?").get(wk).v : 0 };
    res.json({ now, active: db.prepare("SELECT * FROM challenges WHERE closed_at IS NULL AND status IN ('active','done') ORDER BY start_at").all().map(c => view(c, null)),
      past: db.prepare("SELECT * FROM challenges WHERE closed_at IS NOT NULL OR status = 'cancelled' ORDER BY COALESCE(closed_at, created_at) DESC LIMIT 12").all().map(c => view(c, null)),
      lastWeek: last, thisWeek: week, team: db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'chatter' AND active = 1").get().n,
      models: db.prepare("SELECT id, name FROM models ORDER BY name").all(), badges: BADGES });
  });
  app.post("/api/admin/challenges", auth, admin, (req, res) => {
    const b = req.body || {}, now = Date.now();
    const scope = b.scope === "solo" ? "solo" : "team", metric = ["ca", "count", "customs"].includes(b.metric) ? b.metric : "ca";
    const target = Math.round(+b.target * 100) / 100, prime = Math.max(0, Math.round((+b.prime || 0) * 100) / 100);
    const start = +b.start || now, end = +b.end;
    if (!(target > 0)) return res.status(400).json({ error: "Indique un objectif" });
    if (!(end > start) || end < now) return res.status(400).json({ error: "La date de fin doit être après le début et dans le futur" });
    if (end - start > 62 * 864e5) return res.status(400).json({ error: "Un défi dure au maximum 2 mois" });
    if (prime > 5000) return res.status(400).json({ error: "Prime trop élevée" });
    const model_id = b.model_id ? parseInt(b.model_id, 10) : null, model = model_id ? modelName(model_id) : null;
    if (model_id && !model) return res.status(400).json({ error: "Créatrice inconnue" });
    const c = { scope, metric, target, end_at: end };
    const title = String(b.title || "").trim().slice(0, 90) || makeTitle(c, model);
    const id = db.prepare("INSERT INTO challenges (scope, metric, title, target, model_id, start_at, end_at, prime, split, badge, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(scope, metric, title, target, model_id, start, end, prime, b.split === "equal" ? "equal" : "prorata", BADGES.includes(b.badge) ? b.badge : "fusee", now, req.user.id).lastInsertRowid;
    // annonce épinglée dans #informations
    if (b.announce !== false) try {
      const ch = db.prepare("SELECT id FROM chat_channels WHERE slug = 'informations'").get();
      if (ch) { const txt = `Nouveau défi ${scope === "team" ? "d'équipe" : "perso"} : ${title}.` + (prime > 0 ? ` Récompense : ${eur(prime)}${scope === "team" ? (b.split === "equal" ? " partagés à parts égales" : " partagés selon la part de chacun") : " pour chaque chatter qui y arrive"}.` : "") + " Suis ta progression sur ton accueil.";
        const mid = db.prepare("INSERT INTO chat_messages (channel_id, user_id, body, kind, meta, created_at, pinned) VALUES (?,?,?,?,?,?,1)").run(ch.id, req.user.id, txt, "text", JSON.stringify({ announce: true, challenge: id }), now).lastInsertRowid;
        try { ctx.chatPush && ctx.chatPush(ch.id, mid); } catch (e) {} }
    } catch (e) { console.error("annonce défi", e.message); }
    gest.log(req.user.id, "a", `a lancé le défi **${title}**`, prime > 0 ? `Récompense : ${eur(prime)}` : "Sans prime");
    res.json({ ok: true, id });
  });
  app.delete("/api/admin/challenges/:id", auth, admin, (req, res) => {
    const c = db.prepare("SELECT * FROM challenges WHERE id = ?").get(parseInt(req.params.id, 10));
    if (!c || c.closed_at) return res.status(400).json({ error: "Ce défi est déjà terminé" });
    db.prepare("UPDATE challenges SET status = 'cancelled', closed_at = ? WHERE id = ?").run(Date.now(), c.id);
    gest.log(req.user.id, "a", `a annulé le défi **${c.title}**`, "Aucune prime versée"); res.json({ ok: true });
  });
  // pour la salle de contrôle : le défi d'équipe en cours le plus proche de la fin
  app.get("/api/admin/challenges/live", auth, admin, (req, res) => {
    const c = db.prepare("SELECT * FROM challenges WHERE closed_at IS NULL AND status IN ('active','done') AND scope = 'team' AND start_at <= ? ORDER BY end_at LIMIT 1").get(Date.now());
    res.json({ challenge: c ? view(c, null) : null });
  });
  return { sweep };
};
