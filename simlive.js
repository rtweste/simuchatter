// Simu Chatter — suivi en direct par les managers, conseils soufflés, réglages et entraînements assignés
module.exports = function mount(app, db, auth, admin, h) {
  const { loadSim, publicSim, PERSONAS, busy } = h;
  db.exec(`
  CREATE TABLE IF NOT EXISTS sim_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sim_whispers (id INTEGER PRIMARY KEY, sim_id INTEGER NOT NULL, from_user INTEGER NOT NULL,
    text TEXT NOT NULL, created_at INTEGER NOT NULL, seen_at INTEGER);
  CREATE INDEX IF NOT EXISTS sim_whispers_sim ON sim_whispers(sim_id);
  CREATE TABLE IF NOT EXISTS sim_assignments (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, persona_id TEXT NOT NULL,
    difficulty TEXT NOT NULL, goal INTEGER NOT NULL, due_at INTEGER, note TEXT, created_by INTEGER NOT NULL, created_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, best INTEGER, done_at INTEGER);
  `);
  const DEF = { notify: "1", draft: "1", whisper: "1", limit: process.env.DAILY_SIM_LIMIT || "10" };
  const getSet = () => { const o = { ...DEF }; db.prepare("SELECT key, value FROM sim_settings").all().forEach(r => o[r.key] = r.value);
    return { notify: o.notify === "1", draft: o.draft === "1", whisper: o.whisper === "1", limit: Math.max(1, Math.min(50, parseInt(o.limit, 10) || 10)) }; };
  const persona = id => PERSONAS.find(p => p.id === id) || { name: id, label: "" };
  const uname = id => db.prepare("SELECT username FROM users WHERE id = ?").get(id)?.username || "?";

  // état en mémoire : brouillon en cours, dernière présence du chatter, managers qui regardent
  const draft = new Map(), seen = new Map(), watchers = new Map();   // simId -> {text, at} | at | Map(userId -> {name, at})
  const watching = id => { const m = watchers.get(id); if (!m) return []; const now = Date.now(); return [...m.values()].filter(w => now - w.at < 8000).map(w => w.name); };

  /* ---------- côté chatter ---------- */
  const ownActive = (req, res) => {
    const s = loadSim(parseInt(req.params.id, 10));
    if (!s || s.user_id !== req.user.id) { res.status(404).json({ error: "Introuvable" }); return null; }
    return s;
  };
  // présence + conseils reçus + qui regarde (appelé toutes les 2-3 s pendant la simu)
  app.get("/api/sims/:id/live", auth, (req, res) => {
    const s = ownActive(req, res); if (!s) return;
    seen.set(s.id, Date.now());
    const set = getSet(), now = Date.now();
    const ws = db.prepare("SELECT w.id, w.text, w.created_at, u.username FROM sim_whispers w JOIN users u ON u.id = w.from_user WHERE w.sim_id = ? AND w.seen_at IS NULL ORDER BY w.id").all(s.id);
    if (ws.length) db.prepare(`UPDATE sim_whispers SET seen_at = ? WHERE id IN (${ws.map(() => "?").join(",")})`).run(now, ...ws.map(w => w.id));
    res.json({ watchers: set.notify ? watching(s.id) : [], whispers: ws.map(w => ({ id: w.id, text: w.text, from: w.username, at: w.created_at })), sendDraft: set.draft });
  });
  // ce que le chatter est en train de taper
  app.post("/api/sims/:id/draft", auth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const s = db.prepare("SELECT user_id, status FROM sims WHERE id = ?").get(id);
    if (!s || s.user_id !== req.user.id || s.status !== "active") return res.json({ ok: false });
    if (!getSet().draft) { draft.delete(id); return res.json({ ok: false }); }
    draft.set(id, { text: String(req.body?.text || "").slice(0, 1000), at: Date.now() }); seen.set(id, Date.now());
    res.json({ ok: true });
  });
  // entraînements assignés au chatter
  app.get("/api/my-assignments", auth, (req, res) => {
    res.json(db.prepare("SELECT a.*, u.username created_by_name FROM sim_assignments a JOIN users u ON u.id = a.created_by WHERE a.user_id = ? AND a.done_at IS NULL ORDER BY a.created_at DESC").all(req.user.id)
      .map(a => ({ ...a, persona: persona(a.persona_id).name, label: persona(a.persona_id).label })));
  });

  /* ---------- côté manager ---------- */
  const aiCost = id => { try { return Math.round(db.prepare("SELECT COALESCE(SUM(cost),0) c FROM ai_usage WHERE sim_id = ?").get(id).c * 10000) / 10000; } catch (e) { return 0; } };
  const liveList = () => {
    const now = Date.now();
    return db.prepare("SELECT s.*, u.username FROM sims s JOIN users u ON u.id = s.user_id WHERE s.status = 'active' AND s.started_at > ? ORDER BY s.started_at DESC").all(now - 6 * 3600e3)
      .filter(s => now - (seen.get(s.id) || 0) < 20000)
      .map(s => { const log = JSON.parse(s.log), last = [...log].reverse().find(l => l.who === "fan" || l.who === "chatter" || l.who === "ppv"), d = draft.get(s.id), p = persona(s.persona_id);
        return { id: s.id, user: s.username, userId: s.user_id, persona: p.name, label: p.label, difficulty: s.difficulty, creator: s.creator_name, started_at: s.started_at,
          msgs: log.filter(l => l.who === "chatter" || l.who === "ppv").length, revenue: s.revenue, interest: s.interest,
          last: last ? { who: last.who, text: last.who === "ppv" ? `PPV · ${last.desc} · ${last.price} €` : last.text } : null,
          draft: d && now - d.at < 15000 ? d.text : "", fanTyping: busy.has(s.id), watchers: watching(s.id), aiCost: aiCost(s.id) }; });
  };
  app.get("/api/admin/sim/live", auth, admin, (req, res) => res.json(liveList()));

  // vue d'ensemble de l'onglet Gestion
  app.get("/api/admin/sim/overview", auth, admin, (req, res) => {
    const now = Date.now(), d7 = now - 7 * 864e5, d14 = now - 14 * 864e5;
    const chatters = db.prepare("SELECT id, username, role FROM users WHERE role IN ('chatter','trainee') AND active = 1 ORDER BY username").all();
    const done = db.prepare("SELECT s.id, s.user_id, s.persona_id, s.difficulty, s.score, s.revenue, s.started_at, u.username FROM sims s JOIN users u ON u.id = s.user_id WHERE s.status = 'done' AND u.role = 'chatter' AND s.started_at > ? ORDER BY s.started_at DESC").all(now - 60 * 864e5);
    const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
    const team = chatters.map(c => { const mine = done.filter(s => s.user_id === c.id), w = mine.filter(s => s.started_at > d7), pw = mine.filter(s => s.started_at > d14 && s.started_at <= d7);
      return { id: c.id, name: c.username, sessions7: w.length, avg7: avg(w.map(s => s.score)), prevAvg: avg(pw.map(s => s.score)), best: mine.length ? Math.max(...mine.map(s => s.score)) : null,
        last: mine[0]?.started_at || null, trend: mine.slice(0, 8).reverse().map(s => s.score) }; });
    const all7 = done.filter(s => s.started_at > d7), allP = done.filter(s => s.started_at > d14 && s.started_at <= d7);
    const bestS = done.filter(s => s.started_at > d7).sort((a, b) => b.score - a.score)[0];
    const live = liveList(), liveIds = new Set(live.map(l => l.userId));
    const shifts = db.prepare("SELECT c.user_id, u.username, m.name model FROM clocks c JOIN users u ON u.id = c.user_id JOIN models m ON m.id = c.model_id WHERE c.end_at IS NULL AND c.reinforce = 0").all()
      .filter(s => !liveIds.has(s.user_id)).map(s => { const last = done.find(d => d.user_id === s.user_id); return { userId: s.user_id, user: s.username, model: s.model, lastScore: last?.score ?? null, lastAt: last?.started_at || null }; });
    const assignments = db.prepare("SELECT a.*, u.username FROM sim_assignments a JOIN users u ON u.id = a.user_id WHERE a.done_at IS NULL OR a.done_at > ? ORDER BY a.done_at IS NOT NULL, a.created_at DESC").all(now - 7 * 864e5)
      .map(a => ({ ...a, persona: persona(a.persona_id).name, label: persona(a.persona_id).label }));
    let ai7 = null;
    try { const u = db.prepare("SELECT COALESCE(SUM(cost),0) cost, COUNT(DISTINCT sim_id) sims FROM ai_usage WHERE at > ? AND sim_id IS NOT NULL").get(d7), m = db.prepare("SELECT COALESCE(SUM(cost),0) cost FROM ai_usage WHERE at > ? AND sim_id IS NOT NULL").get(now - 30 * 864e5);
      ai7 = { cost: Math.round(u.cost * 100) / 100, perSession: u.sims ? Math.round(u.cost / u.sims * 1000) / 1000 : null, month: Math.round(m.cost * 100) / 100 }; } catch (e) {}
    res.json({
      stats: { ai7, aiLive: Math.round(live.reduce((t, l) => t + (l.aiCost || 0), 0) * 1000) / 1000, live: live.length, sessions7: all7.length, sessionsPrev: allP.length, avg7: avg(all7.map(s => s.score)), avgPrev: avg(allP.map(s => s.score)), best: bestS ? { score: bestS.score, user: bestS.username } : null },
      live, shifts, team, settings: getSet(), assignments, chatters,
      recent: done.slice(0, 8).map(s => ({ id: s.id, user: s.username, persona: persona(s.persona_id).name, label: persona(s.persona_id).label, difficulty: s.difficulty, score: s.score, at: s.started_at })),
      personas: PERSONAS.map(p => ({ id: p.id, name: p.name, label: p.label }))
    });
  });
  app.put("/api/admin/sim/settings", auth, admin, (req, res) => {
    const b = req.body || {}, up = db.prepare("INSERT INTO sim_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    ["notify", "draft", "whisper"].forEach(k => { if (k in b) up.run(k, b[k] ? "1" : "0"); });
    if ("limit" in b) up.run("limit", String(Math.max(1, Math.min(50, parseInt(b.limit, 10) || 10))));
    if (!getSet().draft) draft.clear();
    res.json(getSet());
  });
  // regarder une session : tout l'état + brouillon + conseils envoyés
  app.get("/api/admin/sims/:id/watch", auth, admin, (req, res) => {
    const s = loadSim(parseInt(req.params.id, 10)); if (!s) return res.status(404).json({ error: "Introuvable" });
    if (!watchers.has(s.id)) watchers.set(s.id, new Map());
    watchers.get(s.id).set(req.user.id, { name: req.user.username, at: Date.now() });
    const d = draft.get(s.id), now = Date.now(), set = getSet();
    const done = db.prepare("SELECT score FROM sims WHERE user_id = ? AND status = 'done'").all(s.user_id).map(r => r.score);
    res.json({ ...publicSim(s), username: uname(s.user_id), userId: s.user_id, aiCost: aiCost(s.id),
      draft: set.draft && d && now - d.at < 15000 && s.status === "active" ? d.text : "", fanTyping: busy.has(s.id),
      online: now - (seen.get(s.id) || 0) < 20000, settings: set,
      chatterStats: { sessions: done.length, avg: done.length ? Math.round(done.reduce((a, b) => a + b, 0) / done.length) : null },
      whispers: db.prepare("SELECT id, text, created_at, seen_at FROM sim_whispers WHERE sim_id = ? ORDER BY id DESC LIMIT 20").all(s.id) });
  });
  app.post("/api/admin/sims/:id/whisper", auth, admin, (req, res) => {
    if (!getSet().whisper) return res.status(400).json({ error: "Les conseils du manager sont désactivés dans les réglages." });
    const id = parseInt(req.params.id, 10), text = String(req.body?.text || "").trim().slice(0, 400);
    const s = db.prepare("SELECT status FROM sims WHERE id = ?").get(id);
    if (!s) return res.status(404).json({ error: "Introuvable" });
    if (s.status !== "active") return res.status(400).json({ error: "La session est terminée." });
    if (!text) return res.status(400).json({ error: "Écris un conseil" });
    db.prepare("INSERT INTO sim_whispers (sim_id, from_user, text, created_at) VALUES (?,?,?,?)").run(id, req.user.id, text, Date.now());
    res.json({ ok: true });
  });
  // entraînements assignés
  app.post("/api/admin/assignments", auth, admin, (req, res) => {
    const b = req.body || {}, uid = parseInt(b.userId, 10);
    if (!db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('chatter','trainee')").get(uid)) return res.status(400).json({ error: "Chatter invalide" });
    if (!PERSONAS.some(p => p.id === b.personaId)) return res.status(400).json({ error: "Fan invalide" });
    const diff = ["facile", "normal", "difficile"].includes(b.difficulty) ? b.difficulty : "normal";
    const goal = Math.max(10, Math.min(100, parseInt(b.goal, 10) || 70)), due = b.dueAt ? Number(b.dueAt) : null;
    db.prepare("INSERT INTO sim_assignments (user_id, persona_id, difficulty, goal, due_at, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(uid, b.personaId, diff, goal, due, String(b.note || "").slice(0, 200), req.user.id, Date.now());
    res.json({ ok: true });
  });
  app.delete("/api/admin/assignments/:id", auth, admin, (req, res) => { db.prepare("DELETE FROM sim_assignments WHERE id = ?").run(parseInt(req.params.id, 10)); res.json({ ok: true }); });

  // à la fin d'une simu : met à jour les entraînements correspondants et efface le brouillon
  function onEnd(sim) {
    draft.delete(sim.id);
    db.prepare("SELECT * FROM sim_assignments WHERE user_id = ? AND persona_id = ? AND difficulty = ? AND done_at IS NULL").all(sim.user_id, sim.persona_id, sim.difficulty).forEach(a => {
      const best = Math.max(a.best ?? 0, sim.score ?? 0);
      db.prepare("UPDATE sim_assignments SET attempts = attempts + 1, best = ?, done_at = ? WHERE id = ?").run(best, best >= a.goal ? Date.now() : null, a.id);
    });
  }
  return { getSet, onEnd };
};
