const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const { DatabaseSync } = require("node:sqlite");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const PERSONAS = require("./personas");
const ai = require("./ai");

/* ================= Configuration ================= */
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "app.db");
const DAILY_LIMIT = parseInt(process.env.DAILY_SIM_LIMIT || "10", 10); // simulations / chatter / jour
const MAX_MESSAGES = parseInt(process.env.MAX_MESSAGES_PER_SIM || "40", 10);
const HINT_PENALTY = 3;
let LIVE = null;   // module « simlive » (réglages dont la limite par jour)
const dailyLimit = () => LIVE ? LIVE.getSet().limit : DAILY_LIMIT;
const PROD = process.env.NODE_ENV === "production";

if (!ai.MOCK && !process.env.ANTHROPIC_API_KEY) {
  console.error("❌ ANTHROPIC_API_KEY manquante. Ajoutez-la dans les variables d'environnement.");
  process.exit(1);
}

/* ================= Base de données ================= */
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
// Coût de l'IA : chaque appel est enregistré avec son prix (dollars, tarifs Anthropic par million de tokens)
db.exec("CREATE TABLE IF NOT EXISTS ai_usage (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, sim_id INTEGER, user_id INTEGER, kind TEXT, model TEXT, in_tok INTEGER, out_tok INTEGER, cache_w INTEGER, cache_r INTEGER, cost REAL)");
const AI_PRICE = { "claude-haiku": [0.10, 0.50, 0.125, 0.01], "claude-sonnet": [2, 10, 2.5, 0.10], "claude-opus": [2, 10, 2.5, 0.10] };
ai.setUsageHook((tag, model, u) => {
  const p = AI_PRICE[Object.keys(AI_PRICE).find(k => String(model).startsWith(k))] || AI_PRICE["claude-sonnet"];
  const i = u.input_tokens || 0, o = u.output_tokens || 0, w = u.cache_creation_input_tokens || 0, r = u.cache_read_input_tokens || 0;
  const cost = (i * p[0] + o * p[1] + w * p[2] + r * p[3]) / 1e6;
  try { db.prepare("INSERT INTO ai_usage (at, sim_id, user_id, kind, model, in_tok, out_tok, cache_w, cache_r, cost) VALUES (?,?,?,?,?,?,?,?,?,?)").run(Date.now(), tag.sim || null, tag.user || null, tag.kind || null, model, i, o, w, r, cost); } catch (e) {}
});
db.exec("PRAGMA journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','chatter','trainee')), active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, style TEXT NOT NULL, prices TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sims (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, persona_id TEXT NOT NULL, difficulty TEXT NOT NULL,
  creator_name TEXT NOT NULL, creator_style TEXT NOT NULL, prices TEXT NOT NULL,
  log TEXT NOT NULL DEFAULT '[]', interest INTEGER NOT NULL, budget INTEGER NOT NULL,
  spent INTEGER NOT NULL DEFAULT 0, revenue INTEGER NOT NULL DEFAULT 0, hints INTEGER NOT NULL DEFAULT 0,
  left_conv INTEGER NOT NULL DEFAULT 0, pending_ppv TEXT, rts TEXT NOT NULL DEFAULT '[]',
  fan_ready_at INTEGER, status TEXT NOT NULL DEFAULT 'active', score INTEGER, report TEXT,
  started_at INTEGER NOT NULL, ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS sims_user ON sims(user_id, started_at);
`);

// rôle « En formation » (trainee) : on reconstruit la table si l'ancienne contrainte de rôle est encore là
{
  const r = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (r && r.sql.includes("CHECK(role IN ('admin','chatter'))")) {
    const sql = r.sql.replace(/CREATE TABLE\s+("?users"?)/i, "CREATE TABLE users_new").replace("CHECK(role IN ('admin','chatter'))", "CHECK(role IN ('admin','chatter','trainee'))");
    db.exec("PRAGMA foreign_keys = OFF"); db.exec("BEGIN");
    try { db.exec(sql); db.exec("INSERT INTO users_new SELECT * FROM users; DROP TABLE users; ALTER TABLE users_new RENAME TO users;"); db.exec("COMMIT"); }
    catch (e) { db.exec("ROLLBACK"); console.error("Migration des rôles impossible :", e.message); }
  }
}
// Compte manager initial
if (process.env.ADMIN_USER && process.env.ADMIN_PASSWORD) {
  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(process.env.ADMIN_USER);
  if (!exists) {
    db.prepare("INSERT INTO users (username, pass_hash, role, created_at) VALUES (?,?,?,?)")
      .run(process.env.ADMIN_USER, bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10), "admin", Date.now());
    console.log(`✅ Compte manager « ${process.env.ADMIN_USER} » créé.`);
  }
}
// Créatrice d'exemple
if (!db.prepare("SELECT COUNT(*) n FROM models").get().n) {
  db.prepare("INSERT INTO models (name, style, prices) VALUES (?,?,?)").run(
    "Léa",
    "Douce et taquine, 24 ans, fan de fitness et de voyages. Écrit en minuscules, utilise peu d'emojis (😏 🙈), tutoie toujours.",
    "Photos : 8–15 € · Vidéo courte : 15–25 € · Vidéo longue : 30–50 €"
  );
}

/* ================= Helpers ================= */
const J = s => JSON.parse(s);
function loadSim(id) {
  const s = db.prepare("SELECT * FROM sims WHERE id = ?").get(id);
  if (!s) return null;
  s.log = J(s.log); s.rts = J(s.rts); s.pending_ppv = s.pending_ppv ? J(s.pending_ppv) : null;
  return s;
}
function saveSim(s) {
  db.prepare(`UPDATE sims SET log=?, interest=?, spent=?, revenue=?, hints=?, left_conv=?, pending_ppv=?, rts=?,
    fan_ready_at=?, status=?, score=?, report=?, ended_at=? WHERE id=?`).run(
    JSON.stringify(s.log), s.interest, s.spent, s.revenue, s.hints, s.left_conv ? 1 : 0,
    s.pending_ppv ? JSON.stringify(s.pending_ppv) : null, JSON.stringify(s.rts),
    s.fan_ready_at, s.status, s.score ?? null, s.report ?? null, s.ended_at ?? null, s.id);
}
const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
const publicPersona = p => ({ id: p.id, name: p.name, label: p.label, level: p.level, desc: p.desc, goal: p.goal, opens: p.opens });
function publicSim(s) {
  return {
    id: s.id, persona: publicPersona(PERSONAS.find(p => p.id === s.persona_id)), difficulty: s.difficulty,
    creator_name: s.creator_name, creator_style: s.creator_style, prices: s.prices,
    log: s.log, revenue: s.revenue, interest: s.interest, hints: s.hints, left: !!s.left_conv,
    avgRt: avg(s.rts), status: s.status, score: s.score, report: s.report ? J(s.report) : null,
    started_at: s.started_at, ended_at: s.ended_at
  };
}

// Verrou : une requête IA à la fois par simulation
const busy = new Set();
async function withLock(id, res, fn) {
  if (busy.has(id)) return res.status(429).json({ error: "Patientez, le fan est en train de répondre." });
  busy.add(id);
  try { await fn(); }
  catch (e) {
    console.error(e);
    // message plus précis selon la cause
    const st = e.status || 0, m = String(e.message || "").toLowerCase();
    let msg = "L'IA n'a pas pu répondre. Réessayez dans un instant.";
    if (m.includes("credit") || m.includes("billing") || m.includes("balance")) msg = "Crédit de l'API Anthropic épuisé : rechargez le compte sur console.anthropic.com.";
    else if (st === 401 || st === 403) msg = "Clé d'API refusée : vérifiez ANTHROPIC_API_KEY dans Railway.";
    else if (st === 429 || st === 529 || st >= 500) msg = "L'IA est surchargée en ce moment. Réessayez dans une minute.";
    else if (m.includes("json")) msg = "Réponse de l'IA illisible. Cliquez à nouveau sur Évaluer.";
    res.status(502).json({ error: msg });
  } finally { busy.delete(id); }
}

// Fait jouer le fan et applique ses décisions
async function playFan(sim) {
  const persona = PERSONAS.find(p => p.id === sim.persona_id);
  const r = await ai.fanTurn(sim, persona);
  let replies = Array.isArray(r.replies) ? r.replies : [r.reply];
  replies = replies.filter(x => typeof x === "string" && x.trim()).slice(0, 3);
  if (!replies.length) replies = ["..."];
  // l'intérêt bouge par paliers : une petite maladresse ne fait pas chuter un fan qui vient d'acheter
  if (typeof r.interest === "number") {
    const prev = sim.interest, want = Math.max(0, Math.min(100, Math.round(r.interest)));
    const maxDown = r.left ? 100 : sim.difficulty === "difficile" ? 15 : sim.difficulty === "facile" ? 8 : 12;
    let v = Math.max(prev - maxDown, Math.min(prev + 15, want));
    if (sim.pending_ppv && r.ppv_decision === "buy") v = Math.max(v, prev);   // il achète : son intérêt ne baisse pas ce tour-ci
    sim.interest = v;
  }

  let ppvEvent = null;
  if (sim.pending_ppv && r.ppv_decision) {
    const ppv = sim.pending_ppv;
    const entry = sim.log.find(l => l.who === "ppv" && l.id === ppv.id);
    let status;
    if (r.ppv_decision === "buy" && ppv.price <= sim.budget - sim.spent) {
      status = "acheté"; sim.spent += ppv.price; sim.revenue += ppv.price; sim.pending_ppv = null;
    } else if (r.ppv_decision === "negotiate") {
      status = "en négociation";
    } else {
      status = "refusé"; sim.pending_ppv = null;
    }
    if (entry) entry.status = status;
    ppvEvent = { id: ppv.id, status, price: ppv.price };
  }

  // Délais d'affichage réalistes (le chrono de réponse démarre après le dernier message affiché)
  const out = replies.map(text => ({ text, delay: Math.min(2600, 700 + text.length * 28) }));
  out.forEach(m => sim.log.push({ who: "fan", text: m.text, at: Date.now() }));
  sim.fan_ready_at = Date.now() + out.reduce((t, m) => t + m.delay, 0);
  if (r.left) sim.left_conv = true;
  saveSim(sim);
  return { replies: out, ppv: ppvEvent, left: !!sim.left_conv, interest: sim.interest, revenue: sim.revenue };
}

function recordRt(sim) {
  if (sim.fan_ready_at) {
    sim.rts.push(Math.max(0, Math.round((Date.now() - sim.fan_ready_at) / 1000)));
    sim.fan_ready_at = null;
  }
}

/* ================= App ================= */
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "SAMEORIGIN");   // l'accueil peut être préparé dans la page de connexion (même site uniquement)
  res.set("Content-Security-Policy", "frame-ancestors 'self'");
  res.set("Referrer-Policy", "same-origin");
  next();
});

// Authentification
function auth(req, res, next) {
  const tok = req.cookies.tok;
  if (!tok) return res.status(401).json({ error: "Non connecté" });
  const row = db.prepare(`SELECT u.id, u.username, u.role, u.active, u.grade, u.team_lead, t.expires_at FROM tokens t
    JOIN users u ON u.id = t.user_id WHERE t.token = ?`).get(tok);
  if (!row || row.expires_at < Date.now() || !row.active) return res.status(401).json({ error: "Session expirée" });
  row.rk = PERM.rk(row); req.user = row;
  if (row.grade === "assistant" && req.path === "/api/home") PERM.stripMargin(res);
  if (row.role === "trainee" && TRAINEE_BLOCK.test(req.path)) return res.status(403).json({ error: "Réservé aux chatters : termine ta formation d'abord" });
  next();
}
const TRAINEE_BLOCK = /^\/api\/(sales|shifts|swaps|reinforce|help|planning|clock|my-pay|my-sanctions|home)(\/|$)/;
// rôles fins (Fondateur, Manager, Assistante, Team Leader) : voir perms.js
const PERM = require("./perms")(db, () => GEST && GEST.agency());
const admin = PERM.admin;
// journal d'activité (branché plus bas, une fois la gestion montée)
let GEST = null;
app.use((req, res, next) => GEST ? GEST.middleware(req, res, next) : next());
// passation de shift : à la fin d'un shift, on vérifie que les fans prioritaires reçus ont été suivis
let HAND = null, STUDIO = null;
app.use((req, res, next) => {
  if (!HAND || req.method !== "POST" || req.path !== "/api/clock/out" || !req.cookies.tok) return next();
  try { const t = db.prepare("SELECT user_id FROM tokens WHERE token = ?").get(req.cookies.tok), c = t && HAND.openClock(t.user_id);
    if (c) res.on("finish", () => { if (res.statusCode < 300) HAND.checkMissed(t.user_id, c); }); } catch (e) {}
  next();
});

const attempts = new Map();
app.post("/api/login", (req, res) => {
  const ip = req.ip;
  const a = attempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) return res.status(429).json({ error: "Trop de tentatives. Réessayez dans 15 minutes." });
  const { username, password } = req.body || {};
  let u = db.prepare("SELECT * FROM users WHERE username = ?").get(String(username || "").trim());
  if (u && u.role === "trainee" && GEST) { GEST.deadline(u.id); u = db.prepare("SELECT * FROM users WHERE id = ?").get(u.id); }
  if (u && !u.active && u.role === "trainee" && GEST && bcrypt.compareSync(String(password || ""), u.pass_hash)) {
    if (GEST.refusedByInterview(u.id)) return res.status(403).json({ error: "Merci pour ton entretien : ta candidature n'a pas été retenue." });
    if (GEST.deadline(u.id).state === "rejected") return res.status(403).json({ error: "Le délai de 24 h pour terminer ta formation est dépassé : ta candidature n'a pas été retenue." });
  }
  if (u && u.active && u.pass_hash === "!" && !u.deleted_at) return res.status(401).json({ error: "Ton compte n'est pas encore activé : ouvre le lien d'invitation envoyé par ton manager" });
  if (!u || !u.active || !bcrypt.compareSync(String(password || ""), u.pass_hash)) {
    a.n++; attempts.set(ip, a);
    return res.status(401).json({ error: "Identifiant ou mot de passe incorrect" });
  }
  attempts.delete(ip);
  if (u.role === "trainee" && GEST) GEST.startDeadline(u.id);   // le compte à rebours de 24 h démarre à la première connexion
  const token = crypto.randomBytes(32).toString("hex");
  const ttl = 30 * 24 * 3600e3;
  db.prepare("INSERT INTO tokens VALUES (?,?,?)").run(token, u.id, Date.now() + ttl);
  res.cookie("tok", token, { httpOnly: true, sameSite: "lax", secure: PROD, maxAge: ttl });
  res.json({ role: u.role });
});
app.post("/api/logout", (req, res) => {
  if (req.cookies.tok) db.prepare("DELETE FROM tokens WHERE token = ?").run(req.cookies.tok);
  res.clearCookie("tok"); res.json({ ok: true });
});
// vidéo de présentation : vue une fois par chaque chatter (les comptes existants la voient aussi une fois)
if (!db.prepare("PRAGMA table_info(users)").all().some(c => c.name === "intro_seen")) db.exec("ALTER TABLE users ADD COLUMN intro_seen INTEGER NOT NULL DEFAULT 0");
app.get("/api/me", auth, (req, res) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const used = db.prepare("SELECT COUNT(*) n FROM sims WHERE user_id = ? AND started_at >= ?").get(req.user.id, today.getTime()).n;
  const intro = db.prepare("SELECT intro_seen FROM users WHERE id = ?").get(req.user.id)?.intro_seen ? 1 : 0;
  let deadline = null;
  if (req.user.role === "trainee" && GEST) { GEST.startDeadline(req.user.id); deadline = GEST.deadline(req.user.id);
    if (deadline.state === "rejected") return res.status(401).json({ error: "Session expirée" }); }
  const tl = req.user.team_lead ? db.prepare("SELECT id, username FROM users WHERE id = ? AND active = 1 AND grade = 'tl'").get(req.user.team_lead) : null;
  const ob = db.prepare("SELECT onboarded_at FROM users WHERE id = ?").get(req.user.id);
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role, grade: req.user.grade || null, rk: req.user.rk, roleLabel: PERM.LABEL[req.user.rk], onboarded: !!(ob && ob.onboarded_at),
    teamLead: tl ? { id: tl.id, username: tl.username } : null, dailyLimit: dailyLimit(), usedToday: used, introSeen: intro, deadline });
});
// nouvelle version de la vidéo : les élèves déjà inscrits la regardent une fois (une seule réinitialisation)
setTimeout(() => { try { const k = db.prepare("SELECT value FROM settings WHERE key = 'intro_version'").get();
  if (!k || k.value !== "2") { db.prepare("UPDATE users SET intro_seen = 0 WHERE role = 'trainee'").run(); db.prepare("INSERT INTO settings (key, value) VALUES ('intro_version', '2') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(); } } catch (e) { console.error("intro v2", e.message); } }, 0);
app.post("/api/me/intro-seen", auth, (req, res) => { db.prepare("UPDATE users SET intro_seen = 1 WHERE id = ?").run(req.user.id); res.json({ ok: true }); });

/* ----- Données de configuration ----- */
app.get("/api/personas", auth, (req, res) => res.json(PERSONAS.map(publicPersona)));
app.get("/api/models", auth, (req, res) => res.json(db.prepare(req.user.role === "admin" ? "SELECT * FROM models ORDER BY name" : "SELECT id, name, style, prices FROM models ORDER BY name").all()));

/* ----- Simulation (chatter) ----- */
function ownSim(req, res) {
  const sim = loadSim(parseInt(req.params.id, 10));
  if (!sim || sim.user_id !== req.user.id) { res.status(404).json({ error: "Simulation introuvable" }); return null; }
  return sim;
}

app.post("/api/sims", auth, async (req, res) => {
  const { personaId, difficulty, modelId } = req.body || {};
  const persona = PERSONAS.find(p => p.id === personaId);
  const model = db.prepare("SELECT * FROM models WHERE id = ?").get(modelId);
  if (!persona || !model) return res.status(400).json({ error: "Profil ou créatrice invalide" });
  const diff = ["facile", "normal", "difficile"].includes(difficulty) ? difficulty : "normal";
  if (req.user.role !== "admin") {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const used = db.prepare("SELECT COUNT(*) n FROM sims WHERE user_id = ? AND started_at >= ?").get(req.user.id, today.getTime()).n;
    if (used >= dailyLimit()) return res.status(429).json({ error: `Limite de ${dailyLimit()} simulations par jour atteinte.` });
  }
  // Ferme les anciennes simulations non terminées
  db.prepare("UPDATE sims SET status = 'abandoned', ended_at = ? WHERE user_id = ? AND status = 'active'").run(Date.now(), req.user.id);
  const info = db.prepare(`INSERT INTO sims (user_id, persona_id, difficulty, creator_name, creator_style, prices, interest, budget, started_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(req.user.id, persona.id, diff, model.name, model.style, model.prices, persona.interest, persona.budget, Date.now());
  const sim = loadSim(info.lastInsertRowid);
  if (!persona.opens) {
    sim.fan_ready_at = Date.now(); saveSim(sim);
    return res.json({ sim: publicSim(sim), turn: null });
  }
  await withLock(sim.id, res, async () => {
    const turn = await playFan(sim);
    res.json({ sim: publicSim(sim), turn });
  });
});

app.get("/api/sims/:id", auth, (req, res) => {
  const sim = loadSim(parseInt(req.params.id, 10));
  if (!sim || (sim.user_id !== req.user.id && req.user.role !== "admin")) return res.status(404).json({ error: "Introuvable" });
  const u = db.prepare("SELECT username FROM users WHERE id = ?").get(sim.user_id);
  res.json({ ...publicSim(sim), username: u?.username });
});

function canAct(sim, res) {
  if (sim.status !== "active") { res.status(400).json({ error: "Simulation terminée" }); return false; }
  if (sim.left_conv) { res.status(400).json({ error: "Le fan a quitté la conversation" }); return false; }
  if (sim.log.filter(l => l.who !== "fan").length >= MAX_MESSAGES) { res.status(400).json({ error: "Nombre maximum de messages atteint : terminez la session." }); return false; }
  return true;
}

app.post("/api/sims/:id/message", auth, async (req, res) => {
  const sim = ownSim(req, res); if (!sim || !canAct(sim, res)) return;
  const text = String(req.body?.text || "").trim().slice(0, 1000);
  if (!text) return res.status(400).json({ error: "Message vide" });
  await withLock(sim.id, res, async () => {
    recordRt(sim);
    sim.log.push({ who: "chatter", text, at: Date.now() });
    saveSim(sim);
    res.json(await playFan(sim));
  });
});

app.post("/api/sims/:id/ppv", auth, async (req, res) => {
  const sim = ownSim(req, res); if (!sim || !canAct(sim, res)) return;
  const desc = String(req.body?.desc || "").trim().slice(0, 300);
  const price = Math.round(Number(req.body?.price));
  const msg = String(req.body?.msg || "").trim().slice(0, 500);
  if (!desc || !price || price < 1 || price > 1000) return res.status(400).json({ error: "Description ou prix invalide" });
  await withLock(sim.id, res, async () => {
    recordRt(sim);
    if (sim.pending_ppv) {
      const old = sim.log.find(l => l.who === "ppv" && l.id === sim.pending_ppv.id);
      if (old) old.status = "remplacé";
    }
    if (msg) sim.log.push({ who: "chatter", text: msg, at: Date.now() });
    const ppv = { id: Date.now(), desc, price };
    sim.pending_ppv = ppv;
    sim.log.push({ who: "ppv", id: ppv.id, desc, price, status: "en attente", at: Date.now() });
    saveSim(sim);
    const turn = await playFan(sim);
    res.json({ ...turn, ppvId: ppv.id });
  });
});

app.post("/api/sims/:id/hint", auth, async (req, res) => {
  const sim = ownSim(req, res); if (!sim || sim.status !== "active") return res.headersSent || res.status(400).json({ error: "Simulation terminée" });
  await withLock(sim.id, res, async () => {
    const text = await ai.hint(sim, PERSONAS.find(p => p.id === sim.persona_id));
    sim.hints++; saveSim(sim);
    res.json({ text, hints: sim.hints });
  });
});

app.post("/api/sims/:id/end", auth, async (req, res) => {
  const sim = ownSim(req, res); if (!sim) return;
  if (sim.status === "done") return res.json(publicSim(sim));
  if (!sim.log.some(l => l.who === "chatter" || l.who === "ppv")) return res.status(400).json({ error: "Envoyez au moins un message avant d'évaluer." });
  await withLock(sim.id, res, async () => {
    const ppvs = sim.log.filter(l => l.who === "ppv");
    const stats = { ppvSent: ppvs.length, ppvBought: ppvs.filter(p => p.status === "acheté").length, avgRt: avg(sim.rts) };
    const report = await ai.evaluate(sim, PERSONAS.find(p => p.id === sim.persona_id), stats);
    const raw = Math.max(0, Math.min(100, Math.round(Number(report.score) || 0)));
    report.rawScore = raw;
    sim.score = Math.max(0, raw - sim.hints * HINT_PENALTY);
    sim.report = JSON.stringify(report);
    sim.status = "done"; sim.ended_at = Date.now(); sim.pending_ppv = null;
    saveSim(sim);
    try { LIVE && LIVE.onEnd(sim); } catch (e) { console.error(e); }
    res.json(publicSim(sim));
  });
});

app.get("/api/my-sims", auth, (req, res) => {
  res.json(db.prepare(`SELECT id, persona_id, difficulty, creator_name, revenue, score, rts, started_at FROM sims
    WHERE user_id = ? AND status = 'done' ORDER BY started_at DESC LIMIT 50`).all(req.user.id)
    .map(r => ({ ...r, avgRt: avg(J(r.rts)), rts: undefined, persona: PERSONAS.find(p => p.id === r.persona_id)?.name })));
});

// suppression automatique des comptes désactivés : date de désactivation et de suppression
for (const c of ["deactivated_at", "deleted_at"]) if (!db.prepare("PRAGMA table_info(users)").all().some(x => x.name === c)) db.exec(`ALTER TABLE users ADD COLUMN ${c} INTEGER`);
/* ----- Manager ----- */
app.get("/api/admin/users", auth, admin, (req, res) => {
  res.json(db.prepare(`SELECT u.id, u.username, u.role, u.active, u.created_at,
      COUNT(s.id) sessions, ROUND(AVG(s.score)) avgScore, ROUND(AVG(s.revenue)) avgRevenue, MAX(s.started_at) lastAt
    FROM users u LEFT JOIN sims s ON s.user_id = u.id AND s.status = 'done'
    WHERE u.deleted_at IS NULL GROUP BY u.id ORDER BY u.role, u.username`).all());
});
app.post("/api/admin/users", auth, admin, (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const role = ["admin", "chatter", "trainee"].includes(req.body?.role) ? req.body.role : "trainee";
  if (!/^[\w.\-]{3,30}$/.test(username)) return res.status(400).json({ error: "Identifiant : 3 à 30 caractères (lettres, chiffres, . _ -)" });
  if (password.length < 8) return res.status(400).json({ error: "Mot de passe : 8 caractères minimum" });
  try {
    const uid = db.prepare("INSERT INTO users (username, pass_hash, role, created_at) VALUES (?,?,?,?)").run(username, bcrypt.hashSync(password, 10), role, Date.now()).lastInsertRowid;
    // créatrices habituelles choisies à la création
    if (Array.isArray(req.body.models)) req.body.models.forEach(m => { try { db.prepare("INSERT OR IGNORE INTO user_models (user_id, model_id) VALUES (?,?)").run(uid, parseInt(m, 10)); } catch (e) {} });
    res.json({ ok: true, id: uid });
  } catch (e) { res.status(400).json({ error: "Cet identifiant existe déjà" }); }
});
app.patch("/api/admin/users/:id", auth, admin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (req.body?.password !== undefined) {
    if (String(req.body.password).length < 8) return res.status(400).json({ error: "Mot de passe : 8 caractères minimum" });
    db.prepare("UPDATE users SET pass_hash = ? WHERE id = ?").run(bcrypt.hashSync(String(req.body.password), 10), id);
    db.prepare("DELETE FROM tokens WHERE user_id = ?").run(id);
  }
  if (req.body?.active !== undefined) {
    if (id === req.user.id) return res.status(400).json({ error: "Vous ne pouvez pas désactiver votre propre compte" });
    db.prepare("UPDATE users SET active = ? WHERE id = ?").run(req.body.active ? 1 : 0, id);
    if (!req.body.active) db.prepare("DELETE FROM tokens WHERE user_id = ?").run(id);
    else try { db.prepare("UPDATE trainee_deadline SET rejected_at = NULL, met_at = NULL, deadline_at = ? WHERE user_id = ? AND rejected_at IS NOT NULL").run(Date.now() + 24 * 3600e3, id); } catch (e) {}
  }
  if (req.body?.role !== undefined) {
    if (id === req.user.id) return res.status(400).json({ error: "Tu ne peux pas changer ton propre rôle" });
    if (!["admin", "chatter", "trainee"].includes(req.body.role)) return res.status(400).json({ error: "Rôle invalide" });
    db.prepare("UPDATE users SET role = ?, grade = NULL, team_lead = CASE WHEN ? = 'admin' THEN NULL ELSE team_lead END WHERE id = ?").run(req.body.role, req.body.role, id);
    db.prepare("DELETE FROM tokens WHERE user_id = ?").run(id);
  }
  res.json({ ok: true });
});

app.get("/api/admin/sims", auth, admin, (req, res) => {
  const where = ["s.status = 'done'"]; const args = [];
  if (req.query.user) { where.push("s.user_id = ?"); args.push(parseInt(req.query.user, 10)); }
  if (req.query.persona) { where.push("s.persona_id = ?"); args.push(String(req.query.persona)); }
  res.json(db.prepare(`SELECT s.id, s.user_id, u.username, s.persona_id, s.difficulty, s.creator_name, s.revenue, s.score, s.hints, s.rts, s.report, s.started_at
    FROM sims s JOIN users u ON u.id = s.user_id WHERE ${where.join(" AND ")} ORDER BY s.started_at DESC LIMIT 300`).all(...args)
    .map(r => {
      const rep = r.report ? J(r.report) : {};
      return { ...r, report: undefined, rts: undefined, avgRt: avg(J(r.rts)), persona: PERSONAS.find(p => p.id === r.persona_id)?.name, ethics: rep.ethics_flag || null, verdict: rep.verdict || "" };
    }));
});

app.post("/api/admin/models", auth, admin, (req, res) => {
  const { name, style, prices } = req.body || {};
  if (!name?.trim() || !style?.trim() || !prices?.trim()) return res.status(400).json({ error: "Tous les champs sont requis" });
  if (req.body.id) db.prepare("UPDATE models SET name=?, style=?, prices=? WHERE id=?").run(name.trim(), style.trim(), prices.trim(), req.body.id);
  else {
    let pct = 50; try { pct = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'agency'").get()?.value || "{}").creatorPct ?? 50; } catch (e) {}
    return res.json({ ok: true, id: db.prepare("INSERT INTO models (name, style, prices, creator_pct) VALUES (?,?,?,?)").run(name.trim(), style.trim(), prices.trim(), pct).lastInsertRowid });
  }
  res.json({ ok: true, id: req.body.id });
});
app.delete("/api/admin/models/:id", auth, admin, (req, res) => {
  if (db.prepare("SELECT COUNT(*) n FROM models").get().n <= 1) return res.status(400).json({ error: "Gardez au moins une créatrice" });
  db.prepare("DELETE FROM models WHERE id = ?").run(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

/* ----- Planning & compta ----- */
const validatedByPeriod = require("./sales")(app, db, auth, admin, path.dirname(DB_PATH));
const COMPTA = require("./compta")(app, db, auth, admin, validatedByPeriod);
const PLAN = require("./planning")(app, db, auth, admin);
/* ----- Gestion : équipe, créatrices, réglages, journal, sanctions ----- */
GEST = require("./gestion")(app, db, auth, admin, { compta: COMPTA, planning: PLAN, PERSONAS });
const CAND_CTX = { bcrypt, gest: GEST, ai };
require("./candidatures")(app, db, auth, admin, CAND_CTX);   // page publique /postuler
HAND = require("./handover")(app, db, auth, admin, { planning: PLAN, gest: GEST });   // passation de shift
require("./teamfx")(app, db, auth, admin, { planning: PLAN, gest: GEST, PERSONAS });   // salle de contrôle, radar, mur des ventes
require("./extras")(app, db, auth, admin, { compta: COMPTA, planning: PLAN, gest: GEST, ai });   // assistant, Wrapped, team leaders
STUDIO = require("./studio")(app, db, auth, admin, { dataDir: path.dirname(DB_PATH), gest: GEST, planning: PLAN });   // contenus perso, fiches créatrices, pauses
require("./chat")(app, db, auth, admin, { dataDir: path.dirname(DB_PATH), gest: GEST, planning: PLAN });   // chat d'équipe
require("./tests")(app, db, auth, admin, { gest: GEST });   // tests d'aptitude : débit et frappe
require("./challenges")(app, db, auth, admin, { compta: COMPTA, gest: GEST });   // défis de la semaine
CAND_CTX.referrals = require("./referrals")(app, db, auth, admin, { compta: COMPTA, gest: GEST });   // parrainage
const ALERTS = require("./alerts")(app, db, auth, admin, { planning: PLAN, gest: GEST });
require("./roles")(app, db, auth, admin, { compta: COMPTA, planning: PLAN, gest: GEST, perms: PERM, alerts: ALERTS, PERSONAS });   // rôles, équipes des Team Leaders, réglages du Fondateur
require("./purge")(app, db, auth, admin, { gest: GEST });
require("./notify")(app, db, auth, admin, { bcrypt, PROD, gest: GEST, planning: PLAN });   // notifications sur le téléphone, invitations, premier lancement
require("./announce")(app, db, auth, admin, { gest: GEST });   // annonces importantes / urgentes : bandeau, écran bloquant, suivi de lecture   // comptes désactivés depuis 24 h : supprimés (historique gardé)   // alertes du shift en cours (cloche manager, salle de contrôle)
/* ----- Simu Chatter : suivi en direct, conseils du manager, entraînements ----- */
LIVE = require("./simlive")(app, db, auth, admin, { loadSim, publicSim, PERSONAS, busy });

/* ----- Pages ----- */
app.get("/rejoindre", (req, res) => res.sendFile(path.join(__dirname, "public", "bienvenue.html")));   // comptes formation express (session d'entretien)
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));

// Nettoyage des sessions expirées
setInterval(() => db.prepare("DELETE FROM tokens WHERE expires_at < ?").run(Date.now()), 3600e3);

app.listen(PORT, () => console.log(`🚀 Simulateur en ligne sur le port ${PORT}${ai.MOCK ? " (mode IA simulée)" : ""}`));
