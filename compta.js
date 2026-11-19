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
/* ---------- Mois de compta : "2026-11" (la paie des chatters reste par quinzaine) ---------- */
const MONTHS_L = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function monthInfo(k) {
  const m = /^(\d{4})-(\d{2})$/.exec(k || ""); if (!m) return null;
  const y = +m[1], mo = +m[2]; if (mo < 1 || mo > 12) return null;
  const pad = n => String(n).padStart(2, "0"), last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { key: k, month: true, from: `${y}-${pad(mo)}-01`, to: `${y}-${pad(mo)}-${pad(last)}`, label: `${MONTHS_L[mo - 1]} ${y}`,
    prev: mo === 1 ? `${y - 1}-12` : `${y}-${pad(mo - 1)}`, next: mo === 12 ? `${y + 1}-01` : `${y}-${pad(mo + 1)}`, halves: [`${k}-A`, `${k}-B`] };
}
const monthOfKey = k => monthInfo(k) ? k : (periodInfo(k) ? k.slice(0, 7) : null);   // un mois, ou le mois d'une quinzaine
const currentMonth = () => parisDate(Date.now()).slice(0, 7);

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

// managers qui déclarent leurs ventes : commission fixe, sans paliers ni prime
const MGR_RATE = 10;
function flatPay(net) {
  net = Math.max(0, net || 0); const c = Math.round(net * MGR_RATE) / 100;
  return { net, commission: c, prime: 0, total: c, rate: MGR_RATE, tier: 0, flat: true };
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
  // part « saisie d'un bloc » (ancien système) d'une quinzaine, gardée quand le mois est regroupé
  if (!cols("revenues").includes("legacy_net")) db.exec("ALTER TABLE revenues ADD COLUMN legacy_net REAL");
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
  const lockedMonthMsg = { error: "Ce mois est clôturé : rouvre-le dans la Compta pour modifier le CA" };
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
      people: db.prepare("SELECT id, username, role FROM users WHERE active = 1 AND role != 'trainee' ORDER BY role DESC, username").all(),
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
  // planning d'un chatter en une fois : son créneau tous les jours de la période, sauf ses jours de repos
  // rest : jours de repos (0 = lundi … 6 = dimanche) · replace : efface d'abord ses shifts déjà prévus sur la période (à partir d'aujourd'hui)
  app.post("/api/admin/shifts/fill", auth, admin, (req, res) => {
    const b = req.body || {}, s = shiftBody({ ...b, date: b.from }); if (s.error) return res.status(400).json(s);
    const weeks = Math.min(Math.max(parseInt(b.weeks, 10) || 1, 1), 12);
    const rest = new Set((Array.isArray(b.rest) ? b.rest : []).map(Number).filter(n => n >= 0 && n <= 6));
    if (rest.size >= 7) return res.status(400).json({ error: "Laisse au moins un jour travaillé" });
    const today = parisDate(Date.now()), nowHM = new Date().toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }), days = [];
    for (let i = 0; i < weeks * 7; i++) { const d = new Date(s.date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + i); days.push(d.toISOString().slice(0, 10)); }
    const last = days[days.length - 1], dow = d => (new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7;
    let removed = 0, added = 0, skipped = 0;
    db.exec("BEGIN");
    try {
      if (b.replace) removed = db.prepare("DELETE FROM shifts WHERE user_id = ? AND date BETWEEN ? AND ?").run(s.user_id, s.date < today ? today : s.date, last).changes;
      const has = db.prepare("SELECT 1 FROM shifts WHERE user_id = ? AND date = ?"), ins = db.prepare("INSERT INTO shifts (user_id, model_id, date, start, end, note) VALUES (?,?,?,?,?,?)");
      days.forEach(d => { if (rest.has(dow(d)) || d < today || (d === today && s.start <= nowHM)) return;   // jours passés et créneau déjà commencé : ignorés
        if (has.get(s.user_id, d)) { skipped++; return; } ins.run(s.user_id, s.model_id, d, s.start, s.end, s.note); added++; });
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); return res.status(500).json({ error: "Le planning n'a pas pu être rempli" }); }
    res.json({ ok: true, added, skipped, removed, from: s.date, to: last });
  });
  /* ----- jour de repos d'un chatter : déduit de son planning à venir, modifiable sans toucher au reste ----- */
  const dowOf = d => (new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7;   // 0 = lundi
  function restPattern(uid) {
    const today = parisDate(Date.now());
    const rows = db.prepare("SELECT s.date, s.start, s.end, s.model_id, m.name model_name FROM shifts s JOIN models m ON m.id = s.model_id WHERE s.user_id = ? AND s.date >= ? ORDER BY s.date").all(uid, today);
    if (!rows.length) return { today, shifts: [], rest: [], slot: null, to: null };
    const to = rows[rows.length - 1].date, seen = new Set(rows.map(r => dowOf(r.date)));
    const span = Math.round((new Date(to + "T12:00:00Z") - new Date(today + "T12:00:00Z")) / 864e5) + 1;
    // jours de repos = jours de la semaine sans aucun shift sur la période prévue (si elle couvre au moins une semaine)
    const rest = span >= 7 ? [0, 1, 2, 3, 4, 5, 6].filter(k => !seen.has(k)) : [];
    // créneau et créatrice habituels = les plus fréquents
    const cnt = {}; rows.forEach(r => { const k = `${r.start}|${r.end}|${r.model_id}`; cnt[k] = (cnt[k] || 0) + 1; });
    const [st, en, mid] = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0].split("|");
    return { today, to, rest, slot: { start: st, end: en, model_id: +mid, model_name: rows.find(r => r.model_id === +mid).model_name }, shifts: rows.map(r => ({ date: r.date, start: r.start, end: r.end })) };
  }
  app.get("/api/admin/shifts/rest", auth, admin, (req, res) => {
    const uid = parseInt(req.query.user_id, 10); if (!userExists(uid)) return res.status(400).json({ error: "Chatter invalide" });
    res.json(restPattern(uid));
  });
  // nouveaux jours de repos à partir d'une date : ses shifts de ces jours sont retirés,
  // ses anciens jours de repos reçoivent son créneau habituel ; le reste de son planning ne bouge pas
  app.post("/api/admin/shifts/rest", auth, admin, (req, res) => {
    const b = req.body || {}, uid = parseInt(b.user_id, 10); if (!userExists(uid)) return res.status(400).json({ error: "Chatter invalide" });
    const P = restPattern(uid); if (!P.slot) return res.status(400).json({ error: "Aucun shift prévu pour ce chatter : utilise « Ajouter des shifts »" });
    const nw = new Set((Array.isArray(b.rest) ? b.rest : []).map(Number).filter(n => n >= 0 && n <= 6)), old = new Set(P.rest);
    if (nw.size >= 7) return res.status(400).json({ error: "Laisse au moins un jour travaillé" });
    const from = isDate(b.from) && b.from > P.today ? b.from : P.today;
    const nowHM = new Date().toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
    let removed = 0, added = 0;
    db.exec("BEGIN");
    try {
      const has = db.prepare("SELECT 1 FROM shifts WHERE user_id = ? AND date = ?"), ins = db.prepare("INSERT INTO shifts (user_id, model_id, date, start, end, note) VALUES (?,?,?,?,?,'')");
      for (let d = from; d <= P.to; ) {
        const k = dowOf(d);
        if (nw.has(k)) removed += db.prepare("DELETE FROM shifts WHERE user_id = ? AND date = ?" + (d === P.today ? " AND start > ?" : "")).run(...(d === P.today ? [uid, d, nowHM] : [uid, d])).changes;
        else if (old.has(k) && !has.get(uid, d) && !(d === P.today && P.slot.start <= nowHM)) { ins.run(uid, P.slot.model_id, d, P.slot.start, P.slot.end); added++; }
        const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + 1); d = x.toISOString().slice(0, 10);
      }
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); return res.status(500).json({ error: "Le jour de repos n'a pas pu être changé" }); }
    res.json({ ok: true, removed, added, from, to: P.to });
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
      live: rows.filter(c => !c.end_at).map(c => ({ ...c, planned_end: c.reinforce ? c.until_at || null : plannedEnd(c) })),
      people: db.prepare("SELECT id, username FROM users WHERE active = 1 AND role != 'trainee' ORDER BY username").all(),
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
  // terminer le shift d'un chatter qui a oublié de dépointer (à l'heure choisie par le manager)
  const SPAN = require("./planning").shiftSpan;
  const plannedEnd = c => { const d = parisDate(c.start_at), prev = parisDate(c.start_at - 864e5);
    const ss = db.prepare("SELECT date, start, end, model_id FROM shifts WHERE user_id = ? AND date IN (?, ?)").all(c.user_id, d, prev)
      .map(s => ({ s, sp: SPAN(s) })).filter(x => c.start_at >= x.sp[0] - 3 * 3.6e6 && c.start_at < x.sp[1]);
    const m = ss.find(x => x.s.model_id === c.model_id) || ss[0]; return m ? m.sp[1] : null; };
  app.post("/api/admin/clocks/:id/end", auth, admin, (req, res) => {
    const c = db.prepare("SELECT c.*, u.username FROM clocks c JOIN users u ON u.id = c.user_id WHERE c.id = ?").get(parseInt(req.params.id, 10));
    if (!c) return res.status(404).json({ error: "Pointage introuvable" });
    if (c.end_at) return res.status(400).json({ error: `${c.username} a déjà dépointé` });
    const now = Date.now(), end = req.body?.end_at ? num(req.body.end_at, 1e12, 1e13) : now;
    if (!end || end <= c.start_at) return res.status(400).json({ error: "La fin doit être après le début du shift" });
    if (end > now + 60e3) return res.status(400).json({ error: "La fin ne peut pas être dans le futur" });
    if (end - c.start_at > 24 * 3.6e6) return res.status(400).json({ error: "Un shift ne peut pas dépasser 24 h" });
    if (isLocked(periodOfDate(parisDate(c.start_at)))) return res.status(400).json(lockedMsg);
    db.prepare("UPDATE clocks SET end_at = ?, edited = 1 WHERE id = ?").run(end, c.id);
    // les renforts tenus pendant ce shift s'arrêtent avec lui
    if (!c.reinforce) db.prepare("UPDATE clocks SET end_at = MAX(start_at + 60000, MIN(?, COALESCE(until_at, ?))), edited = 1 WHERE user_id = ? AND reinforce = 1 AND end_at IS NULL").run(end, end, c.user_id);
    res.json({ ok: true, end_at: end });
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
    const validated = validatedByPeriod ? validatedByPeriod(p.key) : {}, validatedCom = validatedByPeriod ? validatedByPeriod(p.key, true) : {};
    // le CA saisi à la main est mensuel : la quinzaine en prend sa part au prorata des jours (sert au mode « heures »)
    const mi = monthInfo(p.key.slice(0, 7)), share = (+p.to.slice(8) - +p.from.slice(8) + 1) / +mi.to.slice(8);
    const models = db.prepare(`SELECT m.id, m.name, m.creator_pct, r.brut, r.net, r.abo, r.live, r.coll, r.push, r.v2, r.legacy_net FROM models m
      LEFT JOIN revenues r ON r.model_id = m.id AND r.period = ? ORDER BY m.name`).all(mi.key);
    // chatting = ventes validées sur la créatrice (déclarées en brut)
    const chatBy = {}, chatN = {};
    Object.entries(validated).forEach(([k, v]) => { const mid = +k.split(":")[1]; chatBy[mid] = (chatBy[mid] || 0) + v; });
    db.prepare("SELECT model_id, sold_at FROM sales WHERE status = 'validated'").all().filter(x => periodOfDate(parisDate(x.sold_at)) === p.key)
      .forEach(x => chatN[x.model_id] = (chatN[x.model_id] || 0) + 1);
    const paidC = {};   // les parts créatrices se versent au mois (voir computeMonth)
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
      const manual = (SRC.reduce((t, k) => t + (m[k] || 0), 0) + (m.legacy_net || 0)) * share;
      const net = legacy ? r2((m.net || 0) * share) : r2(chatNet + manual), brut = legacy ? m.brut * share : chatBrut + manual / keep;
      const missing = legacy ? [] : SRC.filter(k => m[k] == null);
      const creatorPay = r2(net * m.creator_pct / 100), cp = paidC[m.id];
      return { id: m.id, name: m.name, creator_pct: m.creator_pct, brut, net, legacy, chatBrut, chatNet, chatCount: chatN[m.id] || 0,
        sources: Object.fromEntries(SRC.map(k => [k, m[k] == null ? null : r2(m[k] * share)])), missing,
        totalHours: totalH, creatorPay, creatorPaid: cp ? cp.amount : 0, creatorPaidAt: cp ? cp.paid_at : null, agencyShare: net - creatorPay,
        commissionBase: base === "brut" ? brut : net };
    });
    const lines = [];
    users.forEach(u => modelRows.forEach(m => {
      const k = u.id + ":" + m.id, h = hours[k] || 0, ov = overrides[k], v = validatedCom[k] || 0;
      if (!h && ov === undefined && !v && !validated[k]) return;
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
      const ls = lines.filter(l => l.user_id === u.id), sales = ls.reduce((t, l) => t + l.sales, 0), tp = u.role === "admin" ? flatPay(sales) : tierPay(sales);
      // la commission par paliers est répartie sur chaque créatrice au prorata des ventes
      ls.forEach(l => { l.pay = sales > 0 ? tp.total * l.sales / sales : 0; l.pct = tp.rate; });
      const lost = tp.prime > 0 && hooks.primeLost && hooks.primeLost(u.id, p.key);
      if (lost) { tp.total = r2(tp.total - tp.prime); tp.primeLost = tp.prime; tp.prime = 0; }
      const adj = adjs.filter(a => a.user_id === u.id), adjT = adj.reduce((t, a) => t + a.amount, 0), pay = r2(tp.total + adjT);
      // heures : les renforts sont comptés à part (ils ne doublent pas le temps de travail)
      const hRf = rfH[u.id] || 0, hAll = ls.reduce((t, l) => t + l.hours, 0);
      return { id: u.id, username: u.username, active: u.active, flat: !!tp.flat, commission_pct: tp.rate, rate: tp.rate, tier: tp.tier, prime: tp.prime, primeLost: tp.primeLost || 0, commission: tp.commission,
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
  /* ================= COMPTA DU MOIS ================= */
  // CA (chatting automatique + entrées saisies au mois), parts créatrices et marge sur le mois entier ;
  // la paie des chatters vient des deux quinzaines (calculées et clôturées à part)
  function computeMonth(mkey) {
    const mi = monthInfo(mkey); if (!mi) return null;
    const base = getSetting("commission_base", "net"), mode = getSetting("attribution_mode", "ventes"), fee = Number(getSetting("platform_fee", "25"));
    const keep = fee < 100 ? 1 - fee / 100 : 1, r2 = x => Math.round(x * 100) / 100;
    const chatBy = {}, chatN = {};
    mi.halves.forEach(h => Object.entries(validatedByPeriod ? validatedByPeriod(h) : {}).forEach(([k, v]) => { const mid = +k.split(":")[1]; chatBy[mid] = (chatBy[mid] || 0) + v; }));
    db.prepare("SELECT model_id, sold_at FROM sales WHERE status = 'validated'").all().filter(x => parisDate(x.sold_at).slice(0, 7) === mkey)
      .forEach(x => chatN[x.model_id] = (chatN[x.model_id] || 0) + 1);
    const paidC = {}; db.prepare("SELECT model_id, amount, paid_at FROM creator_paid WHERE period = ?").all(mkey).forEach(x => paidC[x.model_id] = x);
    const models = db.prepare(`SELECT m.id, m.name, m.creator_pct, r.brut, r.net, r.abo, r.live, r.coll, r.push, r.v2, r.legacy_net FROM models m
      LEFT JOIN revenues r ON r.model_id = m.id AND r.period = ? ORDER BY m.name`).all(mkey).map(m => {
      const chatBrut = r2(chatBy[m.id] || 0), chatNet = r2(chatBrut * keep);
      const legacy = !m.v2 && m.brut != null;
      const manual = SRC.reduce((t, k) => t + (m[k] || 0), 0) + (m.legacy_net || 0);
      const net = legacy ? (m.net || 0) : r2(chatNet + manual), brut = legacy ? m.brut : r2(chatBrut + manual / keep);
      const missing = legacy ? [] : SRC.filter(k => m[k] == null);
      const creatorPay = r2(net * m.creator_pct / 100), cp = paidC[m.id];
      return { id: m.id, name: m.name, creator_pct: m.creator_pct, brut, net, legacy, legacyNet: m.legacy_net || 0, chatBrut, chatNet, chatCount: chatN[m.id] || 0,
        sources: { abo: m.abo, live: m.live, coll: m.coll, push: m.push }, missing,
        creatorPay, creatorPaid: cp ? cp.amount : 0, creatorPaidAt: cp ? cp.paid_at : null, agencyShare: r2(net - creatorPay) };
    });
    const sum = (arr, f) => arr.reduce((t, x) => t + (f(x) || 0), 0);
    const totals = { brut: r2(sum(models, m => m.brut)), net: r2(sum(models, m => m.net)), creators: r2(sum(models, m => m.creatorPay)), agencyShare: r2(sum(models, m => m.agencyShare)) };
    totals.platform = r2(totals.brut - totals.net);
    totals.sources = { chat: sum(models, m => m.legacy ? 0 : m.chatNet), legacy: sum(models, m => m.legacy ? m.net : m.legacyNet) };
    SRC.forEach(k => totals.sources[k] = sum(models, m => m.legacy ? 0 : m.sources[k]));
    return { period: mi, base, mode, fee, models, totals };
  }
  // le mois tel qu'affiché : CA figé à la clôture du mois, paie des chatters toujours lue sur les quinzaines
  function comptaMonthOf(mkey) {
    const mi = monthInfo(mkey); if (!mi) return null;
    const lk = lockOf(mkey);
    let c = null; if (lk && lk.snapshot) { try { c = JSON.parse(lk.snapshot); } catch (e) {} }
    if (!c) c = computeMonth(mkey);
    if (lk) { const pc = {}; db.prepare("SELECT * FROM creator_paid WHERE period = ?").all(mkey).forEach(x => pc[x.model_id] = x);
      c.models.forEach(m => { m.creatorPaid = pc[m.id] ? pc[m.id].amount : 0; m.creatorPaidAt = pc[m.id] ? pc[m.id].paid_at : null; }); }
    c.period = mi; c.locked = lk ? { at: lk.closed_at, by: lk.closed_name } : null;
    const H = mi.halves.map(h => comptaOf(h)), ch = {};
    H.forEach((hc, i) => hc.chatters.forEach(x => { const o = ch[x.id] = ch[x.id] || { id: x.id, username: x.username, active: x.active, pay: 0, sales: 0, salesCount: 0, halves: [null, null], paidAll: true };
      o.pay += x.pay; o.sales += x.sales; o.salesCount += x.salesCount || 0; o.halves[i] = { key: hc.period.key, pay: x.pay, paid: !!x.paid, rate: x.rate };
      if (x.pay > 0 && !x.paid) o.paidAll = false; }));
    c.chatters = Object.values(ch).filter(x => x.pay || x.sales).sort((a, b) => b.pay - a.pay);
    c.halves = H.map(hc => { const P = hc.chatters.filter(x => x.pay > 0);
      return { key: hc.period.key, label: hc.period.label, from: hc.period.from, to: hc.period.to, locked: hc.locked, chatters: Math.round(P.reduce((t, x) => t + x.pay, 0) * 100) / 100,
        sales: Math.round(hc.chatters.reduce((t, x) => t + x.sales, 0) * 100) / 100, paid: P.filter(x => x.paid).length, payable: P.length }; });
    c.totals.chatters = Math.round(c.halves.reduce((t, h) => t + h.chatters, 0) * 100) / 100;
    c.totals.margin = Math.round((c.totals.agencyShare - c.totals.chatters) * 100) / 100;
    return c;
  }
  const monthElapsed = (mi, today) => Math.min(1, Math.max(1 / 31, (+today.slice(8)) / +mi.to.slice(8)));

  app.get("/api/admin/compta", auth, admin, (req, res) => {
    const today = parisDate(Date.now()), goals = { ca: Number(getSetting("goal_ca", "40000")), chatter: Number(getSetting("goal_chatter", "300")) };
    const bands = BANDS.map(b => [b[0], b[1] === Infinity ? null : b[1], b[2]]);
    // ?period=AAAA-MM-A|B : la paie d'une quinzaine
    if (periodInfo(req.query.period)) {
      const key = req.query.period, c = comptaOf(key), p = c.period;
      const pend = db.prepare("SELECT amount, sold_at FROM sales WHERE status = 'pending'").all().filter(x => periodOfDate(parisDate(x.sold_at)) === key);
      const running = today >= p.from && today <= p.to;
      return res.json({ ...c, pending: { n: pend.length, total: pend.reduce((t, x) => t + x.amount, 0) }, running,
        dayOf: running ? +today.slice(8) - +p.from.slice(8) + 1 : null, nDays: +p.to.slice(8) - +p.from.slice(8) + 1, goals, bands });
    }
    // sinon : la compta du mois (?month=AAAA-MM, le mois en cours par défaut)
    const mkey = monthInfo(req.query.month) ? req.query.month : currentMonth(), c = comptaMonthOf(mkey), mi = c.period;
    const pend = db.prepare("SELECT amount, sold_at FROM sales WHERE status = 'pending'").all().filter(x => parisDate(x.sold_at).slice(0, 7) === mkey);
    const pv = comptaMonthOf(mi.prev).totals;
    const running = today >= mi.from && today <= mi.to, el = running ? monthElapsed(mi, today) : 1;
    res.json({ ...c, pending: { n: pend.length, total: pend.reduce((t, x) => t + x.amount, 0) }, prev: { brut: pv.brut, net: pv.net, margin: pv.margin },
      running, elapsed: el, dayOf: running ? +today.slice(8) : null, nDays: +mi.to.slice(8), projection: running ? Math.round(c.totals.brut / el) : null, goals, bands });
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
    const period = monthOfKey(req.body?.month || req.body?.period), model_id = parseInt(req.body?.model_id, 10);   // les créatrices sont payées au mois
    if (!period || !modelExists(model_id)) return res.status(400).json({ error: "Données invalides" });
    if (req.body.paid === false) db.prepare("DELETE FROM creator_paid WHERE period = ? AND model_id = ?").run(period, model_id);
    else { const m = comptaMonthOf(period).models.find(x => x.id === model_id);
      db.prepare(`INSERT INTO creator_paid (period, model_id, amount, paid_at) VALUES (?,?,?,?) ON CONFLICT(period, model_id) DO UPDATE SET amount = excluded.amount, paid_at = excluded.paid_at`).run(period, model_id, m ? m.creatorPay : 0, Date.now()); }
    res.json({ ok: true });
  });
  /* ----- clôture d'une période ----- */
  app.post("/api/admin/periods/:key/close", auth, admin, (req, res) => {
    // AAAA-MM : clôture du mois (CA et parts créatrices figés) · AAAA-MM-A|B : clôture de la paie d'une quinzaine
    const key = req.params.key; if (!periodInfo(key) && !monthInfo(key)) return res.status(400).json({ error: "Période invalide" });
    if (isLocked(key)) return res.json({ ok: true });
    db.prepare("INSERT INTO period_locks (period, closed_at, closed_by, snapshot) VALUES (?,?,?,?)").run(key, Date.now(), req.user.id, JSON.stringify(monthInfo(key) ? computeMonth(key) : computeCompta(key)));
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
  // Historique pour les graphiques : totaux des N derniers mois jusqu'au mois demandé
  app.get("/api/admin/compta/history", auth, admin, (req, res) => {
    let key = monthInfo(req.query.month) ? req.query.month : currentMonth();
    const n = Math.max(2, Math.min(24, parseInt(req.query.n, 10) || 6)), out = [];
    for (let i = 0; i < n; i++) { const c = comptaMonthOf(key), p = c.period; out.unshift({ key: p.key, label: p.label, from: p.from, ...c.totals }); key = p.prev; }
    res.json({ periods: out });
  });
  // une entrée manuelle (montant net) : abonnements, live, collections ou média push
  app.put("/api/admin/revenue-source", auth, admin, (req, res) => {
    const { source } = req.body || {}, period = monthOfKey(req.body?.month || req.body?.period), model_id = parseInt(req.body?.model_id, 10);   // CA saisi au mois
    if (!period || !modelExists(model_id) || !SRC.includes(source)) return res.status(400).json({ error: "Données invalides" });
    if (isLocked(period)) return res.status(400).json(lockedMonthMsg);
    const empty = req.body.amount === "" || req.body.amount == null, v = empty ? null : num(String(req.body.amount).replace(",", "."), 0, 1e9);
    if (!empty && v === null) return res.status(400).json({ error: "Montant invalide" });
    db.prepare(`INSERT INTO revenues (period, model_id, v2, ${source}) VALUES (?,?,1,?) ON CONFLICT(period, model_id) DO UPDATE SET v2 = 1, ${source} = excluded.${source}`).run(period, model_id, v);
    snapCA(period);
    res.json({ ok: true });
  });
  app.put("/api/admin/revenue", auth, admin, (req, res) => {
    const period = monthOfKey(req.body?.month || req.body?.period), model_id = parseInt(req.body?.model_id, 10);
    if (!period || !modelExists(model_id)) return res.status(400).json({ error: "Données invalides" });
    if (isLocked(period)) return res.status(400).json(lockedMonthMsg);
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
      const mk = monthOfKey(req.body.month || req.body.period);
      if (mk) db.prepare("UPDATE revenues SET net = ROUND(brut * (1 - ? / 100.0), 2) WHERE period = ? AND brut IS NOT NULL").run(f, mk);
    }
    res.json({ ok: true });
  });

  /* ================= ACCUEIL : résumé selon le rôle ================= */
  // 7 derniers jours (heure de Paris), du plus ancien au plus récent
  // photo du CA brut total de la période, une par jour : sert à tracer la courbe de l'accueil
  function snapCA(key) {
    const pkey = monthOfKey(key), p = monthInfo(pkey); if (!p) return;
    const today = parisDate(Date.now()), date = today > p.to ? p.to : today < p.from ? p.from : today;
    const brut = computeMonth(pkey).totals.brut;
    db.prepare(`INSERT INTO ca_snaps (period, date, brut) VALUES (?,?,?) ON CONFLICT(period, date) DO UPDATE SET brut = excluded.brut`).run(pkey, date, brut);
  }
  const lastDays = (n, now) => Array.from({ length: n }, (_, i) => parisDate(now - (n - 1 - i) * 864e5));
  const pctTrend = (a, b) => b > 0 ? Math.round((a - b) / b * 100) : (a > 0 ? 100 : 0);
  const periodElapsed = (p, today) => { const d = +today.slice(8), d1 = +p.from.slice(8), d2 = +p.to.slice(8); return Math.min(1, Math.max(1 / 16, (d - d1 + 1) / (d2 - d1 + 1))); };
  const boardOf = (inP) => {
    const board = {};
    db.prepare("SELECT s.user_id, u.username, COALESCE(s.com_amount, s.amount) amount, s.sold_at FROM sales s JOIN users u ON u.id = s.user_id WHERE s.status = 'validated' AND u.deleted_at IS NULL").all()
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

    // manager qui déclare ses ventes : ?self=1 donne sa propre vue (paliers, ventes et commission de la quinzaine)
    const selfView = req.user.role === "admin" && req.query.self === "1" && !!(db.prepare("SELECT sells FROM users WHERE id = ?").get(req.user.id) || {}).sells;
    if (req.user.role !== "admin" || selfView) {
      const u = db.prepare("SELECT commission_pct FROM users WHERE id = ?").get(req.user.id);
      // côté chatter, une vente validée compte pour sa part (commission réduite par le manager)
      const mine = db.prepare("SELECT CASE WHEN status = 'validated' THEN COALESCE(com_amount, amount) ELSE amount END amount, status, sold_at FROM sales WHERE user_id = ?").all(req.user.id).filter(s => inP(s.sold_at));
      const validated = mine.filter(s => s.status === "validated").reduce((t, s) => t + s.amount, 0);
      const pending = mine.filter(s => s.status === "pending").reduce((t, s) => t + s.amount, 0);
      const baseAmt = base === "brut" ? validated : validated * (1 - fee / 100);
      const hours = db.prepare("SELECT start_at, end_at FROM clocks WHERE user_id = ? AND reinforce = 0").all(req.user.id)
        .filter(c => inP(c.start_at)).reduce((t, c) => t + ((c.end_at || now) - c.start_at) / 3.6e6, 0);
      const last = db.prepare("SELECT score, persona_id, started_at FROM sims WHERE user_id = ? AND status = 'done' ORDER BY started_at DESC LIMIT 1").get(req.user.id);
      const my7 = sims.filter(x => x.user_id === req.user.id);
      // séries des 7 derniers jours + tendance par rapport aux 7 jours d'avant
      const allMine = db.prepare("SELECT CASE WHEN status = 'validated' THEN COALESCE(com_amount, amount) ELSE amount END amount, status, sold_at FROM sales WHERE user_id = ?").all(req.user.id);
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
      const pay = selfView ? flatPay : tierPay;   // manager qui vend : 10 % fixe
      const tp = pay(baseAmt), commission = tp.total, goal = Number(getSetting("goal_chatter", "300"));
      const nxt = selfView ? null : TIERS[tp.tier + 1] || null, projNet = baseAmt / elapsed, tpP = pay(projNet);
      const netOf = x => base === "brut" ? x : x * (1 - fee / 100);
      const nDays = +p.to.slice(8) - +p.from.slice(8) + 1, d1 = +p.from.slice(8), dToday = +today.slice(8) - d1 + 1;
      let cum = 0; const netPts = [];
      for (let dd = 1; dd <= Math.min(nDays, dToday); dd++) { const ds = p.from.slice(0, 8) + String(d1 + dd - 1).padStart(2, "0"); cum += netOf(salesDay(ds)); netPts.push({ day: dd, date: ds, brut: Math.round(cum * 100) / 100 }); }
      // dernier shift sur la créatrice du prochain créneau (ventes et net réalisés pendant ce shift)
      const up = upcomingOf(req.user.id), op = openOf(req.user.id), target = op ? op.model_name : up[0]?.model_name;
      let lastShift = null;
      if (target) { const lc = db.prepare(`SELECT c.start_at, c.end_at FROM clocks c JOIN models m ON m.id = c.model_id WHERE c.user_id = ? AND m.name = ? AND c.end_at IS NOT NULL ORDER BY c.start_at DESC LIMIT 1`).get(req.user.id, target);
        if (lc) { const ss = db.prepare(`SELECT CASE WHEN s.status = 'validated' THEN COALESCE(s.com_amount, s.amount) ELSE s.amount END amount FROM sales s JOIN models m ON m.id = s.model_id WHERE s.user_id = ? AND m.name = ? AND s.status != 'refused' AND s.sold_at BETWEEN ? AND ?`).all(req.user.id, target, lc.start_at, lc.end_at);
          lastShift = { count: ss.length, net: Math.round(netOf(ss.reduce((t, x) => t + x.amount, 0)) * 100) / 100, hours: (lc.end_at - lc.start_at) / 3.6e6 }; } }
      // shifts de la semaine (lundi → dimanche) : rang du prochain créneau dans la semaine
      const wd = (new Date(today + "T12:00Z").getUTCDay() + 6) % 7, mon = parisDate(now - wd * 864e5), sun = parisDate(now + (6 - wd) * 864e5);
      const wk = db.prepare("SELECT date, start, end FROM shifts WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date, start").all(req.user.id, mon, sun);
      const nextIdx = up[0] ? wk.findIndex(x => x.date === up[0].date && x.start === up[0].start) : -1;
      const weekShifts = { count: wk.length, nth: nextIdx >= 0 ? nextIdx + 1 : null };
      const board = boardOf(inP), myIdx = board.findIndex(b => b.user_id === req.user.id);
      return res.json({ role: "chatter", period: p, open: op, upcoming: up, today, nDays, netPts, lastShift, weekShifts, days,
        tiers: { list: TIERS, flat: !!tp.flat, k: base === "brut" ? 1 : 1 - fee / 100, net: Math.round(baseAmt * 100) / 100, commission: tp.commission, prime: tp.prime, total: tp.total, rate: tp.rate, tier: tp.tier,
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
    // manager : CA, objectif et marge sur le mois (la paie et le classement des chatters restent sur la quinzaine)
    const mi = monthInfo(currentMonth()), c = comptaMonthOf(mi.key), mEl = monthElapsed(mi, today);
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
    const prevMargin = comptaMonthOf(mi.prev).totals.margin;
    const feed = feedOf();
    const activeChatters = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'chatter' AND active = 1").get().n;
    const goal = Number(getSetting("goal_ca", "40000"));
    // courbe du CA : photos du CA saisi, jour par jour sur le mois
    snapCA(mi.key);
    const nDays = +mi.to.slice(8);
    const caPts = db.prepare("SELECT date, brut FROM ca_snaps WHERE period = ? ORDER BY date").all(mi.key)
      .map(x => ({ day: +x.date.slice(8), date: x.date, brut: x.brut }));
    // marge des mois précédents (barres)
    const marginHist = []; let k = mi.key;
    for (let i = 0; i < 6; i++) { const pi = monthInfo(k); marginHist.unshift({ label: pi.label, margin: i === 0 ? c.totals.margin : comptaMonthOf(k).totals.margin }); k = pi.prev; }
    // prochain shift (si personne ne travaille)
    const hm = new Date(now).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
    const nextShift = db.prepare(`SELECT s.date, s.start, s.end, u.username, m.name model_name FROM shifts s JOIN users u ON u.id = s.user_id
      JOIN models m ON m.id = s.model_id WHERE s.date > ? OR (s.date = ? AND s.start > ?) ORDER BY s.date, s.start LIMIT 1`).get(today, today, hm) || null;
    res.json({ role: "admin", today, nDays, caPts, marginHist, nextShift, days, period: mi, payPeriod: p, totals: c.totals, series, goal, elapsed: mEl, projection: Math.round(c.totals.brut / mEl), prevMargin,
      marginTrend: pctTrend(c.totals.margin, prevMargin), feed, activeChatters,
      missingRevenue: c.models.filter(m => m.missing && m.missing.length).map(m => m.name),
      pendingSales, live, todayShifts,
      leaderboard: board.slice(0, 5).map(b => ({ username: b.username, total: b.total })),
      simu: { week: sims.length, avg: sims.length ? Math.round(sims.reduce((t, x) => t + x.score, 0) / sims.length) : null } });
  });

  /* ---------- Passage de la compta au mois (une seule fois) ---------- */
  // CA saisi et parts créatrices versées par quinzaine → regroupés sur le mois (les lignes d'origine sont gardées, suffixées « #q »),
  // mois dont les 2 quinzaines étaient clôturées → mois clôturé, objectif de CA doublé (il était par quinzaine)
  if (getSetting("compta_monthly", null) == null) {
    const setS = (k, v) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, String(v));
    const fee = Number(getSetting("platform_fee", "25")), keep = fee < 100 ? 1 - fee / 100 : 1, r2 = x => Math.round(x * 100) / 100;
    const halfRe = /^\d{4}-\d{2}-[AB]$/;
    db.exec("BEGIN");
    try {
      const groups = {};
      db.prepare("SELECT * FROM revenues").all().filter(r => halfRe.test(r.period)).forEach(r => { const g = r.period.slice(0, 7) + ":" + r.model_id; (groups[g] = groups[g] || []).push(r); });
      const chatNetHalf = (h, mid) => r2(Object.entries(validatedByPeriod ? validatedByPeriod(h) : {}).filter(([k]) => +k.split(":")[1] === mid).reduce((t, [, v]) => t + v, 0) * keep);
      Object.entries(groups).forEach(([g, rows]) => {
        const [mk, mid] = [g.split(":")[0], +g.split(":")[1]];
        const isLeg = r => !r.v2 && r.brut != null, used = rows.filter(r => r.v2 || r.brut != null);
        const ex = db.prepare("SELECT * FROM revenues WHERE period = ? AND model_id = ?").get(mk, mid);
        if (used.length && !ex) {
          if (used.every(isLeg)) db.prepare("INSERT INTO revenues (period, model_id, brut, net, v2) VALUES (?,?,?,?,0)").run(mk, mid, r2(used.reduce((t, r) => t + r.brut, 0)), r2(used.reduce((t, r) => t + (r.net || 0), 0)));
          else {
            const v = {}; SRC.forEach(k => { const xs = used.filter(r => r.v2 && r[k] != null); v[k] = xs.length ? r2(xs.reduce((t, r) => t + r[k], 0)) : null; });
            // quinzaine saisie d'un bloc (elle comprenait déjà son chatting) : on garde le reste, le chatting du mois est recalculé automatiquement
            const leg = used.filter(isLeg), ln = leg.length ? r2(leg.reduce((t, r) => t + (r.net || 0) - chatNetHalf(r.period, mid), 0)) : null;
            db.prepare("INSERT INTO revenues (period, model_id, abo, live, coll, push, v2, legacy_net) VALUES (?,?,?,?,?,?,1,?)").run(mk, mid, v.abo, v.live, v.coll, v.push, ln);
          }
        }
        rows.forEach(r => db.prepare("UPDATE revenues SET period = ? WHERE period = ? AND model_id = ?").run(r.period + "#q", r.period, mid));
      });
      const cg = {};
      db.prepare("SELECT * FROM creator_paid").all().filter(r => halfRe.test(r.period)).forEach(r => { const g = r.period.slice(0, 7) + ":" + r.model_id; (cg[g] = cg[g] || []).push(r); });
      Object.entries(cg).forEach(([g, rows]) => {
        const [mk, mid] = [g.split(":")[0], +g.split(":")[1]];
        if (!db.prepare("SELECT 1 FROM creator_paid WHERE period = ? AND model_id = ?").get(mk, mid))
          db.prepare("INSERT INTO creator_paid (period, model_id, amount, paid_at) VALUES (?,?,?,?)").run(mk, mid, r2(rows.reduce((t, r) => t + r.amount, 0)), Math.max(...rows.map(r => r.paid_at)));
        rows.forEach(r => db.prepare("UPDATE creator_paid SET period = ? WHERE period = ? AND model_id = ?").run(r.period + "#q", r.period, mid));
      });
      const locks = db.prepare("SELECT * FROM period_locks").all(), lk = {}; locks.filter(l => halfRe.test(l.period)).forEach(l => { (lk[l.period.slice(0, 7)] = lk[l.period.slice(0, 7)] || []).push(l); });
      Object.entries(lk).forEach(([mk, ls]) => { if (ls.length === 2 && !locks.some(l => l.period === mk))
        db.prepare("INSERT INTO period_locks (period, closed_at, closed_by, snapshot) VALUES (?,?,?,NULL)").run(mk, Math.max(...ls.map(l => l.closed_at)), ls[0].closed_by); });
      const g = db.prepare("SELECT value FROM settings WHERE key = 'goal_ca'").get(); if (g && Number(g.value) > 0) setS("goal_ca", Number(g.value) * 2);
      setS("compta_monthly", Date.now());
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); console.error("passage de la compta au mois", e); }
  }

  return { periodInfo, periodOfDate, monthInfo, computeMonth, comptaMonthOf, currentMonth, computeCompta, tierPay, setTiers, getTiers: () => TIERS, isLocked, hooks, comptaOf, parisDate };
};
