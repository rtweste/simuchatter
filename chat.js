// Chat d'équipe : salons, messages privés, fils, réactions, mentions, vocaux, médias, annonces, sondages, remplacements de shift, aide fan, modération.
// Temps réel par flux SSE (/api/chat/stream).
const path = require("path");
const fs = require("fs");
const express = require("express");

const FILES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav" };
const QUICK = ["🔥", "💸", "👑", "😂", "❤️", "👀", "⭐", "👍"];

module.exports = function mount(app, db, auth, admin, { dataDir, gest, planning }) {
  const DIR = path.join(dataDir, "chat"); fs.mkdirSync(DIR, { recursive: true });
  db.exec(`
  CREATE TABLE IF NOT EXISTS chat_channels (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'public', topic TEXT, readonly INTEGER NOT NULL DEFAULT 0,
    model_id INTEGER, emoji TEXT, position INTEGER NOT NULL DEFAULT 50, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS chat_members (channel_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (channel_id, user_id));
  CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY, channel_id INTEGER NOT NULL, user_id INTEGER, body TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'text',
    meta TEXT, reply_to INTEGER, thread_root INTEGER, created_at INTEGER NOT NULL, edited_at INTEGER, deleted_at INTEGER, deleted_by INTEGER, hidden INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS chat_msg_ch ON chat_messages(channel_id, thread_root, id);
  CREATE INDEX IF NOT EXISTS chat_msg_root ON chat_messages(thread_root);
  CREATE TABLE IF NOT EXISTS chat_reactions (message_id INTEGER NOT NULL, user_id INTEGER NOT NULL, emoji TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (message_id, user_id, emoji));
  CREATE TABLE IF NOT EXISTS chat_reads (user_id INTEGER NOT NULL, channel_id INTEGER NOT NULL, last_id INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, channel_id));
  CREATE TABLE IF NOT EXISTS chat_votes (message_id INTEGER NOT NULL, user_id INTEGER NOT NULL, opt INTEGER NOT NULL, PRIMARY KEY (message_id, user_id, opt));
  CREATE TABLE IF NOT EXISTS chat_acks (message_id INTEGER NOT NULL, user_id INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (message_id, user_id));
  CREATE TABLE IF NOT EXISTS chat_mutes (user_id INTEGER PRIMARY KEY, until INTEGER NOT NULL, by INTEGER);
  `);
  const HOOKS = {};   // état calculé de certains messages (ex. vote du coéquipier du mois), branché par d'autres modules
  const J = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };
  const now = () => Date.now();
  const user = id => db.prepare("SELECT id, username, role, active FROM users WHERE id = ?").get(id);
  const log = (...a) => { try { gest.log(...a); } catch (e) {} };

  /* ---------- salons par défaut ---------- */
  const ensure = (slug, name, o = {}) => { if (!db.prepare("SELECT 1 FROM chat_channels WHERE slug = ?").get(slug))
    db.prepare("INSERT INTO chat_channels (slug, name, kind, topic, readonly, model_id, emoji, position, created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(slug, name, o.kind || "public", o.topic || "", o.readonly ? 1 : 0, o.model_id || null, o.emoji || "#", o.position ?? 50, now()); };
  function seed() {
    ensure("informations", "informations", { readonly: 1, emoji: "📣", position: 0, topic: "Annonces de l'équipe de direction · seuls les managers écrivent ici" });
    ensure("general", "général", { emoji: "💬", position: 10, topic: "Tout et rien, entre nous" });
    ensure("off", "off", { emoji: "☕", position: 12, topic: "La pause café : tout sauf le boulot · une question du jour chaque matin" });
    ensure("ventes", "ventes", { emoji: "💸", position: 20, topic: "Chaque vente validée arrive ici automatiquement" });
    ensure("formation", "formation", { kind: "training", emoji: "🎓", position: 5, topic: "Le salon des élèves en formation · seuls les élèves et les managers le voient" });
    ensure("problemes-techniques", "problèmes-techniques", { emoji: "🛠️", position: 30, topic: "Un bug, un accès qui ne marche pas, Twizz qui rame ? C'est ici" });
    db.prepare("SELECT id, name FROM models ORDER BY name").all().forEach((m, i) => {
      const ex = db.prepare("SELECT id FROM chat_channels WHERE model_id = ?").get(m.id);
      const slug = "crea-" + m.id;
      if (!ex) ensure(slug, m.name.toLowerCase(), { kind: "model", model_id: m.id, emoji: "✦", position: 60 + i, topic: `Tout ce qui concerne ${m.name} : fans, contenus, astuces` });
      else db.prepare("UPDATE chat_channels SET name = ? WHERE id = ?").run(m.name.toLowerCase(), ex.id);
    });
  }
  seed(); setInterval(seed, 10 * 60e3);

  /* ---------- temps réel ---------- */
  const CL = new Map();   // user_id -> Set(res)
  const ROLE = new Map(); // user_id -> rôle (pour savoir qui reçoit quoi)
  const send = (res, ev, data) => { try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch (e) {} };
  const members = ch => ch.kind === "dm" ? db.prepare("SELECT user_id FROM chat_members WHERE channel_id = ?").all(ch.id).map(r => r.user_id) : null;
  // qui reçoit les événements d'un salon : membres d'un privé ; élèves + managers pour #formation ; tout le monde sauf les élèves ailleurs
  const hears = (ch, uid, m) => ch.kind === "dm" ? m.includes(uid) : ch.kind === "training" ? ["trainee", "admin"].includes(ROLE.get(uid)) : ROLE.get(uid) !== "trainee";
  function emit(ch, ev, data) {
    const m = members(ch); for (const [uid, set] of CL) { if (!hears(ch, uid, m)) continue; set.forEach(r => send(r, ev, data)); } }
  const emitAll = (ev, data) => { for (const set of CL.values()) set.forEach(r => send(r, ev, data)); };
  const online = () => [...CL.keys()];
  function statusOf(uid) {
    try { if (db.prepare("SELECT 1 FROM pauses WHERE user_id = ? AND end_at IS NULL").get(uid)) return "pause"; } catch (e) {}
    if (db.prepare("SELECT 1 FROM clocks WHERE user_id = ? AND end_at IS NULL").get(uid)) return "shift";
    return CL.has(uid) ? "online" : "offline";
  }
  app.get("/api/chat/stream", auth, (req, res) => {
    ROLE.set(req.user.id, req.user.role);
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" }); res.flushHeaders?.();
    res.write("retry: 3000\n\n");
    const uid = req.user.id, first = !CL.has(uid); if (!CL.has(uid)) CL.set(uid, new Set()); CL.get(uid).add(res);
    if (first) emitAll("presence", { user_id: uid, status: statusOf(uid) });
    const ka = setInterval(() => { try { res.write(": ping\n\n"); } catch (e) {} }, 25e3);
    req.on("close", () => { clearInterval(ka); const s = CL.get(uid); if (s) { s.delete(res); if (!s.size) { CL.delete(uid); emitAll("presence", { user_id: uid, status: statusOf(uid) }); } } });
  });
  // statuts (shift / pause) qui changent sans passer par le chat
  let lastSt = {};
  setInterval(() => { try { db.prepare("SELECT id FROM users WHERE active = 1 AND role <> 'trainee'").all().forEach(u => { const s = statusOf(u.id); if (lastSt[u.id] && lastSt[u.id] !== s) emitAll("presence", { user_id: u.id, status: s }); lastSt[u.id] = s; }); } catch (e) {} }, 15e3);

  /* ---------- règles ---------- */
  // les élèves n'ont accès qu'à #formation (vérifié par canSee) ; messages privés et shifts : chatters et managers seulement
  const noTrainee = (req, res, next) => next();
  const staffOnly = (req, res, next) => req.user.role === "trainee" ? res.status(403).json({ error: "Réservé aux chatters" }) : next();
  const chOf = id => db.prepare("SELECT * FROM chat_channels WHERE id = ?").get(id);
  const AVS = () => { try { return Object.fromEntries(db.prepare("SELECT user_id, updated_at FROM user_avatars").all().map(r => [r.user_id, r.updated_at])); } catch (e) { return {}; } };
  const RL = u => u.role !== "admin" ? null : u.grade === "founder" ? "FONDATEUR" : u.grade === "assistant" ? "ASSISTANT" : "MANAGER";
  let AV = {}, AVt = 0;
  function pubUser(u) { if (Date.now() - AVt > 5000) { AV = AVS(); AVt = Date.now(); }
    return { id: u.id, username: u.username, role: u.role, name: u.display_name || u.username, color: u.color || null, avatar: AV[u.id] ? `/api/avatar/${u.id}?v=${AV[u.id]}` : null, rl: RL(u), status: statusOf(u.id) }; }
  function canSee(ch, u) { if (!ch) return false;
    if (ch.kind === "training") return u.role === "trainee" || u.role === "admin";
    if (u.role === "trainee") return false;
    if (ch.kind !== "dm") return true; return !!db.prepare("SELECT 1 FROM chat_members WHERE channel_id = ? AND user_id = ?").get(ch.id, u.id); }
  const muted = uid => { const m = db.prepare("SELECT until FROM chat_mutes WHERE user_id = ?").get(uid); return m && m.until > now() ? m.until : null; };
  // filtre infos perso : numéros, e-mails, comptes de réseaux sociaux
  const PERSO = [
    [/(?:\+|00)\s?\d{2}[\s.-]?\d(?:[\s.-]?\d{2}){4}|\b0[1-9](?:[\s.-]?\d{2}){4}\b/, "un numéro de téléphone"],
    [/[\w.+-]+@[\w-]+\.[\w.]{2,}/, "une adresse e-mail"],
    [/\b(insta(?:gram)?|snap(?:chat)?|telegram|whats?app|tiktok|onlyfans|t\.me|wa\.me)\b\s*[:@/]?\s*@?[\w.]{3,}/i, "un compte de réseau social"],
    [/(instagram\.com|snapchat\.com|t\.me|wa\.me|tiktok\.com)\//i, "un lien de réseau social"],
    [/\b\d{1,4}\s?(?:bis\s)?(?:rue|avenue|av\.|boulevard|bd|chemin|impasse|allée|place)\s+\w+/i, "une adresse"]
  ];
  const persoHit = t => (PERSO.find(([r]) => r.test(t)) || [])[1] || null;

  /* ---------- mise en forme d'un message ---------- */
  function hydrate(rows, uid, isAdmin) {
    if (!rows.length) return [];
    const ids = rows.map(r => r.id), q = ids.map(() => "?").join(",");
    const reacts = db.prepare(`SELECT r.message_id, r.emoji, r.user_id, u.username FROM chat_reactions r JOIN users u ON u.id = r.user_id WHERE r.message_id IN (${q}) ORDER BY r.at`).all(...ids);
    const thr = db.prepare(`SELECT thread_root, COUNT(*) n, MAX(created_at) last, GROUP_CONCAT(DISTINCT user_id) us FROM chat_messages WHERE thread_root IN (${q}) AND deleted_at IS NULL GROUP BY thread_root`).all(...ids);
    const votes = db.prepare(`SELECT v.message_id, v.opt, v.user_id, u.username FROM chat_votes v JOIN users u ON u.id = v.user_id WHERE v.message_id IN (${q})`).all(...ids);
    const acks = db.prepare(`SELECT a.message_id, a.user_id, a.at, u.username FROM chat_acks a JOIN users u ON u.id = a.user_id WHERE a.message_id IN (${q}) ORDER BY a.at`).all(...ids);
    const chk = (db.prepare("SELECT kind FROM chat_channels WHERE id = ?").get(rows[0].channel_id) || {}).kind;
    const teamN = db.prepare(`SELECT COUNT(*) n FROM users WHERE active = 1 AND role = '${chk === "training" ? "trainee" : "chatter"}'`).get().n;
    const reps = rows.filter(r => r.reply_to).map(r => r.reply_to), rmap = {};
    if (reps.length) db.prepare(`SELECT m.id, m.body, m.kind, m.deleted_at, u.username FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id IN (${reps.map(() => "?").join(",")})`).all(...reps).forEach(r => rmap[r.id] = r);
    return rows.map(r => {
      const meta = J(r.meta, {}), del = !!r.deleted_at, hid = !!r.hidden && !isAdmin;
      const rx = {}; reacts.filter(x => x.message_id === r.id).forEach(x => { (rx[x.emoji] = rx[x.emoji] || { n: 0, me: false, who: [] }); rx[x.emoji].n++; rx[x.emoji].who.push(x.username); if (x.user_id === uid) rx[x.emoji].me = true; });
      const t = thr.find(x => x.thread_root === r.id);
      const o = { id: r.id, channel_id: r.channel_id, user_id: r.user_id, username: r.username, role: r.role, kind: r.kind, body: del || hid ? "" : r.body, meta: del || hid ? {} : meta,
        created_at: r.created_at, edited_at: r.edited_at, deleted: del, deletedByMod: del && r.deleted_by && r.deleted_by !== r.user_id, hidden: !!r.hidden, pinned: !!r.pinned,
        reply: r.reply_to && rmap[r.reply_to] ? { id: r.reply_to, username: rmap[r.reply_to].username, body: rmap[r.reply_to].deleted_at ? "message supprimé" : (rmap[r.reply_to].kind === "voice" ? "🎤 message vocal" : rmap[r.reply_to].kind === "image" ? "📷 photo" : rmap[r.reply_to].body).slice(0, 140) } : null,
        thread_root: r.thread_root, reactions: rx, thread: t ? { n: t.n, last: t.last, users: String(t.us || "").split(",").map(Number).filter(Boolean).slice(0, 4) } : null };
      if (r.kind === "poll") { const vs = votes.filter(v => v.message_id === r.id); o.poll = { counts: (meta.options || []).map((_, i) => vs.filter(v => v.opt === i).length), mine: vs.filter(v => v.user_id === uid).map(v => v.opt), voters: new Set(vs.map(v => v.user_id)).size, who: (meta.options || []).map((_, i) => vs.filter(v => v.opt === i).map(v => v.username)) }; }
      if (r.pinned || meta.announce) { const a = acks.filter(x => x.message_id === r.id); o.acks = { n: a.length, of: teamN, me: a.some(x => x.user_id === uid), who: isAdmin ? a.map(x => ({ username: x.username, at: x.at })) : [] }; }
      if (HOOKS[r.kind]) try { o[r.kind] = HOOKS[r.kind](meta, uid); } catch (e) {}
      if (r.kind === "swap" && meta.swap_id) { const w = db.prepare("SELECT w.*, t.username to_name FROM shift_swaps w LEFT JOIN users t ON t.id = w.to_user WHERE w.id = ?").get(meta.swap_id); if (w) o.swap = { status: w.status, to_user: w.to_user, to_name: w.to_name }; }
      if (r.kind === "sos") { const best = db.prepare("SELECT m.id, m.body, u.username, COUNT(r.user_id) n FROM chat_messages m JOIN users u ON u.id = m.user_id JOIN chat_reactions r ON r.message_id = m.id AND r.emoji = '⭐' WHERE m.thread_root = ? AND m.deleted_at IS NULL GROUP BY m.id ORDER BY n DESC, m.id LIMIT 1").get(r.id); o.best = best || null; }
      return o;
    });
  }
  const SEL = "SELECT m.*, u.username, u.role FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id";
  const one = (id, uid, isAdmin) => hydrate(db.prepare(`${SEL} WHERE m.id = ?`).all(id), uid, isAdmin)[0];
  // diffusion : chaque client reçoit sa propre version (réactions « moi », votes…) → on renvoie l'id, le client recharge ce message
  function bump(msgId, ev = "update") { const m = db.prepare("SELECT channel_id, thread_root FROM chat_messages WHERE id = ?").get(msgId); if (!m) return; const ch = chOf(m.channel_id);
    emit(ch, ev, { id: msgId, channel_id: m.channel_id, thread_root: m.thread_root }); if (m.thread_root) emit(ch, "update", { id: m.thread_root, channel_id: m.channel_id }); }

  function post(ch, uid, body, kind = "text", meta = {}, reply_to = null, thread_root = null) {
    const ment = new Set(); const ids = [];
    if (body) { const names = db.prepare(ch.kind === "training" ? "SELECT id, username FROM users WHERE active = 1 AND role IN ('trainee','admin')" : "SELECT id, username FROM users WHERE active = 1 AND role <> 'trainee'").all();
      for (const m of body.matchAll(/@([\wÀ-ÿ.\-]+)/g)) { const n = m[1].toLowerCase();
        if (n === "shift") db.prepare("SELECT DISTINCT user_id FROM clocks WHERE end_at IS NULL").all().forEach(r => ment.add(r.user_id));
        else if (n === "tous" || n === "everyone") names.forEach(x => ment.add(x.id));
        else { const u = names.find(x => x.username.toLowerCase() === n); if (u) ment.add(u.id); } } }
    ment.delete(uid); if (ment.size) meta.mentions = [...ment];
    const id = db.prepare("INSERT INTO chat_messages (channel_id, user_id, body, kind, meta, reply_to, thread_root, created_at) VALUES (?,?,?,?,?,?,?,?)").run(ch.id, uid, body || "", kind, JSON.stringify(meta), reply_to, thread_root, now()).lastInsertRowid;
    if (uid) db.prepare("INSERT INTO chat_reads (user_id, channel_id, last_id) VALUES (?,?,?) ON CONFLICT(user_id, channel_id) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)").run(uid, ch.id, thread_root ? 0 : id);
    emit(ch, "message", { id, channel_id: ch.id, thread_root, user_id: uid, mentions: meta.mentions || [] });
    if (thread_root) bump(thread_root);
    return id;
  }

  /* ---------- données de départ ---------- */
  function channelsFor(u) {
    const isAdmin = u.role === "admin";
    const rows = db.prepare(`SELECT c.* FROM chat_channels c WHERE c.kind <> 'dm' OR EXISTS (SELECT 1 FROM chat_members cm WHERE cm.channel_id = c.id AND cm.user_id = ?) ORDER BY c.position, c.name`).all(u.id);
    return rows.filter(c => canSee(c, u)).map(c => {
      const rd = db.prepare("SELECT last_id FROM chat_reads WHERE user_id = ? AND channel_id = ?").get(u.id, c.id), lr = rd ? rd.last_id : 0;
      const unread = db.prepare("SELECT COUNT(*) n FROM chat_messages WHERE channel_id = ? AND id > ? AND thread_root IS NULL AND deleted_at IS NULL AND (user_id IS NULL OR user_id <> ?)").get(c.id, lr, u.id).n;
      const ment = db.prepare("SELECT COUNT(*) n FROM chat_messages WHERE channel_id = ? AND id > ? AND deleted_at IS NULL AND meta LIKE ?").get(c.id, lr, `%"mentions":[%`).n ? db.prepare("SELECT meta FROM chat_messages WHERE channel_id = ? AND id > ? AND deleted_at IS NULL AND meta LIKE '%mentions%'").all(c.id, lr).filter(r => (J(r.meta, {}).mentions || []).includes(u.id)).length : 0;
      const last = db.prepare("SELECT m.body, m.kind, m.created_at, u.username FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.channel_id = ? AND m.thread_root IS NULL AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT 1").get(c.id);
      let other = null; if (c.kind === "dm") { const o = db.prepare("SELECT u.id, u.username, u.role FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.channel_id = ? AND cm.user_id <> ?").get(c.id, u.id); other = o || null; }
      return { id: c.id, slug: c.slug, name: other ? other.username : c.name, kind: c.kind, topic: c.topic, readonly: !!c.readonly, canWrite: !c.readonly || isAdmin, emoji: c.emoji, model_id: c.model_id,
        other, unread, mentions: ment, last: last ? { body: last.kind === "voice" ? "🎤 Message vocal" : last.kind === "image" ? "📷 Photo" : last.kind === "poll" ? "📊 Sondage" : last.kind === "swap" ? "🔁 Remplacement de shift" : last.kind === "sos" ? "🆘 Aide fan" : last.kind === "sale" ? "💸 Nouvelle vente" : last.kind === "win" ? "🎉 Victoire d'équipe" : last.kind === "motm" ? "🏅 Vote du coéquipier du mois" : last.kind === "qotd" ? "☕ Question du jour" : last.body.slice(0, 80), at: last.created_at, username: last.username } : null };
    });
  }
  app.get("/api/chat/boot", auth, noTrainee, (req, res) => {
    const users = db.prepare(req.user.role === "trainee" ? "SELECT id, username, role, grade, display_name, color FROM users WHERE active = 1 AND role IN ('trainee','admin') ORDER BY username" : "SELECT id, username, role, grade, display_name, color FROM users WHERE active = 1 AND role <> 'trainee' ORDER BY username").all().map(u => pubUser(u));
    res.json({ me: { id: req.user.id, username: req.user.username, role: req.user.role, muted: muted(req.user.id) }, channels: channelsFor(req.user), users, quick: QUICK });
  });
  app.get("/api/chat/unread", auth, (req, res) => {
    const cs = channelsFor(req.user); res.json({ n: cs.reduce((t, c) => t + c.unread, 0), mentions: cs.reduce((t, c) => t + c.mentions, 0) });
  });
  app.get("/api/chat/c/:id/messages", auth, noTrainee, (req, res) => {
    const ch = chOf(+req.params.id); if (!canSee(ch, req.user)) return res.status(404).json({ error: "Salon introuvable" });
    const before = +req.query.before || 9e15, root = +req.query.thread || null, isAdmin = req.user.role === "admin";
    const rows = root ? db.prepare(`${SEL} WHERE m.channel_id = ? AND (m.id = ? OR m.thread_root = ?) ORDER BY m.id`).all(ch.id, root, root)
      : db.prepare(`${SEL} WHERE m.channel_id = ? AND m.thread_root IS NULL AND m.id < ? ORDER BY m.id DESC LIMIT 60`).all(ch.id, before).reverse();
    const pins = root ? [] : hydrate(db.prepare(`${SEL} WHERE m.channel_id = ? AND m.pinned = 1 AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT 5`).all(ch.id), req.user.id, isAdmin);
    res.json({ messages: hydrate(rows, req.user.id, isAdmin), pins, more: !root && rows.length === 60 });
  });
  app.get("/api/chat/m/:id", auth, noTrainee, (req, res) => { const m = db.prepare("SELECT channel_id FROM chat_messages WHERE id = ?").get(+req.params.id); if (!m || !canSee(chOf(m.channel_id), req.user)) return res.status(404).json({ error: "Message introuvable" }); res.json(one(+req.params.id, req.user.id, req.user.role === "admin")); });

  /* ---------- écrire ---------- */
  function guard(req, res, ch) {
    if (!canSee(ch, req.user)) { res.status(404).json({ error: "Salon introuvable" }); return false; }
    if (ch.readonly && req.user.role !== "admin") { res.status(403).json({ error: "Seuls les managers peuvent écrire dans #" + ch.name }); return false; }
    const mu = muted(req.user.id); if (mu && req.user.role !== "admin") { res.status(403).json({ error: `Tu es en sourdine jusqu'à ${new Date(mu).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })}` }); return false; }
    return true;
  }
  const rate = new Map();
  function spam(uid) { const h = (rate.get(uid) || []).filter(t => now() - t < 10e3); h.push(now()); rate.set(uid, h); return h.length > 12; }
  app.post("/api/chat/c/:id/messages", auth, noTrainee, (req, res) => {
    const ch = chOf(+req.params.id); if (!guard(req, res, ch)) return;
    if (spam(req.user.id)) return res.status(429).json({ error: "Doucement 🙂 trop de messages d'un coup" });
    const b = req.body || {}, body = String(b.body || "").trim().slice(0, 4000), kind = ["text", "poll", "sos"].includes(b.kind) ? b.kind : "text";
    const root = b.thread_root ? db.prepare("SELECT id FROM chat_messages WHERE id = ? AND channel_id = ? AND thread_root IS NULL").get(+b.thread_root, ch.id) : null;
    const reply = b.reply_to ? db.prepare("SELECT id FROM chat_messages WHERE id = ? AND channel_id = ?").get(+b.reply_to, ch.id) : null;
    const meta = {};
    if (kind === "poll") { const opts = (Array.isArray(b.options) ? b.options : []).map(o => String(o).trim().slice(0, 80)).filter(Boolean).slice(0, 6);
      if (!body || opts.length < 2) return res.status(400).json({ error: "Un sondage a besoin d'une question et d'au moins 2 réponses" }); meta.options = opts; meta.multi = !!b.multi; }
    else if (kind === "sos") { meta.fan = String(b.fan || "").trim().slice(0, 1500); if (!meta.fan) return res.status(400).json({ error: "Colle le message du fan" }); meta.model = String(b.model || "").slice(0, 40); }
    else if (!body) return res.status(400).json({ error: "Message vide" });
    if (req.user.role !== "admin") { const hit = persoHit(body + " " + (meta.fan || "") + " " + (meta.options || []).join(" ")); if (hit) return res.status(400).json({ error: `Message bloqué : il contient ${hit}. Pas d'infos perso dans le chat.`, blocked: true }); }
    if (req.user.role === "admin" && (b.announce || ch.readonly)) meta.announce = true;
    if (meta.announce && ch.kind !== "training" && ["important", "urgent"].includes(b.level)) meta.level = b.level;   // bandeau sur l'accueil / écran bloquant
    const id = post(ch, req.user.id, body, kind, meta, reply ? reply.id : null, root ? root.id : null);
    if (meta.announce) db.prepare("UPDATE chat_messages SET pinned = 1 WHERE id = ?").run(id);
    if (ch.readonly) log(req.user.id, "a", `a publié une annonce${meta.level === "urgent" ? " urgente" : meta.level === "important" ? " importante" : ""} dans **#${ch.name}**`, body.slice(0, 120));
    res.json({ ok: true, message: one(id, req.user.id, req.user.role === "admin") });
  });
  app.put("/api/chat/m/:id", auth, noTrainee, (req, res) => {
    const m = db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(+req.params.id); if (!m || m.user_id !== req.user.id || m.deleted_at) return res.status(404).json({ error: "Message introuvable" });
    const body = String(req.body?.body || "").trim().slice(0, 4000); if (!body) return res.status(400).json({ error: "Message vide" });
    if (req.user.role !== "admin") { const hit = persoHit(body); if (hit) return res.status(400).json({ error: `Message bloqué : il contient ${hit}.`, blocked: true }); }
    db.prepare("UPDATE chat_messages SET body = ?, edited_at = ? WHERE id = ?").run(body, now(), m.id); bump(m.id); res.json({ ok: true });
  });
  // fichiers : photos, GIF, vocaux
  app.post("/api/chat/c/:id/upload", auth, noTrainee, express.raw({ type: ["image/*", "audio/*"], limit: "15mb" }), (req, res) => {
    const ch = chOf(+req.params.id); if (!guard(req, res, ch)) return;
    const mime = (req.headers["content-type"] || "").split(";")[0], ext = FILES[mime]; if (!ext || !Buffer.isBuffer(req.body) || req.body.length < 50) return res.status(400).json({ error: "Format non pris en charge" });
    const f = `c${ch.id}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`; fs.writeFileSync(path.join(DIR, f), req.body);
    const kind = mime.startsWith("audio") ? "voice" : "image", meta = { file: f, mime, size: req.body.length };
    if (kind === "voice") { meta.dur = Math.max(0, Math.min(600, +req.query.dur || 0)); try { meta.wave = String(req.query.wave || "").split(",").map(Number).filter(n => n >= 0 && n <= 100).slice(0, 48); } catch (e) {} }
    else { meta.w = +req.query.w || null; meta.h = +req.query.h || null; }
    const root = req.query.thread ? db.prepare("SELECT id FROM chat_messages WHERE id = ? AND channel_id = ? AND thread_root IS NULL").get(+req.query.thread, ch.id) : null;
    const id = post(ch, req.user.id, String(req.query.caption || "").slice(0, 500), kind, meta, null, root ? root.id : null);
    res.json({ ok: true, message: one(id, req.user.id, req.user.role === "admin") });
  });
  app.get("/api/chat/file/:f", auth, noTrainee, (req, res) => {
    const f = path.basename(req.params.f), m = db.prepare("SELECT channel_id FROM chat_messages WHERE meta LIKE ? LIMIT 1").get(`%"file":"${f}"%`);
    if (!m || !canSee(chOf(m.channel_id), req.user)) return res.status(404).end(); const p = path.join(DIR, f); if (!fs.existsSync(p)) return res.status(404).end();
    res.sendFile(p, { headers: { "Cache-Control": "private, max-age=604800" } });
  });

  /* ---------- réactions, votes, lu par, épingles ---------- */
  const msgFor = (req, res) => { const m = db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(+req.params.id); if (!m || !canSee(chOf(m.channel_id), req.user)) { res.status(404).json({ error: "Message introuvable" }); return null; } return m; };
  app.post("/api/chat/m/:id/react", auth, noTrainee, (req, res) => {
    const m = msgFor(req, res); if (!m) return; const e = String(req.body?.emoji || "").slice(0, 16); if (!e) return res.status(400).json({ error: "Emoji manquant" });
    const had = db.prepare("SELECT 1 FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?").get(m.id, req.user.id, e);
    if (had) db.prepare("DELETE FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?").run(m.id, req.user.id, e);
    else db.prepare("INSERT INTO chat_reactions (message_id, user_id, emoji, at) VALUES (?,?,?,?)").run(m.id, req.user.id, e, now());
    bump(m.id); if (!had) emit(chOf(m.channel_id), "react", { id: m.id, emoji: e, user_id: req.user.id, username: req.user.username, super: !!req.body?.super });
    res.json({ ok: true, on: !had });
  });
  app.post("/api/chat/m/:id/vote", auth, noTrainee, (req, res) => {
    const m = msgFor(req, res); if (!m || m.kind !== "poll") return m && res.status(400).json({ error: "Ce n'est pas un sondage" }); const meta = J(m.meta, {}), opt = +req.body?.opt;
    if (!(opt >= 0 && opt < (meta.options || []).length)) return res.status(400).json({ error: "Réponse invalide" });
    const had = db.prepare("SELECT 1 FROM chat_votes WHERE message_id = ? AND user_id = ? AND opt = ?").get(m.id, req.user.id, opt);
    if (!meta.multi) db.prepare("DELETE FROM chat_votes WHERE message_id = ? AND user_id = ?").run(m.id, req.user.id);
    if (had) db.prepare("DELETE FROM chat_votes WHERE message_id = ? AND user_id = ? AND opt = ?").run(m.id, req.user.id, opt);
    else db.prepare("INSERT OR IGNORE INTO chat_votes (message_id, user_id, opt) VALUES (?,?,?)").run(m.id, req.user.id, opt);
    bump(m.id); res.json({ ok: true });
  });
  app.post("/api/chat/m/:id/ack", auth, noTrainee, (req, res) => { const m = msgFor(req, res); if (!m) return; db.prepare("INSERT OR IGNORE INTO chat_acks (message_id, user_id, at) VALUES (?,?,?)").run(m.id, req.user.id, now()); bump(m.id); res.json({ ok: true }); });
  app.post("/api/chat/m/:id/pin", auth, admin, (req, res) => { const m = msgFor(req, res); if (!m) return; db.prepare("UPDATE chat_messages SET pinned = ? WHERE id = ?").run(m.pinned ? 0 : 1, m.id); bump(m.id); emit(chOf(m.channel_id), "pins", { channel_id: m.channel_id }); res.json({ ok: true, pinned: !m.pinned }); });
  app.delete("/api/chat/m/:id", auth, noTrainee, (req, res) => {
    const m = msgFor(req, res); if (!m) return; if (m.user_id !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "Tu ne peux supprimer que tes messages" });
    db.prepare("UPDATE chat_messages SET deleted_at = ?, deleted_by = ?, pinned = 0 WHERE id = ?").run(now(), req.user.id, m.id);
    if (m.user_id !== req.user.id) { const a = user(m.user_id); log(req.user.id, "a", `a supprimé un message de **${a ? a.username : "?"}** dans le chat`, m.body.slice(0, 120)); }
    bump(m.id); res.json({ ok: true });
  });
  app.post("/api/chat/m/:id/hide", auth, admin, (req, res) => { const m = msgFor(req, res); if (!m) return; db.prepare("UPDATE chat_messages SET hidden = ? WHERE id = ?").run(m.hidden ? 0 : 1, m.id); bump(m.id); res.json({ ok: true, hidden: !m.hidden }); });
  app.post("/api/chat/mute", auth, admin, (req, res) => {
    const u = user(+req.body?.user_id); if (!u || u.role === "admin") return res.status(400).json({ error: "Utilisateur invalide" }); const min = Math.max(0, Math.min(7 * 1440, +req.body?.minutes || 0));
    if (!min) db.prepare("DELETE FROM chat_mutes WHERE user_id = ?").run(u.id); else db.prepare("INSERT OR REPLACE INTO chat_mutes (user_id, until, by) VALUES (?,?,?)").run(u.id, now() + min * 60e3, req.user.id);
    log(req.user.id, "a", min ? `a mis **${u.username}** en sourdine dans le chat` : `a réactivé **${u.username}** dans le chat`, min ? `${min >= 60 ? Math.round(min / 60) + " h" : min + " min"}` : "");
    (CL.get(u.id) || new Set()).forEach(r => send(r, "muted", { until: min ? now() + min * 60e3 : null })); res.json({ ok: true });
  });
  app.post("/api/chat/c/:id/read", auth, noTrainee, (req, res) => {
    const ch = chOf(+req.params.id); if (!canSee(ch, req.user)) return res.status(404).json({ error: "Salon introuvable" });
    const last = db.prepare("SELECT MAX(id) m FROM chat_messages WHERE channel_id = ?").get(ch.id).m || 0;
    db.prepare("INSERT INTO chat_reads (user_id, channel_id, last_id) VALUES (?,?,?) ON CONFLICT(user_id, channel_id) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)").run(req.user.id, ch.id, last);
    if (ch.kind === "dm") emit(ch, "seen", { channel_id: ch.id, user_id: req.user.id, last_id: last });
    res.json({ ok: true });
  });
  app.get("/api/chat/c/:id/seen", auth, noTrainee, (req, res) => { const ch = chOf(+req.params.id); if (!canSee(ch, req.user) || ch.kind !== "dm") return res.json({}); const o = db.prepare("SELECT r.last_id FROM chat_reads r JOIN chat_members m ON m.user_id = r.user_id AND m.channel_id = r.channel_id WHERE r.channel_id = ? AND r.user_id <> ?").get(ch.id, req.user.id); res.json({ last_id: o ? o.last_id : 0 }); });
  const typing = new Map();
  app.post("/api/chat/typing", auth, noTrainee, (req, res) => { const ch = chOf(+req.body?.channel_id); if (!canSee(ch, req.user)) return res.json({ ok: false });
    const k = req.user.id + ":" + ch.id; if (now() - (typing.get(k) || 0) > 2500) { typing.set(k, now()); emit(ch, "typing", { channel_id: ch.id, user_id: req.user.id, username: req.user.username, thread: +req.body?.thread || null }); } res.json({ ok: true }); });
  app.post("/api/chat/dm", auth, staffOnly, (req, res) => {
    const o = user(+req.body?.user_id); if (!o || !o.active || o.role === "trainee" || o.id === req.user.id) return res.status(400).json({ error: "Destinataire invalide" });
    const ex = db.prepare("SELECT c.id FROM chat_channels c JOIN chat_members a ON a.channel_id = c.id AND a.user_id = ? JOIN chat_members b ON b.channel_id = c.id AND b.user_id = ? WHERE c.kind = 'dm'").get(req.user.id, o.id);
    if (ex) return res.json({ id: ex.id });
    const id = db.prepare("INSERT INTO chat_channels (slug, name, kind, emoji, position, created_at) VALUES (?,?,?,?,?,?)").run(`dm-${Math.min(req.user.id, o.id)}-${Math.max(req.user.id, o.id)}`, "dm", "dm", "@", 90, now()).lastInsertRowid;
    db.prepare("INSERT INTO chat_members (channel_id, user_id) VALUES (?,?),(?,?)").run(id, req.user.id, id, o.id);
    res.json({ id });
  });

  /* ---------- remplacement de shift depuis le chat ---------- */
  app.get("/api/chat/myshifts", auth, staffOnly, (req, res) => {
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
    const rows = planning.decorate(db.prepare(`${planning.SHIFT_SQL} WHERE s.user_id = ? AND s.date >= ? ORDER BY s.date, s.start LIMIT 12`).all(req.user.id, today)).filter(s => s.start_ms > now());
    res.json({ shifts: rows.map(s => ({ id: s.id, date: s.date, start: s.start, end: s.end, model_name: s.model_name, start_ms: s.start_ms, busy: !!db.prepare("SELECT 1 FROM shift_swaps WHERE shift_id = ? AND status IN ('open','requested')").get(s.id) })) });
  });
  app.post("/api/chat/swap", auth, staffOnly, (req, res) => {
    const ch = chOf(+req.body?.channel_id); if (!guard(req, res, ch)) return;
    const s = db.prepare("SELECT s.*, m.name model_name FROM shifts s JOIN models m ON m.id = s.model_id WHERE s.id = ?").get(+req.body?.shift_id);
    if (!s || s.user_id !== req.user.id) return res.status(404).json({ error: "Shift introuvable" });
    if (planning.shiftSpan(s)[1] <= now()) return res.status(400).json({ error: "Ce shift est déjà passé" });
    if (db.prepare("SELECT 1 FROM shift_swaps WHERE shift_id = ? AND status IN ('open','requested')").get(s.id)) return res.status(400).json({ error: "Ce shift est déjà en échange" });
    const reason = String(req.body?.reason || "").trim().slice(0, 160);
    const sw = db.prepare("INSERT INTO shift_swaps (shift_id, from_user, reason, created_at) VALUES (?,?,?,?)").run(s.id, req.user.id, reason, now()).lastInsertRowid;
    const id = post(ch, req.user.id, reason, "swap", { swap_id: sw, shift_id: s.id, date: s.date, start: s.start, end: s.end, model: s.model_name, start_ms: planning.shiftSpan(s)[0] });
    log(req.user.id, "pl", `**${req.user.username}** cherche un remplaçant dans le chat`, `${s.date} ${s.start}–${s.end} · ${s.model_name}`);
    res.json({ ok: true, message: one(id, req.user.id, req.user.role === "admin") });
  });
  app.post("/api/chat/m/:id/swap", auth, staffOnly, (req, res) => {
    const m = msgFor(req, res); if (!m || m.kind !== "swap") return m && res.status(400).json({ error: "Message invalide" });
    const w = db.prepare("SELECT * FROM shift_swaps WHERE id = ?").get(J(m.meta, {}).swap_id); if (!w) return res.status(404).json({ error: "Échange introuvable" });
    const a = req.body?.action, isAdmin = req.user.role === "admin";
    if (a === "take") {
      if (w.status !== "open") return res.status(400).json({ error: "Quelqu'un a déjà pris ce shift" });
      if (w.from_user === req.user.id) return res.status(400).json({ error: "C'est ton propre shift" });
      const su = planning.suspended(req.user.id); if (su) return res.status(403).json({ error: "Tes shifts sont suspendus" });
      db.prepare("UPDATE shift_swaps SET status = 'requested', to_user = ? WHERE id = ?").run(req.user.id, w.id);
      post(chOf(m.channel_id), null, `**${req.user.username}** prend le shift · en attente de validation du manager`, "system", {}, null, m.id);
    } else if (a === "release") {
      if (w.to_user !== req.user.id || w.status !== "requested") return res.status(400).json({ error: "Action impossible" });
      db.prepare("UPDATE shift_swaps SET status = 'open', to_user = NULL WHERE id = ?").run(w.id);
    } else if (a === "cancel") {
      if (w.from_user !== req.user.id && !isAdmin) return res.status(403).json({ error: "Action non autorisée" });
      db.prepare("UPDATE shift_swaps SET status = 'cancelled', decided_at = ? WHERE id = ?").run(now(), w.id);
    } else if ((a === "approve" || a === "refuse") && isAdmin) {
      if (!["open", "requested"].includes(w.status)) return res.status(400).json({ error: "Échange déjà traité" });
      if (a === "approve") { if (!w.to_user) return res.status(400).json({ error: "Personne n'a repris ce shift" });
        db.prepare("UPDATE shifts SET user_id = ? WHERE id = ?").run(w.to_user, w.shift_id); db.prepare("UPDATE shift_swaps SET status = 'approved', decided_by = ?, decided_at = ? WHERE id = ?").run(req.user.id, now(), w.id);
        const t = user(w.to_user); post(chOf(m.channel_id), null, `✅ Validé : le shift passe à **${t ? t.username : "?"}** dans le planning`, "system", {}, null, m.id);
      } else { db.prepare("UPDATE shift_swaps SET status = 'refused', decided_by = ?, decided_at = ? WHERE id = ?").run(req.user.id, now(), w.id); post(chOf(m.channel_id), null, "Échange refusé par le manager", "system", {}, null, m.id); }
    } else return res.status(400).json({ error: "Action invalide" });
    bump(m.id); res.json({ ok: true });
  });

  /* ---------- #ventes : chaque vente validée est postée automatiquement ---------- */
  let lastSale = Date.now();
  const SUPER = () => +(gest.agency().superSale ?? 100);
  setInterval(() => { try {
    const ch = db.prepare("SELECT * FROM chat_channels WHERE slug = 'ventes'").get(); if (!ch) return;
    const rows = db.prepare("SELECT s.id, s.amount, s.user_id, s.reviewed_at, u.username, m.name model FROM sales s JOIN users u ON u.id = s.user_id JOIN models m ON m.id = s.model_id WHERE s.status = 'validated' AND s.reviewed_at > ? ORDER BY s.reviewed_at").all(lastSale);
    rows.forEach(s => { lastSale = Math.max(lastSale, s.reviewed_at);
      if (db.prepare("SELECT 1 FROM chat_messages WHERE kind = 'sale' AND meta LIKE ?").get(`%"sale_id":${s.id},%`)) return;
      post(ch, null, "", "sale", { sale_id: s.id, amount: s.amount, user_id: s.user_id, username: s.username, model: s.model, super: s.amount >= SUPER() }); });
  } catch (e) {} }, 8000);

  return { post, emit, bump, hooks: HOOKS };
};
