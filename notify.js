// Notifications sur le téléphone (Web Push) + arrivée des chatters (invitations, premier lancement, suivi du lancement)
// - messages privés, mentions, annonces, rappels de shift, renforts, conseils / entraînements, ventes validées
// - un lien d'invitation personnel par compte : le chatter choisit son mot de passe, puis se laisse guider
const crypto = require("crypto");
let webpush = null; try { webpush = require("web-push"); } catch (e) { console.error("web-push absent : pas de notifications"); }

module.exports = function mount(app, db, auth, admin, ctx) {
  const { bcrypt, PROD, gest, planning } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS push_subs (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
      ua TEXT, standalone INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_ok INTEGER, fails INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS push_prefs (user_id INTEGER PRIMARY KEY, prefs TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS push_sent (key TEXT PRIMARY KEY, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invites (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, created_by INTEGER);`);
  if (!db.prepare("PRAGMA table_info(users)").all().some(c => c.name === "onboarded_at")) db.exec("ALTER TABLE users ADD COLUMN onboarded_at INTEGER");
  const has = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const getSet = k => { const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(k); return r ? r.value : null; };
  const setSet = (k, v) => db.prepare("INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
  const AG = () => { try { return gest.agency(); } catch (e) { return {}; } };
  const parisDate = ms => new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const eur = n => Math.round(n * 100) / 100 + " €";
  const cut = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

  /* ===================== WEB PUSH ===================== */
  let VAPID = null;
  if (webpush) {
    try {
      if (process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE) VAPID = { publicKey: process.env.VAPID_PUBLIC, privateKey: process.env.VAPID_PRIVATE };
      else { VAPID = JSON.parse(getSet("vapid") || "null"); if (!VAPID) { VAPID = webpush.generateVAPIDKeys(); setSet("vapid", JSON.stringify(VAPID)); } }
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contact@stellads.fr", VAPID.publicKey, VAPID.privateKey);
    } catch (e) { console.error("VAPID", e.message); VAPID = null; }
  }
  const KINDS = { dm: "Messages privés", mention: "Mentions dans le chat", announce: "Annonces de #informations", shift: "Rappels de shift", help: "Demandes de renfort", coach: "Conseils et entraînements", sales: "Ventes validées ou refusées" };
  const prefsOf = uid => { const r = db.prepare("SELECT prefs FROM push_prefs WHERE user_id = ?").get(uid); let p = {}; try { p = r ? JSON.parse(r.prefs) : {}; } catch (e) {} const o = {}; for (const k in KINDS) o[k] = p[k] !== false; return o; };
  const once = key => { try { db.prepare("INSERT INTO push_sent (key, at) VALUES (?,?)").run(key, Date.now()); return true; } catch (e) { return false; } };
  async function push(uid, kind, payload) {
    if (!webpush || !VAPID || !uid) return 0;
    if (kind && !prefsOf(uid)[kind]) return 0;
    const subs = db.prepare("SELECT * FROM push_subs WHERE user_id = ?").all(uid); let n = 0;
    const body = JSON.stringify({ kind, tag: payload.tag || kind, url: payload.url || "/home", title: payload.title, body: payload.body || "", urgent: !!payload.urgent });
    await Promise.all(subs.map(async s => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: payload.ttl || 3600, urgency: payload.urgent ? "high" : "normal" });
        db.prepare("UPDATE push_subs SET last_ok = ?, fails = 0 WHERE id = ?").run(Date.now(), s.id); n++; }
      catch (e) { const code = e.statusCode || 0;
        if (code === 404 || code === 410) db.prepare("DELETE FROM push_subs WHERE id = ?").run(s.id);
        else db.prepare("UPDATE push_subs SET fails = fails + 1 WHERE id = ?").run(s.id); }
    }));
    return n;
  }
  const pushMany = (uids, kind, p) => [...new Set(uids)].forEach(u => push(u, kind, p).catch(() => {}));
  const activeIds = (where = "role IN ('chatter','admin')") => db.prepare(`SELECT id FROM users WHERE active = 1 AND deleted_at IS NULL AND ${where}`).all().map(r => r.id);

  app.get("/api/push/key", auth, (req, res) => res.json({ key: VAPID ? VAPID.publicKey : null, kinds: KINDS, prefs: prefsOf(req.user.id),
    devices: db.prepare("SELECT COUNT(*) n FROM push_subs WHERE user_id = ?").get(req.user.id).n }));
  app.post("/api/push/sub", auth, (req, res) => {
    const s = req.body?.sub || {}; if (!s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth || !/^https:\/\//.test(s.endpoint)) return res.status(400).json({ error: "Abonnement invalide" });
    db.prepare(`INSERT INTO push_subs (user_id, endpoint, p256dh, auth, ua, standalone, created_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, standalone = excluded.standalone, fails = 0`)
      .run(req.user.id, String(s.endpoint).slice(0, 800), String(s.keys.p256dh).slice(0, 200), String(s.keys.auth).slice(0, 100), String(req.get("user-agent") || "").slice(0, 200), req.body.standalone ? 1 : 0, Date.now());
    res.json({ ok: true });
  });
  app.post("/api/push/unsub", auth, (req, res) => { db.prepare("DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?").run(String(req.body?.endpoint || ""), req.user.id); res.json({ ok: true }); });
  app.put("/api/push/prefs", auth, (req, res) => { const p = {}; for (const k in KINDS) p[k] = req.body?.[k] !== false;
    db.prepare("INSERT INTO push_prefs (user_id, prefs) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET prefs = excluded.prefs").run(req.user.id, JSON.stringify(p)); res.json({ ok: true, prefs: p }); });
  app.post("/api/push/test", auth, async (req, res) => {
    const n = await push(req.user.id, null, { title: "StellADS", body: "Les notifications marchent sur cet appareil ✨", url: "/home", tag: "test" });
    if (!n) return res.status(400).json({ error: "Aucun appareil n'a reçu la notification : réactive-les sur ce téléphone" }); res.json({ ok: true, n });
  });

  /* ---------- déclencheurs (balayage toutes les 5 s, sans renvoyer l'historique au démarrage) ---------- */
  const max = (t, c = "id") => has(t) ? (db.prepare(`SELECT MAX(${c}) m FROM ${t}`).get().m || 0) : 0;
  const C = { msg: max("chat_messages"), help: max("help_requests"), tip: max("team_tips"), asg: max("sim_assignments"), rev: Date.now() };
  function chatScan() {
    if (!has("chat_messages")) return;
    const rows = db.prepare(`SELECT m.id, m.channel_id, m.user_id, m.body, m.kind, m.meta, m.thread_root, u.username, c.kind ch_kind, c.name ch_name, c.slug FROM chat_messages m
      JOIN chat_channels c ON c.id = m.channel_id LEFT JOIN users u ON u.id = m.user_id WHERE m.id > ? AND m.deleted_at IS NULL ORDER BY m.id LIMIT 200`).all(C.msg);
    rows.forEach(m => {
      C.msg = Math.max(C.msg, m.id);
      let meta = {}; try { meta = JSON.parse(m.meta || "{}"); } catch (e) {}
      const txt = m.kind === "voice" ? "🎤 Message vocal" : m.kind === "image" ? "📷 Photo" : m.kind === "poll" ? "📊 Sondage" : m.kind === "sos" ? "🆘 " + cut(m.body, 120) : cut(m.body, 140) || "Nouveau message";
      const url = `/chat?c=${m.channel_id}`, done = new Set([m.user_id]);
      if (m.ch_kind === "dm" && m.user_id) {
        db.prepare("SELECT user_id FROM chat_members WHERE channel_id = ?").all(m.channel_id).forEach(r => { if (done.has(r.user_id)) return; done.add(r.user_id);
          push(r.user_id, "dm", { title: m.username || "Message privé", body: txt, url, tag: "dm-" + m.channel_id }).catch(() => {}); });
      }
      if (m.slug === "informations" && (meta.level === "urgent" || meta.level === "important")) {
        const ids = activeIds("role = 'chatter'").filter(u => !done.has(u)); ids.forEach(u => done.add(u));
        pushMany(ids, "announce", { title: meta.level === "urgent" ? "Annonce urgente" : "Annonce importante", body: (m.username ? m.username + " : " : "") + cut(m.body, 140), url: "/home", tag: "ann-" + m.id, urgent: meta.level === "urgent", ttl: 86400 });
      }
      (meta.mentions || []).forEach(u => { if (done.has(u)) return; done.add(u);
        push(u, "mention", { title: `${m.username || "Quelqu'un"} t'a mentionné${m.ch_kind === "dm" ? "" : " dans #" + m.ch_name}`, body: txt, url, tag: "men-" + m.channel_id }).catch(() => {}); });
    });
  }
  function otherScan() {
    const now = Date.now();
    if (has("help_requests")) db.prepare("SELECT h.*, m.name model FROM help_requests h JOIN models m ON m.id = h.model_id WHERE h.id > ? AND h.resolved_at IS NULL ORDER BY h.id").all(C.help).forEach(h => {
      C.help = Math.max(C.help, h.id);
      const ids = db.prepare("SELECT DISTINCT user_id FROM clocks WHERE end_at IS NULL AND reinforce = 0").all().map(r => r.user_id).filter(u => u !== h.for_user && u !== h.created_by);
      pushMany(ids, "help", { title: `Renfort demandé pour ${h.model}`, body: "Tu peux la prendre en renfort depuis ton shift.", url: "/planning", tag: "help-" + h.id });
    });
    if (has("team_tips")) db.prepare("SELECT t.*, u.username FROM team_tips t JOIN users u ON u.id = t.leader_id WHERE t.id > ? ORDER BY t.id").all(C.tip).forEach(t => {
      C.tip = Math.max(C.tip, t.id); push(t.recruit_id, "coach", { title: `Conseil de ${t.username}`, body: cut(t.text, 140), url: "/home", tag: "tip-" + t.id }).catch(() => {}); });
    if (has("sim_assignments")) db.prepare("SELECT a.*, u.username FROM sim_assignments a LEFT JOIN users u ON u.id = a.created_by WHERE a.id > ? ORDER BY a.id").all(C.asg).forEach(a => {
      C.asg = Math.max(C.asg, a.id); push(a.user_id, "coach", { title: "Nouvel entraînement à faire", body: `${a.username || "Ton manager"} t'assigne une simulation · objectif ${a.goal}`, url: "/app", tag: "asg-" + a.id }).catch(() => {}); });
    if (has("sales")) { db.prepare("SELECT s.id, s.user_id, s.amount, s.status, s.reason, s.reviewed_at, m.name model FROM sales s JOIN models m ON m.id = s.model_id WHERE s.reviewed_at > ? AND s.status IN ('validated','refused') ORDER BY s.reviewed_at").all(C.rev).forEach(s => {
      C.rev = Math.max(C.rev, s.reviewed_at); if (!once("sale:" + s.id + ":" + s.status)) return;
      push(s.user_id, "sales", s.status === "validated" ? { title: `Vente validée · +${eur(s.amount)}`, body: `${s.model} · elle compte dans ta paie`, url: "/ventes", tag: "sale-" + s.id }
        : { title: "Vente refusée", body: `${s.model} · ${eur(s.amount)}${s.reason ? " · " + cut(s.reason, 90) : ""}`, url: "/ventes", tag: "sale-" + s.id }).catch(() => {}); }); }
  }
  // rappels de shift : X minutes avant, puis si le shift a commencé sans pointage
  function shiftScan() {
    try {
      const now = Date.now(), today = parisDate(now), a = AG(), rem = Math.max(5, +a.reminder || 30), thr = +a.missedAlert || 10;
      planning.decorate(db.prepare(`${planning.SHIFT_SQL} WHERE s.date BETWEEN ? AND ?`).all(addDays(today, -1), addDays(today, 1))).forEach(s => {
        const left = (s.start_ms - now) / 60000;
        if (s.state === "future" && left <= rem && left > 0 && once("shiftrem:" + s.id)) push(s.user_id, "shift", { title: `Ton shift commence dans ${Math.round(left)} min`, body: `${s.model_name} · ${s.start}–${s.end}`, url: "/home", tag: "shift-" + s.id });
        if (s.state === "missing" && s.late >= thr && s.late < 180 && once("shiftmiss:" + s.id)) push(s.user_id, "shift", { title: "Tu n'as pas pointé ton shift", body: `${s.model_name} · commencé à ${s.start}, il y a ${s.late} min`, url: "/home", tag: "shift-" + s.id, urgent: true });
      });
    } catch (e) { console.error("rappels shift", e.message); }
  }
  setInterval(() => { try { chatScan(); otherScan(); } catch (e) { console.error("notifications", e.message); } }, 5000).unref();
  setInterval(shiftScan, 60e3).unref();
  setInterval(() => { try { db.prepare("DELETE FROM push_sent WHERE at < ?").run(Date.now() - 14 * 864e5); db.prepare("DELETE FROM push_subs WHERE fails >= 15").run(); } catch (e) {} }, 6 * 3600e3).unref();

  /* ===================== INVITATIONS ===================== */
  const INV_DAYS = 7;
  function newInvite(uid, by) {
    db.prepare("DELETE FROM invites WHERE user_id = ? AND used_at IS NULL").run(uid);
    const t = crypto.randomBytes(18).toString("base64url");
    db.prepare("INSERT INTO invites (token, user_id, created_at, expires_at, created_by) VALUES (?,?,?,?,?)").run(t, uid, Date.now(), Date.now() + INV_DAYS * 864e5, by || null);
    return t;
  }
  const base = req => (PROD ? "https://" : req.protocol + "://") + req.get("host");
  const canInvite = req => ["founder", "manager"].includes(req.user.rk);
  app.post("/api/admin/invites/bulk", auth, admin, (req, res) => {
    if (!canInvite(req)) return res.status(403).json({ error: "Réservé au Fondateur et aux managers" });
    const role = req.body?.role === "trainee" ? "trainee" : "chatter";
    const lines = String(req.body?.names || "").split(/[\n,;]+/).map(s => s.trim().replace(/^@/, "")).filter(Boolean).slice(0, 200);
    if (!lines.length) return res.status(400).json({ error: "Colle au moins un pseudo" });
    const models = (Array.isArray(req.body?.models) ? req.body.models : []).map(Number).filter(id => db.prepare("SELECT 1 FROM models WHERE id = ?").get(id));
    const team = req.body?.team ? parseInt(req.body.team, 10) : null, tl = team ? db.prepare("SELECT id FROM users WHERE id = ? AND grade = 'tl' AND active = 1").get(team) : null;
    const out = [], seen = new Set();
    db.exec("BEGIN");
    try {
      for (const raw of lines) {
        const username = raw.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, ".").replace(/[^\w.\-]/g, "").toLowerCase().slice(0, 30);
        if (username.length < 3) { out.push({ input: raw, error: "Pseudo trop court (3 caractères minimum)" }); continue; }
        if (seen.has(username.toLowerCase())) { out.push({ input: raw, username, error: "En double dans la liste" }); continue; } seen.add(username.toLowerCase());
        const ex = db.prepare("SELECT id, active, deleted_at FROM users WHERE username = ? COLLATE NOCASE").get(username);
        if (ex) { out.push({ input: raw, username, error: ex.deleted_at ? "Ancien compte supprimé" : "Ce compte existe déjà", existing: ex.deleted_at ? null : ex.id }); continue; }
        const uid = db.prepare("INSERT INTO users (username, pass_hash, role, created_at, team_lead) VALUES (?,?,?,?,?)").run(username, "!", role, Date.now(), role === "chatter" && tl ? tl.id : null).lastInsertRowid;
        models.forEach(m => db.prepare("INSERT OR IGNORE INTO user_models (user_id, model_id) VALUES (?,?)").run(uid, m));
        const t = newInvite(uid, req.user.id); out.push({ input: raw, username, id: uid, link: `${base(req)}/bienvenue?t=${t}` });
      }
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); console.error("invitations", e.message); return res.status(500).json({ error: "Impossible de créer les comptes" }); }
    const n = out.filter(x => x.link).length;
    if (n) gest.log(req.user.id, "a", `a créé **${n} compte${n > 1 ? "s" : ""}** avec un lien d'invitation`, out.filter(x => x.link).map(x => x.username).join(", ").slice(0, 200));
    res.json({ results: out, days: INV_DAYS });
  });
  app.post("/api/admin/invites/:id", auth, admin, (req, res) => {
    if (!canInvite(req)) return res.status(403).json({ error: "Réservé au Fondateur et aux managers" });
    const u = db.prepare("SELECT id, username, role, grade FROM users WHERE id = ? AND deleted_at IS NULL").get(parseInt(req.params.id, 10));
    if (!u) return res.status(404).json({ error: "Compte introuvable" });
    if (u.grade === "founder" || (u.role === "admin" && req.user.rk !== "founder")) return res.status(403).json({ error: "Seul le Fondateur peut inviter un manager" });
    res.json({ username: u.username, link: `${base(req)}/bienvenue?t=${newInvite(u.id, req.user.id)}`, days: INV_DAYS });
  });
  // public : ouvrir un lien d'invitation
  const invOf = t => db.prepare("SELECT i.*, u.username, u.role, u.active, u.deleted_at FROM invites i JOIN users u ON u.id = i.user_id WHERE i.token = ?").get(String(t || ""));
  const tries = new Map();
  app.get("/api/invite/:t", (req, res) => {
    const i = invOf(req.params.t);
    if (!i || i.deleted_at || !i.active) return res.status(404).json({ error: "Ce lien d'invitation n'existe pas ou n'est plus valable" });
    if (i.used_at) return res.status(410).json({ error: "Ce lien a déjà servi : connecte-toi avec ton mot de passe", used: true, username: i.username });
    if (i.expires_at < Date.now()) return res.status(410).json({ error: "Ce lien a expiré : demande-en un nouveau à ton manager", expired: true });
    res.json({ username: i.username, role: i.role });
  });
  app.post("/api/invite/:t", (req, res) => {
    const ip = req.ip, a = tries.get(ip) || { n: 0, t: Date.now() }; if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); } a.n++; tries.set(ip, a);
    if (a.n > 20) return res.status(429).json({ error: "Trop de tentatives, réessaie dans 15 minutes" });
    const i = invOf(req.params.t);
    if (!i || i.deleted_at || !i.active || i.used_at || i.expires_at < Date.now()) return res.status(410).json({ error: "Ce lien n'est plus valable : demande-en un nouveau à ton manager" });
    const pw = String(req.body?.password || "");
    if (pw.length < 8) return res.status(400).json({ error: "Ton mot de passe doit faire au moins 8 caractères" });
    if (pw.toLowerCase() === i.username.toLowerCase()) return res.status(400).json({ error: "Choisis un mot de passe différent de ton pseudo" });
    db.prepare("UPDATE users SET pass_hash = ? WHERE id = ?").run(bcrypt.hashSync(pw, 10), i.user_id);
    db.prepare("UPDATE invites SET used_at = ? WHERE token = ?").run(Date.now(), i.token);
    db.prepare("DELETE FROM tokens WHERE user_id = ?").run(i.user_id);
    const token = crypto.randomBytes(32).toString("hex"), ttl = 30 * 24 * 3600e3;
    db.prepare("INSERT INTO tokens VALUES (?,?,?)").run(token, i.user_id, Date.now() + ttl);
    res.cookie("tok", token, { httpOnly: true, sameSite: "lax", secure: PROD, maxAge: ttl });
    gest.log(i.user_id, "a", `**${i.username}** a activé son compte`, "Lien d'invitation");
    res.json({ ok: true, role: i.role });
  });

  /* ===================== PREMIER LANCEMENT ===================== */
  app.get("/api/onboarding", auth, (req, res) => {
    const u = db.prepare("SELECT onboarded_at FROM users WHERE id = ?").get(req.user.id);
    res.json({ done: !!u.onboarded_at, models: db.prepare("SELECT id, name FROM models ORDER BY name").all(),
      mine: db.prepare("SELECT model_id FROM user_models WHERE user_id = ?").all(req.user.id).map(r => r.model_id),
      devices: db.prepare("SELECT COUNT(*) n FROM push_subs WHERE user_id = ?").get(req.user.id).n, push: !!VAPID });
  });
  app.put("/api/onboarding/models", auth, (req, res) => {
    if (req.user.role !== "chatter") return res.json({ ok: true });
    const ids = (Array.isArray(req.body?.models) ? req.body.models : []).map(Number).filter(id => db.prepare("SELECT 1 FROM models WHERE id = ?").get(id)).slice(0, 20);
    db.prepare("DELETE FROM user_models WHERE user_id = ?").run(req.user.id); ids.forEach(m => db.prepare("INSERT OR IGNORE INTO user_models (user_id, model_id) VALUES (?,?)").run(req.user.id, m));
    res.json({ ok: true });
  });
  app.post("/api/onboarding/done", auth, (req, res) => { db.prepare("UPDATE users SET onboarded_at = COALESCE(onboarded_at, ?) WHERE id = ?").run(Date.now(), req.user.id); res.json({ ok: true }); });

  /* ===================== SUIVI DU LANCEMENT (manager) ===================== */
  app.get("/api/admin/launch", auth, admin, (req, res) => {
    const now = Date.now();
    const rows = db.prepare(`SELECT u.id, u.username, u.role, u.grade, u.created_at, u.onboarded_at, u.pass_hash = '!' pending,
        (SELECT MAX(created_at) FROM invites i WHERE i.user_id = u.id) inv_at, (SELECT MAX(used_at) FROM invites i WHERE i.user_id = u.id) used_at,
        (SELECT expires_at FROM invites i WHERE i.user_id = u.id AND i.used_at IS NULL ORDER BY created_at DESC LIMIT 1) inv_exp,
        (SELECT COUNT(*) FROM push_subs p WHERE p.user_id = u.id) devices, (SELECT MAX(standalone) FROM push_subs p WHERE p.user_id = u.id) installed,
        (SELECT COUNT(*) FROM tokens t WHERE t.user_id = u.id AND t.expires_at > ?) sessions
      FROM users u WHERE u.active = 1 AND u.deleted_at IS NULL AND u.role = 'chatter' ORDER BY u.username COLLATE NOCASE`).all(now);
    const people = rows.map(r => ({ id: r.id, username: r.username, role: r.role, tl: r.grade === "tl", invitedAt: r.inv_at, joined: !r.pending, joinedAt: r.used_at, onboarded: !!r.onboarded_at,
      notifs: r.devices > 0, installed: !!r.installed, online: r.sessions > 0, expired: r.pending && r.inv_exp && r.inv_exp < now, noInvite: r.pending && !r.inv_exp }));
    res.json({ people, totals: { accounts: people.length, joined: people.filter(p => p.joined).length, onboarded: people.filter(p => p.onboarded).length, notifs: people.filter(p => p.notifs).length, installed: people.filter(p => p.installed).length }, push: !!VAPID });
  });

  return { push, pushMany, newInvite };
};
