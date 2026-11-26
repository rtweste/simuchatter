// Planning v2 : créneaux fixes, statut de pointage (à l'heure / retard / absent), échanges de shifts,
// renforts (2e créatrice pendant un shift), demandes de renfort et rappels.
const TZ = "Europe/Paris";
const parisDate = ms => new Date(ms).toLocaleDateString("sv-SE", { timeZone: TZ });
const periodOfDate = d => { const [y, m, day] = d.split("-"); return `${y}-${m}-${Number(day) <= 15 ? "A" : "B"}`; };
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
// AAAA-MM-JJ + HH:MM (heure de Paris) → timestamp
function parisMs(date, time) {
  const guess = Date.parse(`${date}T${time}:00Z`);
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess)).reduce((o, x) => (o[x.type] = x.value, o), {});
  const asParis = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
  return guess - (asParis - guess);
}
const shiftSpan = s => { const a = parisMs(s.date, s.start); let b = parisMs(s.date, s.end); if (b <= a) b = parisMs(addDays(s.date, 1), s.end); return [a, b]; };
const mondayOf = d => { const wd = (new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7; return addDays(d, -wd); };

module.exports = function mount(app, db, auth, admin) {
  return mountPlanning(app, db, auth, admin);
};
module.exports.shiftSpan = shiftSpan;
function mountPlanning(app, db, auth, admin) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS shift_swaps (id INTEGER PRIMARY KEY, shift_id INTEGER NOT NULL, from_user INTEGER NOT NULL, to_user INTEGER,
    reason TEXT, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, decided_by INTEGER, decided_at INTEGER);
  CREATE INDEX IF NOT EXISTS swaps_status ON shift_swaps(status);
  CREATE TABLE IF NOT EXISTS help_requests (id INTEGER PRIMARY KEY, model_id INTEGER NOT NULL, for_user INTEGER, created_by INTEGER NOT NULL,
    reason TEXT, created_at INTEGER NOT NULL, resolved_at INTEGER, resolved_by INTEGER);
  `);
  const getSet = (k, d) => db.prepare("SELECT value FROM settings WHERE key = ?").get(k)?.value ?? d;
  const setSet = (k, v) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
  const AG = () => { try { return JSON.parse(getSet("agency", "{}")); } catch (e) { return {}; } };
  const GRACE = () => { const v = +AG().tolerance; return Number.isFinite(v) && v >= 0 ? v : 5; };   // minutes de tolérance avant un retard
  const DEFAULT_SLOTS = [["3–9", "03:00", "09:00"], ["9–15", "09:00", "15:00"], ["15–21", "15:00", "21:00"], ["21–3", "21:00", "03:00"]];
  // passage aux 4 créneaux de 6 h (une seule fois : remplace les créneaux enregistrés dans les Réglages)
  if (getSet("slots_v2", null) == null) { try { const a = AG(); a.slots = DEFAULT_SLOTS; setSet("agency", JSON.stringify(a)); setSet("slots_v2", String(Date.now())); } catch (e) {} }
  const SLOTS = () => { const s = AG().slots; return Array.isArray(s) && s.length ? s : DEFAULT_SLOTS; };
  // suspension (sanctions) : plus de reprise de shift ni de renfort
  const suspended = uid => { try { const r = db.prepare("SELECT until FROM suspensions WHERE user_id = ? AND until > ?").get(uid, Date.now()); return r ? r.until : null; } catch (e) { return null; } };
  const models = () => db.prepare("SELECT id, name FROM models ORDER BY name").all();
  const mainClock = uid => db.prepare(`SELECT c.*, m.name model_name FROM clocks c JOIN models m ON m.id = c.model_id
    WHERE c.user_id = ? AND c.end_at IS NULL AND c.reinforce = 0`).get(uid);
  const SHIFT_SQL = `SELECT s.*, u.username, m.name model_name FROM shifts s JOIN users u ON u.id = s.user_id JOIN models m ON m.id = s.model_id`;

  // renforts arrivés à leur heure de fin prévue → arrêtés
  const sweep = () => db.prepare("UPDATE clocks SET end_at = until_at WHERE reinforce = 1 AND end_at IS NULL AND until_at IS NOT NULL AND until_at <= ?").run(Date.now());

  // statut d'un shift d'après les pointages du chatter
  function decorate(shifts) {
    if (!shifts.length) return shifts;
    const now = Date.now(), spans = shifts.map(shiftSpan);
    const lo = Math.min(...spans.map(s => s[0])) - 4 * 3.6e6, hi = Math.max(...spans.map(s => s[1])), grace = GRACE();
    const clocks = db.prepare("SELECT id, user_id, model_id, start_at, end_at FROM clocks WHERE reinforce = 0 AND start_at BETWEEN ? AND ?").all(lo, hi);
    const swaps = db.prepare(`SELECT w.*, t.username to_name FROM shift_swaps w LEFT JOIN users t ON t.id = w.to_user WHERE w.status IN ('open','requested')`).all();
    return shifts.map((s, i) => {
      const [a, b] = spans[i];
      const mine = clocks.filter(c => c.user_id === s.user_id && c.start_at >= a - 3 * 3.6e6 && c.start_at < b);
      const c = mine.find(x => x.model_id === s.model_id) || mine[0];
      let state, late = 0;
      if (c) { late = Math.max(0, Math.round((c.start_at - a) / 60000)); state = !c.end_at && now < b + 3 * 3.6e6 ? "live" : "done"; if (late <= grace) late = 0; }
      else if (now < a) state = "future";
      else if (now < b) { state = "missing"; late = Math.round((now - a) / 60000); }
      else state = "absent";
      const sw = swaps.find(w => w.shift_id === s.id);
      return { ...s, start_ms: a, end_ms: b, state, late, clock_in: c ? c.start_at : null, clock_id: c ? c.id : null, clock_open: !!(c && !c.end_at),
        swap: sw ? { id: sw.id, status: sw.status, to_user: sw.to_user, to_name: sw.to_name, reason: sw.reason } : null };
    });
  }
  // ponctualité d'un chatter sur une période de 15 jours
  function punctuality(uid, pkey) {
    const today = parisDate(Date.now());
    const rows = decorate(db.prepare(`${SHIFT_SQL} WHERE s.user_id = ? AND s.date <= ? ORDER BY s.date, s.start`).all(uid, today)
      .filter(s => periodOfDate(s.date) === pkey)).filter(s => s.state !== "future" && s.state !== "missing");
    const onTime = rows.filter(s => s.clock_in && !s.late), late = rows.filter(s => s.late > 0), absent = rows.filter(s => s.state === "absent");
    const adv = onTime.map(s => (s.start_ms - s.clock_in) / 60000);
    const last = decorate(db.prepare(`${SHIFT_SQL} WHERE s.user_id = ? AND s.date <= ? ORDER BY s.date DESC, s.start DESC LIMIT 14`).all(uid, today))
      .filter(s => s.state !== "future" && s.state !== "missing").slice(0, 12).reverse().map(s => s.state === "absent" ? "a" : s.late ? "r" : "v");
    return { total: rows.length, onTime: onTime.length, late: late.length, absent: absent.length, lateMin: late.reduce((t, s) => t + s.late, 0),
      pct: rows.length ? Math.round(onTime.length / rows.length * 100) : null, advance: adv.length ? Math.round(adv.reduce((t, x) => t + x, 0) / adv.length) : null, last };
  }
  const renforts = where => db.prepare(`SELECT c.*, u.username, m.name model_name, p.model_id main_model_id, pm.name main_model_name
    FROM clocks c JOIN users u ON u.id = c.user_id JOIN models m ON m.id = c.model_id LEFT JOIN clocks p ON p.id = c.parent_id LEFT JOIN models pm ON pm.id = p.model_id
    WHERE c.reinforce = 1 AND c.end_at IS NULL ${where || ""} ORDER BY c.start_at`).all().map(r => {
      const s = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) total FROM sales WHERE user_id = ? AND model_id = ? AND sold_at >= ? AND status != 'refused'").get(r.user_id, r.model_id, r.start_at);
      return { id: r.id, user_id: r.user_id, username: r.username, model_id: r.model_id, model_name: r.model_name, main_model_name: r.main_model_name, start_at: r.start_at, until_at: r.until_at, sales: s.n, amount: s.total };
    });
  const helps = () => db.prepare(`SELECT h.*, m.name model_name, u.username for_name, c.username by_name FROM help_requests h JOIN models m ON m.id = h.model_id
    LEFT JOIN users u ON u.id = h.for_user LEFT JOIN users c ON c.id = h.created_by WHERE h.resolved_at IS NULL AND h.created_at > ? ORDER BY h.created_at DESC`).all(Date.now() - 12 * 3.6e6);
  const activeSwaps = () => db.prepare(`SELECT w.*, s.date, s.start, s.end, s.model_id, m.name model_name, f.username from_name, t.username to_name
    FROM shift_swaps w JOIN shifts s ON s.id = w.shift_id JOIN models m ON m.id = s.model_id JOIN users f ON f.id = w.from_user LEFT JOIN users t ON t.id = w.to_user
    WHERE w.status IN ('open','requested') ORDER BY s.date, s.start`).all().map(w => ({ ...w, start_ms: shiftSpan(w)[0] })).filter(w => w.start_ms > Date.now() - 3.6e6);
  const PREFS = { before: true, missed: true, swaps: false };
  const prefsOf = uid => { try { return { ...PREFS, ...JSON.parse(getSet("planprefs:" + uid, "{}")) }; } catch (e) { return { ...PREFS }; } };

  /* ================= CHATTER ================= */
  app.get("/api/planning/me", auth, (req, res) => {
    sweep();
    const uid = req.user.id, now = Date.now(), today = parisDate(now);
    const from = isDate(req.query.from) ? mondayOf(req.query.from) : mondayOf(today), to = addDays(from, 6);
    const week = decorate(db.prepare(`${SHIFT_SQL} WHERE s.user_id = ? AND s.date BETWEEN ? AND ? ORDER BY s.date, s.start`).all(uid, from, to));
    // shift en cours ou prochain
    const near = decorate(db.prepare(`${SHIFT_SQL} WHERE s.user_id = ? AND s.date >= ? ORDER BY s.date, s.start LIMIT 12`).all(uid, addDays(today, -1)));
    const next = near.find(s => s.end_ms > now && s.state !== "done" && !(s.swap && s.swap.status === "requested")) || null;
    const open = mainClock(uid) || null;
    const live = db.prepare("SELECT c.model_id, u.username FROM clocks c JOIN users u ON u.id = c.user_id WHERE c.end_at IS NULL").all();
    const nowShifts = decorate(db.prepare(`${SHIFT_SQL} WHERE s.date BETWEEN ? AND ?`).all(addDays(today, -1), today)).filter(s => s.start_ms <= now && s.end_ms > now);
    const hs = helps();
    const mineRf = db.prepare("SELECT model_id FROM clocks WHERE user_id = ? AND reinforce = 1 AND end_at IS NULL").all(uid).map(r => r.model_id);
    const meName = req.user.username;
    const candidates = models().filter(m => (!open || m.id !== open.model_id) && !mineRf.includes(m.id)).map(m => {
      const h = hs.find(x => x.model_id === m.id), on = [...new Set(live.filter(l => l.model_id === m.id && l.username !== meName).map(l => l.username))];
      const planned = nowShifts.filter(s => s.model_id === m.id);
      const note = h ? (!h.for_user ? `Renfort demandé par ${h.by_name || "le manager"}${h.reason ? " · " + h.reason : ""}` : h.created_by !== h.for_user ? `${h.for_name} n'a pas pointé` : `${h.for_name} a un souci${h.reason ? " · " + h.reason : ""}`)
        : on.length ? `En cours avec ${on.join(", ")}` : planned.some(s => s.state === "missing" && s.user_id !== uid) ? `${planned.find(s => s.state === "missing" && s.user_id !== uid).username} n'a pas pointé` : "Personne dessus en ce moment";
      return { id: m.id, name: m.name, help: h ? { id: h.id, at: h.created_at } : null, busy: on.length > 0, note };
    }).sort((a, b) => (b.help ? 2 : 0) + (!b.busy ? 1 : 0) - (a.help ? 2 : 0) - (!a.busy ? 1 : 0));
    const swaps = activeSwaps();
    const training = app.locals.supWeek ? app.locals.supWeek(from, to).filter(s => s.user_id === uid) : [];   // shifts accompagnés (chatters en formation)
    res.json({ now, today, from, to, week, training, next, open, renforts: renforts(`AND c.user_id = ${uid}`), candidates,
      myHelp: hs.find(h => h.for_user === uid && h.created_by === uid) || null,
      swaps: swaps.filter(w => w.from_user !== uid && (w.status === "open" || w.to_user === uid)),
      mySwaps: swaps.filter(w => w.from_user === uid),
      punctuality: punctuality(uid, periodOfDate(today)), prefs: prefsOf(uid), models: models() });
  });
  // rappels (appelé chaque minute par toutes les pages ouvertes)
  app.get("/api/planning/ping", auth, (req, res) => {
    if (req.user.role === "admin") return res.json({});
    const uid = req.user.id, now = Date.now(), today = parisDate(now);
    const near = decorate(db.prepare(`${SHIFT_SQL} WHERE s.user_id = ? AND s.date BETWEEN ? AND ? ORDER BY s.date, s.start`).all(uid, addDays(today, -1), addDays(today, 1)));
    const next = near.find(s => s.end_ms > now && s.state !== "done") || null;
    const swaps = activeSwaps().filter(w => w.status === "open" && w.from_user !== uid);
    res.json({ prefs: prefsOf(uid), remind: +AG().reminder || 30, next: next && { id: next.id, start_ms: next.start_ms, end_ms: next.end_ms, state: next.state, model_name: next.model_name, start: next.start, end: next.end },
      swaps: swaps.map(w => ({ id: w.id, created_at: w.created_at, date: w.date, start: w.start, end: w.end, model_name: w.model_name, from_name: w.from_name })) });
  });
  app.put("/api/planning/prefs", auth, (req, res) => {
    const p = prefsOf(req.user.id); ["before", "missed", "swaps"].forEach(k => { if (typeof req.body?.[k] === "boolean") p[k] = req.body[k]; });
    setSet("planprefs:" + req.user.id, JSON.stringify(p)); res.json({ ok: true, prefs: p });
  });

  // échanges : je ne peux pas venir → le shift part à l'échange
  app.post("/api/shifts/:id/release", auth, (req, res) => {
    const s = db.prepare("SELECT * FROM shifts WHERE id = ?").get(parseInt(req.params.id, 10));
    if (!s || s.user_id !== req.user.id) return res.status(404).json({ error: "Shift introuvable" });
    if (shiftSpan(s)[1] <= Date.now()) return res.status(400).json({ error: "Ce shift est déjà passé" });
    if (db.prepare("SELECT 1 FROM shift_swaps WHERE shift_id = ? AND status IN ('open','requested')").get(s.id)) return res.status(400).json({ error: "Ce shift est déjà en échange" });
    db.prepare("INSERT INTO shift_swaps (shift_id, from_user, reason, created_at) VALUES (?,?,?,?)").run(s.id, req.user.id, String(req.body?.reason || "").slice(0, 160), Date.now());
    res.json({ ok: true });
  });
  app.post("/api/swaps/:id/take", auth, (req, res) => {
    const w = db.prepare("SELECT * FROM shift_swaps WHERE id = ?").get(parseInt(req.params.id, 10));
    if (!w || w.status !== "open") return res.status(400).json({ error: "Ce shift n'est plus disponible" });
    if (w.from_user === req.user.id) return res.status(400).json({ error: "C'est ton propre shift" });
    const su = suspended(req.user.id); if (su) return res.status(403).json({ error: `Tes shifts sont suspendus jusqu'au ${new Date(su).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}` });
    db.prepare("UPDATE shift_swaps SET status = 'requested', to_user = ? WHERE id = ?").run(req.user.id, w.id);
    res.json({ ok: true });
  });
  app.delete("/api/swaps/:id", auth, (req, res) => {
    const w = db.prepare("SELECT * FROM shift_swaps WHERE id = ?").get(parseInt(req.params.id, 10));
    if (!w || !["open", "requested"].includes(w.status)) return res.status(404).json({ error: "Échange introuvable" });
    if (w.from_user === req.user.id || req.user.role === "admin") db.prepare("UPDATE shift_swaps SET status = 'cancelled', decided_at = ? WHERE id = ?").run(Date.now(), w.id);
    else if (w.to_user === req.user.id) db.prepare("UPDATE shift_swaps SET status = 'open', to_user = NULL WHERE id = ?").run(w.id);
    else return res.status(403).json({ error: "Action non autorisée" });
    res.json({ ok: true });
  });

  // renfort : 2e créatrice pendant mon shift
  app.post("/api/reinforce", auth, (req, res) => {
    sweep();
    const main = mainClock(req.user.id); if (!main) return res.status(400).json({ error: "Commence d'abord ton shift" });
    const su = suspended(req.user.id); if (su) return res.status(403).json({ error: "Tu es suspendu : pas de renfort pour l'instant" });
    const model_id = parseInt(req.body?.model_id, 10);
    if (!db.prepare("SELECT 1 FROM models WHERE id = ?").get(model_id)) return res.status(400).json({ error: "Créatrice invalide" });
    if (model_id === main.model_id) return res.status(400).json({ error: "Tu es déjà sur cette créatrice" });
    if (db.prepare("SELECT 1 FROM clocks WHERE user_id = ? AND model_id = ? AND reinforce = 1 AND end_at IS NULL").get(req.user.id, model_id)) return res.status(400).json({ error: "Tu tiens déjà cette créatrice en renfort" });
    const min = parseInt(req.body?.minutes, 10), now = Date.now();
    const until = min > 0 && min <= 12 * 60 ? now + min * 60000 : null;
    const info = db.prepare("INSERT INTO clocks (user_id, model_id, start_at, reinforce, parent_id, until_at) VALUES (?,?,?,1,?,?)").run(req.user.id, model_id, now, main.id, until);
    db.prepare("UPDATE help_requests SET resolved_at = ?, resolved_by = ? WHERE model_id = ? AND resolved_at IS NULL").run(now, req.user.id, model_id);
    res.json({ ok: true, id: info.lastInsertRowid });
  });
  app.post("/api/reinforce/:id/stop", auth, (req, res) => {
    const c = db.prepare("SELECT * FROM clocks WHERE id = ? AND reinforce = 1").get(parseInt(req.params.id, 10));
    if (!c || (c.user_id !== req.user.id && req.user.role !== "admin")) return res.status(404).json({ error: "Renfort introuvable" });
    if (!c.end_at) db.prepare("UPDATE clocks SET end_at = ? WHERE id = ?").run(Date.now(), c.id);
    res.json({ ok: true });
  });
  // j'ai un souci : je demande un renfort sur ma créatrice
  app.post("/api/help", auth, (req, res) => {
    const main = mainClock(req.user.id); if (!main) return res.status(400).json({ error: "Tu n'es pas en shift" });
    if (db.prepare("SELECT 1 FROM help_requests WHERE model_id = ? AND resolved_at IS NULL AND created_at > ?").get(main.model_id, Date.now() - 12 * 3.6e6)) return res.json({ ok: true, already: true });
    db.prepare("INSERT INTO help_requests (model_id, for_user, created_by, reason, created_at) VALUES (?,?,?,?,?)").run(main.model_id, req.user.id, req.user.id, String(req.body?.reason || "").slice(0, 160), Date.now());
    res.json({ ok: true });
  });
  app.delete("/api/help/:id", auth, (req, res) => {
    const h = db.prepare("SELECT * FROM help_requests WHERE id = ?").get(parseInt(req.params.id, 10));
    if (!h || (h.created_by !== req.user.id && req.user.role !== "admin")) return res.status(404).json({ error: "Demande introuvable" });
    db.prepare("UPDATE help_requests SET resolved_at = ?, resolved_by = ? WHERE id = ?").run(Date.now(), req.user.id, h.id); res.json({ ok: true });
  });

  /* ================= MANAGER ================= */
  // alertes du planning masquées par un manager (« c'est réglé ») : partagées entre managers
  db.exec("CREATE TABLE IF NOT EXISTS planning_dismiss (key TEXT PRIMARY KEY, by_id INTEGER, at INTEGER NOT NULL)");
  app.post("/api/admin/planning/dismiss", auth, admin, (req, res) => {
    const key = String(req.body?.key || "").slice(0, 80); if (!/^[a-z]+:[\w,-]+$/.test(key)) return res.status(400).json({ error: "Alerte invalide" });
    db.prepare("INSERT OR REPLACE INTO planning_dismiss (key, by_id, at) VALUES (?,?,?)").run(key, req.user.id, Date.now());
    db.prepare("DELETE FROM planning_dismiss WHERE at < ?").run(Date.now() - 14 * 864e5);
    res.json({ ok: true });
  });
  app.get("/api/admin/planning", auth, admin, (req, res) => {
    sweep();
    const now = Date.now(), today = parisDate(now);
    const from = isDate(req.query.from) ? mondayOf(req.query.from) : mondayOf(today), to = addDays(from, 6);
    const shifts = decorate(db.prepare(`${SHIFT_SQL} WHERE s.date BETWEEN ? AND ? ORDER BY s.date, s.start`).all(from, to));
    const around = decorate(db.prepare(`${SHIFT_SQL} WHERE s.date BETWEEN ? AND ?`).all(addDays(today, -1), today));
    const people = db.prepare("SELECT id, username, role FROM users WHERE active = 1 AND role != 'trainee' ORDER BY role DESC, username").all();
    const pkey = periodOfDate(today);
    const usual = {}; try { db.prepare("SELECT user_id, model_id FROM user_models").all().forEach(r => (usual[r.user_id] = usual[r.user_id] || []).push(r.model_id)); } catch (e) {}
    res.json({ now, today, from, to, shifts, training: app.locals.supWeek ? app.locals.supWeek(from, to) : [], people, usual, models: models(), slots: SLOTS(),
      dismissed: db.prepare("SELECT key FROM planning_dismiss").all().map(r => r.key),
      missing: around.filter(s => s.state === "missing" && s.late >= (+AG().missedAlert || 10)), swaps: activeSwaps(), renforts: renforts(), helps: helps(),
      punctuality: people.filter(p => p.role !== "admin").map(p => ({ id: p.id, username: p.username, ...punctuality(p.id, pkey) })).filter(p => p.total) });
  });
  app.post("/api/admin/swaps/:id", auth, admin, (req, res) => {
    const w = db.prepare("SELECT * FROM shift_swaps WHERE id = ?").get(parseInt(req.params.id, 10));
    if (!w || !["open", "requested"].includes(w.status)) return res.status(404).json({ error: "Échange introuvable" });
    const to = req.body?.to_user ? parseInt(req.body.to_user, 10) : w.to_user;
    if (req.body?.decision === "approve") {
      if (!to || !db.prepare("SELECT 1 FROM users WHERE id = ?").get(to)) return res.status(400).json({ error: "Personne n'a repris ce shift" });
      db.prepare("UPDATE shifts SET user_id = ? WHERE id = ?").run(to, w.shift_id);
      db.prepare("UPDATE shift_swaps SET status = 'approved', to_user = ?, decided_by = ?, decided_at = ? WHERE id = ?").run(to, req.user.id, Date.now(), w.id);
    } else if (req.body?.decision === "refuse") {
      db.prepare("UPDATE shift_swaps SET status = 'refused', decided_by = ?, decided_at = ? WHERE id = ?").run(req.user.id, Date.now(), w.id);
    } else return res.status(400).json({ error: "Décision invalide" });
    res.json({ ok: true });
  });
  app.post("/api/admin/help", auth, admin, (req, res) => {
    const s = req.body?.shift_id ? db.prepare("SELECT * FROM shifts WHERE id = ?").get(parseInt(req.body.shift_id, 10)) : null;
    const model_id = s ? s.model_id : parseInt(req.body?.model_id, 10);
    if (!db.prepare("SELECT 1 FROM models WHERE id = ?").get(model_id)) return res.status(400).json({ error: "Créatrice invalide" });
    if (!db.prepare("SELECT 1 FROM help_requests WHERE model_id = ? AND resolved_at IS NULL AND created_at > ?").get(model_id, Date.now() - 12 * 3.6e6))
      db.prepare("INSERT INTO help_requests (model_id, for_user, created_by, reason, created_at) VALUES (?,?,?,?,?)").run(model_id, s ? s.user_id : null, req.user.id, s ? "pas pointé" : String(req.body?.reason || "").trim().slice(0, 120), Date.now());
    else return res.json({ ok: true, already: true });
    res.json({ ok: true });
  });

  // créatrices actives d'un chatter (principale + renforts) pour le formulaire de vente
  return { decorate, punctuality, shiftSpan, suspended, SHIFT_SQL, activeModels: uid => { sweep(); return db.prepare("SELECT model_id, reinforce FROM clocks WHERE user_id = ? AND end_at IS NULL ORDER BY reinforce, start_at").all(uid); } };
}
