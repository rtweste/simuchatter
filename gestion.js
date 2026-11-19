// Gestion : équipe, créatrices, réglages de l'agence, journal d'activité et sanctions.
const TZ = "Europe/Paris";
const parisDate = ms => new Date(ms).toLocaleDateString("sv-SE", { timeZone: TZ });
const periodOfDate = d => { const [y, m, day] = d.split("-"); return `${y}-${m}-${Number(day) <= 15 ? "A" : "B"}`; };
const dShort = ms => new Date(ms).toLocaleDateString("fr-FR", { timeZone: TZ, day: "numeric", month: "short" });
const hm = ms => new Date(ms).toLocaleTimeString("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const E = n => (Math.round(n * 100) / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " €";
// Formation Twizz : vidéos à regarder dans l'ordre, débloquées quand les critères du simulateur sont verts
const COURSE = [
  { id: "tw1", title: "Créer ton compte et rejoindre l'agence", file: "twizz-01-compte.mp4" },
  { id: "tw2", title: "Envoyer un média payant", file: "twizz-02-media-payant.mp4" },
  { id: "tw3", title: "Les prix et la négo", file: "twizz-03-prix-nego.mp4" },
  { id: "tw4", title: "Connaître son fan", file: "twizz-04-connaitre-son-fan.mp4" },
  { id: "tw5", title: "Les outils pour répondre vite", file: "twizz-05-outils.mp4" },
  { id: "tw6", title: "S'organiser pendant le shift", file: "twizz-06-shift.mp4" }];
const COURSE_DIR = require("path").join(__dirname, "public", "video", "twizz");
const courseList = () => COURSE.filter(v => { try { return require("fs").existsSync(require("path").join(COURSE_DIR, v.file)); } catch (e) { return false; } });
const SRC_LBL = { abo: "Abonnements", live: "Live", coll: "Collections", push: "Média push" };

const DEFAULT_RULES = [
  { key: "late", label: "Retard de plus de 5 min", detail: "après la tolérance", kind: "warn", amount: 0, points: 1 },
  { key: "absent", label: "Absence non prévenue", detail: "aucun pointage", kind: "fine", amount: 20, points: 2 },
  { key: "late_release", label: "Shift lâché moins de 2 h avant", detail: "échange tardif", kind: "fine", amount: 10, points: 2 },
  { key: "doublon", label: "Vente refusée « Doublon »", detail: "déclarée 2 fois", kind: "warn", amount: 0, points: 1 },
  { key: "fake", label: "Fausse vente ou capture truquée", detail: "faute grave", kind: "prime", amount: 0, points: 3 },
  { key: "rules", label: "Non-respect des consignes", detail: "manuel", kind: "warn", amount: 0, points: 1 }];
const DEFAULT_TH = { warnAt: 3, suspendAt: 5, suspendDays: 7, windowDays: 30 };
const TR_DEF = { sessions: { on: true, v: 8 }, avg: { on: true, v: 70 }, hard: { on: true, v: 2, score: 70 }, fans: { on: true, v: 3 }, rt: { on: true, v: 60 }, speed: { on: true, v: 10 }, typing: { on: true, v: 30 }, notify: true };
const KIND_LBL = { warn: "Avertissement", fine: "Retenue", prime: "Perte de prime", suspend: "Suspension" };

module.exports = function mount(app, db, auth, admin, ctx) {
  const { compta, planning } = ctx;
  db.exec(`
  CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, user_id INTEGER, kind TEXT NOT NULL, text TEXT NOT NULL, sub TEXT, chg TEXT);
  CREATE INDEX IF NOT EXISTS activity_at ON activity(at);
  CREATE TABLE IF NOT EXISTS user_notes (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT, text TEXT NOT NULL, created_at INTEGER NOT NULL, created_by INTEGER);
  CREATE TABLE IF NOT EXISTS user_models (user_id INTEGER NOT NULL, model_id INTEGER NOT NULL, PRIMARY KEY (user_id, model_id));
  CREATE TABLE IF NOT EXISTS sanctions (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, rule_key TEXT, label TEXT NOT NULL, detail TEXT, kind TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0, source_key TEXT, status TEXT NOT NULL DEFAULT 'active', period TEXT, adj_id INTEGER,
    event_at INTEGER, created_at INTEGER NOT NULL, created_by INTEGER, explanation TEXT, explained_at INTEGER, decision TEXT);
  CREATE TABLE IF NOT EXISTS sanction_props (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, rule_key TEXT NOT NULL, detail TEXT, event_at INTEGER, source_key TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS suspensions (user_id INTEGER PRIMARY KEY, until INTEGER NOT NULL, reason TEXT);
  `);
  const getSet = (k, d) => db.prepare("SELECT value FROM settings WHERE key = ?").get(k)?.value ?? d;
  const setSet = (k, v) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, String(v));
  // les sanctions automatiques ne regardent que ce qui arrive après leur mise en service
  if (!getSet("sanctions_since", null)) setSet("sanctions_since", Date.now());
  const SALECATS = require("./salecats");
  const AG = () => { try { return JSON.parse(getSet("agency", "{}")); } catch (e) { return {}; } };
  const rules = () => { const a = AG(), r = Array.isArray(a.rules) ? a.rules : [], tol = a.tolerance ?? 5;
    return DEFAULT_RULES.map(d => ({ ...d, ...(r.find(x => x.key === d.key) || {}), ...(d.key === "late" ? { label: `Retard de plus de ${tol} min` } : {}) })); };
  const th = () => ({ ...DEFAULT_TH, ...(AG().thresholds || {}) });
  const trCfg = () => { const t = AG().training || {}, o = {}; for (const k in TR_DEF) o[k] = typeof TR_DEF[k] === "object" ? { ...TR_DEF[k], ...(t[k] || {}) } : (t[k] ?? TR_DEF[k]); return o; };
  const agency = () => { const a = AG(); return {
    tiers: compta.getTiers(), tolerance: a.tolerance ?? 5, missedAlert: a.missedAlert ?? 10, reminder: a.reminder ?? 30, creatorPct: a.creatorPct ?? 50,
    slots: a.slots || [["3–9", "03:00", "09:00"], ["9–15", "09:00", "15:00"], ["15–21", "15:00", "21:00"], ["21–3", "21:00", "03:00"]],
    fee: Number(getSet("platform_fee", "25")), goalCa: Number(getSet("goal_ca", "20000")), goalChatter: Number(getSet("goal_chatter", "300")),
    rules: rules(), thresholds: th(), training: trCfg(), tlPrime: a.tlPrime ?? 30, assistantInfo: a.assistantInfo || "", pauseMax: a.pauseMax ?? 15, pauseCount: a.pauseCount ?? 2, applyWhatsapp: a.applyWhatsapp || "", applyUnlock: a.applyUnlock ?? 70,
    saleCats: SALECATS.cats(db), lateHours: SALECATS.lateHours(db) }; };
  const user = id => db.prepare("SELECT id, username, role, active, created_at FROM users WHERE id = ?").get(id);
  const model = id => db.prepare("SELECT id, name FROM models WHERE id = ?").get(id);

  /* =================== JOURNAL D'ACTIVITÉ =================== */
  const log = (uid, kind, text, sub = "", chg = null) => { try { db.prepare("INSERT INTO activity (at, user_id, kind, text, sub, chg) VALUES (?,?,?,?,?,?)").run(Date.now(), uid || null, kind, text, sub, chg ? JSON.stringify(chg) : null); } catch (e) {} };
  // chaque action importante est notée une fois la réponse envoyée avec succès
  const ROUTES = [
    ["POST", /^\/api\/admin\/sales\/(\d+)\/review$/, (req, m) => { const s = db.prepare("SELECT s.*, u.username, mo.name model_name FROM sales s JOIN users u ON u.id = s.user_id JOIN models mo ON mo.id = s.model_id WHERE s.id = ?").get(+m[1]); if (!s) return;
      const d = req.body?.decision; return d === "validated" ? ["v", `a validé une vente de **${E(s.amount)}**${s.com_amount != null ? (s.com_amount > 0 ? ` (${E(s.com_amount)} pour le chatter)` : " (hors commission)") : ""}`, `${s.username} · ${s.model_name}${s.com_reason ? " · « " + s.com_reason + " »" : s.note ? " · " + s.note : ""}`] : d === "refused" ? ["v", `a refusé une vente de **${E(s.amount)}**`, `${s.username} · ${s.model_name}${s.reason ? " · « " + s.reason + " »" : ""}`] : ["v", `a remis en attente une vente de **${E(s.amount)}**`, `${s.username} · ${s.model_name}`]; }],
    ["POST", /^\/api\/admin\/sales\/(\d+)\/edit$/, (req, m) => { const e = db.prepare("SELECT e.detail, s.amount, u.username, mo.name model_name FROM sale_events e JOIN sales s ON s.id = e.sale_id JOIN users u ON u.id = s.user_id JOIN models mo ON mo.id = s.model_id WHERE e.sale_id = ? AND e.action = 'edited' AND e.at > ? ORDER BY e.id DESC LIMIT 1").get(+m[1], Date.now() - 10e3); if (!e) return;
      return ["v", `a modifié une vente de **${E(e.amount)}**`, `${e.username} · ${e.model_name} · ${e.detail}`]; }],
    ["POST", /^\/api\/admin\/clocks\/(\d+)\/end$/, (req, m) => { const c = db.prepare("SELECT c.end_at, u.username, mo.name FROM clocks c JOIN users u ON u.id = c.user_id JOIN models mo ON mo.id = c.model_id WHERE c.id = ?").get(+m[1]); if (!c || !c.end_at) return;
      return ["a", `a terminé le shift de **${c.username}**`, `${c.name} · dépointé à ${new Date(c.end_at).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })}`]; }],
    ["POST", /^\/api\/admin\/payouts$/, req => { const u = user(+req.body?.user_id); if (!u) return; const p = db.prepare("SELECT amount FROM payouts WHERE period = ? AND user_id = ?").get(req.body.period, u.id);
      return req.body.paid === false ? ["p", `a annulé le paiement de **${u.username}**`, `Paie du ${req.body.period}`] : ["p", `a payé **${u.username}**`, `Paie du ${req.body.period}${p ? " · " + E(p.amount) : ""}`]; }],
    ["POST", /^\/api\/admin\/adjustments$/, req => { const u = user(+req.body?.user_id); if (!u) return; const a = +req.body.amount;
      return ["p", `a ajouté une ${a > 0 ? "prime" : "retenue"} de **${E(Math.abs(a))}** à **${u.username}**`, req.body.reason ? `« ${req.body.reason} »` : ""]; }],
    ["DELETE", /^\/api\/admin\/adjustments\/(\d+)$/, (req, m, before) => before && ["p", `a supprimé une ${before.amount > 0 ? "prime" : "retenue"} de **${E(Math.abs(before.amount))}** à **${before.username}**`, before.reason ? `« ${before.reason} »` : ""],
      (req, m) => db.prepare("SELECT a.*, u.username FROM pay_adjust a JOIN users u ON u.id = a.user_id WHERE a.id = ?").get(+m[1])],
    ["PUT", /^\/api\/admin\/revenue-source$/, (req, m, before) => { const mo = model(+req.body?.model_id); if (!mo) return; const nv = req.body.amount === "" || req.body.amount == null ? null : +String(req.body.amount).replace(",", ".");
      return ["c", `a modifié **${SRC_LBL[req.body.source] || req.body.source}** de **${mo.name}**`, `Compta · ${req.body.period}`, { from: before == null ? "vide" : E(before), to: nv == null ? "vide" : E(nv) }]; },
      req => { try { return db.prepare(`SELECT ${["abo", "live", "coll", "push"].includes(req.body?.source) ? req.body.source : "abo"} v FROM revenues WHERE period = ? AND model_id = ?`).get(req.body?.period, +req.body?.model_id)?.v ?? null; } catch (e) { return null; } }],
    ["POST", /^\/api\/admin\/periods\/([\w-]+)\/close$/, (req, m) => ["c", `a clôturé la quinzaine **${m[1]}**`, "Compta"]],
    ["POST", /^\/api\/admin\/periods\/([\w-]+)\/reopen$/, (req, m) => ["c", `a rouvert la quinzaine **${m[1]}**`, "Compta"]],
    ["POST", /^\/api\/admin\/creator-paid$/, req => { const mo = model(+req.body?.model_id); return mo && ["c", req.body.paid === false ? `a annulé le versement à **${mo.name}**` : `a versé sa part à **${mo.name}**`, `Compta · ${req.body.period}`]; }],
    ["POST", /^\/api\/admin\/swaps\/(\d+)$/, (req, m) => { const w = db.prepare("SELECT w.*, s.date, s.start, s.end, f.username fn, t.username tn FROM shift_swaps w JOIN shifts s ON s.id = w.shift_id JOIN users f ON f.id = w.from_user LEFT JOIN users t ON t.id = w.to_user WHERE w.id = ?").get(+m[1]); if (!w) return;
      return ["pl", req.body.decision === "approve" ? `a validé l'échange **${w.fn} → ${w.tn}**` : `a refusé l'échange de **${w.fn}**`, `${dShort(Date.parse(w.date + "T12:00:00Z"))} · ${w.start}–${w.end}`]; }],
    ["POST", /^\/api\/shifts\/(\d+)\/release$/, (req, m) => { const s = db.prepare("SELECT s.*, mo.name mn FROM shifts s JOIN models mo ON mo.id = s.model_id WHERE s.id = ?").get(+m[1]); return s && ["pl", `**${req.user.username}** a mis son shift du ${dShort(Date.parse(s.date + "T12:00:00Z"))} en échange`, `${s.start}–${s.end} · ${s.mn}`]; }],
    ["POST", /^\/api\/swaps\/(\d+)\/take$/, (req, m) => { const w = db.prepare("SELECT w.*, f.username fn FROM shift_swaps w JOIN users f ON f.id = w.from_user WHERE w.id = ?").get(+m[1]); return w && ["pl", `**${req.user.username}** veut reprendre le shift de **${w.fn}**`, "En attente du manager"]; }],
    ["POST", /^\/api\/reinforce$/, req => { const mo = model(+req.body?.model_id); return mo && ["pl", `**${req.user.username}** a pris **${mo.name}** en renfort`, ""]; }],
    ["POST", /^\/api\/help$/, req => ["pl", `**${req.user.username}** a demandé un renfort`, "J'ai un souci"]],
    ["POST", /^\/api\/admin\/shifts$/, req => { const u = user(+req.body?.user_id), mo = model(+req.body?.model_id); return u && mo && ["pl", `a ajouté un shift à **${u.username}**`, `${req.body.date} · ${req.body.start}–${req.body.end} · ${mo.name}`]; }],
    ["DELETE", /^\/api\/admin\/shifts\/(\d+)$/, (req, m, b) => b && ["pl", `a supprimé un shift de **${b.username}**`, `${b.date} · ${b.start}–${b.end}`], (req, m) => db.prepare("SELECT s.*, u.username FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.id = ?").get(+m[1])],
    ["POST", /^\/api\/admin\/users$/, req => ["a", `a créé le compte de **${req.body?.username}**`, req.body?.role === "admin" ? "Manager" : req.body?.role === "chatter" ? "Chatter" : "En formation"]],
    ["POST", /^\/api\/admin\/users\/(\d+)\/promote$/, (req, m) => { const u = user(+m[1]); return u && ["a", `a validé la formation de **${u.username}**`, "Il passe chatter : planning, ventes et paie ouverts"]; }],
    ["PATCH", /^\/api\/admin\/users\/(\d+)$/, (req, m) => { const u = user(+m[1]); if (!u) return; if (req.body?.password !== undefined) return ["a", `a changé le mot de passe de **${u.username}**`, "Comptes"];
      if (req.body?.active !== undefined) return ["a", `a ${req.body.active ? "réactivé" : "désactivé"} le compte de **${u.username}**`, "Comptes"];
      if (req.body?.role !== undefined) return ["a", `a passé **${u.username}** ${req.body.role === "admin" ? "manager" : req.body.role === "trainee" ? "en formation" : "chatter"}`, "Comptes"]; }],
    ["POST", /^\/api\/admin\/models$/, req => ["a", req.body?.id ? `a modifié la fiche de **${req.body.name}**` : `a ajouté la créatrice **${req.body?.name}**`, "Créatrices"]],
    ["PUT", /^\/api\/admin\/models\/(\d+)\/pct$/, (req, m) => { const mo = model(+m[1]); return mo && ["c", `a mis la part de **${mo.name}** à **${req.body.creator_pct} %**`, "Créatrices"]; }],
    ["PUT", /^\/api\/admin\/settings$/, req => ["s", "a modifié les réglages de la compta", Object.keys(req.body || {}).filter(k => k !== "period").join(", ")]],
    ["PUT", /^\/api\/admin\/agency$/, req => ["s", "a modifié les réglages de l'agence", Object.keys(req.body || {}).join(", ")]]];
  function middleware(req, res, next) {
    const r = ROUTES.find(x => x[0] === req.method && x[1].test(req.path)); if (!r) return next();
    const m = req.path.match(r[1]); let before;
    // le corps JSON est déjà décodé ici : on lit la valeur d'avant la modification
    if (r[3]) { try { before = r[3](req, m); } catch (e) {} }
    res.on("finish", () => { if (res.statusCode >= 300 || !req.user) return; try { const out = r[2](req, m, before); if (out) log(req.user.id, out[0], (req.user.role === "admin" && !out[1].startsWith("**") ? `**${req.user.username}** ` : "") + out[1], out[2], out[3]); } catch (e) {} });
    next();
  }

  /* =================== RÉGLAGES DE L'AGENCE =================== */
  app.get("/api/admin/agency", auth, admin, (req, res) => res.json(agency()));
  app.put("/api/admin/agency", auth, admin, (req, res) => {
    const a = AG(), b = req.body || {};
    const num = (v, lo, hi) => { const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
    if (b.tiers !== undefined) {
      if (!Array.isArray(b.tiers) || !b.tiers.length) return res.status(400).json({ error: "Il faut au moins un palier" });
      const t = b.tiers.map(x => ({ from: num(x.from, 0, 1e7), rate: num(x.rate ?? 0, 0, 100), prime: num(x.prime ?? 0, 0, 1e5) }));
      if (t.some(x => x.from === null || x.rate === null || x.prime === null)) return res.status(400).json({ error: "Palier invalide" });
      a.tiers = t.map(x => ({ from: x.from, rate: x.rate, ...(x.prime ? { prime: x.prime } : {}) })); compta.setTiers(a.tiers);
    }
    if (b.saleCats !== undefined) { try { a.saleCats = SALECATS.clean(b.saleCats); } catch (e) { return res.status(400).json({ error: e.message }); } }
    if (b.lateHours !== undefined) { const v = num(b.lateHours, 1, 24 * 30); if (v === null) return res.status(400).json({ error: "Délai de retard invalide (en heures)" }); a.lateHours = v; }
    if (b.assistantInfo !== undefined) a.assistantInfo = String(b.assistantInfo || "").slice(0, 4000);
    if (b.applyWhatsapp !== undefined) { const w = String(b.applyWhatsapp || "").replace(/[^\d+]/g, "").slice(0, 20); if (w && w.replace(/\D/g, "").length < 9) return res.status(400).json({ error: "Numéro WhatsApp du recrutement invalide (avec l'indicatif, ex. +33 6…)" }); a.applyWhatsapp = w; }
    for (const [k, lo, hi] of [["applyUnlock", 0, 100], ["tolerance", 0, 120], ["missedAlert", 1, 240], ["reminder", 5, 240], ["creatorPct", 0, 100], ["tlPrime", 0, 1000], ["pauseMax", 1, 180], ["pauseCount", 0, 10]]) if (b[k] !== undefined) { const v = num(b[k], lo, hi); if (v === null) return res.status(400).json({ error: "Valeur invalide : " + k }); a[k] = v; }
    if (b.slots !== undefined) {
      if (!Array.isArray(b.slots) || b.slots.some(s => !Array.isArray(s) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s[1]) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s[2]))) return res.status(400).json({ error: "Créneau invalide" });
      a.slots = b.slots.map(s => [String(s[0]).slice(0, 12), s[1], s[2]]);
    }
    if (b.rules !== undefined) { if (!Array.isArray(b.rules)) return res.status(400).json({ error: "Barème invalide" });
      a.rules = b.rules.filter(r => DEFAULT_RULES.some(d => d.key === r.key)).map(r => ({ key: r.key, kind: KIND_LBL[r.kind] ? r.kind : "warn", amount: Math.max(0, num(r.amount || 0, 0, 1e4) || 0), points: Math.max(0, Math.round(num(r.points || 0, 0, 20) || 0)) })); }
    if (b.training !== undefined) { const t = {}, src = b.training || {};
      for (const k of ["sessions", "avg", "hard", "fans", "rt", "speed", "typing"]) { const x = src[k] || {}, d = TR_DEF[k]; const v = num(x.v ?? d.v, 1, 1000);
        if (v === null) return res.status(400).json({ error: "Critère invalide" }); t[k] = { on: x.on !== false, v: Math.round(v) };
        if (k === "hard") { const sc = num(x.score ?? d.score, 1, 100); t[k].score = sc === null ? d.score : Math.round(sc); } }
      t.notify = src.notify !== false; a.training = t; }
    if (b.thresholds !== undefined) { const t = {}; for (const k of ["warnAt", "suspendAt", "suspendDays", "windowDays"]) { const v = num(b.thresholds[k], 1, 365); if (v === null) return res.status(400).json({ error: "Seuil invalide" }); t[k] = Math.round(v); } a.thresholds = t; }
    setSet("agency", JSON.stringify(a));
    if (b.fee !== undefined) { const f = num(b.fee, 0, 90); if (f === null) return res.status(400).json({ error: "Commission de la plateforme invalide" }); setSet("platform_fee", f); }
    if (b.goalCa !== undefined) { const g = num(b.goalCa, 0, 1e8); if (g !== null) setSet("goal_ca", g); }
    if (b.goalChatter !== undefined) { const g = num(b.goalChatter, 0, 1e7); if (g !== null) setSet("goal_chatter", g); }
    res.json({ ok: true, agency: agency() });
  });

  /* =================== ÉQUIPE =================== */
  const habitual = uid => { const fixed = db.prepare("SELECT m.id, m.name FROM user_models um JOIN models m ON m.id = um.model_id WHERE um.user_id = ?").all(uid);
    const fromShifts = db.prepare(`SELECT m.id, m.name, COUNT(*) n FROM shifts s JOIN models m ON m.id = s.model_id WHERE s.user_id = ? AND s.date >= ? GROUP BY m.id ORDER BY n DESC LIMIT 3`).all(uid, parisDate(Date.now() - 30 * 864e5));
    const out = [...fixed]; fromShifts.forEach(x => { if (!out.some(o => o.id === x.id)) out.push({ id: x.id, name: x.name }); }); return out; };
  const pointsOf = uid => { const w = th().windowDays * 864e5; return db.prepare("SELECT COALESCE(SUM(points),0) p FROM sanctions WHERE user_id = ? AND status = 'active' AND created_at > ?").get(uid, Date.now() - w).p; };
  function teamRow(u, C) {
    const now = Date.now(), today = parisDate(now), ch = C.chatters.find(x => x.id === u.id) || {};
    const open = db.prepare("SELECT c.model_id, c.reinforce, m.name FROM clocks c JOIN models m ON m.id = c.model_id WHERE c.user_id = ? AND c.end_at IS NULL ORDER BY c.reinforce").all(u.id);
    const nextShifts = planning.decorate(db.prepare(`${planning.SHIFT_SQL} WHERE s.user_id = ? AND s.date >= ? ORDER BY s.date, s.start LIMIT 6`).all(u.id, parisDate(now - 864e5))).filter(s => s.end_ms > now && s.state !== "done").slice(0, 4);
    const pq = planning.punctuality(u.id, periodOfDate(today));
    const sims = db.prepare("SELECT score FROM sims WHERE user_id = ? AND status = 'done' ORDER BY started_at DESC LIMIT 5").all(u.id);
    const su = planning.suspended(u.id);
    return { id: u.id, username: u.username, role: u.role, rk: u.role === "admin" ? (u.grade === "founder" ? "founder" : u.grade === "assistant" ? "assistant" : "manager") : u.role, active: !!u.active, created_at: u.created_at, purgeAt: !u.active && u.deactivated_at && u.role !== "admin" ? u.deactivated_at + 24 * 3600e3 : null,
      rate: ch.rate || 10, sales: ch.sales || 0, salesCount: ch.salesCount || 0, pay: ch.pay || 0, paid: ch.paid || null, hours: ch.hours || 0, renfortHours: ch.renfortHours || 0,
      punctuality: pq.total ? pq.pct : null, late: pq.late, absent: pq.absent, lateMin: pq.lateMin,
      live: open.length ? open.map(o => o.name + (o.reinforce ? " (renfort)" : "")).join(" + ") : null,
      seen: (global.PRESENCE && global.PRESENCE.get(u.id)) || null,
      pause: (() => { try { const p = db.prepare("SELECT start_at FROM pauses WHERE user_id = ? AND end_at IS NULL").get(u.id); return p ? p.start_at : null; } catch (e) { return null; } })(), pauseMax: agency().pauseMax,
      next: nextShifts.map(s => ({ date: s.date, start: s.start, end: s.end, model: s.model_name, start_ms: s.start_ms, state: s.state })),
      simu: sims.length ? Math.round(sims.reduce((t, x) => t + x.score, 0) / sims.length) : null, simuN: sims.length,
      creators: habitual(u.id), points: pointsOf(u.id), suspendedUntil: su, training: u.role === "trainee" ? training(u.id) : null, notes: db.prepare("SELECT COUNT(*) n FROM user_notes WHERE user_id = ?").get(u.id).n };
  }
  app.get("/api/admin/team", auth, admin, (req, res) => {
    const C = compta.computeCompta(periodOfDate(parisDate(Date.now())));
    const users = db.prepare("SELECT id, username, role, grade, active, created_at, deactivated_at FROM users WHERE deleted_at IS NULL ORDER BY role DESC, username").all();
    const rows = users.filter(u => u.role !== "admin" || u.id !== req.user.id).map(u => teamRow(u, C));
    const act = rows.filter(r => r.active && r.role === "chatter"), pqs = act.filter(r => r.punctuality != null);
    res.json({ me: req.user.id, team: rows, models: db.prepare("SELECT id, name FROM models ORDER BY name").all(), warnAt: th().warnAt, windowDays: th().windowDays,
      kpis: { trainees: rows.filter(r => r.active && r.role === "trainee").length, ready: rows.filter(r => r.active && r.training && r.training.ready).length, active: act.length, live: act.filter(r => r.live).length, punctuality: pqs.length ? Math.round(pqs.reduce((t, r) => t + r.punctuality, 0) / pqs.length) : null, pay: act.reduce((t, r) => t + r.pay, 0) } });
  });
  app.get("/api/admin/team/:id", auth, admin, (req, res) => {
    const u = user(parseInt(req.params.id, 10)); if (!u) return res.status(404).json({ error: "Introuvable" });
    const C = compta.computeCompta(periodOfDate(parisDate(Date.now())));
    const pu = db.prepare("SELECT sells, push_exempt FROM users WHERE id = ?").get(u.id) || {};
    let devices = 0; try { devices = db.prepare("SELECT COUNT(*) n FROM push_subs WHERE user_id = ?").get(u.id).n; } catch (e) {}
    res.json({ ...teamRow(u, C), sells: !!pu.sells, pushExempt: !!pu.push_exempt, devices, notes: db.prepare("SELECT n.*, u.username by_name FROM user_notes n LEFT JOIN users u ON u.id = n.created_by WHERE n.user_id = ? ORDER BY n.created_at DESC").all(u.id),
      sanctions: db.prepare("SELECT * FROM sanctions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20").all(u.id) });
  });
  app.post("/api/admin/team/:id/notes", auth, admin, (req, res) => {
    const u = user(parseInt(req.params.id, 10)), t = String(req.body?.text || "").trim().slice(0, 600); if (!u || !t) return res.status(400).json({ error: "Note vide" });
    db.prepare("INSERT INTO user_notes (user_id, kind, text, created_at, created_by) VALUES (?,?,?,?,?)").run(u.id, String(req.body.kind || "Remarque").slice(0, 30), t, Date.now(), req.user.id); res.json({ ok: true });
  });
  app.delete("/api/admin/notes/:id", auth, admin, (req, res) => { db.prepare("DELETE FROM user_notes WHERE id = ?").run(parseInt(req.params.id, 10)); res.json({ ok: true }); });
  app.put("/api/admin/team/:id/creators", auth, admin, (req, res) => {
    const id = parseInt(req.params.id, 10); if (!user(id)) return res.status(404).json({ error: "Introuvable" });
    db.prepare("DELETE FROM user_models WHERE user_id = ?").run(id);
    (Array.isArray(req.body?.models) ? req.body.models : []).forEach(m => { if (model(+m)) db.prepare("INSERT OR IGNORE INTO user_models (user_id, model_id) VALUES (?,?)").run(id, +m); });
    res.json({ ok: true });
  });

  /* =================== CRÉATRICES =================== */
  app.get("/api/admin/creators", auth, admin, (req, res) => {
    // CA et part de la créatrice sur le mois en cours (la compta est mensuelle)
    const mk = compta.currentMonth(), C = compta.computeMonth(mk), today = parisDate(Date.now());
    const lines = compta.monthInfo(mk).halves.flatMap(h => compta.computeCompta(h).lines);
    const ms = db.prepare("SELECT * FROM models ORDER BY name").all();
    res.json({ creatorPct: agency().creatorPct, month: compta.monthInfo(mk).label, creators: ms.map(m => { const cm = C.models.find(x => x.id === m.id) || {};
      const by = {}; lines.filter(l => l.model_id === m.id && l.validatedBrut > 0).forEach(l => by[l.username] = (by[l.username] || 0) + l.validatedBrut);
      const ch = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([username, amount]) => ({ username, amount }));
      const slots = db.prepare("SELECT DISTINCT start, end FROM shifts WHERE model_id = ? AND date BETWEEN ? AND ? ORDER BY start").all(m.id, today, parisDate(Date.now() + 7 * 864e5));
      return { id: m.id, name: m.name, style: m.style, prices: m.prices, creator_pct: m.creator_pct, net: cm.net || 0, part: cm.creatorPay || 0, sales: cm.chatCount || 0, chatters: ch, slots }; }) });
  });
  app.post("/api/admin/models/:id/default-pct", auth, admin, (req, res) => { const m = model(parseInt(req.params.id, 10)); if (m) db.prepare("UPDATE models SET creator_pct = ? WHERE id = ?").run(agency().creatorPct, m.id); res.json({ ok: true }); });

  /* =================== JOURNAL =================== */
  app.get("/api/admin/activity", auth, admin, (req, res) => {
    const rows = db.prepare("SELECT a.*, u.username FROM activity a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.at DESC LIMIT 400").all().map(r => ({ ...r, chg: r.chg ? JSON.parse(r.chg) : null }));
    const wk = Date.now() - 7 * 864e5, w = rows.filter(r => r.at > wk);
    res.json({ items: rows, week: { validated: w.filter(r => r.kind === "v" && r.text.includes("validé")).length, refused: w.filter(r => r.kind === "v" && r.text.includes("refusé")).length,
      payments: w.filter(r => r.kind === "p" && r.text.includes(" a payé ")).length, compta: w.filter(r => r.kind === "c").length, swaps: w.filter(r => r.kind === "pl" && r.text.includes("échange")).length, sanctions: w.filter(r => r.kind === "x").length } });
  });


  /* =================== FORMATION (rôle « En formation ») =================== */
  db.exec("CREATE TABLE IF NOT EXISTS training_ready (user_id INTEGER PRIMARY KEY, at INTEGER NOT NULL)");
  db.exec("CREATE TABLE IF NOT EXISTS training_bypass (user_id INTEGER PRIMARY KEY, level TEXT NOT NULL, at INTEGER NOT NULL)");
  db.exec("CREATE TABLE IF NOT EXISTS course_progress (user_id INTEGER NOT NULL, video_id TEXT NOT NULL, max_pos REAL NOT NULL DEFAULT 0, dur REAL, upd INTEGER, done_at INTEGER, PRIMARY KEY (user_id, video_id))");
  function course(uid, unlocked) {
    const rows = {}; db.prepare("SELECT video_id, max_pos, dur, done_at FROM course_progress WHERE user_id = ?").all(uid).forEach(r => rows[r.video_id] = r);
    let prevDone = true;
    const videos = courseList().map((v, i) => { const r = rows[v.id] || {}, done = !!r.done_at, locked = !unlocked || !prevDone; prevDone = prevDone && done;
      return { id: v.id, n: i + 1, title: v.title, src: "/video/twizz/" + v.file, done, locked, pos: done ? 0 : Math.max(0, r.max_pos || 0), dur: r.dur || null }; });
    const done = videos.filter(v => v.done).length;
    return { unlocked, videos, done, total: videos.length, complete: videos.length > 0 && done === videos.length, next: videos.find(v => !v.done && !v.locked) || null };
  }
  /* Délai de formation : 24 h à partir de la première connexion de l'élève pour remplir tous les critères */
  const DEADLINE_H = 24;
  db.exec("CREATE TABLE IF NOT EXISTS trainee_deadline (user_id INTEGER PRIMARY KEY, started_at INTEGER NOT NULL, deadline_at INTEGER NOT NULL, met_at INTEGER, rejected_at INTEGER)");
  const dlRow = uid => db.prepare("SELECT * FROM trainee_deadline WHERE user_id = ?").get(uid);
  // démarre le compte à rebours à la première connexion (sans effet s'il tourne déjà)
  function startDeadline(uid) {
    const u = db.prepare("SELECT role FROM users WHERE id = ?").get(uid); if (!u || u.role !== "trainee" || dlRow(uid)) return;
    const now = Date.now(); db.prepare("INSERT OR IGNORE INTO trainee_deadline (user_id, started_at, deadline_at) VALUES (?,?,?)").run(uid, now, now + DEADLINE_H * 3600e3);
  }
  const dlView = r => !r ? { state: "notstarted", hours: DEADLINE_H } : {
    state: r.rejected_at ? "rejected" : r.met_at ? "met" : "running", hours: DEADLINE_H,
    start: r.started_at, end: r.deadline_at, left: Math.max(0, r.deadline_at - Date.now()), metAt: r.met_at, rejectedAt: r.rejected_at };
  // délai dépassé sans avoir rempli les critères : compte désactivé et candidature refusée
  function rejectExpired() {
    const now = Date.now();
    db.prepare(`SELECT d.user_id, u.username FROM trainee_deadline d JOIN users u ON u.id = d.user_id
      WHERE d.met_at IS NULL AND d.rejected_at IS NULL AND d.deadline_at <= ? AND u.role = 'trainee' AND u.active = 1`).all(now).forEach(r => {
      if (training(r.user_id, true).ready) return void db.prepare("UPDATE trainee_deadline SET met_at = ? WHERE user_id = ?").run(now, r.user_id);   // rempli à la dernière seconde
      db.prepare("UPDATE trainee_deadline SET rejected_at = ? WHERE user_id = ?").run(now, r.user_id);
      db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(r.user_id); db.prepare("DELETE FROM tokens WHERE user_id = ?").run(r.user_id);
      log(r.user_id, "a", `**${r.username}** n'a pas terminé sa formation dans les ${DEADLINE_H} h`, "Compte désactivé · candidature refusée automatiquement");
    });
  }
  setInterval(() => { try { rejectExpired(); } catch (e) { console.error("délai de formation", e.message); } }, 60e3).unref();
  setTimeout(() => { try { rejectExpired(); } catch (e) {} }, 5e3).unref();
  const PERS = ctx.PERSONAS || [];
  const mean = a => a.reduce((t, x) => t + x, 0) / a.length;
  const J = s => { try { return JSON.parse(s || "null"); } catch (e) { return null; } };
  function training(uid, noDl) {
    const c = trCfg();
    const sims = db.prepare("SELECT persona_id, difficulty, score, rts, report, started_at FROM sims WHERE user_id = ? AND status = 'done' AND score IS NOT NULL ORDER BY started_at DESC").all(uid);
    const last5 = sims.slice(0, 5), avg5 = last5.length ? Math.round(mean(last5.map(s => s.score))) : null;
    const hardOk = sims.filter(s => s.difficulty === "difficile" && s.score >= c.hard.score).length;
    const fansOk = new Set(sims.filter(s => s.score >= 70).map(s => s.persona_id));
    const rts = last5.flatMap(s => (J(s.rts) || []).filter(x => typeof x === "number")), rt = rts.length ? Math.round(mean(rts)) : null;
    const n = sims.length, pl = (x, w) => `${x} ${w}${x > 1 ? "s" : ""}`;
    // tests d'aptitude : meilleur débit et meilleure vitesse de frappe
    db.exec("CREATE TABLE IF NOT EXISTS skill_tests (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, score REAL NOT NULL, data TEXT, at INTEGER NOT NULL)");
    const bestOf = k => db.prepare("SELECT MAX(score) s FROM skill_tests WHERE user_id = ? AND kind = ?").get(uid, k).s;
    const sp = bestOf("speed"), ty = db.prepare("SELECT MAX(score) s FROM skill_tests WHERE user_id = ? AND kind = 'typing' AND json_extract(data, '$.acc') >= 90").get(uid).s;
    const all = [
      { key: "sessions", label: `${pl(c.sessions.v, "session")} terminée${c.sessions.v > 1 ? "s" : ""}`, value: `${Math.min(n, 99)} / ${c.sessions.v}`, ok: n >= c.sessions.v, pct: n / c.sessions.v },
      { key: "avg", label: `Moyenne ≥ ${c.avg.v} sur les 5 dernières`, value: avg5 == null ? "—" : String(avg5), ok: avg5 != null && avg5 >= c.avg.v, pct: (avg5 || 0) / c.avg.v },
      { key: "hard", label: `${pl(c.hard.v, "session")} difficile${c.hard.v > 1 ? "s" : ""} réussie${c.hard.v > 1 ? "s" : ""}`, sub: `score de ${c.hard.score} ou plus`, value: `${hardOk} / ${c.hard.v}`, ok: hardOk >= c.hard.v, pct: hardOk / c.hard.v },
      { key: "fans", label: `${pl(c.fans.v, "profil")} de fans réussi${c.fans.v > 1 ? "s" : ""}`, sub: "score de 70 ou plus", value: `${fansOk.size} / ${c.fans.v}`, ok: fansOk.size >= c.fans.v, pct: fansOk.size / c.fans.v },
      { key: "rt", label: `Réponse moyenne < ${c.rt.v} s`, sub: "sur les 5 dernières sessions", value: rt == null ? "—" : `${rt} s`, ok: rt != null && rt < c.rt.v, pct: rt ? Math.min(1, c.rt.v / rt) : 0 },
      { key: "speed", label: `Connexion d'au moins ${c.speed.v} Mb/s`, sub: "test de débit", value: sp == null ? "—" : `${Math.round(sp)} Mb/s`, ok: sp != null && sp >= c.speed.v, pct: (sp || 0) / c.speed.v, link: "/tests?t=speed" },
      { key: "typing", label: `Frappe d'au moins ${c.typing.v} mots/min`, sub: "test de frappe, 90 % de précision minimum", value: ty == null ? "—" : `${Math.round(ty)} mots/min`, ok: ty != null && ty >= c.typing.v, pct: (ty || 0) / c.typing.v, link: "/tests?t=typing" }];
    const byp = db.prepare("SELECT level FROM training_bypass WHERE user_id = ?").get(uid);
    const simCrit = all.filter(x => c[x.key].on).map(x => ({ ...x, pct: Math.max(0, Math.min(1, x.pct)) })).map(x => byp && !x.ok ? { ...x, ok: true, pct: 1, test: true } : x);
    const simReady = simCrit.every(x => x.ok), co = course(uid, simReady);
    const criteria = co.total ? [...simCrit, { key: "course", label: "Formation Twizz terminée", sub: simReady ? `${co.total} vidéos à regarder jusqu'au bout` : "se débloque quand les critères du simulateur sont verts", value: `${co.done} / ${co.total}`, ok: co.complete, pct: co.done / co.total }] : simCrit;
    const done = criteria.filter(x => x.ok).length, total = criteria.length, ready = total > 0 && done === total;
    const fans = PERS.map(p => ({ id: p.id, name: p.name, label: p.label, ok: fansOk.has(p.id) }));
    const miss = simCrit.find(x => !x.ok) || criteria.find(x => !x.ok), notFan = fans.find(f => !f.ok);
    const tip = !miss ? "Tous tes critères sont verts : ton manager peut valider ta formation." :
      miss.key === "sessions" ? `Encore ${c.sessions.v - n} session${c.sessions.v - n > 1 ? "s" : ""} à terminer pour valider le premier critère.` :
      miss.key === "avg" ? `Ta moyenne est à ${avg5} : vise ${c.avg.v} ou plus sur tes prochaines sessions.` :
      miss.key === "hard" ? `Tente une session <b>difficile</b>${notFan ? ` contre <b>${notFan.label}</b>` : ""} : il t'en manque ${c.hard.v - hardOk}.` :
      miss.key === "fans" ? `Essaie un nouveau profil${notFan ? ` : <b>${notFan.label}</b>` : ""}. Il te faut ${c.fans.v} profils réussis.` :
      miss.key === "speed" ? (sp == null ? `Fais le <b>test de connexion</b> : il prend moins d'une minute.` : `Ta connexion est à ${Math.round(sp)} Mb/s : refais le test depuis un meilleur réseau (wifi proche de la box, ou câble).`) :
      miss.key === "typing" ? (ty == null ? `Fais le <b>test de frappe</b> : 60 secondes pour mesurer ta vitesse d'écriture.` : `Ta meilleure frappe est à ${Math.round(ty)} mots/min : vise ${c.typing.v} ou plus, entraîne-toi et retente.`) :
      miss.key === "course" ? `Ton simulateur est validé : la <b>formation Twizz</b> est débloquée. Regarde ${co.next ? `la vidéo <b>${co.next.n}</b>` : "les vidéos"} jusqu'au bout.` :
      `Réponds plus vite : ta moyenne est de ${rt} s, l'objectif est sous ${c.rt.v} s.`;
    const u = db.prepare("SELECT username, role, created_at FROM users WHERE id = ?").get(uid);
    if (u && u.role === "trainee" && ready && c.notify && !db.prepare("SELECT 1 FROM training_ready WHERE user_id = ?").get(uid)) {
      db.prepare("INSERT OR IGNORE INTO training_ready (user_id, at) VALUES (?, ?)").run(uid, Date.now());
      log(uid, "a", `**${u.username}** a rempli tous les critères de formation`, "Prêt : sa formation peut être validée");
    }
    let dl = null;
    if (u && u.role === "trainee" && !noDl) {
      const r = dlRow(uid);
      if (r && ready && !r.met_at && !r.rejected_at) { db.prepare("UPDATE trainee_deadline SET met_at = ? WHERE user_id = ?").run(Date.now(), uid); r.met_at = Date.now(); }
      dl = dlView(r);
    }
    return { criteria, done, total, ready, tip, fans, simReady, course: co, test: byp ? byp.level : null, deadline: dl, interview: u && u.role === "trainee" && !noDl && typeof interview === "function" ? interview(uid) : null,
      day: u ? Math.floor((Date.now() - u.created_at) / 864e5) + 1 : 1,
      stats: { avg5, best: n ? Math.max(...sims.map(s => s.score)) : null, sessions: n, rt, hard: hardOk, trend: sims.slice(0, 8).map(s => s.score).reverse() } };
  }
  app.get("/api/training", auth, (req, res) => res.json(training(req.user.id)));
  // Outil de test (manager) : forcer les critères d'un élève, ou le remettre à zéro
  app.post("/api/admin/users/:id/training-test", auth, admin, (req, res) => {
    const u = db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(parseInt(req.params.id, 10)), mode = req.body.mode;
    if (!u || u.role !== "trainee") return res.status(400).json({ error: "Ce compte n'est pas en formation" });
    if (!["sim", "all", "reset"].includes(mode)) return res.status(400).json({ error: "Action inconnue" });
    const now = Date.now();
    if (mode === "reset") {
      db.prepare("DELETE FROM training_bypass WHERE user_id = ?").run(u.id); db.prepare("DELETE FROM course_progress WHERE user_id = ?").run(u.id);
      db.prepare("DELETE FROM training_ready WHERE user_id = ?").run(u.id); db.prepare("UPDATE users SET intro_seen = 0 WHERE id = ?").run(u.id);
      db.prepare("DELETE FROM trainee_deadline WHERE user_id = ?").run(u.id); db.prepare("DELETE FROM interviews WHERE user_id = ?").run(u.id);
      log(req.user.id, "a", `Test : formation de **${u.username}** remise à zéro`, "Critères forcés, vidéos, présentation, délai de 24 h et entretien réinitialisés");
    } else {
      db.prepare("INSERT INTO training_bypass (user_id, level, at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET level = excluded.level, at = excluded.at").run(u.id, mode, now);
      if (mode === "all") { const ins = db.prepare("INSERT INTO course_progress (user_id, video_id, max_pos, dur, upd, done_at) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id, video_id) DO UPDATE SET done_at = COALESCE(course_progress.done_at, excluded.done_at)");
        courseList().forEach(v => ins.run(u.id, v.id, 0, null, now, now));
        const A = { _test: true }; IV_QUESTIONS.forEach(q => A[q.id] = q.type === "slots" ? { v: agency().slots.slice(0, 2).map(x => x[0]), note: "" } : q.type === "rating" ? { v: 4, note: "" } : { v: "ok", note: "" });
        db.prepare("INSERT INTO interviews (user_id, by_id, started_at, updated_at, done_at, decision, answers) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET answers = excluded.answers, done_at = excluded.done_at, decision = excluded.decision, updated_at = excluded.updated_at")
          .run(u.id, req.user.id, now, now, now, "review", JSON.stringify(A)); }
      log(req.user.id, "a", `Test : ${mode === "all" ? "toute la formation validée" : "critères du simulateur validés"} pour **${u.username}**`, "Outil de test du manager");
    }
    res.json({ ok: true, training: training(u.id) });
  });
  /* =================== ENTRETIEN MANAGER (dernière étape avant de passer chatter) =================== */
  db.exec("CREATE TABLE IF NOT EXISTS interviews (user_id INTEGER PRIMARY KEY, by_id INTEGER, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, done_at INTEGER, decision TEXT, answers TEXT NOT NULL DEFAULT '{}')");
  const OK3 = (a, b, c) => [{ v: "ok", label: a, tone: "ok" }, { v: "mid", label: b, tone: "mid" }, { v: "bad", label: c, tone: "bad" }];
  const IV_QUESTIONS = [
    { id: "dispo", cat: "Disponibilités", type: "slots", q: "Sur quels shifts du planning peux-tu travailler ?", hint: "Coche tous les créneaux qu'il peut tenir régulièrement." },
    { id: "motiv", cat: "Motivation", type: "choice", q: "Pourquoi tu veux devenir chatter chez StellADS ?", hint: "Cherche une vraie envie : la vente, l'écrit, la régularité. Méfie-toi du « c'est de l'argent facile ».", options: OK3("Convaincant", "Moyen", "Pas convaincant") },
    { id: "exp", cat: "Expérience", type: "choice", q: "As-tu déjà fait du chat, de la vente ou du service client ?", hint: "Pas obligatoire : le simulateur a déjà montré son niveau. Ça t'aide à savoir comment l'accompagner.", options: OK3("Oui, en vente ou chat", "Un peu", "Aucune") },
    { id: "situ", cat: "Mise en situation", type: "choice", q: "« Un fan te dit qu'il n'a plus d'argent ce mois-ci mais il veut absolument la vidéo. Tu fais quoi ? »", hint: "Bonne réponse : il respecte le refus, ne met pas de pression et garde le lien pour plus tard.", options: OK3("Respecte les règles", "Partiellement", "Met la pression") },
    { id: "rules", cat: "Règles de l'agence", type: "choice", q: "Que fais-tu quand un média payant passe de « En attente » à « Accepté » ?", hint: "Bonne réponse : il prend une capture d'écran de la vente et la dépose sur le dashboard StellADS, dans « Mes ventes ».", options: OK3("Bonne réponse", "Hésitant", "Ne sait pas") },
    { id: "feel", cat: "Ton ressenti", type: "rating", q: "Note globale de l'entretien", hint: "Ton impression générale : sérieux, ponctualité, façon de parler." }];
  // boutons de décision (verbe) et libellé une fois l'entretien terminé
  const IV_DECISIONS = { hire: "Recruter", review: "À revoir", refused: "Refuser" };
  const IV_DONE_LBL = { hire: "Recruté", review: "À revoir", refused: "Refusé", recommended: "Recommandé" };
  const ivRow = uid => { const r = db.prepare("SELECT * FROM interviews WHERE user_id = ?").get(uid); if (r) r.answers = J(r.answers) || {}; return r; };
  const ivAnswered = (q, a) => !!a && (q.type === "slots" ? Array.isArray(a.v) && a.v.length > 0 : q.type === "rating" ? a.v >= 1 && a.v <= 5 : !!q.options.find(o => o.v === a.v));
  function interview(uid) {
    const r = ivRow(uid), ans = r ? r.answers : {}, by = r && r.by_id ? db.prepare("SELECT username FROM users WHERE id = ?").get(r.by_id) : null;
    const answered = IV_QUESTIONS.filter(q => ivAnswered(q, ans[q.id])).length;
    return { started: !!r, done: !!(r && r.done_at), answered, total: IV_QUESTIONS.length, decision: r ? r.decision : null, decisionLabel: r && r.decision ? IV_DONE_LBL[r.decision] : null,
      by: by ? by.username : null, startedAt: r ? r.started_at : null, updatedAt: r ? r.updated_at : null, doneAt: r ? r.done_at : null, test: !!(ans._test) };
  }
  app.get("/api/admin/users/:id/interview", auth, admin, (req, res) => {
    const u = db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(parseInt(req.params.id, 10)); if (!u) return res.status(404).json({ error: "Introuvable" });
    const r = ivRow(u.id);
    res.json({ questions: IV_QUESTIONS, slots: agency().slots.map(s => ({ id: s[0], label: s[0], start: s[1], end: s[2] })), decisions: IV_DECISIONS,
      answers: r ? r.answers : {}, decision: r ? r.decision : null, summary: interview(u.id), training: training(u.id) });
  });
  // enregistrement au fil de l'eau (chaque clic) ; « done » termine l'entretien avec la décision
  app.put("/api/admin/users/:id/interview", auth, admin, (req, res) => {
    const u = db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(parseInt(req.params.id, 10));
    if (!u || u.role !== "trainee") return res.status(400).json({ error: "Ce compte n'est pas en formation" });
    const b = req.body || {}, now = Date.now(), r = ivRow(u.id), ans = r ? r.answers : {}, slotIds = agency().slots.map(s => s[0]);
    if (!r && !training(u.id, true).ready) return res.status(400).json({ error: "L'entretien se débloque quand tous ses critères sont verts" });
    for (const q of IV_QUESTIONS) { const a = b.answers && b.answers[q.id]; if (a === undefined) continue;
      if (a === null) { delete ans[q.id]; continue; }
      const note = String(a.note || "").slice(0, 800);
      if (q.type === "slots") ans[q.id] = { v: (Array.isArray(a.v) ? a.v : []).filter(x => slotIds.includes(x)), note };
      else if (q.type === "rating") ans[q.id] = { v: Math.max(0, Math.min(5, parseInt(a.v, 10) || 0)), note };
      else ans[q.id] = { v: q.options.some(o => o.v === a.v) ? a.v : null, note }; }
    let decision = r ? r.decision : null; if (b.decision !== undefined) decision = IV_DECISIONS[b.decision] ? b.decision : null;
    let doneAt = r ? r.done_at : null;
    if (b.done) {
      const miss = IV_QUESTIONS.filter(q => !ivAnswered(q, ans[q.id]));
      if (miss.length) return res.status(400).json({ error: `Il reste ${miss.length} question${miss.length > 1 ? "s" : ""} : ${miss.map(q => q.cat).join(", ")}` });
      if (!decision) return res.status(400).json({ error: "Choisis une décision" });
      doneAt = now;
    }
    if (r) db.prepare("UPDATE interviews SET answers = ?, decision = ?, updated_at = ?, done_at = ? WHERE user_id = ?").run(JSON.stringify(ans), decision, now, doneAt, u.id);
    else db.prepare("INSERT INTO interviews (user_id, by_id, started_at, updated_at, done_at, decision, answers) VALUES (?,?,?,?,?,?,?)").run(u.id, req.user.id, now, now, doneAt, decision, JSON.stringify(ans));
    let outcome = null;
    if (b.done) { const d = ans.dispo ? ans.dispo.v.join(", ") : "", sub = `Note ${ans.feel ? ans.feel.v : "?"} / 5${d ? " · dispo : " + d : ""}`;
      if (decision === "hire") {          // Recruter : il devient chatter tout de suite
        db.prepare("UPDATE users SET role = 'chatter' WHERE id = ?").run(u.id); db.prepare("DELETE FROM training_ready WHERE user_id = ?").run(u.id);
        db.prepare("DELETE FROM tokens WHERE user_id = ?").run(u.id);   // il se reconnecte avec son nouvel accès
        outcome = "hired"; log(req.user.id, "a", `a recruté **${u.username}** après l'entretien`, sub + " · il est maintenant chatter");
      } else if (decision === "refused") { // Refuser : compte désactivé tout de suite
        db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(u.id); db.prepare("DELETE FROM tokens WHERE user_id = ?").run(u.id);
        outcome = "refused"; log(req.user.id, "a", `a refusé la candidature de **${u.username}** après l'entretien`, sub + " · compte désactivé");
      } else log(req.user.id, "a", `a fait passer l'entretien de **${u.username}** · à revoir`, sub);
    }
    res.json({ ok: true, outcome, summary: interview(u.id) });
  });
  // rouvrir un entretien terminé pour le modifier
  app.post("/api/admin/users/:id/interview/reopen", auth, admin, (req, res) => {
    db.prepare("UPDATE interviews SET done_at = NULL, updated_at = ? WHERE user_id = ?").run(Date.now(), parseInt(req.params.id, 10)); res.json({ ok: true });
  });
  // Manager : donner du temps en plus à un élève (+24 h), ce qui réactive aussi une candidature refusée pour délai
  app.post("/api/admin/users/:id/deadline", auth, admin, (req, res) => {
    const u = db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(parseInt(req.params.id, 10));
    if (!u || u.role !== "trainee") return res.status(400).json({ error: "Ce compte n'est pas en formation" });
    const h = Math.max(1, Math.min(168, parseInt(req.body?.hours, 10) || DEADLINE_H)), now = Date.now(), r = dlRow(u.id);
    if (!r) startDeadline(u.id);
    const base = r && !r.rejected_at ? Math.max(now, r.deadline_at) : now;
    db.prepare("UPDATE trainee_deadline SET deadline_at = ?, rejected_at = NULL, met_at = NULL WHERE user_id = ?").run(base + h * 3600e3, u.id);
    const wasRejected = r && r.rejected_at; if (wasRejected) db.prepare("UPDATE users SET active = 1 WHERE id = ?").run(u.id);
    log(req.user.id, "a", `a donné **${h} h** de plus à **${u.username}** pour terminer sa formation`, wasRejected ? "Compte réactivé · candidature rouverte" : "Délai de formation prolongé");
    res.json({ ok: true, training: training(u.id) });
  });
  // Avancement d'une vidéo : on ne peut pas sauter de passage (la position ne peut avancer que du temps réellement écoulé)
  app.post("/api/course/:id/progress", auth, (req, res) => {
    const uid = req.user.id, T = training(uid), v = T.course.videos.find(x => x.id === req.params.id);
    if (!v) return res.status(404).json({ error: "Vidéo introuvable" });
    if (v.locked) return res.status(403).json({ error: "Cette vidéo n'est pas encore débloquée" });
    if (v.done) return res.json({ ok: true, done: true, training: T });
    const pos = Number(req.body.pos), dur = Number(req.body.dur);
    if (!isFinite(pos) || pos < 0 || !isFinite(dur) || dur <= 0 || dur > 3600) return res.status(400).json({ error: "Position invalide" });
    const now = Date.now(), r = db.prepare("SELECT max_pos, upd FROM course_progress WHERE user_id = ? AND video_id = ?").get(uid, v.id);
    const prev = r ? r.max_pos : 0, el = r && r.upd ? (now - r.upd) / 1000 : 0;
    const max = Math.max(prev, Math.min(pos, prev + el * 1.25 + 6, dur));
    const done = max >= dur - 1.5;
    db.prepare("INSERT INTO course_progress (user_id, video_id, max_pos, dur, upd, done_at) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id, video_id) DO UPDATE SET max_pos = excluded.max_pos, dur = excluded.dur, upd = excluded.upd, done_at = COALESCE(course_progress.done_at, excluded.done_at)")
      .run(uid, v.id, max, dur, now, done ? now : null);
    if (done) { const u = db.prepare("SELECT username FROM users WHERE id = ?").get(uid); log(uid, "a", `**${u ? u.username : "?"}** a terminé la vidéo ${v.n} de la formation Twizz`, v.title); }
    res.json({ ok: true, done, max, training: done ? training(uid) : undefined });
  });
  app.post("/api/admin/users/:id/promote", auth, admin, (req, res) => {
    const u = db.prepare("SELECT id, role FROM users WHERE id = ?").get(parseInt(req.params.id, 10));
    if (!u || u.role !== "trainee") return res.status(400).json({ error: "Ce compte n'est pas en formation" });
    const iv = interview(u.id);
    if (!iv.done && !req.body?.force) return res.status(400).json({ error: "Fais d'abord passer l'entretien" });
    if (iv.done && iv.decision === "refused" && !req.body?.force) return res.status(400).json({ error: "L'entretien est marqué « Refusé »" });
    db.prepare("UPDATE users SET role = 'chatter' WHERE id = ?").run(u.id); db.prepare("DELETE FROM training_ready WHERE user_id = ?").run(u.id);
    res.json({ ok: true });
  });

  /* =================== SANCTIONS =================== */
  const ruleOf = k => rules().find(r => r.key === k);
  function detect() {
    const since = +getSet("sanctions_since", Date.now()), now = Date.now(), add = db.prepare("INSERT OR IGNORE INTO sanction_props (user_id, rule_key, detail, event_at, source_key, created_at) VALUES (?,?,?,?,?,?)");
    const from = parisDate(Math.max(since, now - 14 * 864e5) - 864e5);
    planning.decorate(db.prepare(`${planning.SHIFT_SQL} WHERE s.date >= ? ORDER BY s.date`).all(from)).forEach(s => {
      if (s.start_ms < since) return;
      if (s.state === "done" && s.late > 0) add.run(s.user_id, "late", `${dShort(s.start_ms)} · ${s.start}–${s.end} · ${s.model_name} · pointé à ${hm(s.clock_in)} (+${s.late} min)`, s.start_ms, "late:" + s.id + ":" + s.user_id, now);
      if (s.state === "absent") add.run(s.user_id, "absent", `${dShort(s.start_ms)} · ${s.start}–${s.end} · ${s.model_name} · aucun pointage`, s.start_ms, "absent:" + s.id + ":" + s.user_id, now);
    });
    db.prepare(`SELECT w.*, s.date, s.start, s.end, m.name mn FROM shift_swaps w JOIN shifts s ON s.id = w.shift_id JOIN models m ON m.id = s.model_id WHERE w.created_at > ? AND w.status != 'cancelled'`).all(since).forEach(w => {
      const start = planning.shiftSpan(w)[0]; if (start - w.created_at < 2 * 3.6e6) add.run(w.from_user, "late_release", `${dShort(start)} · ${w.start}–${w.end} · ${w.mn} · lâché ${Math.max(0, Math.round((start - w.created_at) / 60000))} min avant`, w.created_at, "lrel:" + w.id, now); });
    db.prepare(`SELECT s.*, m.name mn FROM sales s JOIN models m ON m.id = s.model_id WHERE s.status = 'refused' AND s.reviewed_at > ? AND s.reason LIKE '%Doublon%'`).all(since)
      .forEach(s => add.run(s.user_id, "doublon", `${E(s.amount)} · ${s.mn} · ${dShort(s.sold_at)}`, s.reviewed_at, "dbl:" + s.id, now));
  }
  function suspendIfNeeded(uid, by) {
    const t = th(), p = pointsOf(uid); if (p < t.suspendAt) return null;
    const cur = planning.suspended(uid); if (cur) return cur;
    const until = Date.now() + t.suspendDays * 864e5;
    db.prepare("INSERT INTO suspensions (user_id, until, reason) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET until = excluded.until, reason = excluded.reason").run(uid, until, `${p} points`);
    const u = user(uid); log(by, "x", `**${u.username}** atteint **${p} points** : shifts suspendus ${t.suspendDays} jours`, `jusqu'au ${dShort(until)}`); return until;
  }
  function applySanction({ uid, ruleKey, label, detail, kind, amount, points, eventAt, sourceKey, by }) {
    const now = Date.now(); let pk = periodOfDate(parisDate(eventAt || now));
    if (compta.isLocked(pk)) pk = periodOfDate(parisDate(now));
    let adj = null;
    if (kind === "fine" && amount > 0) adj = db.prepare("INSERT INTO pay_adjust (period, user_id, amount, reason, created_at, created_by) VALUES (?,?,?,?,?,?)").run(pk, uid, -amount, `Sanction · ${label.replace(/^[^·]+· /, "")}`, now, by).lastInsertRowid;
    const id = db.prepare(`INSERT INTO sanctions (user_id, rule_key, label, detail, kind, amount, points, source_key, period, adj_id, event_at, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(uid, ruleKey || null, label, detail || "", kind, kind === "fine" ? amount : 0, points, sourceKey || null, pk, adj, eventAt || now, now, by).lastInsertRowid;
    if (kind === "suspend") { const until = now + th().suspendDays * 864e5; db.prepare("INSERT INTO suspensions (user_id, until, reason) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET until = excluded.until, reason = excluded.reason").run(uid, until, label); }
    const u = user(uid);
    log(by, "x", `**${user(by)?.username || "Le manager"}** a sanctionné **${u.username}** : ${KIND_LBL[kind].toLowerCase()}${kind === "fine" ? ` de **${E(amount)}**` : ""}`, `${label}${points ? ` · +${points} pt${points > 1 ? "s" : ""}` : ""}`);
    suspendIfNeeded(uid, by);
    return id;
  }
  function cancelSanction(s, by) {
    db.prepare("UPDATE sanctions SET status = 'cancelled', decision = 'cancelled' WHERE id = ?").run(s.id);
    if (s.adj_id) db.prepare("DELETE FROM pay_adjust WHERE id = ?").run(s.adj_id);
    // la suspension saute si les points repassent sous le seuil
    if (pointsOf(s.user_id) < th().suspendAt) db.prepare("DELETE FROM suspensions WHERE user_id = ?").run(s.user_id);
    log(by, "x", `**${user(by)?.username}** a annulé la sanction de **${user(s.user_id)?.username}**`, s.label + (s.amount ? ` · ${E(s.amount)} rendus` : ""));
  }
  // perte de prime : la prime de palier de la quinzaine saute
  compta.hooks.primeLost = (uid, pk) => { try { return !!db.prepare("SELECT 1 FROM sanctions WHERE user_id = ? AND period = ? AND kind = 'prime' AND status = 'active'").get(uid, pk); } catch (e) { return false; } };

  app.get("/api/admin/sanctions", auth, admin, (req, res) => {
    detect();
    const t = th(), R = rules(), w = Date.now() - t.windowDays * 864e5, pk = periodOfDate(parisDate(Date.now()));
    const props = db.prepare("SELECT p.*, u.username FROM sanction_props p JOIN users u ON u.id = p.user_id WHERE p.status = 'open' AND u.active = 1 ORDER BY p.event_at DESC").all()
      .map(p => { const r = R.find(x => x.key === p.rule_key) || {}; return { ...p, rule: r }; });
    const expl = db.prepare("SELECT s.*, u.username FROM sanctions s JOIN users u ON u.id = s.user_id WHERE s.status = 'active' AND s.explanation IS NOT NULL AND s.decision IS NULL ORDER BY s.explained_at DESC").all();
    const users = db.prepare("SELECT id, username FROM users WHERE role = 'chatter' AND active = 1 ORDER BY username").all();
    const pts = users.map(u => ({ id: u.id, username: u.username, points: pointsOf(u.id), suspendedUntil: planning.suspended(u.id) })).sort((a, b) => b.points - a.points);
    const recent = db.prepare("SELECT s.*, u.username FROM sanctions s JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC LIMIT 30").all()
      .map(s => ({ ...s, expired: s.created_at < w }));
    const fines = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM sanctions WHERE status = 'active' AND kind = 'fine' AND period = ?").get(pk).t;
    res.json({ props, explanations: expl, points: pts, recent, rules: R, thresholds: t, users,
      kpis: { todo: props.length, active: db.prepare("SELECT COUNT(*) n FROM sanctions WHERE status = 'active' AND created_at > ?").get(w).n, fines, watch: pts.filter(p => p.points >= t.warnAt).length } });
  });
  app.post("/api/admin/sanctions/props/:id", auth, admin, (req, res) => {
    const p = db.prepare("SELECT * FROM sanction_props WHERE id = ?").get(parseInt(req.params.id, 10)); if (!p || p.status !== "open") return res.status(404).json({ error: "Déjà traité" });
    const a = req.body?.action, r = ruleOf(p.rule_key);
    if (a === "ignore") { db.prepare("UPDATE sanction_props SET status = 'ignored' WHERE id = ?").run(p.id); return res.json({ ok: true }); }
    if (!["apply", "lighten"].includes(a) || !r) return res.status(400).json({ error: "Action invalide" });
    const light = a === "lighten";
    applySanction({ uid: p.user_id, ruleKey: p.rule_key, label: `${light ? "Avertissement" : KIND_LBL[r.kind]} · ${r.label.charAt(0).toLowerCase() + r.label.slice(1)}`, detail: p.detail,
      kind: light ? "warn" : r.kind, amount: light ? 0 : r.amount, points: light ? Math.min(1, r.points) : r.points, eventAt: p.event_at, sourceKey: p.source_key, by: req.user.id });
    db.prepare("UPDATE sanction_props SET status = ? WHERE id = ?").run(light ? "lightened" : "applied", p.id);
    res.json({ ok: true, points: pointsOf(p.user_id), suspendedUntil: planning.suspended(p.user_id) });
  });
  app.post("/api/admin/sanctions", auth, admin, (req, res) => {
    const u = user(parseInt(req.body?.user_id, 10)); if (!u) return res.status(400).json({ error: "Choisis un chatter" });
    const r = ruleOf(req.body.rule_key), kind = KIND_LBL[req.body.kind] ? req.body.kind : r?.kind || "warn";
    const amount = Math.max(0, Number(String(req.body.amount ?? r?.amount ?? 0).replace(",", ".")) || 0), points = Math.max(0, Math.round(Number(req.body.points ?? r?.points ?? 1) || 0));
    const label = `${KIND_LBL[kind]} · ${(String(req.body.label || "").trim() || r?.label || "sanction manuelle").replace(/^./, c => c.toLowerCase())}`;
    if (kind === "fine" && !amount) return res.status(400).json({ error: "Indique le montant de la retenue" });
    const id = applySanction({ uid: u.id, ruleKey: r?.key || "manual", label, detail: String(req.body.detail || "Sanction manuelle").slice(0, 200), kind, amount, points, eventAt: Date.now(), by: req.user.id });
    res.json({ ok: true, id });
  });
  app.post("/api/admin/sanctions/:id/decide", auth, admin, (req, res) => {
    const s = db.prepare("SELECT * FROM sanctions WHERE id = ?").get(parseInt(req.params.id, 10)); if (!s || s.status !== "active") return res.status(404).json({ error: "Introuvable" });
    if (req.body?.decision === "cancel") cancelSanction(s, req.user.id);
    else { db.prepare("UPDATE sanctions SET decision = 'kept' WHERE id = ?").run(s.id); log(req.user.id, "x", `**${req.user.username}** a maintenu la sanction de **${user(s.user_id)?.username}**`, s.label); }
    res.json({ ok: true });
  });
  app.delete("/api/admin/suspensions/:uid", auth, admin, (req, res) => { db.prepare("DELETE FROM suspensions WHERE user_id = ?").run(parseInt(req.params.uid, 10)); log(req.user.id, "x", `**${req.user.username}** a levé la suspension de **${user(parseInt(req.params.uid, 10))?.username}**`, ""); res.json({ ok: true }); });

  /* ----- chatter : son dossier ----- */
  app.post("/api/my-sanctions/:id/explain", auth, (req, res) => {
    const s = db.prepare("SELECT * FROM sanctions WHERE id = ? AND user_id = ?").get(parseInt(req.params.id, 10), req.user.id); if (!s || s.status !== "active") return res.status(404).json({ error: "Introuvable" });
    const t = String(req.body?.text || "").trim().slice(0, 600); if (!t) return res.status(400).json({ error: "Explique ce qui s'est passé" });
    db.prepare("UPDATE sanctions SET explanation = ?, explained_at = ?, decision = NULL WHERE id = ?").run(t, Date.now(), s.id);
    log(req.user.id, "x", `**${req.user.username}** a donné une explication`, `${s.label} · « ${t.slice(0, 80)}${t.length > 80 ? "…" : ""} »`); res.json({ ok: true });
  });
  const ruleTxt = r => r.kind === "fine" ? `${E(r.amount)} · ${r.points} pt${r.points > 1 ? "s" : ""}` : `${KIND_LBL[r.kind]}${r.points ? ` · ${r.points} pt${r.points > 1 ? "s" : ""}` : ""}`;
  compta.hooks.discipline = uid => {
    const t = th(), R = rules(), now = Date.now(), W = t.windowDays * 864e5, grace = +(AG().tolerance ?? 5);
    const act = db.prepare("SELECT * FROM sanctions WHERE user_id = ? AND status = 'active' AND created_at > ? ORDER BY created_at DESC").all(uid, now - W);
    const points = act.reduce((s, x) => s + x.points, 0);
    const exp = act.filter(x => x.points > 0).sort((a, b) => a.created_at - b.created_at)[0];
    const days = ms => { const d = Math.ceil(ms / 864e5); return d <= 1 ? "1 j" : d + " j"; };
    const risks = [], su = planning.suspended(uid);
    if (su) risks.push({ level: "hot", title: "Tes shifts sont suspendus", short: "Suspendu", text: `Plus de reprise de shift ni de renfort jusqu'au <strong>${dShort(su)}</strong>.`, until: su, cdLabel: "RESTANT" });
    const today = parisDate(now);
    const near = planning.decorate(db.prepare(`${planning.SHIFT_SQL} WHERE s.user_id = ? AND s.date BETWEEN ? AND ? ORDER BY s.date, s.start`).all(uid, parisDate(now - 864e5), parisDate(now + 8 * 864e5)))
      .filter(s => s.end_ms > now && s.state !== "done" && !(s.swap && s.swap.status === "requested"));
    const lateR = R.find(r => r.key === "late"), absR = R.find(r => r.key === "absent"), relR = R.find(r => r.key === "late_release");
    const cur = near[0];
    if (cur && cur.state === "missing") {
      risks.push({ level: "hot", title: "Ton shift a commencé", short: "Pointe maintenant", text: `${cur.model_name} · ${cur.start} → ${cur.end}. Tu as ${cur.late} min de retard : pointe maintenant (${ruleTxt(lateR)}). Sans pointage, c'est une absence (${ruleTxt(absR)}).` });
    } else if (cur && cur.state === "future" && cur.start_ms - now <= 2 * 3.6e6) {
      const limit = cur.start_ms + grace * 60000;
      risks.push({ level: cur.start_ms - now <= 3.6e6 ? "hot" : "mid", title: "Ton shift commence bientôt", short: `Pointe avant ${hm(limit)}`,
        text: `${cur.model_name} · ${cur.start} → ${cur.end}. Pointe avant <strong>${hm(limit)}</strong> : après, c'est un retard (${ruleTxt(lateR)})${points + (lateR?.points || 0) >= t.suspendAt ? ` et tu passes à ${points + lateR.points} points` : ""}.`, until: limit });
    }
    const rel = near.find(s => s.state === "future" && !(s.swap) && s.start_ms - 2 * 3.6e6 > now);
    if (rel) risks.push({ level: "mid", title: `Lâcher ton shift du ${dShort(rel.start_ms)}`, text: `Gratuit jusqu'au ${dShort(rel.start_ms - 2 * 3.6e6)} à ${hm(rel.start_ms - 2 * 3.6e6)}. Ensuite : ${ruleTxt(relR)}.`, until: rel.start_ms - 2 * 3.6e6, cdLabel: "SANS RISQUE" });
    const lastRef = db.prepare("SELECT reviewed_at FROM sales WHERE user_id = ? AND status = 'refused' ORDER BY reviewed_at DESC LIMIT 1").get(uid);
    const dbl = db.prepare("SELECT COUNT(*) n FROM sales WHERE user_id = ? AND status = 'refused' AND reason LIKE '%Doublon%' AND reviewed_at > ?").get(uid, now - W).n;
    risks.push(dbl ? { level: "mid", title: `${dbl} vente${dbl > 1 ? "s" : ""} refusée${dbl > 1 ? "s" : ""} pour doublon`, text: "Vérifie que tu ne déclares pas deux fois la même vente." }
      : { level: "ok", title: "Ventes : rien à signaler", text: lastRef ? `Aucune vente refusée depuis ${Math.max(1, Math.floor((now - lastRef.reviewed_at) / 864e5))} jours.` : "Aucune vente refusée." });
    return { points, warnAt: t.warnAt, suspendAt: t.suspendAt, suspendDays: t.suspendDays, windowDays: t.windowDays, suspendedUntil: su ? dShort(su) : null,
      nextExpiry: exp ? { inTxt: days(exp.created_at + W - now), pct: Math.round(Math.min(100, (now - exp.created_at) / W * 100)), points: exp.points } : null,
      risks, sanctions: act.map(x => ({ id: x.id, points: x.points, amount: x.amount, label: x.label, when: x.detail && x.detail !== "Sanction manuelle" ? x.detail : `${dShort(x.event_at || x.created_at)}${x.detail ? " · " + x.detail : ""}`,
        expires: `le ${dShort(x.created_at + W)}`, explanation: x.explanation, status: x.decision === "kept" ? "sanction maintenue par le manager" : "pending" })),
      rules: R.filter(r => r.points || r.amount || r.kind !== "warn").map(r => ({ label: r.label, sanction: ruleTxt(r) })) };
  };

  // lecture du délai : si l'heure est passée, le refus est appliqué tout de suite (sans attendre le balayage de la minute)
  const refusedByInterview = uid => { const r = db.prepare("SELECT decision, done_at FROM interviews WHERE user_id = ?").get(uid); return !!(r && r.done_at && r.decision === "refused"); };
  const deadline = uid => { let r = dlRow(uid); if (r && !r.met_at && !r.rejected_at && r.deadline_at <= Date.now()) { rejectExpired(); r = dlRow(uid); } return dlView(r); };
  return { middleware, log, agency, startDeadline, deadline, refusedByInterview, training };
};
