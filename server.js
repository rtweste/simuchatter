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
const PROD = process.env.NODE_ENV === "production";

if (!ai.MOCK && !process.env.ANTHROPIC_API_KEY) {
  console.error("❌ ANTHROPIC_API_KEY manquante. Ajoutez-la dans les variables d'environnement.");
  process.exit(1);
}

/* ================= Base de données ================= */
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','chatter')), active INTEGER NOT NULL DEFAULT 1,
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
    res.status(502).json({ error: "L'IA n'a pas pu répondre. Réessayez dans un instant." });
  } finally { busy.delete(id); }
}

// Fait jouer le fan et applique ses décisions
async function playFan(sim) {
  const persona = PERSONAS.find(p => p.id === sim.persona_id);
  const r = await ai.fanTurn(sim, persona);
  let replies = Array.isArray(r.replies) ? r.replies : [r.reply];
  replies = replies.filter(x => typeof x === "string" && x.trim()).slice(0, 3);
  if (!replies.length) replies = ["..."];
  if (typeof r.interest === "number") sim.interest = Math.max(0, Math.min(100, Math.round(r.interest)));

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
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "same-origin");
  next();
});

// Authentification
function auth(req, res, next) {
  const tok = req.cookies.tok;
  if (!tok) return res.status(401).json({ error: "Non connecté" });
  const row = db.prepare(`SELECT u.id, u.username, u.role, u.active, t.expires_at FROM tokens t
    JOIN users u ON u.id = t.user_id WHERE t.token = ?`).get(tok);
  if (!row || row.expires_at < Date.now() || !row.active) return res.status(401).json({ error: "Session expirée" });
  req.user = row; next();
}
const admin = (req, res, next) => req.user.role === "admin" ? next() : res.status(403).json({ error: "Réservé au manager" });

const attempts = new Map();
app.post("/api/login", (req, res) => {
  const ip = req.ip;
  const a = attempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) return res.status(429).json({ error: "Trop de tentatives. Réessayez dans 15 minutes." });
  const { username, password } = req.body || {};
  const u = db.prepare("SELECT * FROM users WHERE username = ?").get(String(username || "").trim());
  if (!u || !u.active || !bcrypt.compareSync(String(password || ""), u.pass_hash)) {
    a.n++; attempts.set(ip, a);
    return res.status(401).json({ error: "Identifiant ou mot de passe incorrect" });
  }
  attempts.delete(ip);
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
app.get("/api/me", auth, (req, res) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const used = db.prepare("SELECT COUNT(*) n FROM sims WHERE user_id = ? AND started_at >= ?").get(req.user.id, today.getTime()).n;
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role, dailyLimit: DAILY_LIMIT, usedToday: used });
});

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
    if (used >= DAILY_LIMIT) return res.status(429).json({ error: `Limite de ${DAILY_LIMIT} simulations par jour atteinte.` });
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
    res.json(publicSim(sim));
  });
});

app.get("/api/my-sims", auth, (req, res) => {
  res.json(db.prepare(`SELECT id, persona_id, difficulty, creator_name, revenue, score, rts, started_at FROM sims
    WHERE user_id = ? AND status = 'done' ORDER BY started_at DESC LIMIT 50`).all(req.user.id)
    .map(r => ({ ...r, avgRt: avg(J(r.rts)), rts: undefined, persona: PERSONAS.find(p => p.id === r.persona_id)?.name })));
});

/* ----- Manager ----- */
app.get("/api/admin/users", auth, admin, (req, res) => {
  res.json(db.prepare(`SELECT u.id, u.username, u.role, u.active, u.created_at,
      COUNT(s.id) sessions, ROUND(AVG(s.score)) avgScore, ROUND(AVG(s.revenue)) avgRevenue, MAX(s.started_at) lastAt
    FROM users u LEFT JOIN sims s ON s.user_id = u.id AND s.status = 'done'
    GROUP BY u.id ORDER BY u.role, u.username`).all());
});
app.post("/api/admin/users", auth, admin, (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const role = req.body?.role === "admin" ? "admin" : "chatter";
  if (!/^[\w.\-]{3,30}$/.test(username)) return res.status(400).json({ error: "Identifiant : 3 à 30 caractères (lettres, chiffres, . _ -)" });
  if (password.length < 8) return res.status(400).json({ error: "Mot de passe : 8 caractères minimum" });
  try {
    db.prepare("INSERT INTO users (username, pass_hash, role, created_at) VALUES (?,?,?,?)").run(username, bcrypt.hashSync(password, 10), role, Date.now());
    res.json({ ok: true });
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
  else db.prepare("INSERT INTO models (name, style, prices) VALUES (?,?,?)").run(name.trim(), style.trim(), prices.trim());
  res.json({ ok: true });
});
app.delete("/api/admin/models/:id", auth, admin, (req, res) => {
  if (db.prepare("SELECT COUNT(*) n FROM models").get().n <= 1) return res.status(400).json({ error: "Gardez au moins une créatrice" });
  db.prepare("DELETE FROM models WHERE id = ?").run(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

/* ----- Planning & compta ----- */
require("./compta")(app, db, auth, admin);

/* ----- Pages ----- */
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));

// Nettoyage des sessions expirées
setInterval(() => db.prepare("DELETE FROM tokens WHERE expires_at < ?").run(Date.now()), 3600e3);

app.listen(PORT, () => console.log(`🚀 Simulateur en ligne sur le port ${PORT}${ai.MOCK ? " (mode IA simulée)" : ""}`));
