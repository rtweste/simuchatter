// Planning (créneaux + pointage) et compta par périodes de 15 jours.
// Les dates sont calculées à l'heure de Paris.

const TZ = "Europe/Paris";
const parisDate = ms => new Date(ms).toLocaleDateString("sv-SE", { timeZone: TZ }); // AAAA-MM-JJ
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/* ---------- Périodes : "2026-11-A" (1→15) et "2026-11-B" (16→fin du mois) ---------- */
function periodOfDate(d) { const [y, m, day] = d.split("-"); return `${y}-${m}-${Number(day) <= 15 ? "A" : "B"}`; }
function periodInfo(p) {
  const m = /^(\d{4})-(\d{2})-([AB])$/.exec(p || ""); if (!m) return null;
  const y = +m[1], mo = +m[2], half = m[3];
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const d1 = half === "A" ? 1 : 16, d2 = half === "A" ? 15 : last;
  const pad = n => String(n).padStart(2, "0");
  const prev = half === "B" ? `${y}-${pad(mo)}-A` : (mo === 1 ? `${y - 1}-12-B` : `${y}-${pad(mo - 1)}-B`);
  const next = half === "A" ? `${y}-${pad(mo)}-B` : (mo === 12 ? `${y + 1}-01-A` : `${y}-${pad(mo + 1)}-A`);
  return { key: p, from: `${y}-${pad(mo)}-${pad(d1)}`, to: `${y}-${pad(mo)}-${pad(d2)}`,
    label: `${d1} – ${d2} ${MONTHS[mo - 1]} ${y}`, prev, next };
}
const currentPeriod = () => periodOfDate(parisDate(Date.now()));

module.exports = function mount(app, db, auth, admin, validatedByPeriod) {
  /* ---------- Tables ---------- */
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  if (!cols("models").includes("creator_pct")) db.exec("ALTER TABLE models ADD COLUMN creator_pct REAL NOT NULL DEFAULT 50");
  if (!cols("users").includes("commission_pct")) db.exec("ALTER TABLE users ADD COLUMN commission_pct REAL NOT NULL DEFAULT 10");
  db.exec(`
  CREATE TABLE IF NOT EXISTS revenues (period TEXT NOT NULL, model_id INTEGER NOT NULL, brut REAL, net REAL, PRIMARY KEY (period, model_id));
  CREATE TABLE IF NOT EXISTS shifts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, model_id INTEGER NOT NULL,
    date TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, note TEXT);
  CREATE INDEX IF NOT EXISTS shifts_date ON shifts(date);
  CREATE TABLE IF NOT EXISTS clocks (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, model_id INTEGER NOT NULL,
    start_at INTEGER NOT NULL, end_at INTEGER, edited INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS clocks_start ON clocks(start_at);
  CREATE TABLE IF NOT EXISTS attributions (period TEXT NOT NULL, user_id INTEGER NOT NULL, model_id INTEGER NOT NULL, amount REAL NOT NULL,
    PRIMARY KEY (period, user_id, model_id));
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  `);
  const getSetting = (k, d) => db.prepare("SELECT value FROM settings WHERE key = ?").get(k)?.value ?? d;

  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  const isTime = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || "");
  const num = (v, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
  const modelExists = id => !!db.prepare("SELECT 1 FROM models WHERE id = ?").get(id);
  const userExists = id => !!db.prepare("SELECT 1 FROM users WHERE id = ?").get(id);

  /* ================= PLANNING : créneaux ================= */
  app.get("/api/shifts", auth, (req, res) => {
    const { from, to } = req.query;
    if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: "Dates invalides" });
    res.json({
      shifts: db.prepare(`SELECT s.*, u.username, m.name model_name FROM shifts s
        JOIN users u ON u.id = s.user_id JOIN models m ON m.id = s.model_id
        WHERE s.date BETWEEN ? AND ? ORDER BY s.date, s.start`).all(from, to),
      people: db.prepare("SELECT id, username, role FROM users WHERE active = 1 ORDER BY role DESC, username").all(),
      models: db.prepare("SELECT id, name FROM models ORDER BY name").all(),
      me: req.user.id
    });
  });
  function shiftBody(b) {
    const user_id = parseInt(b.user_id, 10), model_id = parseInt(b.model_id, 10);
    if (!userExists(user_id) || !modelExists(model_id)) return { error: "Chatter ou créatrice invalide" };
    if (!isDate(b.date) || !isTime(b.start) || !isTime(b.end)) return { error: "Date ou heures invalides" };
    if (b.start === b.end) return { error: "L'heure de fin doit être différente du début" };
    return { user_id, model_id, date: b.date, start: b.start, end: b.end, note: String(b.note || "").slice(0, 200) };
  }
  app.post("/api/admin/shifts", auth, admin, (req, res) => {
    const s = shiftBody(req.body || {}); if (s.error) return res.status(400).json(s);
    const repeat = Math.min(Math.max(parseInt(req.body.repeatWeeks || 0, 10) || 0, 0), 12);
    const ins = db.prepare("INSERT INTO shifts (user_id, model_id, date, start, end, note) VALUES (?,?,?,?,?,?)");
    for (let w = 0; w <= repeat; w++) {
      const d = new Date(s.date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 7 * w);
      ins.run(s.user_id, s.model_id, d.toISOString().slice(0, 10), s.start, s.end, s.note);
    }
    res.json({ ok: true });
  });
  app.put("/api/admin/shifts/:id", auth, admin, (req, res) => {
    const s = shiftBody(req.body || {}); if (s.error) return res.status(400).json(s);
    db.prepare("UPDATE shifts SET user_id=?, model_id=?, date=?, start=?, end=?, note=? WHERE id=?")
      .run(s.user_id, s.model_id, s.date, s.start, s.end, s.note, parseInt(req.params.id, 10));
    res.json({ ok: true });
  });
  app.delete("/api/admin/shifts/:id", auth, admin, (req, res) => {
    db.prepare("DELETE FROM shifts WHERE id = ?").run(parseInt(req.params.id, 10)); res.json({ ok: true });
  });

  /* ================= PLANNING : pointage ================= */
  const openClock = uid => db.prepare(`SELECT c.*, m.name model_name FROM clocks c JOIN models m ON m.id = c.model_id
    WHERE c.user_id = ? AND c.end_at IS NULL`).get(uid);

  app.get("/api/clock/me", auth, (req, res) => {
    const p = periodInfo(req.query.period) || periodInfo(currentPeriod());
    const rows = db.prepare(`SELECT c.*, m.name model_name FROM clocks c JOIN models m ON m.id = c.model_id
      WHERE c.user_id = ? ORDER BY c.start_at DESC LIMIT 200`).all(req.user.id)
      .filter(c => periodOfDate(parisDate(c.start_at)) === p.key);
    const hours = rows.reduce((t, c) => t + ((c.end_at || Date.now()) - c.start_at) / 3.6e6, 0);
    const today = parisDate(Date.now());
    const upcoming = db.prepare(`SELECT s.*, m.name model_name FROM shifts s JOIN models m ON m.id = s.model_id
      WHERE s.user_id = ? AND s.date >= ? ORDER BY s.date, s.start LIMIT 10`).all(req.user.id, today);
    res.json({ open: openClock(req.user.id) || null, period: p, clocks: rows, hours, upcoming,
      models: db.prepare("SELECT id, name FROM models ORDER BY name").all() });
  });
  app.post("/api/clock/in", auth, (req, res) => {
    const model_id = parseInt(req.body?.model_id, 10);
    if (!modelExists(model_id)) return res.status(400).json({ error: "Choisissez une créatrice" });
    if (openClock(req.user.id)) return res.status(400).json({ error: "Un shift est déjà en cours" });
    db.prepare("INSERT INTO clocks (user_id, model_id, start_at) VALUES (?,?,?)").run(req.user.id, model_id, Date.now());
    res.json({ ok: true });
  });
  app.post("/api/clock/out", auth, (req, res) => {
    const c = openClock(req.user.id); if (!c) return res.status(400).json({ error: "Aucun shift en cours" });
    db.prepare("UPDATE clocks SET end_at = ? WHERE id = ?").run(Date.now(), c.id);
    res.json({ ok: true });
  });

  app.get("/api/admin/clocks", auth, admin, (req, res) => {
    const p = periodInfo(req.query.period) || periodInfo(currentPeriod());
    const rows = db.prepare(`SELECT c.*, u.username, m.name model_name FROM clocks c
      JOIN users u ON u.id = c.user_id JOIN models m ON m.id = c.model_id ORDER BY c.start_at DESC LIMIT 2000`).all();
    res.json({
      period: p,
      clocks: rows.filter(c => periodOfDate(parisDate(c.start_at)) === p.key),
      live: rows.filter(c => !c.end_at),
      people: db.prepare("SELECT id, username FROM users WHERE active = 1 ORDER BY username").all(),
      models: db.prepare("SELECT id, name FROM models ORDER BY name").all()
    });
  });
  function clockBody(b) {
    const user_id = parseInt(b.user_id, 10), model_id = parseInt(b.model_id, 10);
    const start_at = num(b.start_at, 1e12, 1e13), end_at = b.end_at == null || b.end_at === "" ? null : num(b.end_at, 1e12, 1e13);
    if (!userExists(user_id) || !modelExists(model_id) || !start_at) return { error: "Données invalides" };
    if (end_at !== null && end_at <= start_at) return { error: "La fin doit être après le début" };
    if (end_at !== null && end_at - start_at > 24 * 3.6e6) return { error: "Un shift ne peut pas dépasser 24 h" };
    return { user_id, model_id, start_at, end_at };
  }
  app.post("/api/admin/clocks", auth, admin, (req, res) => {
    const c = clockBody(req.body || {}); if (c.error) return res.status(400).json(c);
    if (c.end_at === null) return res.status(400).json({ error: "Indiquez l'heure de fin" });
    db.prepare("INSERT INTO clocks (user_id, model_id, start_at, end_at, edited) VALUES (?,?,?,?,1)").run(c.user_id, c.model_id, c.start_at, c.end_at);
    res.json({ ok: true });
  });
  app.put("/api/admin/clocks/:id", auth, admin, (req, res) => {
    const c = clockBody(req.body || {}); if (c.error) return res.status(400).json(c);
    db.prepare("UPDATE clocks SET user_id=?, model_id=?, start_at=?, end_at=?, edited=1 WHERE id=?")
      .run(c.user_id, c.model_id, c.start_at, c.end_at, parseInt(req.params.id, 10));
    res.json({ ok: true });
  });
  app.delete("/api/admin/clocks/:id", auth, admin, (req, res) => {
    db.prepare("DELETE FROM clocks WHERE id = ?").run(parseInt(req.params.id, 10)); res.json({ ok: true });
  });

  /* ================= COMPTA ================= */
  function computeCompta(pkey) {
    const p = periodInfo(pkey);
    const base = getSetting("commission_base", "net"); // "net" ou "brut"
    const mode = getSetting("attribution_mode", "ventes"); // "ventes" (ventes validées) ou "heures"
    const fee = Number(getSetting("platform_fee", "25"));
    const validated = validatedByPeriod ? validatedByPeriod(p.key) : {};
    const models = db.prepare(`SELECT m.id, m.name, m.creator_pct, r.brut, r.net FROM models m
      LEFT JOIN revenues r ON r.model_id = m.id AND r.period = ? ORDER BY m.name`).all(p.key);
    const users = db.prepare("SELECT id, username, role, active, commission_pct FROM users ORDER BY username").all();
    // heures pointées par chatter et par créatrice (shifts terminés, rattachés à la période de leur début)
    const hours = {};
    db.prepare("SELECT user_id, model_id, start_at, end_at FROM clocks WHERE end_at IS NOT NULL").all()
      .filter(c => periodOfDate(parisDate(c.start_at)) === p.key)
      .forEach(c => { const k = c.user_id + ":" + c.model_id; hours[k] = (hours[k] || 0) + (c.end_at - c.start_at) / 3.6e6; });
    const overrides = {};
    db.prepare("SELECT user_id, model_id, amount FROM attributions WHERE period = ?").all(p.key)
      .forEach(a => overrides[a.user_id + ":" + a.model_id] = a.amount);

    const modelRows = models.map(m => {
      const totalH = users.reduce((t, u) => t + (hours[u.id + ":" + m.id] || 0), 0);
      const net = m.net || 0, brut = m.brut || 0;
      const creatorPay = net * m.creator_pct / 100;
      return { ...m, brut: m.brut, net: m.net, totalHours: totalH, creatorPay, agencyShare: net - creatorPay,
        commissionBase: base === "brut" ? brut : net };
    });
    const lines = [];
    users.forEach(u => modelRows.forEach(m => {
      const k = u.id + ":" + m.id, h = hours[k] || 0, ov = overrides[k], v = validated[k] || 0;
      if (!h && ov === undefined && !v) return;
      const auto = mode === "ventes"
        ? (base === "brut" ? v : Math.round(v * (1 - fee / 100) * 100) / 100)
        : (m.totalHours > 0 ? m.commissionBase * h / m.totalHours : 0);
      const sales = ov !== undefined ? ov : auto;
      lines.push({ user_id: u.id, username: u.username, model_id: m.id, model_name: m.name, hours: h,
        validatedBrut: v, auto, override: ov ?? null, sales, pct: u.commission_pct, pay: sales * u.commission_pct / 100 });
    }));
    modelRows.forEach(m => { m.attributed = lines.filter(l => l.model_id === m.id).reduce((t, l) => t + l.sales, 0); });
    const chatters = users.filter(u => u.role === "chatter" || lines.some(l => l.user_id === u.id)).map(u => {
      const ls = lines.filter(l => l.user_id === u.id);
      return { id: u.id, username: u.username, active: u.active, commission_pct: u.commission_pct,
        hours: ls.reduce((t, l) => t + l.hours, 0), sales: ls.reduce((t, l) => t + l.sales, 0), pay: ls.reduce((t, l) => t + l.pay, 0) };
    });
    const sum = (arr, f) => arr.reduce((t, x) => t + (f(x) || 0), 0);
    const unattributed = mode === "ventes" ? [] : modelRows.filter(m => m.commissionBase > 0 && m.totalHours === 0 &&
      !lines.some(l => l.model_id === m.id)).map(m => m.name);
    const totals = { brut: sum(modelRows, m => m.brut), net: sum(modelRows, m => m.net), creators: sum(modelRows, m => m.creatorPay),
      agencyShare: sum(modelRows, m => m.agencyShare), chatters: sum(chatters, c => c.pay) };
    totals.margin = totals.agencyShare - totals.chatters;
    return { period: p, base, mode, fee, models: modelRows, lines, chatters, totals, unattributed };
  }

  app.get("/api/admin/compta", auth, admin, (req, res) => {
    res.json(computeCompta(periodInfo(req.query.period) ? req.query.period : currentPeriod()));
  });
  // Historique pour les graphiques : totaux des N dernières périodes jusqu'à la période demandée
  app.get("/api/admin/compta/history", auth, admin, (req, res) => {
    let key = periodInfo(req.query.period) ? req.query.period : currentPeriod();
    const n = Math.max(2, Math.min(24, parseInt(req.query.n, 10) || 7)), out = [];
    for (let i = 0; i < n; i++) {
      const c = computeCompta(key), p = c.period;
      out.unshift({ key: p.key, label: p.label, from: p.from, ...c.totals });
      key = p.prev;
    }
    res.json({ periods: out });
  });
  app.put("/api/admin/revenue", auth, admin, (req, res) => {
    const { period } = req.body || {}; const model_id = parseInt(req.body?.model_id, 10);
    if (!periodInfo(period) || !modelExists(model_id)) return res.status(400).json({ error: "Données invalides" });
    const empty = req.body.brut === "" || req.body.brut == null;
    const brut = empty ? null : num(req.body.brut, 0, 1e9);
    if (!empty && brut === null) return res.status(400).json({ error: "Montant invalide" });
    // CA net = CA brut moins la commission de la plateforme (25 % par défaut)
    const fee = Number(getSetting("platform_fee", "25"));
    const net = brut === null ? null : Math.round(brut * (1 - fee / 100) * 100) / 100;
    db.prepare(`INSERT INTO revenues (period, model_id, brut, net) VALUES (?,?,?,?)
      ON CONFLICT(period, model_id) DO UPDATE SET brut = excluded.brut, net = excluded.net`).run(period, model_id, brut, net);
    res.json({ ok: true, net });
  });
  app.put("/api/admin/models/:id/pct", auth, admin, (req, res) => {
    const v = num(req.body?.creator_pct, 0, 100); if (v === null) return res.status(400).json({ error: "Pourcentage entre 0 et 100" });
    db.prepare("UPDATE models SET creator_pct = ? WHERE id = ?").run(v, parseInt(req.params.id, 10)); res.json({ ok: true });
  });
  app.put("/api/admin/users/:id/commission", auth, admin, (req, res) => {
    const v = num(req.body?.commission_pct, 0, 100); if (v === null) return res.status(400).json({ error: "Pourcentage entre 0 et 100" });
    db.prepare("UPDATE users SET commission_pct = ? WHERE id = ?").run(v, parseInt(req.params.id, 10)); res.json({ ok: true });
  });
  app.put("/api/admin/attribution", auth, admin, (req, res) => {
    const { period } = req.body || {}; const user_id = parseInt(req.body?.user_id, 10), model_id = parseInt(req.body?.model_id, 10);
    if (!periodInfo(period) || !userExists(user_id) || !modelExists(model_id)) return res.status(400).json({ error: "Données invalides" });
    if (req.body.amount === null || req.body.amount === "") {
      db.prepare("DELETE FROM attributions WHERE period=? AND user_id=? AND model_id=?").run(period, user_id, model_id);
    } else {
      const a = num(req.body.amount, 0, 1e9); if (a === null) return res.status(400).json({ error: "Montant invalide" });
      db.prepare(`INSERT INTO attributions (period, user_id, model_id, amount) VALUES (?,?,?,?)
        ON CONFLICT(period, user_id, model_id) DO UPDATE SET amount = excluded.amount`).run(period, user_id, model_id, a);
    }
    res.json({ ok: true });
  });
  app.put("/api/admin/settings", auth, admin, (req, res) => {
    const set = (k, v) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, String(v));
    if (req.body?.commission_base !== undefined) {
      if (!["net", "brut"].includes(req.body.commission_base)) return res.status(400).json({ error: "Valeur invalide" });
      set("commission_base", req.body.commission_base);
    }
    if (req.body?.attribution_mode !== undefined) {
      if (!["ventes", "heures"].includes(req.body.attribution_mode)) return res.status(400).json({ error: "Valeur invalide" });
      set("attribution_mode", req.body.attribution_mode);
    }
    if (req.body?.platform_fee !== undefined) {
      const f = num(req.body.platform_fee, 0, 90); if (f === null) return res.status(400).json({ error: "Pourcentage entre 0 et 90" });
      set("platform_fee", f);
      // recalcule le CA net de la période affichée avec le nouveau taux
      if (periodInfo(req.body.period)) db.prepare("UPDATE revenues SET net = ROUND(brut * (1 - ? / 100.0), 2) WHERE period = ? AND brut IS NOT NULL").run(f, req.body.period);
    }
    res.json({ ok: true });
  });

  /* ================= ACCUEIL : résumé selon le rôle ================= */
  app.get("/api/home", auth, (req, res) => {
    const p = periodInfo(currentPeriod()), now = Date.now(), today = parisDate(now);
    const week = now - 7 * 864e5;
    const inP = ms => periodOfDate(parisDate(ms)) === p.key;
    const fee = Number(getSetting("platform_fee", "25")), base = getSetting("commission_base", "net");
    const upcomingOf = uid => db.prepare(`SELECT s.date, s.start, s.end, m.name model_name FROM shifts s JOIN models m ON m.id = s.model_id
      WHERE s.user_id = ? AND s.date >= ? ORDER BY s.date, s.start LIMIT 4`).all(uid, today);
    const openOf = uid => db.prepare(`SELECT c.start_at, c.model_id, m.name model_name FROM clocks c JOIN models m ON m.id = c.model_id
      WHERE c.user_id = ? AND c.end_at IS NULL`).get(uid) || null;
    const sims = db.prepare("SELECT user_id, score, started_at FROM sims WHERE status = 'done' AND started_at >= ?").all(week);

    if (req.user.role !== "admin") {
      const u = db.prepare("SELECT commission_pct FROM users WHERE id = ?").get(req.user.id);
      const mine = db.prepare("SELECT amount, status, sold_at FROM sales WHERE user_id = ?").all(req.user.id).filter(s => inP(s.sold_at));
      const validated = mine.filter(s => s.status === "validated").reduce((t, s) => t + s.amount, 0);
      const pending = mine.filter(s => s.status === "pending").reduce((t, s) => t + s.amount, 0);
      const baseAmt = base === "brut" ? validated : validated * (1 - fee / 100);
      const hours = db.prepare("SELECT start_at, end_at FROM clocks WHERE user_id = ?").all(req.user.id)
        .filter(c => inP(c.start_at)).reduce((t, c) => t + ((c.end_at || now) - c.start_at) / 3.6e6, 0);
      const last = db.prepare("SELECT score, persona_id, started_at FROM sims WHERE user_id = ? AND status = 'done' ORDER BY started_at DESC LIMIT 1").get(req.user.id);
      const my7 = sims.filter(x => x.user_id === req.user.id);
      return res.json({ role: "chatter", period: p, open: openOf(req.user.id), upcoming: upcomingOf(req.user.id),
        models: db.prepare("SELECT id, name FROM models ORDER BY name").all(),
        sales: { validated, pending, count: mine.length, refused: mine.filter(s => s.status === "refused").length,
          commission: Math.round(baseAmt * (u?.commission_pct || 0)) / 100, pct: u?.commission_pct || 0 },
        hours, simu: { last: last || null, week: my7.length, avg: my7.length ? Math.round(my7.reduce((t, x) => t + x.score, 0) / my7.length) : null } });
    }
    const c = computeCompta(p.key);
    const live = db.prepare(`SELECT c.start_at, u.username, m.name model_name FROM clocks c JOIN users u ON u.id = c.user_id
      JOIN models m ON m.id = c.model_id WHERE c.end_at IS NULL ORDER BY c.start_at`).all();
    const todayShifts = db.prepare(`SELECT s.start, s.end, u.username, m.name model_name FROM shifts s JOIN users u ON u.id = s.user_id
      JOIN models m ON m.id = s.model_id WHERE s.date = ? ORDER BY s.start`).all(today);
    const pendingSales = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) total FROM sales WHERE status = 'pending'").get();
    const board = {};
    db.prepare("SELECT s.user_id, u.username, s.amount, s.sold_at FROM sales s JOIN users u ON u.id = s.user_id WHERE s.status = 'validated'").all()
      .filter(s => inP(s.sold_at)).forEach(s => { board[s.username] = (board[s.username] || 0) + s.amount; });
    res.json({ role: "admin", period: p, totals: c.totals,
      missingRevenue: c.models.filter(m => m.brut == null).map(m => m.name),
      pendingSales, live, todayShifts,
      leaderboard: Object.entries(board).map(([username, total]) => ({ username, total })).sort((a, b) => b.total - a.total).slice(0, 5),
      simu: { week: sims.length, avg: sims.length ? Math.round(sims.reduce((t, x) => t + x.score, 0) / sims.length) : null } });
  });

  return { periodInfo, periodOfDate, computeCompta };
};
