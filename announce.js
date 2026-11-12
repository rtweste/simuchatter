// Annonces importantes et urgentes de #informations : bandeau sur l'accueil, écran bloquant, suivi de lecture et relance.
module.exports = function mount(app, db, auth, admin, ctx) {
  const J = s => { try { return JSON.parse(s || "{}") || {}; } catch (e) { return {}; } };
  const LEVEL = `(m.meta LIKE '%"level":"important"%' OR m.meta LIKE '%"level":"urgent"%')`;
  const teamN = () => db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'chatter' AND active = 1").get().n;
  const shape = (m, uid) => { const meta = J(m.meta);
    const readers = db.prepare("SELECT u.username FROM chat_acks a JOIN users u ON u.id = a.user_id WHERE a.message_id = ? ORDER BY a.at DESC LIMIT 6").all(m.id).map(r => r.username);
    return { id: m.id, channel_id: m.channel_id, body: m.body, author: m.username, created_at: m.created_at, level: meta.level, remind_at: meta.remind_at || null,
      reads: db.prepare("SELECT COUNT(*) n FROM chat_acks WHERE message_id = ?").get(m.id).n, of: teamN(), readers }; };

  // pour un chatter : annonces importantes ou urgentes qu'il n'a pas encore confirmées (14 derniers jours)
  app.get("/api/announcements/pending", auth, (req, res) => {
    if (req.user.role !== "chatter") return res.json({ items: [] });
    const rows = db.prepare(`SELECT m.*, u.username FROM chat_messages m JOIN users u ON u.id = m.user_id
      WHERE m.deleted_at IS NULL AND m.hidden = 0 AND m.thread_root IS NULL AND m.created_at > ? AND ${LEVEL}
        AND NOT EXISTS (SELECT 1 FROM chat_acks a WHERE a.message_id = m.id AND a.user_id = ?)
      ORDER BY m.created_at DESC LIMIT 10`).all(Date.now() - 14 * 864e5, req.user.id);
    const items = rows.map(m => shape(m, req.user.id)).sort((a, b) => (b.level === "urgent") - (a.level === "urgent") || b.created_at - a.created_at);
    res.json({ items });
  });

  // pour le manager : qui a lu, qui n'a pas lu (et qui est en shift)
  app.get("/api/admin/announcements/:id/reads", auth, admin, (req, res) => {
    const m = db.prepare("SELECT m.*, u.username FROM chat_messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?").get(parseInt(req.params.id, 10));
    if (!m || !J(m.meta).announce) return res.status(404).json({ error: "Annonce introuvable" });
    const read = db.prepare("SELECT u.id, u.username, a.at FROM chat_acks a JOIN users u ON u.id = a.user_id WHERE a.message_id = ? ORDER BY a.at").all(m.id);
    const ids = new Set(read.map(r => r.id));
    const live = {}; db.prepare("SELECT c.user_id, c.start_at, md.name model_name FROM clocks c JOIN models md ON md.id = c.model_id WHERE c.end_at IS NULL").all().forEach(c => { live[c.user_id] = live[c.user_id] || c; });
    const unread = db.prepare("SELECT id, username FROM users WHERE role = 'chatter' AND active = 1 ORDER BY username").all().filter(u => !ids.has(u.id))
      .map(u => ({ id: u.id, username: u.username, live: live[u.id] ? { model: live[u.id].model_name, since: live[u.id].start_at } : null }))
      .sort((a, b) => !!b.live - !!a.live || a.username.localeCompare(b.username));
    const meta = J(m.meta);
    res.json({ id: m.id, body: m.body, level: meta.level || "normal", created_at: m.created_at, author: m.username, remind_at: meta.remind_at || null,
      read: read.map(r => ({ username: r.username, at: r.at })), unread, of: teamN() });
  });

  // relance : les chatters qui n'ont pas lu sont de nouveau prévenus à leur prochaine connexion / dans les 30 s
  app.post("/api/admin/announcements/:id/remind", auth, admin, (req, res) => {
    const m = db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(parseInt(req.params.id, 10));
    const meta = m ? J(m.meta) : null; if (!m || !meta.announce) return res.status(404).json({ error: "Annonce introuvable" });
    if (meta.remind_at && Date.now() - meta.remind_at < 5 * 60e3) return res.status(429).json({ error: "Relance déjà envoyée il y a moins de 5 minutes" });
    if (!meta.level) meta.level = "important";   // une annonce normale relancée passe en bandeau
    meta.remind_at = Date.now(); db.prepare("UPDATE chat_messages SET meta = ? WHERE id = ?").run(JSON.stringify(meta), m.id);
    const n = db.prepare("SELECT COUNT(*) n FROM users u WHERE u.role = 'chatter' AND u.active = 1 AND NOT EXISTS (SELECT 1 FROM chat_acks a WHERE a.message_id = ? AND a.user_id = u.id)").get(m.id).n;
    try { ctx.gest && ctx.gest.log(req.user.id, "a", "a relancé une annonce de **#informations**", `${n} chatter${n > 1 ? "s" : ""} pas encore à jour`); } catch (e) {}
    res.json({ ok: true, n });
  });
};
