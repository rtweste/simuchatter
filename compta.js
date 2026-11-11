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

// Commission des chatters par paliers (sur le net de la période) : chaque taux ne s'applique qu'à sa tranche, primes cumulées
// (modifiables dans Gestion → Réglages : enregistrés dans les réglages de l'agence)
const DEFAULT_TIERS = [{ from: 0, rate: 10 }, { from: 500, rate: 12 }, { from: 1000, rate: 14 }, { from: 1400, rate: 15 },
  { from: 2000, rate: 15, prime: 10 }, { from: 3000, rate: 15, prime: 20 }, { from: 4000, rate: 15, prime: 40 }];
let TIERS = DEFAULT_TIERS, BANDS = [];
function setTiers(list) {
  const t = (Array.isArray(list) && list.length ? list : DEFAULT_TIERS).map(x => ({ from: Math.max(0, +x.from || 0), rate: Math.max(0, +x.rate || 0), ...(+x.prime > 0 ? { prime: +x.prime } : {}) }))
    .sort((a, b) => a.from - b.from);
  t[0].from = 0;
  // un palier « prime » garde le taux du palier précédent
  t.forEach((x, i) => { if (x.prime && i > 0 && !x.rate) x.rate = t[i - 1].rate; });
  TIERS = t;
  const rates = []; t.forEach(x => { if (!rates.length || rates[rates.length - 1][2] !== x.rate) rates.push([x.from, 0, x.rate]); });
  BANDS = rates.map((r, i) => [r[0], i < rates.length - 1 ? rates[i + 1][0] : Infinity, r[2]]);
}
setTiers(DEFAULT_TIERS);
function tierPay(net) {
  net = Math.max(0, net || 0);
  const commission = BANDS.reduce((t, [a, b, r]) => t + Math.max(0, Math.min(net, b) - a) * r / 100, 0);
  const prime = TIERS.filter(t => t.prime && net >= t.from).reduce((m, t) => Math.max(m, t.prime), 0);
  const idx = TIERS.reduce((k, t, i) => net >= t.from ? i : k, 0);
  return { net, commission: Math.round(commission * 100) / 100, prime, total: Math.round((commission + prime) * 100) / 100, rate: TIERS[idx].rate, tier: idx };
}

module.exports = function mount(app, db, auth, admin, validatedByPeriod) {
  /* ---------- Tables ---------- */
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  if (!cols("models").includes("creator_pct")) db.exec("ALTER TABLE models ADD COLUMN creator_pct REAL NOT NULL DEFAULT 50");
  if (!cols("users").includes("commission_pct")) db.exec("ALTER TABLE users ADD COLUMN commission_pct REAL NOT NULL DEFAULT 10");
  db.exec(`
  CREATE TABLE IF NOT EXISTS revenues (period TEXT NOT NULL, model_id INTEGER NOT NULL, brut REAL, net REAL, PRIMARY KEY (period, model_id));
  CREATE TABLE IF NOT EXISTS ca_snaps (period TEXT NOT NULL, date TEXT NOT NULL, brut REAL NOT NULL, PRIMARY KEY (period, date));
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
  // renfort : pointage parallèle sur une 2e créatrice pendant un shift (reinforce = 1, parent_id = pointage principal)
  if (!cols("clocks").includes("reinforce")) db.exec("ALTER TABLE clocks ADD COLUMN reinforce INTEGER NOT NULL DEFAULT 0");
  if (!cols("clocks").includes("parent_id")) db.exec("ALTER TABLE clocks ADD COLUMN parent_id INTEGER");
  if (!cols("clocks").includes("until_at")) db.exec("ALTER TABLE clocks ADD COLUMN until_at INTEGER");
  // CA par sources : chatting automatique (ventes validées) + entrées manuelles déjà nettes
  ["abo", "live", "coll", "push"].forEach(c => { if (!cols("revenues").includes(c)) db.exec(`ALTER TABLE revenues ADD COLUMN ${c} REAL`); });
  if (!cols("revenues").includes("v2")) db.exec("ALTER TABLE revenues ADD COLUMN v2 INTEGER NOT NULL DEFAULT 0");
  db.exec(`
  CREATE TABLE IF NOT EXISTS payouts (period TEXT NOT NULL, user_id INTEGER NOT NULL, amount REAL NOT NULL, paid_at INTEGER NOT NULL, paid_by INTEGER, PRIMARY KEY (period, user_id));
  CREATE TABLE IF NOT EXISTS pay_adjust (id INTEGER PRIMARY KEY, period TEXT NOT NULL, user_id INTEGER NOT NULL, amount REAL NOT NULL, reason TEXT, created_at INTEGER NOT NULL, created_by INTEGER);
  CREATE TABLE IF NOT EXISTS creator_paid (period TEXT NOT NULL, model_id INTEGER NOT NULL, amount REAL NOT NULL, paid_at INTEGER NOT NULL, PRIMARY KEY (period, model_id));
  CREATE TABLE IF NOT EXISTS period_locks (period TEXT PRIMARY KEY, closed_at INTEGER NOT NULL, closed_by INTEGER, snapshot TEXT);
  `);
  const SRC = ["abo", "live", "coll", "push"];
  const lockOf = pkey => db.prepare("SELECT l.*, u.username closed_name FROM period_locks l LEFT JOIN users u ON u.id = l.closed_by WHERE l.period = ?").get(pkey);
  const isLocked = pkey => !!db.prepare("SELECT 1 FROM period_locks WHERE period = ?").get(pkey);
  const lockedMsg = { error: "Cette période est clôturée : rouvre-la dans la Compta pour la modifier" };
  const getSetting = (k, d) => db.prepare("SELECT value FROM settings WHERE key = ?").get(k)?.value ?? d;
  try { const ag = JSON.parse(getSetting("agency", "{}")); if (ag.tiers) setTiers(ag.tiers); } catch (e) {}
  const hooks = {};   // branchés par gestion.js : perte de prime (sanction), dossier du chatter

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
    WHERE c.user_id = ? AND c.end_at IS NULL AND c.reinforce = 0`).get(uid);

  app.get("/api/clock/me", auth, (req, res) => {
    const p = periodInfo(req.query.period) || periodInfo(currentPeriod());
    const rows = db.prepare(`SELECT c.*, m.name model_name FROM clocks c JOIN models m ON m.id = c.model_id
      WHERE c.user_id = ? AND c.reinforce = 0 ORDER BY c.start_at DESC LIMIT 200`).all(req.user.id)
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
    const now = Date.now();
    db.prepare("UPDATE clocks SET end_at = ? WHERE id = ?").run(now, c.id);
    // les renforts s'arrêtent avec le shift (au plus tard à l'heure prévue)
    db.prepare("UPDATE clocks SET end_at = MIN(?, COALESCE(until_at, ?)) WHERE user_id = ? AND reinforce = 1 AND end_at IS NULL").run(now, now, req.user.id);
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
    if (isLocked(periodOfDate(parisDate(c.start_at)))) return res.status(400).json(lockedMsg);
    if (c.end_at === null) return res.status(400).json({ error: "Indiquez l'heure de fin" });
    db.prepare("INSERT INTO clocks (user_id, model_id, start_at, end_at, edited) VALUES (?,?,?,?,1)").run(c.user_id, c.model_id, c.start_at, c.end_at);
    res.json({ ok: true });
  });
  app.put("/api/admin/clocks/:id", auth, admin, (req, res) => {
    const c = clockBody(req.body || {}); if (c.error) return res.status(400).json(c);
    const old = db.prepare("SELECT start_at FROM clocks WHERE id = ?").get(parseInt(req.params.id, 10));
    if (isLocked(periodOfDate(parisDate(c.start_at))) || (old && isLocked(periodOfDate(parisDate(old.start_at))))) return res.status(400).json(lockedMsg);
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
    const models = db.prepare(`SELECT m.id, m.name, m.creator_pct, r.brut, r.net, r.abo, r.live, r.coll, r.push, r.v2 FROM models m
      LEFT JOIN revenues r ON r.model_id = m.id AND r.period = ? ORDER BY m.name`).all(p.key);
    // chatting = ventes validées sur la créatrice (déclarées en brut)
    const chatBy = {}, chatN = {};
    Object.entries(validated).forEach(([k, v]) => { const mid = +k.split(":")[1]; chatBy[mid] = (chatBy[mid] || 0) + v; });
    db.prepare("SELECT model_id, sold_at FROM sales WHERE status = 'validated'").all().filter(x => periodOfDate(parisDate(x.sold_at)) === p.key)
      .forEach(x => chatN[x.model_id] = (chatN[x.model_id] || 0) + 1);
    const paidC = {}; db.prepare("SELECT model_id, amount, paid_at FROM creator_paid WHERE period = ?").all(p.key).forEach(x => paidC[x.model_id] = x);
    const keep = fee < 100 ? 1 - fee / 100 : 1;
    const users = db.prepare("SELECT id, username, role, active, commission_pct FROM users ORDER BY username").all();
    // heures pointées par chatter et par créatrice (shifts terminés, rattachés à la période de leur début)
    const hours = {};
    db.prepare("SELECT user_id, model_id, start_at, end_at FROM clocks WHERE end_at IS NOT NULL").all()
      .filter(c => periodOfDate(parisDate(c.start_at)) === p.key)
      .forEach(c => { const k = c.user_id + ":" + c.model_id; hours[k] = (hours[k] || 0) + (c.end_at - c.start_at) / 3.6e6; });
    const overrides = {};
    db.prepare("SELECT user_id, model_id, amount FROM attributions WHERE period = ?").all(p.key)
      .forEach(a => overrides[a.user_id + ":" + a.model_id] = a.amount);

    const r2 = x => Math.round(x * 100) / 100;
    const modelRows = models.map(m => {
      const totalH = users.reduce((t, u) => t + (hours[u.id + ":" + m.id] || 0), 0);
      const chatBrut = r2(chatBy[m.id] || 0), chatNet = r2(chatBrut * keep);
      const legacy = !m.v2 && m.brut != null;   // CA saisi d'un bloc avant les sources
      const manual = SRC.reduce((t, k) => t + (m[k] || 0), 0);
      const net = legacy ? (m.net || 0) : r2(chatNet + manual), brut = legacy ? m.brut : chatBrut + manual / keep;
      const missing = legacy ? [] : SRC.filter(k => m[k] == null);
      const creatorPay = r2(net * m.creator_pct / 100), cp = paidC[m.id];
      return { id: m.id, name: m.name, creator_pct: m.creator_pct, brut, net, legacy, chatBrut, chatNet, chatCount: chatN[m.id] || 0,
        sources: { abo: m.abo, live: m.live, coll: m.coll, push: m.push }, missing,
        totalHours: totalH, creatorPay, creatorPaid: cp ? cp.amount : 0, creatorPaidAt: cp ? cp.paid_at : null, agencyShare: net - creatorPay,
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
    const adjs = db.prepare("SELECT a.*, u.username by_name FROM pay_adjust a LEFT JOIN users u ON u.id = a.created_by WHERE a.period = ? ORDER BY a.created_at").all(p.key);
    const pays = {}; db.prepare("SELECT * FROM payouts WHERE period = ?").all(p.key).forEach(x => pays[x.user_id] = x);
    const rfH = {}; db.prepare("SELECT user_id, start_at, end_at FROM clocks WHERE reinforce = 1 AND end_at IS NOT NULL").all()
      .filter(c => periodOfDate(parisDate(c.start_at)) === p.key).forEach(c => rfH[c.user_id] = (rfH[c.user_id] || 0) + (c.end_at - c.start_at) / 3.6e6);
    const nSales = {}; db.prepare("SELECT user_id, sold_at FROM sales WHERE status = 'validated'").all().filter(x => periodOfDate(parisDate(x.sold_at)) === p.key).forEach(x => nSales[x.user_id] = (nSales[x.user_id] || 0) + 1);
    const chatters = users.filter(u => u.role === "chatter" || lines.some(l => l.user_id === u.id) || adjs.some(a => a.user_id === u.id)).map(u => {
      const ls = lines.filter(l => l.user_id === u.id), sales = ls.reduce((t, l) => t + l.sales, 0), tp = tierPay(sales);
      // la commission par paliers est répartie sur chaque créatrice au prorata des ventes
      ls.forEach(l => { l.pay = sales > 0 ? tp.total * l.sales / sales : 0; l.pct = tp.rate; });
      const lost = tp.prime > 0 && hooks.primeLost && hooks.primeLost(u.id, p.key);
      if (lost) { tp.total = r2(tp.total - tp.prime); tp.primeLost = tp.prime; tp.prime = 0; }
      const adj = adjs.filter(a => a.user_id === u.id), adjT = adj.reduce((t, a) => t + a.amount, 0), pay = r2(tp.total + adjT);
      // heures : les renforts sont comptés à part (ils ne doublent pas le temps de travail)
      const hRf = rfH[u.id] || 0, hAll = ls.reduce((t, l) => t + l.hours, 0);
      return { id: u.id, username: u.username, active: u.active, commission_pct: tp.rate, rate: tp.rate, tier: tp.tier, prime: tp.prime, primeLost: tp.primeLost || 0, commission: tp.commission,
        hours: hAll - hRf, renfortHours: hRf, sales, salesCount: nSales[u.id] || 0, salesBrut: ls.reduce((t, l) => t + l.validatedBrut, 0),
        adjustments: adj.map(a => ({ id: a.id, amount: a.amount, reason: a.reason, at: a.created_at, by: a.by_name })), adjTotal: adjT, pay,
        paid: pays[u.id] ? { amount: pays[u.id].amount, at: pays[u.id].paid_at } : null };
    });
    const sum = (arr, f) => arr.reduce((t, x) => t + (f(x) || 0), 0);
    const unattributed = mode === "ventes" ? [] : modelRows.filter(m => m.commissionBase > 0 && m.totalHours === 0 &&
      !lines.some(l => l.model_id === m.id)).map(m => m.name);
    const totals = { brut: sum(modelRows, m => m.brut), net: sum(modelRows, m => m.net), creators: sum(modelRows, m => m.creatorPay),
      agencyShare: sum(modelRows, m => m.agencyShare), chatters: sum(chatters, c => c.pay) };
    totals.margin = totals.agencyShare - totals.chatters;
    totals.brut = r2(totals.brut); totals.platform = r2(totals.brut - totals.net);
    totals.sources = { chat: sum(modelRows, m => m.legacy ? 0 : m.chatNet), legacy: sum(modelRows, m => m.legacy ? m.net : 0) };
    SRC.forEach(k => totals.sources[k] = sum(modelRows, m => m.legacy ? 0 : m.sources[k]));
    return { period: p, base, mode, fee, models: modelRows, lines, chatters, totals, unattributed };
  }

  // compta d'une période : figée telle qu'au moment de la clôture, paiements toujours à jour
  function comptaOf(pkey) {
    const lk = lockOf(pkey);
    let c = null; if (lk && lk.snapshot) { try { c = JSON.parse(lk.snapshot); } catch (e) {} }
    if (!c) c = computeCompta(pkey);
    if (lk) {
      const pays = {}; db.prepare("SELECT * FROM payouts WHERE period = ?").all(pkey).forEach(x => pays[x.user_id] = x);
      c.chatters.forEach(ch => ch.paid = pays[ch.id] ? { amount: pays[ch.id].amount, at: pays[ch.id].paid_at } : null);
      const pc = {}; db.prepare("SELECT * FROM creator_paid WHERE period = ?").all(pkey).forEach(x => pc[x.model_id] = x);
      c.models.forEach(m => { m.creatorPaid = pc[m.id] ? pc[m.id].amount : 0; m.creatorPaidAt = pc[m.id] ? pc[m.id].paid_at : null; });
    }
    c.locked = lk ? { at: lk.closed_at, by: lk.closed_name } : null;
    return c;
  }
  app.get("/api/admin/compta", auth, admin, (req, res) => {
    const key = periodInfo(req.query.period) ? req.query.period : currentPeriod(), c = comptaOf(key), p = c.period;
    const today = parisDate(Date.now());
    const pend = db.prepare("SELECT amount, sold_at FROM sales WHERE status = 'pending'").all().filter(x => periodOfDate(parisDate(x.sold_at)) === key);
    const prev = computeCompta(p.prev).totals;
    const running = today >= p.from && today <= p.to, el = running ? periodElapsed(p, today) : 1;
    res.json({ ...c, pending: { n: pend.length, total: pend.reduce((t, x) => t + x.amount, 0) }, prev: { brut: prev.brut, net: prev.net, margin: prev.margin },
      running, elapsed: el, dayOf: running ? +today.slice(8) - +p.from.slice(8) + 1 : null, nDays: +p.to.slice(8) - +p.from.slice(8) + 1,
      projection: running ? Math.round(c.totals.brut / el) : null,
      goals: { ca: Number(getSetting("goal_ca", "20000")), chatter: Number(getSetting("goal_chatter", "300")) }, bands: BANDS.map(b => [b[0], b[1] === Infinity ? null : b[1], b[2]]) });
  });
  // récap d'un mois entier : les deux quinzaines additionnées
  app.get("/api/admin/compta/month", auth, admin, (req, res) => {
    const m = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : currentPeriod().slice(0, 7);
    const [y, mo] = m.split("-").map(Number);
    const halves = ["A", "B"].map(h => comptaOf(`${m}-${h}`));
    const tot = {}; ["brut", "net", "creators", "chatters", "margin", "platform"].forEach(k => tot[k] = halves.reduce((t, c) => t + (c.totals[k] || 0), 0));
    tot.sources = {}; ["chat", "legacy", ...SRC].forEach(k => tot.sources[k] = halves.reduce((t, c) => t + (c.totals.sources?.[k] || 0), 0));
    const ch = {}; halves.forEach((c, i) => c.chatters.forEach(x => { const o = ch[x.id] = ch[x.id] || { id: x.id, username: x.username, pay: 0, sales: 0, halves: [null, null], paidAll: true };
      o.pay += x.pay; o.sales += x.sales; o.halves[i] = { pay: x.pay, paid: !!x.paid }; if (x.pay > 0 && !x.paid) o.paidAll = false; }));
    const md = {}; halves.forEach(c => c.models.forEach(x => { const o = md[x.id] = md[x.id] || { id: x.id, name: x.name, net: 0, brut: 0, creatorPay: 0, creatorPaid: 0 };
      o.net += x.net; o.brut += x.brut; o.creatorPay += x.creatorPay; o.creatorPaid += x.creatorPaid; }));
    const pm = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`, nm = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
    const prevM = ["A", "B"].reduce((t, h) => t + computeCompta(`${pm}-${h}`).totals.brut, 0);
    res.json({ month: m, label: new Date(Date.UTC(y, mo - 1, 15)).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }), prev: pm, next: nm,
      halves: halves.map(c => ({ key: c.period.key, label: c.period.label, totals: c.totals, locked: c.locked, paid: c.chatters.filter(x => x.paid).length, payable: c.chatters.filter(x => x.pay > 0).length })),
      totals: tot, prevBrut: prevM, chatters: Object.values(ch).filter(x => x.pay || x.sales).sort((a, b) => b.pay - a.pay), models: Object.values(md) });
  });
  /* ----- paie : paiements, primes / retenues ----- */
  app.post("/api/admin/payouts", auth, admin, (req, res) => {
    const { period } = req.body || {}, user_id = parseInt(req.body?.user_id, 10);
    if (!periodInfo(period) || !userExists(user_id)) return res.status(400).json({ error: "Données invalides" });
    if (req.body.paid === false) db.prepare("DELETE FROM payouts WHERE period = ? AND user_id = ?").run(period, user_id);
    else { const c = comptaOf(period).chatters.find(x => x.id === user_id); if (!c) return res.status(400).json({ error: "Rien à payer" });
      db.prepare(`INSERT INTO payouts (period, user_id, amount, paid_at, paid_by) VALUES (?,?,?,?,?) ON CONFLICT(period, user_id) DO UPDATE SET amount = excluded.amount, paid_at = excluded.paid_at, paid_by = excluded.paid_by`)
        .run(period, user_id, c.pay, Date.now(), req.user.id); }
    res.json({ ok: true });
  });
  app.post("/api/admin/adjustments", auth, admin, (req, res) => {
    const { period } = req.body || {}, user_id = parseInt(req.body?.user_id, 10), amount = num(req.body?.amount, -100000, 100000);
    if (!periodInfo(period) || !userExists(user_id) || !amount) return res.status(400).json({ error: "Montant invalide" });
    if (isLocked(period)) return res.status(400).json(lockedMsg);
    db.prepare("INSERT INTO pay_adjust (period, user_id, amount, reason, created_at, created_by) VALUES (?,?,?,?,?,?)").run(period, user_id, amount, String(req.body.reason || "").slice(0, 160), Date.now(), req.user.id);
    res.json({ ok: true });
  });
  app.delete("/api/admin/adjustments/:id", auth, admin, (req, res) => {
    const a = db.prepare("SELECT * FROM pay_adjust WHERE id = ?").get(parseInt(req.params.id, 10)); if (!a) return res.status(404).json({ error: "Introuvable" });
    if (isLocked(a.period)) return res.status(400).json(lockedMsg);
    db.prepare("DELETE FROM pay_adjust WHERE id = ?").run(a.id); res.json({ ok: true });
  });
  app.post("/api/admin/creator-paid", auth, admin, (req, res) => {
    const { period } = req.body || {}, model_id = parseInt(req.body?.model_id, 10);
    if (!periodInfo(period) || !modelExists(model_id)) return res.status(400).json({ error: "Données invalides" });
    if (req.body.paid === false) db.prepare("DELETE FROM creator_paid WHERE period = ? AND model_id = ?").run(period, model_id);
    else { const m = comptaOf(period).models.find(x => x.id === model_id);
      db.prepare(`INSERT INTO creator_paid (period, model_id, amount, paid_at) VALUES (?,?,?,?) ON CONFLICT(period, model_id) DO UPDATE SET amount = excluded.amount, paid_at = excluded.paid_at`).run(period, model_id, m ? m.creatorPay : 0, Date.now()); }
    res.json({ ok: true });
  });
  /* ----- clôture d'une période ----- */
  app.post("/api/admin/periods/:key/close", auth, admin, (req, res) => {
    const key = req.params.key; if (!periodInfo(key)) return res.status(400).json({ error: "Période invalide" });
    if (isLocked(key)) return res.json({ ok: true });
    db.prepare("INSERT INTO period_locks (period, closed_at, closed_by, snapshot) VALUES (?,?,?,?)").run(key, Date.now(), req.user.id, JSON.stringify(computeCompta(key)));
    res.json({ ok: true });
  });
  app.post("/api/admin/periods/:key/reopen", auth, admin, (req, res) => {
    db.prepare("DELETE FROM period_locks WHERE period = ?").run(req.params.key); res.json({ ok: true });
  });
  /* ----- chatter : ma paie ----- */
  app.get("/api/my-pay", auth, (req, res) => {
    const key = periodInfo(req.query.period) ? req.query.period : currentPeriod(), c = comptaOf(key), p = c.period;
    const me = c.chatters.find(x => x.id === req.user.id) || { pay: 0, sales: 0, salesCount: 0, rate: 10, tier: 0, prime: 0, commission: 0, adjustments: [], adjTotal: 0, hours: 0, renfortHours: 0, paid: null };
    const pend = db.prepare("SELECT amount, sold_at FROM sales WHERE user_id = ? AND status = 'pending'").all(req.user.id).filter(x => periodOfDate(parisDate(x.sold_at)) === key);
    const hist = []; let k = p.prev;
    for (let i = 0; i < 6; i++) { const pi = periodInfo(k), cc = comptaOf(k), x = cc.chatters.find(y => y.id === req.user.id);
      if (x && (x.pay || x.paid)) hist.push({ key: k, label: pi.label, pay: x.pay, paid: x.paid }); k = pi.prev; }
    const nx = TIERS[me.tier + 1] || null;
    res.json({ period: p, locked: c.locked, base: c.base, fee: c.fee, me: { ...me, next: nx ? { ...nx, gap: Math.max(0, Math.round((nx.from - me.sales) * 100) / 100) } : null },
      tiers: TIERS, bands: BANDS.map(([a, b, r]) => ({ from: a, to: b === Infinity ? null : b, rate: r, amount: Math.max(0, Math.min(me.sales, b) - a) * r / 100 })),
      pending: { n: pend.length, total: pend.reduce((t, x) => t + x.amount, 0) }, history: hist });
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
  // une entrée manuelle (montant net) : abonnements, live, collections ou média push
  app.put("/api/admin/revenue-source", auth, admin, (req, res) => {
    const { period, source } = req.body || {}; const model_id = parseInt(req.body?.model_id, 10);
    if (!periodInfo(period) || !modelExists(model_id) || !SRC.includes(source)) return res.status(400).json({ error: "Données invalides" });
    if (isLocked(period)) return res.status(400).json(lockedMsg);
    const empty = req.body.amount === "" || req.body.amount == null, v = empty ? null : num(String(req.body.amount).replace(",", "."), 0, 1e9);
    if (!empty && v === null) return res.status(400).json({ error: "Montant invalide" });
    db.prepare(`INSERT INTO revenues (period, model_id, v2, ${source}) VALUES (?,?,1,?) ON CONFLICT(period, model_id) DO UPDATE SET v2 = 1, ${source} = excluded.${source}`).run(period, model_id, v);
    snapCA(period);
    res.json({ ok: true });
  });
  app.put("/api/admin/revenue", auth, admin, (req, res) => {
    const { period } = req.body || {}; const model_id = parseInt(req.body?.model_id, 10);
    if (!periodInfo(period) || !modelExists(model_id)) return res.status(400).json({ error: "Données invalides" });
    if (isLocked(period)) return res.status(400).json(lockedMsg);
    const empty = req.body.brut === "" || req.body.brut == null;
    const brut = empty ? null : num(req.body.brut, 0, 1e9);
    if (!empty && brut === null) return res.status(400).json({ error: "Montant invalide" });
    // CA net = CA brut moins la commission de la plateforme (25 % par défaut)
    const fee = Number(getSetting("platform_fee", "25"));
    const net = brut === null ? null : Math.round(brut * (1 - fee / 100) * 100) / 100;
    db.prepare(`INSERT INTO revenues (period, model_id, brut, net) VALUES (?,?,?,?)
      ON CONFLICT(period, model_id) DO UPDATE SET brut = excluded.brut, net = excluded.net`).run(period, model_id, brut, net);
    snapCA(period);
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
    if (isLocked(period)) return res.status(400).json(lockedMsg);
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
    if (req.body?.goal_ca !== undefined) {
      const g = num(req.body.goal_ca, 0, 1e8); if (g === null) return res.status(400).json({ error: "Objectif invalide" });
      set("goal_ca", g);
    }
    if (req.body?.goal_chatter !== undefined) {
      const g = num(req.body.goal_chatter, 0, 1e7); if (g === null) return res.status(400).json({ error: "Objectif invalide" });
      set("goal_chatter", g);
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
  // 7 derniers jours (heure de Paris), du plus ancien au plus récent
  // photo du CA brut total de la période, une par jour : sert à tracer la courbe de l'accueil
  function snapCA(pkey) {
    const p = periodInfo(pkey); if (!p) return;
    const today = parisDate(Date.now()), date = today > p.to ? p.to : today < p.from ? p.from : today;
    const brut = computeCompta(pkey).totals.brut;
    db.prepare(`INSERT INTO ca_snaps (period, date, brut) VALUES (?,?,?) ON CONFLICT(period, date) DO UPDATE SET brut = excluded.brut`).run(pkey, date, brut);
  }
  const lastDays = (n, now) => Array.from({ length: n }, (_, i) => parisDate(now - (n - 1 - i) * 864e5));
  const pctTrend = (a, b) => b > 0 ? Math.round((a - b) / b * 100) : (a > 0 ? 100 : 0);
  const periodElapsed = (p, today) => { const d = +today.slice(8), d1 = +p.from.slice(8), d2 = +p.to.slice(8); return Math.min(1, Math.max(1 / 16, (d - d1 + 1) / (d2 - d1 + 1))); };
  const boardOf = (inP) => {
    const board = {};
    db.prepare("SELECT s.user_id, u.username, s.amount, s.sold_at FROM sales s JOIN users u ON u.id = s.user_id WHERE s.status = 'validated'").all()
      .filter(s => inP(s.sold_at)).forEach(s => { const k = s.user_id; board[k] = board[k] || { user_id: k, username: s.username, total: 0 }; board[k].total += s.amount; });
    return Object.values(board).sort((a, b) => b.total - a.total);
  };
  function feedOf() {
    const ev = [];
    // fil d'activité : ventes déclarées / validées / refusées, pointages, simulations
    db.prepare(`SELECT s.amount, s.status, s.created_at, s.reviewed_at, u.username, m.name model_name FROM sales s JOIN users u ON u.id = s.user_id
      JOIN models m ON m.id = s.model_id ORDER BY s.created_at DESC LIMIT 30`).all().forEach(x => {
      ev.push({ t: x.created_at, k: "e", who: x.username, text: `a déclaré une vente de ${x.amount.toLocaleString("fr-FR")} € · ${x.model_name}`, tag: x.status === "pending" ? "à valider" : "", cls: x.status === "pending" ? "o" : "",
        short: "a déclaré une vente", sub: x.model_name, amt: x.amount });
      if (x.reviewed_at && x.status !== "pending") ev.push({ t: x.reviewed_at, k: "e", who: x.username, text: `: vente de ${x.amount.toLocaleString("fr-FR")} € ${x.status === "validated" ? "validée" : "refusée"}`, tag: x.status === "validated" ? "validée" : "refusée", cls: x.status === "validated" ? "g" : "r",
        short: x.status === "validated" ? "vente validée" : "vente refusée", sub: x.model_name, amt: x.amount });
    });
    db.prepare(`SELECT c.start_at, c.end_at, u.username, m.name model_name FROM clocks c JOIN users u ON u.id = c.user_id JOIN models m ON m.id = c.model_id
      WHERE c.reinforce = 0 ORDER BY c.start_at DESC LIMIT 30`).all().forEach(k => {
      ev.push({ t: k.start_at, k: "c", who: k.username, text: `a commencé son shift sur ${k.model_name}`, short: "a commencé son shift", sub: k.model_name });
      if (k.end_at) { const h = (k.end_at - k.start_at) / 3.6e6; const dur = `${Math.floor(h)} h ${String(Math.round(h % 1 * 60)).padStart(2, "0")}`; ev.push({ t: k.end_at, k: "c", who: k.username, text: `a terminé son shift · ${dur}`, short: "a terminé son shift", sub: dur }); }
    });
    db.prepare(`SELECT x.score, x.ended_at, u.username FROM sims x JOIN users u ON u.id = x.user_id WHERE x.status = 'done' AND x.ended_at IS NOT NULL
      ORDER BY x.ended_at DESC LIMIT 20`).all().forEach(x => ev.push({ t: x.ended_at, k: "s", who: x.username, text: `a fait ${x.score}/100 au simulateur`, short: `a fait ${x.score}/100`, sub: "simulateur" }));
    return ev.filter(e => e.t).sort((a, b) => b.t - a.t).slice(0, 24);
  }
  const liveNow = () => db.prepare(`SELECT c.start_at, u.username, m.name model_name FROM clocks c JOIN users u ON u.id = c.user_id
      JOIN models m ON m.id = c.model_id WHERE c.end_at IS NULL AND c.reinforce = 0 ORDER BY c.start_at`).all();
  app.get("/api/home", auth, (req, res) => {
    const p = periodInfo(currentPeriod()), now = Date.now(), today = parisDate(now);
    const days = lastDays(7, now), days14 = lastDays(14, now), elapsed = periodElapsed(p, today);
    const week = now - 7 * 864e5;
    const inP = ms => periodOfDate(parisDate(ms)) === p.key;
    const fee = Number(getSetting("platform_fee", "25")), base = getSetting("commission_base", "net");
    const upcomingOf = uid => db.prepare(`SELECT s.date, s.start, s.end, m.name model_name FROM shifts s JOIN models m ON m.id = s.model_id
      WHERE s.user_id = ? AND s.date >= ? ORDER BY s.date, s.start LIMIT 4`).all(uid, today);
    const openOf = uid => db.prepare(`SELECT c.start_at, c.model_id, m.name model_name FROM clocks c JOIN models m ON m.id = c.model_id
      WHERE c.user_id = ? AND c.end_at IS NULL AND c.reinforce = 0`).get(uid) || null;
    const sims = db.prepare("SELECT user_id, score, started_at FROM sims WHERE status = 'done' AND started_at >= ?").all(week);

    if (req.user.role !== "admin") {
      const u = db.prepare("SELECT commission_pct FROM users WHERE id = ?").get(req.user.id);
      const mine = db.prepare("SELECT amount, status, sold_at FROM sales WHERE user_id = ?").all(req.user.id).filter(s => inP(s.sold_at));
      const validated = mine.filter(s => s.status === "validated").reduce((t, s) => t + s.amount, 0);
      const pending = mine.filter(s => s.status === "pending").reduce((t, s) => t + s.amount, 0);
      const baseAmt = base === "brut" ? validated : validated * (1 - fee / 100);
      const hours = db.prepare("SELECT start_at, end_at FROM clocks WHERE user_id = ? AND reinforce = 0").all(req.user.id)
        .filter(c => inP(c.start_at)).reduce((t, c) => t + ((c.end_at || now) - c.start_at) / 3.6e6, 0);
      const last = db.prepare("SELECT score, persona_id, started_at FROM sims WHERE user_id = ? AND status = 'done' ORDER BY started_at DESC LIMIT 1").get(req.user.id);
      const my7 = sims.filter(x => x.user_id === req.user.id);
      // séries des 7 derniers jours + tendance par rapport aux 7 jours d'avant
      const allMine = db.prepare("SELECT amount, status, sold_at FROM sales WHERE user_id = ?").all(req.user.id);
      const clocksMine = db.prepare("SELECT start_at, end_at FROM clocks WHERE user_id = ? AND reinforce = 0").all(req.user.id);
      const salesDay = d => allMine.filter(x => x.status === "validated" && parisDate(x.sold_at) === d).reduce((t, x) => t + x.amount, 0);
      const hoursDay = d => clocksMine.filter(c => parisDate(c.start_at) === d).reduce((t, c) => t + ((c.end_at || now) - c.start_at) / 3.6e6, 0);
      const sum = (arr, f) => arr.reduce((t, d) => t + f(d), 0);
      const series = { sales: days.map(salesDay), hours: days.map(hoursDay), pending: days.map(d => allMine.filter(x => x.status === "pending" && parisDate(x.sold_at) === d).length) };
      const trend = { sales: pctTrend(sum(days14.slice(7), salesDay), sum(days14.slice(0, 7), salesDay)), hours: pctTrend(sum(days14.slice(7), hoursDay), sum(days14.slice(0, 7), hoursDay)) };
      // record : meilleure période passée (ventes validées)
      const byP = {}; allMine.filter(x => x.status === "validated").forEach(x => { const k = periodOfDate(parisDate(x.sold_at)); byP[k] = (byP[k] || 0) + x.amount; });
      const best = Math.max(0, ...Object.entries(byP).filter(([k]) => k !== p.key).map(([, v]) => v));
      // paliers : commission actuelle, palier suivant, projection
      const tp = tierPay(baseAmt), commission = tp.total, goal = Number(getSetting("goal_chatter", "300"));
      const nxt = TIERS[tp.tier + 1] || null, projNet = baseAmt / elapsed, tpP = tierPay(projNet);
      const netOf = x => base === "brut" ? x : x * (1 - fee / 100);
      const nDays = +p.to.slice(8) - +p.from.slice(8) + 1, d1 = +p.from.slice(8), dToday = +today.slice(8) - d1 + 1;
      let cum = 0; const netPts = [];
      for (let dd = 1; dd <= Math.min(nDays, dToday); dd++) { const ds = p.from.slice(0, 8) + String(d1 + dd - 1).padStart(2, "0"); cum += netOf(salesDay(ds)); netPts.push({ day: dd, date: ds, brut: Math.round(cum * 100) / 100 }); }
      // dernier shift sur la créatrice du prochain créneau (ventes et net réalisés pendant ce shift)
      const up = upcomingOf(req.user.id), op = openOf(req.user.id), target = op ? op.model_name : up[0]?.model_name;
      let lastShift = null;
      if (target) { const lc = db.prepare(`SELECT c.start_at, c.end_at FROM clocks c JOIN models m ON m.id = c.model_id WHERE c.user_id = ? AND m.name = ? AND c.end_at IS NOT NULL ORDER BY c.start_at DESC LIMIT 1`).get(req.user.id, target);
        if (lc) { const ss = db.prepare(`SELECT s.amount FROM sales s JOIN models m ON m.id = s.model_id WHERE s.user_id = ? AND m.name = ? AND s.status != 'refused' AND s.sold_at BETWEEN ? AND ?`).all(req.user.id, target, lc.start_at, lc.end_at);
          lastShift = { count: ss.length, net: Math.round(netOf(ss.reduce((t, x) => t + x.amount, 0)) * 100) / 100, hours: (lc.end_at - lc.start_at) / 3.6e6 }; } }
      // shifts de la semaine (lundi → dimanche) : rang du prochain créneau dans la semaine
      const wd = (new Date(today + "T12:00Z").getUTCDay() + 6) % 7, mon = parisDate(now - wd * 864e5), sun = parisDate(now + (6 - wd) * 864e5);
      const wk = db.prepare("SELECT date, start, end FROM shifts WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date, start").all(req.user.id, mon, sun);
      const nextIdx = up[0] ? wk.findIndex(x => x.date === up[0].date && x.start === up[0].start) : -1;
      const weekShifts = { count: wk.length, nth: nextIdx >= 0 ? nextIdx + 1 : null };
      const board = boardOf(inP), myIdx = board.findIndex(b => b.user_id === req.user.id);
      return res.json({ role: "chatter", period: p, open: op, upcoming: up, today, nDays, netPts, lastShift, weekShifts, days,
        tiers: { list: TIERS, k: base === "brut" ? 1 : 1 - fee / 100, net: Math.round(baseAmt * 100) / 100, commission: tp.commission, prime: tp.prime, total: tp.total, rate: tp.rate, tier: tp.tier,
          next: nxt ? { ...nxt, gap: Math.round((nxt.from - baseAmt) * 100) / 100 } : null, projNet: Math.round(projNet), projTotal: tpP.total, projPrime: tpP.prime },
        feed: feedOf(), live: liveNow(),
        series, trend, best, goal, projection: Math.round(commission / elapsed * 100) / 100, elapsed,
        rank: myIdx === -1 ? null : myIdx + 1, gap: myIdx > 0 ? Math.round((board[myIdx - 1].total - board[myIdx].total) * 100) / 100 : null, above: myIdx > 0 ? board[myIdx - 1].username : null,
        leaderboard: board.slice(0, 3).map(b => ({ username: b.username, total: b.total, me: b.user_id === req.user.id })),
        models: db.prepare("SELECT id, name FROM models ORDER BY name").all(),
        sales: { validated, pending, count: mine.length, refused: mine.filter(s => s.status === "refused").length,
          commission, pct: tp.rate },
        hours, simu: { last: last || null, week: my7.length, avg: my7.length ? Math.round(my7.reduce((t, x) => t + x.score, 0) / my7.length) : null },
        discipline: hooks.discipline ? (() => { try { return hooks.discipline(req.user.id); } catch (e) { console.error(e); return null; } })() : null });
    }
    const c = computeCompta(p.key);
    const live = db.prepare(`SELECT c.start_at, u.username, m.name model_name FROM clocks c JOIN users u ON u.id = c.user_id
      JOIN models m ON m.id = c.model_id WHERE c.end_at IS NULL AND c.reinforce = 0 ORDER BY c.start_at`).all();
    const todayShifts = db.prepare(`SELECT s.start, s.end, u.username, m.name model_name FROM shifts s JOIN users u ON u.id = s.user_id
      JOIN models m ON m.id = s.model_id WHERE s.date = ? ORDER BY s.start`).all(today);
    const pendingSales = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) total FROM sales WHERE status = 'pending'").get();
    const board = boardOf(inP);
    // séries des 7 derniers jours
    const allSales = db.prepare("SELECT amount, status, sold_at, created_at FROM sales").all();
    const allClocks = db.prepare("SELECT user_id, start_at, end_at FROM clocks WHERE reinforce = 0").all();
    const series = {
      sales: days.map(d => allSales.filter(x => x.status === "validated" && parisDate(x.sold_at) === d).reduce((t, x) => t + x.amount, 0)),
      pending: days.map(d => allSales.filter(x => parisDate(x.created_at) === d).length),
      shifts: days.map(d => new Set(allClocks.filter(k => parisDate(k.start_at) === d).map(k => k.user_id)).size)
    };
    const prevMargin = computeCompta(p.prev).totals.margin;
    const feed = feedOf();
    const activeChatters = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'chatter' AND active = 1").get().n;
    const goal = Number(getSetting("goal_ca", "20000"));
    // courbe du CA : photos du CA saisi, jour par jour sur la période
    snapCA(p.key);
    const nDays = +p.to.slice(8) - +p.from.slice(8) + 1;
    const caPts = db.prepare("SELECT date, brut FROM ca_snaps WHERE period = ? ORDER BY date").all(p.key)
      .map(x => ({ day: +x.date.slice(8) - +p.from.slice(8) + 1, date: x.date, brut: x.brut }));
    // marge des périodes précédentes (barres)
    const marginHist = []; let k = p.key;
    for (let i = 0; i < 7; i++) { const pi = periodInfo(k); marginHist.unshift({ label: pi.label, margin: i === 0 ? c.totals.margin : computeCompta(k).totals.margin }); k = pi.prev; }
    // prochain shift (si personne ne travaille)
    const hm = new Date(now).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
    const nextShift = db.prepare(`SELECT s.date, s.start, s.end, u.username, m.name model_name FROM shifts s JOIN users u ON u.id = s.user_id
      JOIN models m ON m.id = s.model_id WHERE s.date > ? OR (s.date = ? AND s.start > ?) ORDER BY s.date, s.start LIMIT 1`).get(today, today, hm) || null;
    res.json({ role: "admin", today, nDays, caPts, marginHist, nextShift, days, period: p, totals: c.totals, series, goal, elapsed, projection: Math.round(c.totals.brut / elapsed), prevMargin,
      marginTrend: pctTrend(c.totals.margin, prevMargin), feed, activeChatters,
      missingRevenue: c.models.filter(m => m.missing && m.missing.length).map(m => m.name),
      pendingSales, live, todayShifts,
      leaderboard: board.slice(0, 5).map(b => ({ username: b.username, total: b.total })),
      simu: { week: sims.length, avg: sims.length ? Math.round(sims.reduce((t, x) => t + x.score, 0) / sims.length) : null } });
  });

  return { periodInfo, periodOfDate, computeCompta, tierPay, setTiers, getTiers: () => TIERS, isLocked, hooks, comptaOf, parisDate };
};
