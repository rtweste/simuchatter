// Passation de shift : en fin de shift, le chatter note les fans à suivre ; le suivant les retrouve en arrivant sur la même créatrice
module.exports = function mount(app, db, auth, admin, ctx) {
  const { planning, gest } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS handovers (id INTEGER PRIMARY KEY, model_id INTEGER NOT NULL, from_user INTEGER NOT NULL, at INTEGER NOT NULL, note TEXT);
    CREATE TABLE IF NOT EXISTS handover_items (id INTEGER PRIMARY KEY, handover_id INTEGER NOT NULL, model_id INTEGER NOT NULL, fan TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]',
      note TEXT, prio INTEGER NOT NULL DEFAULT 0, done_by INTEGER, done_at INTEGER, alerted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS handover_seen (user_id INTEGER NOT NULL, handover_id INTEGER NOT NULL, PRIMARY KEY (user_id, handover_id));
    CREATE INDEX IF NOT EXISTS hi_model ON handover_items(model_id, done_at);`);
  const TAGS = { media: "Attend un média", relance: "À relancer", paid: "A payé", sensible: "Sujet sensible", big: "Gros client" };
  const KEEP = 7 * 864e5;   // une note non suivie reste visible 7 jours
  const J = s => { try { return JSON.parse(s || "[]"); } catch (e) { return []; } };
  const openClock = uid => db.prepare("SELECT c.*, m.name model_name FROM clocks c JOIN models m ON m.id = c.model_id WHERE c.user_id = ? AND c.end_at IS NULL AND c.reinforce = 0 ORDER BY c.start_at DESC LIMIT 1").get(uid);
  const uname = id => (db.prepare("SELECT username FROM users WHERE id = ?").get(id) || {}).username || "?";
  // prochain chatter prévu sur cette créatrice (d'après le planning)
  function nextOn(model_id, uid) {
    try { const today = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      const s = planning.decorate(db.prepare(`${planning.SHIFT_SQL} WHERE s.model_id = ? AND s.user_id <> ? AND s.date >= ? ORDER BY s.date, s.start LIMIT 12`).all(model_id, uid, today))
        .filter(x => x.end_ms > Date.now()).sort((a, b) => a.start_ms - b.start_ms)[0];
      return s ? { username: s.username, start: s.start, start_ms: s.start_ms } : null; } catch (e) { return null; }
  }
  // ce que le chatter en shift doit voir : les fans non suivis laissés par les autres sur sa créatrice
  function inbox(uid) {
    const c = openClock(uid); if (!c) return null;
    const items = db.prepare(`SELECT i.*, h.from_user, h.at h_at FROM handover_items i JOIN handovers h ON h.id = i.handover_id
      WHERE i.model_id = ? AND h.from_user <> ? AND h.at > ? AND (i.done_at IS NULL OR i.done_at > ?) ORDER BY i.prio DESC, h.at DESC`).all(c.model_id, uid, Date.now() - KEEP, c.start_at);
    const last = db.prepare("SELECT * FROM handovers WHERE model_id = ? AND from_user <> ? AND at > ? ORDER BY at DESC LIMIT 1").get(c.model_id, uid, Date.now() - KEEP);
    if (!last && !items.length) return null;
    const seen = last && db.prepare("SELECT 1 FROM handover_seen WHERE user_id = ? AND handover_id = ?").get(uid, last.id);
    const open = items.filter(i => !i.done_at).length;
    if (seen) return null;   // « Tout est noté » : la carte ne revient pas (les fans non suivis restent pour les suivants)
    return { model: c.model_name, model_id: c.model_id, from: last ? uname(last.from_user) : null, at: last ? last.at : null, note: last ? last.note : null, handover_id: last ? last.id : null,
      items: items.map(i => ({ id: i.id, fan: i.fan, tags: J(i.tags), note: i.note, prio: !!i.prio, done: !!i.done_at, from: uname(i.from_user), at: i.h_at, old: last && i.handover_id !== last.id })), open, total: items.length };
  }
  app.get("/api/handover", auth, (req, res) => {
    const c = openClock(req.user.id);
    res.json({ tags: TAGS, inbox: inbox(req.user.id), current: c ? { model_id: c.model_id, model: c.model_name, start_at: c.start_at, next: nextOn(c.model_id, req.user.id) } : null });
  });
  // fin de shift : enregistre la passation (le pointage de sortie est fait juste après par la page)
  app.post("/api/handover", auth, (req, res) => {
    const c = openClock(req.user.id); if (!c) return res.status(400).json({ error: "Aucun shift en cours" });
    const b = req.body || {}, now = Date.now(), note = String(b.note || "").trim().slice(0, 600);
    const items = (Array.isArray(b.items) ? b.items : []).map(i => ({ fan: String(i.fan || "").trim().slice(0, 40), tags: (Array.isArray(i.tags) ? i.tags : []).filter(t => TAGS[t]), note: String(i.note || "").trim().slice(0, 400), prio: i.prio ? 1 : 0 }))
      .filter(i => i.fan).slice(0, 30);
    if (!items.length && !note) return res.json({ ok: true, empty: true });
    const hid = db.prepare("INSERT INTO handovers (model_id, from_user, at, note) VALUES (?,?,?,?)").run(c.model_id, req.user.id, now, note || null).lastInsertRowid;
    const ins = db.prepare("INSERT INTO handover_items (handover_id, model_id, fan, tags, note, prio) VALUES (?,?,?,?,?,?)");
    items.forEach(i => ins.run(hid, c.model_id, i.fan, JSON.stringify(i.tags), i.note || null, i.prio));
    gest.log(req.user.id, "pl", `**${req.user.username}** a laissé une passation sur **${c.model_name}**`, `${items.length} fan${items.length > 1 ? "s" : ""} à suivre${items.some(i => i.prio) ? " · dont " + items.filter(i => i.prio).length + " prioritaire" + (items.filter(i => i.prio).length > 1 ? "s" : "") : ""}`);
    res.json({ ok: true, id: hid });
  });
  app.post("/api/handover/items/:id", auth, (req, res) => {
    const c = openClock(req.user.id), i = db.prepare("SELECT * FROM handover_items WHERE id = ?").get(parseInt(req.params.id, 10));
    if (!i) return res.status(404).json({ error: "Introuvable" });
    if (req.user.role !== "admin" && (!c || c.model_id !== i.model_id)) return res.status(403).json({ error: "Pointe d'abord sur cette créatrice" });
    if (req.body?.done) db.prepare("UPDATE handover_items SET done_at = ?, done_by = ? WHERE id = ?").run(Date.now(), req.user.id, i.id);
    else db.prepare("UPDATE handover_items SET done_at = NULL, done_by = NULL WHERE id = ?").run(i.id);
    res.json({ ok: true, inbox: inbox(req.user.id) });
  });
  app.post("/api/handover/seen", auth, (req, res) => {
    const id = parseInt(req.body?.handover_id, 10); if (id) db.prepare("INSERT OR IGNORE INTO handover_seen (user_id, handover_id) VALUES (?,?)").run(req.user.id, id);
    res.json({ ok: true });
  });
  // appelé quand un chatter termine son shift : prévient le manager si un fan prioritaire qu'il a reçu n'a pas été suivi
  function checkMissed(uid, clock) {
    try { const miss = db.prepare(`SELECT i.*, h.at h_at FROM handover_items i JOIN handovers h ON h.id = i.handover_id
        WHERE i.model_id = ? AND h.from_user <> ? AND i.prio = 1 AND i.done_at IS NULL AND i.alerted = 0 AND h.at < ? AND h.at > ?`).all(clock.model_id, uid, clock.start_at + 3600e3, Date.now() - KEEP);
      if (!miss.length) return;
      miss.forEach(i => db.prepare("UPDATE handover_items SET alerted = 1 WHERE id = ?").run(i.id));
      gest.log(uid, "pl", `**${uname(uid)}** n'a pas suivi ${miss.length > 1 ? miss.length + " fans prioritaires" : "un fan prioritaire"} sur **${clock.model_name}**`, miss.map(i => i.fan).join(", ") + " · laissé" + (miss.length > 1 ? "s" : "") + " en passation");
    } catch (e) {}
  }
  // historique pour le manager
  app.get("/api/admin/handovers", auth, admin, (req, res) => {
    const hs = db.prepare(`SELECT h.*, u.username, m.name model_name FROM handovers h JOIN users u ON u.id = h.from_user JOIN models m ON m.id = h.model_id ORDER BY h.at DESC LIMIT 60`).all();
    res.json({ items: hs.map(h => ({ ...h, items: db.prepare("SELECT i.*, u.username done_name FROM handover_items i LEFT JOIN users u ON u.id = i.done_by WHERE i.handover_id = ? ORDER BY i.prio DESC, i.id").all(h.id).map(i => ({ ...i, tags: J(i.tags) })) })), tags: TAGS });
  });
  return { checkMissed, openClock };
};
