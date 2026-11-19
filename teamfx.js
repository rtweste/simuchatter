// Salle de contrôle (écran live), radar des chatters qui décrochent, mur des meilleures ventes
module.exports = function mount(app, db, auth, admin, ctx) {
  const { planning, gest, PERSONAS } = ctx;
  const J = s => { try { return JSON.parse(s || "null"); } catch (e) { return null; } };
  for (const [c, t] of [["tech", "TEXT"], ["tech_at", "INTEGER"], ["wall_hidden", "INTEGER"]])
    if (!db.prepare("PRAGMA table_info(sales)").all().some(x => x.name === c)) db.exec(`ALTER TABLE sales ADD COLUMN ${c} ${t}`);
  db.exec(`CREATE TABLE IF NOT EXISTS sale_kudos (sale_id INTEGER NOT NULL, user_id INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (sale_id, user_id));
    CREATE TABLE IF NOT EXISTS radar_alerts (user_id INTEGER NOT NULL, at INTEGER NOT NULL, sig TEXT)`);

  // minuit et lundi (heure de Paris)
  const parisOffset = ms => { const d = new Date(ms), p = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Paris" })), u = new Date(d.toLocaleString("en-US", { timeZone: "UTC" })); return p - u; };
  const parisMidnight = ms => { const o = parisOffset(ms), l = new Date(ms + o); l.setUTCHours(0, 0, 0, 0); return l.getTime() - o; };
  const parisMonday = ms => { const m = parisMidnight(ms), o = parisOffset(ms), dow = (new Date(m + o).getUTCDay() + 6) % 7; return parisMidnight(m - dow * 864e5 + 3600e3); };

  /* =================== SALLE DE CONTRÔLE =================== */
  app.get("/api/admin/control", auth, admin, (req, res) => {
    const now = Date.now(), d0 = parisMidnight(now), since = Math.max(Number(req.query.since) || 0, now - 6 * 3600e3);
    const today = db.prepare(`SELECT s.id, s.amount, s.status, s.user_id, s.model_id, s.sold_at, s.created_at, s.reviewed_at, u.username, u.deleted_at, m.name model_name
      FROM sales s JOIN users u ON u.id = s.user_id JOIN models m ON m.id = s.model_id WHERE s.sold_at >= ? AND s.status <> 'refused'`).all(d0);
    const val = today.filter(s => s.status === "validated"), pend = today.filter(s => s.status === "pending");
    const sum = a => Math.round(a.reduce((t, s) => t + s.amount, 0) * 100) / 100;
    // classement : sans les comptes supprimés (dont le compte technique « Ancien chatter »)
    const board = {}; today.filter(s => !s.deleted_at).forEach(s => { const b = board[s.user_id] = board[s.user_id] || { id: s.user_id, username: s.username, ca: 0, n: 0 }; b.ca += s.amount; b.n++; });
    const models = {}; today.forEach(s => { const b = models[s.model_id] = models[s.model_id] || { id: s.model_id, name: s.model_name, ca: 0, n: 0 }; b.ca += s.amount; b.n++; });
    const yest = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM sales WHERE status <> 'refused' AND sold_at >= ? AND sold_at < ?").get(d0 - 864e5, now - 864e5).t;
    const live = db.prepare(`SELECT c.user_id, c.start_at, c.reinforce, u.username, m.name model_name FROM clocks c JOIN users u ON u.id = c.user_id JOIN models m ON m.id = c.model_id WHERE c.end_at IS NULL ORDER BY c.start_at`).all();
    const events = db.prepare(`SELECT s.id, s.amount, s.status, s.created_at, s.reviewed_at, u.username, m.name model_name FROM sales s JOIN users u ON u.id = s.user_id JOIN models m ON m.id = s.model_id
      WHERE s.created_at > ? OR (s.reviewed_at > ? AND s.status = 'validated') ORDER BY MAX(s.created_at, COALESCE(s.reviewed_at, 0)) DESC LIMIT 30`).all(since, since)
      .map(e => ({ ...e, kind: e.reviewed_at && e.reviewed_at > since && e.status === "validated" ? "validated" : "declared", at: e.reviewed_at && e.reviewed_at > since && e.status === "validated" ? e.reviewed_at : e.created_at }));
    const feed = db.prepare(`SELECT s.id, s.amount, s.status, s.created_at, s.reviewed_at, u.username, m.name model_name FROM sales s JOIN users u ON u.id = s.user_id JOIN models m ON m.id = s.model_id
      WHERE s.sold_at >= ? AND s.status <> 'refused' ORDER BY s.created_at DESC LIMIT 14`).all(d0);
    const best = db.prepare("SELECT MAX(t) m FROM (SELECT SUM(amount) t FROM sales WHERE status = 'validated' GROUP BY date(sold_at / 1000 + 3600, 'unixepoch'))").get().m || 0;
    const ser = db.prepare("SELECT sold_at t, amount a, user_id u FROM sales WHERE status <> 'refused' AND sold_at >= ? AND sold_at <= ? ORDER BY sold_at").all(d0 - 864e5, now);
    const series = ser.filter(r => r.t >= d0).map(r => [r.t - d0, r.a, r.u]), seriesY = ser.filter(r => r.t < d0).map(r => [r.t - (d0 - 864e5), r.a]);
    res.json({ now, day0: d0, series, seriesY, ca: sum(today), validated: sum(val), pending: sum(pend), count: today.length, avg: today.length ? Math.round(sum(today) / today.length) : 0, yesterday: Math.round(yest),
      record: Math.round(best), board: Object.values(board).sort((a, b) => b.ca - a.ca).slice(0, 8), models: Object.values(models).sort((a, b) => b.ca - a.ca), live, events, feed });
  });

  /* =================== RADAR : CHATTERS QUI DÉCROCHENT =================== */
  // critère le plus faible au simulateur → fan le plus adapté pour s'entraîner
  const CRIT_FAN = [[/accroche|lien/i, "nouveau"], [/objection/i, "radin"], [/vente|technique/i, "baleine"], [/écoute|personnalis/i, "froid"], [/éthique|respect\b/i, "fragile"], [/personnage/i, "nouveau"]];
  function radarOf(u) {
    const now = Date.now(), D14 = 14 * 864e5, signals = [];
    const s = db.prepare("SELECT COALESCE(SUM(CASE WHEN sold_at >= ? THEN amount END),0) a, COALESCE(SUM(CASE WHEN sold_at < ? THEN amount END),0) b FROM sales WHERE user_id = ? AND status = 'validated' AND sold_at >= ?").get(now - D14, now - D14, u.id, now - 2 * D14);
    if (s.b >= 150 && s.a < s.b * .7) signals.push({ k: "sales", lvl: s.a < s.b * .4 ? 2 : 1, t: `Ventes en baisse de ${Math.round((1 - s.a / s.b) * 100)} %`, d: `${Math.round(s.a)} € sur 14 jours contre ${Math.round(s.b)} € les 14 jours d'avant` });
    const ref = db.prepare("SELECT COUNT(*) n FROM sales WHERE user_id = ? AND status = 'refused' AND reviewed_at > ?").get(u.id, now - D14).n;
    if (ref >= 3) signals.push({ k: "refused", lvl: ref >= 5 ? 2 : 1, t: `${ref} ventes refusées`, d: "sur les 14 derniers jours" });
    let late = 0, abs = 0, total = 0;
    try { const since = new Date(now - D14).toISOString().slice(0, 10);
      planning.decorate(db.prepare(`${planning.SHIFT_SQL} WHERE s.user_id = ? AND s.date >= ?`).all(u.id, since)).filter(x => x.state !== "future" && x.state !== "missing" && x.end_ms < now)
        .forEach(x => { total++; if (x.state === "absent") abs++; else if (x.late > 5) late++; }); } catch (e) {}
    if (abs + late >= 3) signals.push({ k: "punct", lvl: abs >= 2 ? 2 : 1, t: `${abs ? abs + " absence" + (abs > 1 ? "s" : "") : ""}${abs && late ? " et " : ""}${late ? late + " retard" + (late > 1 ? "s" : "") : ""}`, d: `sur ${total} shifts en 14 jours` });
    const lastClock = db.prepare("SELECT MAX(start_at) t FROM clocks WHERE user_id = ?").get(u.id).t;
    if (lastClock && now - lastClock > 7 * 864e5) signals.push({ k: "idle", lvl: 1, t: "Plus de shift depuis " + Math.floor((now - lastClock) / 864e5) + " jours", d: "dernier pointage le " + new Date(lastClock).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" }) });
    if (!signals.length) return null;
    // entraînement conseillé : d'après son point faible au simulateur, sinon d'après le signal
    let fan = signals.some(x => x.k === "sales") ? "radin" : signals.some(x => x.k === "refused") ? "baleine" : "nouveau", why = signals.some(x => x.k === "sales") ? "relancer ses ventes : négociation et objections" : "reprendre les bases";
    const reps = db.prepare("SELECT report FROM sims WHERE user_id = ? AND status = 'done' AND report IS NOT NULL ORDER BY started_at DESC LIMIT 5").all(u.id).map(r => J(r.report)).filter(r => r && Array.isArray(r.criteria));
    if (reps.length) { const avg = {}; reps.forEach(r => r.criteria.forEach(c => { (avg[c.name] = avg[c.name] || []).push(c.score); }));
      const weak = Object.entries(avg).map(([n, a]) => [n, a.reduce((t, x) => t + x, 0) / a.length]).sort((a, b) => a[1] - b[1])[0];
      if (weak) { const m = CRIT_FAN.find(([re]) => re.test(weak[0])); if (m) { fan = m[1]; why = `son point faible au simulateur : « ${weak[0]} » (${weak[1].toFixed(1)}/10)`; } } }
    const p = (PERSONAS || []).find(x => x.id === fan) || {};
    const open = db.prepare("SELECT 1 FROM sim_assignments WHERE user_id = ? AND done_at IS NULL AND created_at > ?").get(u.id, now - 7 * 864e5);
    return { id: u.id, username: u.username, level: signals.some(x => x.lvl === 2) || signals.length >= 2 ? 2 : 1, signals,
      training: { personaId: fan, persona: p.name || fan, difficulty: "normal", why }, assigned: !!open };
  }
  function radar() { return db.prepare("SELECT id, username FROM users WHERE role = 'chatter' AND active = 1").all().map(radarOf).filter(Boolean).sort((a, b) => b.level - a.level || b.signals.length - a.signals.length); }
  app.get("/api/admin/radar", auth, admin, (req, res) => res.json({ items: radar() }));
  // une fois par heure : une alerte dans le Journal pour chaque nouveau chatter qui décroche (au plus une par semaine et par chatter)
  function sweep() { try { radar().filter(r => r.level === 2).forEach(r => {
      if (db.prepare("SELECT 1 FROM radar_alerts WHERE user_id = ? AND at > ?").get(r.id, Date.now() - 7 * 864e5)) return;
      db.prepare("INSERT INTO radar_alerts (user_id, at, sig) VALUES (?,?,?)").run(r.id, Date.now(), r.signals.map(s => s.k).join(","));
      gest.log(r.id, "a", `**${r.username}** est en train de décrocher`, r.signals.map(s => s.t).join(" · ")); }); } catch (e) {} }
  setInterval(sweep, 3600e3).unref(); setTimeout(sweep, 20e3).unref();

  /* =================== MUR DES MEILLEURES VENTES =================== */
  const WALL_N = 6;
  function wall(uid) {
    const w0 = parisMonday(Date.now());
    const rows = db.prepare(`SELECT s.id, s.amount, s.sold_at, s.tech, s.user_id, s.wall_hidden, u.username, m.name model_name FROM sales s JOIN users u ON u.id = s.user_id JOIN models m ON m.id = s.model_id
      WHERE s.status = 'validated' AND s.sold_at >= ? AND COALESCE(s.wall_hidden, 0) = 0 ORDER BY s.amount DESC, s.sold_at ASC LIMIT ?`).all(w0, WALL_N);
    return { since: w0, items: rows.map((r, i) => ({ id: r.id, rank: i + 1, amount: r.amount, sold_at: r.sold_at, username: r.username, model_name: r.model_name, tech: r.tech,
      mine: r.user_id === uid, kudos: db.prepare("SELECT COUNT(*) n FROM sale_kudos WHERE sale_id = ?").get(r.id).n, liked: !!db.prepare("SELECT 1 FROM sale_kudos WHERE sale_id = ? AND user_id = ?").get(r.id, uid) })) };
  }
  app.get("/api/wall", auth, (req, res) => res.json(wall(req.user.id)));
  app.post("/api/wall/:id/tech", auth, (req, res) => {
    const s = db.prepare("SELECT * FROM sales WHERE id = ?").get(parseInt(req.params.id, 10)); if (!s || s.user_id !== req.user.id || s.status !== "validated") return res.status(403).json({ error: "Seulement pour tes ventes validées" });
    const t = String(req.body?.text || "").trim().replace(/\s+/g, " ").slice(0, 160); if (t.length < 5) return res.status(400).json({ error: "Écris une phrase sur ta technique" });
    db.prepare("UPDATE sales SET tech = ?, tech_at = ? WHERE id = ?").run(t, Date.now(), s.id); res.json({ ok: true, wall: wall(req.user.id) });
  });
  app.post("/api/wall/:id/kudo", auth, (req, res) => {
    const id = parseInt(req.params.id, 10), s = db.prepare("SELECT user_id FROM sales WHERE id = ? AND status = 'validated'").get(id); if (!s) return res.status(404).json({ error: "Introuvable" });
    if (db.prepare("SELECT 1 FROM sale_kudos WHERE sale_id = ? AND user_id = ?").get(id, req.user.id)) db.prepare("DELETE FROM sale_kudos WHERE sale_id = ? AND user_id = ?").run(id, req.user.id);
    else db.prepare("INSERT INTO sale_kudos (sale_id, user_id, at) VALUES (?,?,?)").run(id, req.user.id, Date.now());
    res.json({ ok: true, wall: wall(req.user.id) });
  });
  app.post("/api/admin/wall/:id/hide", auth, admin, (req, res) => { db.prepare("UPDATE sales SET wall_hidden = 1 WHERE id = ?").run(parseInt(req.params.id, 10)); res.json({ ok: true, wall: wall(req.user.id) }); });
};
