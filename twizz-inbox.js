// Messagerie Twizz sur le site. Fermée par défaut (fondateur seulement) ; le fondateur l'ouvre à l'équipe
// et choisit qui y a accès : lecture, ou lecture + envoi. Un chatter ne voit que ses créatrices habituelles
// (Gestion) et celle de son shift en cours. Rien n'est marqué comme lu automatiquement,
// et l'envoi est bloqué pour tout le monde tant que l'interrupteur « Envoi activé » est coupé.
module.exports = function mount(app, db, auth, admin, { twizz, ai }) {
  const { call, S } = twizz;
  db.exec("CREATE TABLE IF NOT EXISTS twizz_fan_notes (creator_id TEXT, fan_id TEXT, text TEXT, user_id INTEGER, at INTEGER, PRIMARY KEY (creator_id, fan_id))");
  if (!db.prepare("PRAGMA table_info(twizz_sent)").all().some(x => x.name === "files")) db.exec("ALTER TABLE twizz_sent ADD COLUMN files TEXT");
  // scripts : messages tout prêts, pour toutes les créatrices (creator_id vide) ou une seule
  db.exec("CREATE TABLE IF NOT EXISTS twizz_scripts (id INTEGER PRIMARY KEY, creator_id TEXT, cat TEXT, title TEXT, body TEXT, uses INTEGER DEFAULT 0, user_id INTEGER, at INTEGER)");
  for (const [c, t] of [["updated_at", "INTEGER"], ["updated_by", "INTEGER"], ["source", "TEXT"], ["ext_id", "TEXT"], ["pinned", "INTEGER DEFAULT 0"], ["media", "TEXT"], ["price", "REAL"], ["steps", "TEXT"]])
    if (!db.prepare("PRAGMA table_info(twizz_scripts)").all().some(x => x.name === c)) db.exec(`ALTER TABLE twizz_scripts ADD COLUMN ${c} ${t}`);
  db.exec("CREATE TABLE IF NOT EXISTS twizz_script_uses (script_id INTEGER, user_id INTEGER, at INTEGER)");
  // où en est chaque fan dans le script qu'on lui déroule (une étape à la fois, envoyée par le chatter)
  db.exec("CREATE TABLE IF NOT EXISTS twizz_script_runs (creator_id TEXT, fan_id TEXT, script_id INTEGER, step INTEGER, ppv_msg TEXT, ppv_step INTEGER, relanced INTEGER DEFAULT 0, user_id INTEGER, at INTEGER, PRIMARY KEY (creator_id, fan_id))");
  // fiche du fan : infos perso (posées par l'équipe ou repérées par l'IA), résumé de l'IA, étape corrigée à la main
  db.exec("CREATE TABLE IF NOT EXISTS twizz_fan_profile (creator_id TEXT, fan_id TEXT, field TEXT, value TEXT, source TEXT, user_id INTEGER, at INTEGER, PRIMARY KEY (creator_id, fan_id, field))");
  db.exec("CREATE TABLE IF NOT EXISTS twizz_fan_brief (creator_id TEXT, fan_id TEXT, conv_id TEXT, data TEXT, user_id INTEGER, at INTEGER, PRIMARY KEY (creator_id, fan_id))");
  db.exec("CREATE TABLE IF NOT EXISTS twizz_fan_stage (creator_id TEXT, fan_id TEXT, stage INTEGER, user_id INTEGER, at INTEGER, PRIMARY KEY (creator_id, fan_id))");
  // tags des fans : communs à l'agence, posés par l'équipe ou tout seuls par les règles du manager (rien n'est écrit chez Twizz)
  db.exec("CREATE TABLE IF NOT EXISTS twizz_tags (id INTEGER PRIMARY KEY, name TEXT, color TEXT, rule TEXT, thr REAL, active INTEGER DEFAULT 1, user_id INTEGER, at INTEGER)");
  db.exec("CREATE TABLE IF NOT EXISTS twizz_fan_tags (creator_id TEXT, fan_id TEXT, tag_id INTEGER, auto INTEGER DEFAULT 0, user_id INTEGER, at INTEGER, PRIMARY KEY (creator_id, fan_id, tag_id))");
  db.exec("CREATE TABLE IF NOT EXISTS twizz_tag_log (creator_id TEXT, fan_id TEXT, tag_id INTEGER, action TEXT, user_id INTEGER, at INTEGER)");
  // ce que l'on sait d'un fan, appris au fil des pages ouvertes (aucune requête Twizz en plus) : sert aux règles
  db.exec("CREATE TABLE IF NOT EXISTS twizz_fan_facts (creator_id TEXT, fan_id TEXT, name TEXT, spend REAL, buys INTEGER, vids INTEGER, first_at INTEGER, team_at INTEGER, fan_at INTEGER, at INTEGER, PRIMARY KEY (creator_id, fan_id))");
  const RULES = { gp: ["Spender", "#3dff8a", 300, 1], vid: ["Vidéos", "#7db4ff", 50, 1], nv: ["Nouveau", "#5fd3a2", 7, 1], in: ["Inactif", "#ff8a8a", 7, 0] };
  for (const [k, [name, color, thr, on]] of Object.entries(RULES))
    if (!db.prepare("SELECT 1 FROM twizz_tags WHERE rule = ?").get(k)) db.prepare("INSERT INTO twizz_tags (name, color, rule, thr, active, at) VALUES (?,?,?,?,?,?)").run(name, color, k, thr, on, Date.now());
  db.prepare("UPDATE twizz_tags SET name = 'Spender', color = '#3dff8a' WHERE rule = 'gp' AND name = 'Gros payeur'").run();
  const ruleTags = () => db.prepare("SELECT * FROM twizz_tags WHERE rule IS NOT NULL").all();
  const known = (r, f) => r.rule === "gp" ? f.spend != null : r.rule === "vid" ? f.buys != null : r.rule === "nv" ? f.first_at != null : r.rule === "in" ? f.team_at != null || f.fan_at != null : false;
  const matches = (r, f, now) => r.rule === "gp" ? f.spend > r.thr
    : r.rule === "vid" ? f.buys >= 2 && f.vids * 100 / f.buys > r.thr
    : r.rule === "nv" ? now - f.first_at < r.thr * 864e5
    : r.rule === "in" ? !!f.team_at && (!f.fan_at || f.team_at > f.fan_at) && now - f.team_at >= r.thr * 864e5 : false;
  function applyRules(cid, fan, R) {
    const f = db.prepare("SELECT * FROM twizz_fan_facts WHERE creator_id = ? AND fan_id = ?").get(cid, fan); if (!f) return;
    const now = Date.now();
    for (const r of R || ruleTags()) {
      const has = db.prepare("SELECT auto FROM twizz_fan_tags WHERE creator_id = ? AND fan_id = ? AND tag_id = ?").get(cid, fan, r.id);
      if (!r.active) { if (has && has.auto) db.prepare("DELETE FROM twizz_fan_tags WHERE creator_id = ? AND fan_id = ? AND tag_id = ?").run(cid, fan, r.id); continue; }
      if (!known(r, f)) continue;
      const want = matches(r, f, now);
      if (want && !has) { db.prepare("INSERT INTO twizz_fan_tags (creator_id, fan_id, tag_id, auto, at) VALUES (?,?,?,1,?)").run(cid, fan, r.id, now); db.prepare("INSERT INTO twizz_tag_log (creator_id, fan_id, tag_id, action, at) VALUES (?,?,?,'auto+',?)").run(cid, fan, r.id, now); }
      else if (!want && has && has.auto) { db.prepare("DELETE FROM twizz_fan_tags WHERE creator_id = ? AND fan_id = ? AND tag_id = ?").run(cid, fan, r.id); db.prepare("INSERT INTO twizz_tag_log (creator_id, fan_id, tag_id, action, at) VALUES (?,?,?,'auto-',?)").run(cid, fan, r.id, now); }
    }
  }
  const applyAll = () => { const R = ruleTags(); db.exec("BEGIN"); try { db.prepare("SELECT creator_id, fan_id FROM twizz_fan_facts").all().forEach(x => applyRules(x.creator_id, x.fan_id, R)); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } };
  // n'écrit que ce qui change, puis repasse les règles sur ce fan
  function fact(cid, fan, p) {
    if (!cid || !fan) return; const cur = db.prepare("SELECT * FROM twizz_fan_facts WHERE creator_id = ? AND fan_id = ?").get(cid, fan) || {};
    const keys = ["name", "spend", "buys", "vids", "first_at", "team_at", "fan_at"], nx = {}; let ch = !cur.fan_id;
    keys.forEach(k => { nx[k] = p[k] !== undefined && p[k] !== null ? p[k] : cur[k] ?? null; if (nx[k] !== (cur[k] ?? null)) ch = true; });
    if (!ch) return;
    db.prepare("INSERT INTO twizz_fan_facts (creator_id, fan_id, name, spend, buys, vids, first_at, team_at, fan_at, at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(creator_id, fan_id) DO UPDATE SET name = excluded.name, spend = excluded.spend, buys = excluded.buys, vids = excluded.vids, first_at = excluded.first_at, team_at = excluded.team_at, fan_at = excluded.fan_at, at = excluded.at")
      .run(cid, fan, nx.name, nx.spend, nx.buys, nx.vids, nx.first_at, nx.team_at, nx.fan_at, Date.now());
    applyRules(cid, fan);
  }
  const ts = v => { const t = v ? Date.parse(v) : NaN; return isFinite(t) ? t : null; };
  // début de la conversation : Twizz ne le donne pas ; on prend le plus vieux message, quand toutes les pages ont été lues (règle « Nouveau »)
  function firstSeen(cid, fan, list) { if (!cid || !fan || !list.length) return;
    const t = Math.min(...list.map(m => ts(m.at)).filter(x => x != null)); if (!isFinite(t)) return;
    const cur = db.prepare("SELECT first_at FROM twizz_fan_facts WHERE creator_id = ? AND fan_id = ?").get(cid, fan);
    fact(cid, fan, { first_at: cur && cur.first_at ? Math.min(cur.first_at, t) : t }); }
  const founder = (req, res, next) => req.user.rk === "founder" && !req.viewAs ? next() : res.status(403).json({ error: "Messagerie en test : réservée au fondateur" });
  // ouverture à l'équipe : niveau 1 = lecture, 2 = lecture + envoi (posé par le fondateur, personne par personne)
  db.exec("CREATE TABLE IF NOT EXISTS twizz_inbox_access (user_id INTEGER PRIMARY KEY, level INTEGER NOT NULL DEFAULT 0, by INTEGER, at INTEGER)");
  const openOn = () => !!S.get("twizz_inbox_open", false);
  // managers : accès d'office (envoi), sauf si le fondateur l'a réglé autrement ; chatters : rien tant que le fondateur ne leur donne pas accès
  const levelOf = (uid, rk) => { const r = db.prepare("SELECT level FROM twizz_inbox_access WHERE user_id = ?").get(uid); return r ? r.level || 0 : rk === "manager" ? 2 : 0; };
  // créatrices d'un chatter : ses créatrices habituelles (Gestion) + celle(s) de son shift en cours (renfort compris)
  const scopeOf = uid => { const mids = new Set();
    try { db.prepare("SELECT model_id FROM user_models WHERE user_id = ?").all(uid).forEach(r => mids.add(r.model_id)); } catch (e) {}
    try { db.prepare("SELECT model_id FROM clocks WHERE user_id = ? AND end_at IS NULL").all(uid).forEach(r => mids.add(r.model_id)); } catch (e) {}
    return new Set(mapped().filter(c => mids.has(c.model_id)).map(c => c.id)); };
  function accessOf(req) {
    const u = req.user; if (!u) return null;
    if (u.rk === "founder" && !req.viewAs) return { all: true, send: true, founder: true };
    if (!["manager", "chatter", "tl"].includes(u.rk) || (u.rk !== "manager" && !openOn())) return null;   // les managers n'attendent pas l'ouverture aux chatters
    const lv = levelOf(u.id, u.rk); if (!lv) return null;
    // vue « en tant que » du fondateur : il voit ce que voit la personne, sans pouvoir envoyer
    return { all: u.rk === "manager", cids: u.rk === "manager" ? null : scopeOf(u.id), send: lv >= 2 && !req.viewAs, founder: false, manager: u.rk === "manager" };
  }
  const inbox = (req, res, next) => { const a = accessOf(req);
    if (!a) return res.status(403).json({ error: openOn() ? "Tu n'as pas encore accès à la messagerie : demande au fondateur" : "Messagerie en test : réservée au fondateur" });
    if (req.params.cid && !a.all && !a.cids.has(req.params.cid)) return res.status(403).json({ error: "Cette créatrice ne fait pas partie des tiennes" });
    req.acc = a; next(); };
  // coffre et scripts : les managers y ont toujours accès (page Scripts), les autres selon leur accès à la messagerie
  const mgrOrInbox = (req, res, next) => req.user.role === "admin" && req.user.rk !== "assistant" && !req.viewAs ? (req.acc = accessOf(req) || { all: true, send: false }, next()) : inbox(req, res, next);
  app.locals.inboxOf = req => { try { return !!accessOf(req); } catch (e) { return false; } };
  // qui est sur quelle conversation (en mémoire, signalé par la page toutes les 20 s) : évite que deux personnes répondent au même fan
  const HERE = new Map();
  const hereOf = (conv, me) => { const L = HERE.get(conv); if (!L) return []; const t = Date.now() - 45e3;
    return [...L.entries()].filter(([uid, x]) => x.at > t && uid !== me).map(([uid, x]) => ({ id: uid, name: x.name, typing: x.typing && x.typingAt > Date.now() - 15e3 })); };
  // managers (fondateur compris) : bibliothèque de scripts, et lecture du coffre pour y joindre des médias
  const mgr = (req, res, next) => req.user.role === "admin" && req.user.rk !== "assistant" && !req.viewAs ? next() : res.status(403).json({ error: "Réservé aux managers" });
  // petit cache mémoire : une conversation déjà ouverte se réaffiche tout de suite (vidé par le temps réel et les envois)
  const CACHE = new Map();
  const G = (path, ttl = 0) => { const c = ttl && CACHE.get(path); if (c && Date.now() - c.at < ttl) return Promise.resolve(c.data);
    return call("GET", path, null, true).then(d => { if (ttl) CACHE.set(path, { at: Date.now(), data: d }); if (CACHE.size > 400) CACHE.delete(CACHE.keys().next().value); return d; }); };
  const drop = (...needles) => { for (const k of [...CACHE.keys()]) if (!needles.length || needles.some(n => n && k.includes(n))) CACHE.delete(k); };
  const enc = encodeURIComponent;
  const arr = j => { const d = j && (j.data !== undefined ? j.data : j); if (Array.isArray(d)) return d; if (d && Array.isArray(d.data)) return d.data;
    for (const k of ["conversations", "items", "results", "albums", "files", "list"]) if (d && Array.isArray(d[k])) return d[k]; return []; };
  const str = v => (v == null ? "" : String(v));
  // miniatures Twizz : liste [{ type: "BLURRED" | "CLEAR", absolutePath }] (adresses signées), ou anciens formats
  const thumbOf = x => { const t = x && x.thumbnails;
    if (Array.isArray(t) && t.length) { const c = t.find(y => y && y.type === "CLEAR") || t[0]; return str((c && (c.absolutePath || c.url || c.path)) || ""); }
    if (t && typeof t === "object") return str(t.small || t.medium || t.large || "");
    return str((x && (x.thumbnail || x.thumbUrl)) || ""); };
  // un même fichier n'a pas toujours le même identifiant côté coffre et côté message : on garde tous ses repères
  const pathOf = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && x.pathname.length > 8 ? x.pathname : ""; } catch (e) { return ""; } };
  const keysOf = x => [x && x.fileId, x && x._id, x && x.id, x && x.quickFileId, pathOf(str(x && x.url))].map(str).filter(k => k && k !== "/");
  const wrap = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.twizz ? 502 : e.status || 500).json({ error: e.message }); } };
  const bad = msg => { const e = new Error(msg); e.status = 400; return e; };
  const mapped = () => db.prepare("SELECT t.twizz_id id, t.label, t.note, t.model_id, m.name model FROM twizz_creators t LEFT JOIN models m ON m.id = t.model_id ORDER BY t.label").all();
  // qui a envoyé chaque message depuis le site (les messages envoyés directement sur Twizz n'ont pas d'auteur connu)
  const authors = ids => { const out = {}; const L = ids.filter(Boolean); if (!L.length) return out;
    db.prepare(`SELECT s.msg_id, u.username FROM twizz_sent s JOIN users u ON u.id = s.user_id WHERE s.msg_id IN (${L.map(() => "?").join(",")})`).all(...L).forEach(r => out[r.msg_id] = r.username); return out; };
  const creatorOk = cid => { if (!db.prepare("SELECT 1 FROM twizz_creators WHERE twizz_id = ?").get(cid)) throw bad("Créatrice inconnue : teste d'abord la connexion Twizz"); return cid; };
  const sendOn = () => !!S.get("twizz_inbox_send", false);
  const mustSend = req => { if (!sendOn()) throw bad(req && req.acc && !req.acc.founder ? "L'envoi est coupé pour le moment par le fondateur" : "L'envoi est coupé : active « Envoi activé » en haut de la messagerie");
    if (req && req.acc && !req.acc.send) throw bad("Tu peux lire la messagerie, mais pas encore envoyer : demande au fondateur"); };

  /* ---------- mise en forme (tolérante : le format Twizz n'est pas documenté) ---------- */
  const person = p => { p = p || {}; const full = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
    return { id: str(p.userId || p._id || p.id), name: str(p.name || full || p.username || "Fan"), username: str(p.username || ""), avatar: str(p.avatar || p.avatarPath || p.avatarUrl || "") }; };
  // non lus : Twizz ne documente pas le nom du champ ; on essaie les noms connus, puis « dernier message du fan pas encore lu »
  const UNREAD_KEYS = ["unreadCount", "unread", "unreadMessages", "unreadMessagesCount", "unread_count", "unreadMessageCount", "countUnread", "nbUnread", "creatorUnreadCount", "unreadCountCreator", "unreadByCreator", "newMessages", "newMessagesCount"];
  // qui a envoyé un message : Twizz donne « senderId » dans les messages, mais « sentBy » dans le dernier message de la liste
  const senderOf = m => { m = m || {}; const s = m.senderId || m.sentBy || m.sender; return str(s && typeof s === "object" ? s._id || s.id || s.userId : s); };
  const byFan = (m, fanId) => { const s = senderOf(m); return !!s && (s === fanId || /^(fan|user|subscriber|client|follower)$/i.test(s)); };
  function unreadOf(c, cid, fanId, last) {
    for (const k of UNREAD_KEYS) { const v = c[k]; if (typeof v === "number") return v; if (v && typeof v === "object" && typeof v[cid] === "number") return v[cid]; }
    // le vrai Twizz : « hasNewMessages » sur la conversation (vrai tant que la créatrice n'a pas lu)
    for (const k of ["hasNewMessages", "hasUnread", "hasUnreadMessages", "isUnread", "unreadByCreator"]) if (typeof c[k] === "boolean") return c[k] ? 1 : 0;
    const fromFan = byFan(last, fanId);
    for (const k of ["isRead", "read", "seen", "isSeen", "readByCreator"]) if (typeof last[k] === "boolean") return fromFan && !last[k] ? 1 : 0;
    for (const k of ["isRead", "read", "seen", "isSeen"]) if (typeof c[k] === "boolean") return fromFan && !c[k] ? 1 : 0;
    for (const [k, v] of Object.entries(c)) if (/unread|nonlu|notread|unseen/i.test(k) && typeof v === "number") return v;
    return 0;
  }
  function conv(c, cid) {
    const fanRaw = c.interlocutor || c.fan || c.user || (Array.isArray(c.participants) ? c.participants.find(x => str(x._id || x.userId) !== cid) : null) || {};
    const fan = person(fanRaw), last = c.lastMessage || c.last_message || {};
    return { id: str(c._id || c.id), fan, last: { id: str(last._id || ""), text: str(last.text || ""), type: str(last.type || (last.isAudio ? "AUDIO" : "")), at: last.createdAt || c.updatedAt || c.createdAt || null, fromFan: !!fan.id && byFan(last, fan.id) },
      unread: unreadOf(c, cid, fan.id, last), type: str(c.type || ""), since: c.createdAt || null, online: c.isOnline === true, subscribed: typeof c.isFanSubscribed === "boolean" ? c.isFanSubscribed : null, tags: (c.tags || []).map(t => str(t.name || t.label || t)).filter(Boolean) };
  }
  function msg(m, fanId) {
    const p = m.mediaPushPrice || {};
    return { id: str(m._id), fromFan: !!fanId && str(m.senderId) === fanId, sender: str(m.senderId), type: str(m.type), text: str(m.text), status: str(m.status), at: m.createdAt,
      read: !!m.isRead, price: p.resultPrice ?? p.price ?? null, mediaPushId: str(m.mediaPushId || ""),
      medias: (m.medias || []).map(x => ({ url: str(x.url), thumb: thumbOf(x), audio: !!x.isAudio, private: !!x.isPrivate, video: /video/i.test(str(x.type || x.mimeType)) || /\.(mp4|mov|webm|m3u8)$/i.test(pathOf(str(x.url))), keys: keysOf(x) })) };
  }
  const file = f => ({ id: str(f._id || f.id || f.fileId), url: str(f.url || f.Location || f.path || ""), thumb: thumbOf(f) || str(f.absolutePath || f.url || ""),
    type: str(f.type || f.mimeType || f.fileType || ""), name: str(f.originalFileName || f.name || f.filename || ""), keys: keysOf(f) });

  /* ---------- temps réel : socket Twizz -> flux vers la page ---------- */
  const SUBS = new Set(); let sock = null, live = false, idleT = null;
  const push = (ev, data) => SUBS.forEach(r => { try { r.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch (e) {} });
  // cherche un identifiant de conversation / de créatrice dans un événement, quelle que soit sa forme
  const findId = (o, keys, d = 0) => { if (!o || typeof o !== "object" || d > 4) return ""; for (const k of keys) if (typeof o[k] === "string" && o[k]) return o[k];
    for (const v of Object.values(o)) { const r = findId(v, keys, d + 1); if (r) return r; } return ""; };
  async function connect() {
    if (sock) return; let io; try { io = require("socket.io-client").io; } catch (e) { return; }
    try { await twizz.ensureAuth(); } catch (e) { return; }
    sock = io(process.env.TWIZZ_BASE || "https://api.twizz.com", { transports: ["websocket"], auth: { token: twizz.token(), userId: twizz.accountId() },
      extraHeaders: { Origin: "https://business.twizz.com", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
      reconnectionDelay: 3000, reconnectionDelayMax: 30000 });
    sock.on("connect", () => { live = true; push("live", { on: true }); });
    sock.on("disconnect", () => { live = false; push("live", { on: false }); });
    let authTries = 0;
    sock.on("connect", () => { authTries = 0; });
    sock.on("connect_error", async e => { live = false; push("live", { on: false });
      const m = String(e && e.message); if (authTries < 3) console.error("Twizz temps réel :", m);
      // badge refusé : on le renouvelle et on relance (socket.io ne réessaie pas seul dans ce cas)
      if (/auth|token|jwt|unauthor|forbidden/i.test(m) && authTries++ < 3) { try { await twizz.reauth(); sock.auth = { token: twizz.token(), userId: twizz.accountId() }; setTimeout(() => sock && sock.connect(), 1500); } catch (er) {} } });
    sock.onAny(async (ev, ...args) => {
      if (/token_exp/.test(ev)) { try { await twizz.reauth(); sock.auth = { token: twizz.token(), userId: twizz.accountId() }; sock.disconnect().connect(); } catch (e) {} return; }
      const conv = findId(args[0], ["conversationId", "conversation_id"]) || (args[0] && args[0].conversation && str(args[0].conversation._id)) || "";
      const creator = findId(args[0], ["creatorId", "creator_id"]);
      drop(conv || "find-all-messages", "/conversations/user/");
      push("tw", { ev, conv, creator });
    });
  }
  function disconnectSoon() { clearTimeout(idleT); idleT = setTimeout(() => { if (!SUBS.size && sock) { try { sock.close(); } catch (e) {} sock = null; live = false; } }, 120e3); }
  app.get("/api/twizz/inbox/stream", auth, inbox, (req, res) => {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" }); res.flushHeaders?.();
    res.write("retry: 3000\n\n"); SUBS.add(res); clearTimeout(idleT); connect().catch(() => {});
    res.write(`event: live\ndata: ${JSON.stringify({ on: live })}\n\n`);
    const ka = setInterval(() => { try { res.write(": ping\n\n"); } catch (e) {} }, 25e3);
    req.on("close", () => { clearInterval(ka); SUBS.delete(res); if (!SUBS.size) disconnectSoon(); });
  });

  /* ---------- lecture ---------- */
  app.get("/api/twizz/inbox/debug/conversation", auth, founder, wrap(async req => {
    const c0 = mapped()[0]; if (!c0) throw bad("Aucune créatrice");
    const j = await G(`/conversations/user/${enc(c0.id)}?page=1&type=GENERAL&creatorId=${enc(c0.id)}`, 60e3), x = arr(j)[0] || {};
    const shape = (o, d = 0) => !o || typeof o !== "object" || d > 2 ? (typeof o === "string" ? "texte" : o) : Array.isArray(o) ? [shape(o[0], d + 1)] : Object.fromEntries(Object.entries(o).map(([k, v]) => [k, shape(v, d + 1)]));
    const L = arr(j).slice(0, 20), fanOf = c => person(c.interlocutor || c.fan || c.user || {}).id;
    const who = c => { const s = senderOf(c.lastMessage || {}); return !s ? "vide" : s === fanOf(c) ? "le fan" : s === c0.id ? "la créatrice" : /^[0-9a-f]{20,}$/i.test(s) ? "un autre compte" : s.length <= 16 ? "« " + s + " »" : "autre"; };
    const kind = v => v === null ? "vide" : Array.isArray(v) ? "liste" : typeof v === "number" ? "nombre" : typeof v === "boolean" ? "vrai/faux" : typeof v === "object" ? "objet" : "texte";
    const keysOf2 = o => { const d = o && (o.data ?? o); return d && typeof d === "object" && !Array.isArray(d) ? Object.fromEntries(Object.entries(d).map(([k, v]) => [k, kind(v)])) : kind(d); };
    const fid = L.map(fanOf).find(Boolean); let fanStats = null, recentShape = null;
    if (fid) { fanStats = keysOf2(await G(`/business/get-fan-purchase-stats/${enc(fid)}?creatorId=${enc(c0.id)}`, 120e3).catch(e => ({ erreur: e.message })));
      const rr = arr(await G(`/creator-fan-tags/recent-purchase?fanId=${enc(fid)}&creatorId=${enc(c0.id)}`, 120e3).catch(() => null)); recentShape = rr.length ? keysOf2(rr[0]) : "aucun achat"; }
    const subs = L.map(c => c.isFanSubscribed), cnt = v => subs.filter(x => x === v).length;
    return { conversation: shape(x), unreadDetected: conv(x, c0.id).unread, fanStats, recentShape, abonnement: { vrai: cnt(true), faux: cnt(false), vide: subs.length - cnt(true) - cnt(false) }, page1: { conversations: L.length, nonLues: L.filter(c => conv(c, c0.id).unread > 0).length, dernierMessagePar: L.map(who), attendent: L.filter(c => conv(c, c0.id).last.fromFan).length } };
  }));
  app.get("/api/twizz/inbox/state", auth, inbox, (req, res) => { const a = req.acc;
    res.json({ send: sendOn(), canSend: a.send, founder: a.founder, manager: !!(a.founder || a.manager), open: openOn(),
      creators: a.all ? mapped() : mapped().filter(c => a.cids.has(c.id)), configured: twizz.configured() }); });
  // équipe : qui a accès à la messagerie (fondateur)
  const teamOut = () => { const M = mapped(), um = {}; try { db.prepare("SELECT user_id, model_id FROM user_models").all().forEach(r => (um[r.user_id] = um[r.user_id] || []).push(r.model_id)); } catch (e) {}
    const lv = {}; db.prepare("SELECT user_id, level FROM twizz_inbox_access").all().forEach(r => lv[r.user_id] = r.level);
    const users = db.prepare("SELECT id, username, role, grade FROM users WHERE active = 1 AND role IN ('admin', 'chatter') ORDER BY role, username").all()
      .filter(u => !(u.role === "admin" && (u.grade === "founder" || u.grade === "assistant")))
      .map(u => ({ id: u.id, username: u.username, manager: u.role === "admin", tl: u.grade === "tl", level: lv[u.id] ?? (u.role === "admin" ? 2 : 0),
        creators: u.role === "admin" ? M.map(c => c.label) : M.filter(c => (um[u.id] || []).includes(c.model_id)).map(c => c.label) }));
    return { open: openOn(), send: sendOn(), users }; };
  app.get("/api/twizz/inbox/team", auth, founder, (req, res) => res.json(teamOut()));
  app.post("/api/twizz/inbox/team", auth, founder, (req, res) => { const b = req.body || {};
    if (typeof b.open === "boolean") S.set("twizz_inbox_open", b.open);
    const uid = parseInt(b.user_id, 10);
    if (uid && [0, 1, 2].includes(+b.level)) db.prepare("INSERT INTO twizz_inbox_access (user_id, level, by, at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET level = excluded.level, by = excluded.by, at = excluded.at").run(uid, +b.level, req.user.id, Date.now());
    res.json(teamOut()); });
  // présence sur une conversation : la page le signale toutes les 20 s (et quand on écrit) ; renvoie qui d'autre est dessus
  app.post("/api/twizz/inbox/:cid/here/:conv", auth, inbox, (req, res) => { const conv = str(req.params.conv).slice(0, 64), me = req.user.id;
    if (req.body?.leave) { const L = HERE.get(conv); if (L) { L.delete(me); if (!L.size) HERE.delete(conv); } return res.json({ others: [] }); }
    const L = HERE.get(conv) || new Map(), prev = L.get(me) || {}; const typing = !!req.body?.typing;
    L.set(me, { name: req.user.username, at: Date.now(), typing: typing || prev.typing, typingAt: typing ? Date.now() : prev.typingAt || 0 }); HERE.set(conv, L);
    if (HERE.size > 2000) HERE.delete(HERE.keys().next().value);
    res.json({ others: hereOf(conv, me) }); });
  app.post("/api/twizz/inbox/state", auth, founder, (req, res) => { if (typeof req.body?.send === "boolean") S.set("twizz_inbox_send", req.body.send); res.json({ send: sendOn() }); });
  // non lus d'une créatrice : nombre de conversations non lues, lu dans sa liste (même requête et même cache que la liste)
  app.get("/api/twizz/inbox/:cid/unread", auth, inbox, wrap(async req => { const cid = creatorOk(req.params.cid);
    const j = await G(`/conversations/user/${enc(cid)}?page=1&type=GENERAL&creatorId=${enc(cid)}`, 60e3);
    return { count: arr(j).map(c => conv(c, cid)).filter(c => c.unread > 0).length }; }));
  app.get("/api/twizz/inbox/:cid/conversations", auth, inbox, wrap(async req => {
    const cid = creatorOk(req.params.cid), type = ["GENERAL", "TO_DELIVER"].includes(req.query.type) ? req.query.type : "GENERAL", page = Math.max(1, +req.query.page || 1);
    const q = String(req.query.q || "").trim().slice(0, 60);
    const fresh = req.query.fresh === "1"; if (fresh) drop(`/conversations/user/${enc(cid)}?page=${page}&type=${type}`);
    const j = q ? await G(`/conversations/user/${enc(cid)}/search?search=${enc(q)}`, 10e3) : await G(`/conversations/user/${enc(cid)}?page=${page}&type=${type}&creatorId=${enc(cid)}`, 20e3);
    const d = j && j.data, items = arr(j).map(c => conv(c, cid));
    const by = authors(items.filter(c => !c.last.fromFan).map(c => c.last.id));
    const near = db.prepare("SELECT u.username name, s.at FROM twizz_sent s JOIN users u ON u.id = s.user_id WHERE s.conv_id = ? ORDER BY s.at DESC LIMIT 1");
    items.forEach(c => { if (c.last.fromFan) return; c.last.by = by[c.last.id] || null;
      if (!c.last.by && c.last.at) { const r = near.get(c.id); if (r && Math.abs(r.at - Date.parse(c.last.at)) < 120e3) c.last.by = r.name; } });
    try { items.forEach(c => c.fan.id && fact(cid, c.fan.id, { name: c.fan.name, first_at: ts(c.since), [c.last.fromFan ? "fan_at" : "team_at"]: ts(c.last.at) })); } catch (e) {}
    items.forEach(c => { const h = hereOf(c.id, req.user.id); if (h.length) c.here = h.map(x => x.name); });
    return { items, page, more: !!(d && (d.totalPages ? page < d.totalPages : arr(j).length >= 10)), sample: req.query.debug ? arr(j)[0] : undefined };
  }));
  app.get("/api/twizz/inbox/:cid/messages/:conv", auth, inbox, wrap(async req => {
    const cid = creatorOk(req.params.cid), page = Math.max(1, +req.query.page || 1), fanId = str(req.query.fan);
    const path = `/messages/find-all-messages?conversationId=${enc(req.params.conv)}&creatorId=${enc(cid)}&page=${page}`;
    if (req.query.fresh === "1") drop(path);
    const j = await G(path, 15e3);
    const d = (j && j.data) || {}, L = (d.data || []).map(m => msg(m, fanId)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const by = authors(L.filter(m => !m.fromFan).map(m => m.id)); L.forEach(m => { if (!m.fromFan) m.by = by[m.id] || null; });
    if (page >= (d.totalPages || 1)) try { firstSeen(cid, fanId, L); } catch (e) {}
    return { items: L, page, totalPages: d.totalPages || 1, note: d.creatorFanNote || null, sample: req.query.debug ? (d.data || [])[0] : undefined };
  }));
  app.get("/api/twizz/inbox/:cid/fan/:fan", auth, inbox, wrap(async req => {
    const cid = creatorOk(req.params.cid), fan = enc(req.params.fan);
    const [stats, tags, recent] = await Promise.all([G(`/business/get-fan-purchase-stats/${fan}?creatorId=${enc(cid)}`, 120e3).catch(e => ({ error: e.message })),
      G(`/creator-fan-tags/${fan}?creatorId=${enc(cid)}`, 120e3).catch(() => null), G(`/creator-fan-tags/recent-purchase?fanId=${fan}&creatorId=${enc(cid)}`, 120e3).catch(() => null)]);
    // on garde les chiffres et textes courts, quelle que soit la forme exacte de la réponse
    const flat = {}; const walk = (o, pre) => { if (!o || typeof o !== "object") return; for (const [k, v] of Object.entries(o)) { if (["_id", "__v", "fanId", "creatorId"].includes(k)) continue;
      if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length < 40)) flat[pre + k] = v; else if (v && typeof v === "object" && !Array.isArray(v) && pre.split(".").length < 3) walk(v, pre + k + "."); } };
    walk(stats && (stats.data ?? stats), "");
    const sk = Object.keys(flat).find(k => /totalSpent|spent/i.test(k)); if (sk && isFinite(+flat[sk])) try { fact(cid, str(req.params.fan), { spend: +flat[sk] }); } catch (e) {}
    // derniers achats : on garde montant, type et date, quel que soit le nom exact des champs
    const rec = arr(recent).slice(0, 8).map(x => ({ amount: +(x.netPrice ?? x.amount ?? x.price ?? x.total ?? 0) || 0, type: str(x.type || x.category || x.kind || ""), at: x.createdAt || x.date || x.purchasedAt || null })).filter(x => x.amount > 0);
    return { stats: flat, error: stats && stats.error, tags: arr(tags).map(t => ({ name: str(t.name || t.label || t.tag || t), color: str(t.color || "") })).filter(t => t.name), recent: rec };
  }));
  // coffre de la créatrice (albums « quick-files » de Twizz)
  app.get("/api/twizz/inbox/:cid/vault", auth, mgrOrInbox, wrap(async req => {
    const cid = creatorOk(req.params.cid), j = await G(`/quick-files/albums?creatorId=${enc(cid)}`, 300e3);
    return { albums: arr(j).map(a => ({ id: str(a._id || a.id), name: str(a.name || a.title || "Album"), count: +(a.filesCount ?? a.count ?? (a.files || []).length ?? 0) || 0,
      cover: file((a.files || [])[0] || a.cover || {}).thumb })), sample: req.query.debug ? arr(j)[0] : undefined };
  }));
  app.get("/api/twizz/inbox/:cid/vault/:album", auth, mgrOrInbox, wrap(async req => {
    const cid = creatorOk(req.params.cid), j = await G(`/quick-files/album/${enc(req.params.album)}?creatorId=${enc(cid)}`, 300e3);
    const d = j && (j.data ?? j), L = Array.isArray(d) ? d : (d && (d.files || d.quickFiles || d.items)) || [];
    return { files: L.map(file).filter(f => f.id), sample: req.query.debug ? L[0] : undefined };
  }));

  // historique d'un fan : médias envoyés (achetés ou pas), qui les a envoyés, l'équipe sur ce fan, la note d'équipe
  // (3 pages de messages au plus, gardées 2 min : peu de requêtes vers Twizz)
  app.get("/api/twizz/inbox/:cid/history/:conv", auth, inbox, wrap(async req => {
    const cid = creatorOk(req.params.cid), conv = str(req.params.conv), fan = str(req.query.fan);
    if (req.query.fresh === "1") drop(conv);
    const all = []; let pages = 1, twNote = null;
    for (let p = 1; p <= Math.min(pages, 3); p++) {
      const j = await G(`/messages/find-all-messages?conversationId=${enc(conv)}&creatorId=${enc(cid)}&page=${p}`, p === 1 ? 15e3 : 120e3);
      const d = (j && j.data) || {}; pages = d.totalPages || 1; if (p === 1) twNote = d.creatorFanNote || null;
      (d.data || []).forEach(m => all.push(msg(m, fan)));
    }
    const media = all.filter(m => !m.fromFan && m.type === "FILE" && m.medias.length).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const by = authors(media.map(m => m.id));
    const items = media.map(m => ({ id: m.id, at: m.at, price: m.price, status: m.status, bought: m.status === "accepted" && m.price > 0, by: by[m.id] || null,
      n: m.medias.length, videos: m.medias.filter(x => x.video).length, thumbs: m.medias.slice(0, 3).map(x => x.thumb), keys: [...new Set(m.medias.flatMap(x => x.keys))] }));
    // fichiers envoyés depuis le site (même au-delà des 3 pages lues)
    const site = db.prepare("SELECT files FROM twizz_sent WHERE conv_id = ? AND files IS NOT NULL").all(conv).flatMap(r => { try { return JSON.parse(r.files) || []; } catch (e) { return []; } }).map(str);
    const team = {}; db.prepare("SELECT u.username name, COUNT(*) n FROM twizz_sent s JOIN users u ON u.id = s.user_id WHERE s.conv_id = ? GROUP BY s.user_id").all(conv).forEach(r => team[r.name] = { name: r.name, msgs: r.n, sold: 0, amount: 0 });
    items.forEach(i => { if (i.by && i.bought) { const t = team[i.by] || (team[i.by] = { name: i.by, msgs: 0, sold: 0, amount: 0 }); t.sold++; t.amount += +i.price || 0; } });
    const note = db.prepare("SELECT n.text, n.at, u.username by FROM twizz_fan_notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.creator_id = ? AND n.fan_id = ?").get(cid, fan) || null;
    const paid = items.filter(i => i.bought); try { fact(cid, fan, { buys: paid.length, vids: paid.filter(i => i.videos).length }); } catch (e) {}
    if (pages <= 3) try { firstSeen(cid, fan, all); } catch (e) {}
    const tw = twNote && (twNote.note || twNote.text || twNote.content || (typeof twNote === "string" ? twNote : "")) || "";
    return { items, siteFiles: site, team: Object.values(team).sort((a, b) => b.amount - a.amount || b.msgs - a.msgs), note, twizzNote: str(tw), partial: pages > 3 };
  }));
  // note d'équipe sur un fan : enregistrée sur le site seulement (rien n'est écrit chez Twizz)
  app.post("/api/twizz/inbox/:cid/note/:fan", auth, inbox, wrap(async req => {
    const cid = creatorOk(req.params.cid), fan = str(req.params.fan), text = String(req.body?.text || "").trim().slice(0, 1000), at = Date.now();
    if (!fan) throw bad("Fan inconnu");
    db.prepare("INSERT INTO twizz_fan_notes (creator_id, fan_id, text, user_id, at) VALUES (?,?,?,?,?) ON CONFLICT(creator_id, fan_id) DO UPDATE SET text = excluded.text, user_id = excluded.user_id, at = excluded.at").run(cid, fan, text, req.user.id, at);
    return { ok: true, note: { text, at, by: req.user.username } };
  }));
  // total dépensé d'un fan (pour classer la file « À traiter »), gardé 10 min
  app.get("/api/twizz/inbox/:cid/spend/:fan", auth, inbox, wrap(async req => {
    const cid = creatorOk(req.params.cid), j = await G(`/business/get-fan-purchase-stats/${enc(req.params.fan)}?creatorId=${enc(cid)}`, 600e3), d = (j && (j.data ?? j)) || {};
    const k = Object.keys(d).find(k => /totalSpent|spent/i.test(k)), total = k ? +d[k] || 0 : null;
    if (total != null) try { fact(cid, str(req.params.fan), { spend: total }); } catch (e) {}
    return { total };
  }));

  /* ---------- fiche du fan : infos perso, résumé de l'IA, étape ---------- */
  const PFIELDS = ["anniv", "ville", "metier", "gouts"];
  const cardOf = (cid, fan) => {
    const profile = {}; db.prepare("SELECT p.field, p.value, p.source, p.at, u.username by FROM twizz_fan_profile p LEFT JOIN users u ON u.id = p.user_id WHERE p.creator_id = ? AND p.fan_id = ?").all(cid, fan)
      .forEach(r => profile[r.field] = { value: r.value, source: r.source, at: r.at, by: r.by || null });
    const b = db.prepare("SELECT data, at FROM twizz_fan_brief WHERE creator_id = ? AND fan_id = ?").get(cid, fan);
    let brief = null; if (b) try { brief = { ...JSON.parse(b.data), at: b.at }; } catch (e) {}
    const st = db.prepare("SELECT s.stage, s.at, u.username by FROM twizz_fan_stage s LEFT JOIN users u ON u.id = s.user_id WHERE s.creator_id = ? AND s.fan_id = ?").get(cid, fan);
    return { profile, brief, stage: st ? { stage: st.stage, at: st.at, by: st.by || null } : null };
  };
  app.get("/api/twizz/inbox/:cid/card/:fan", auth, inbox, wrap(async req => cardOf(creatorOk(req.params.cid), str(req.params.fan))));
  app.post("/api/twizz/inbox/:cid/profile/:fan", auth, inbox, wrap(async req => {
    const cid = creatorOk(req.params.cid), fan = str(req.params.fan), f = str(req.body?.field), v = String(req.body?.value || "").trim().slice(0, 120);
    if (!fan || !PFIELDS.includes(f)) throw bad("Champ inconnu");
    if (!v) db.prepare("DELETE FROM twizz_fan_profile WHERE creator_id = ? AND fan_id = ? AND field = ?").run(cid, fan, f);
    else db.prepare("INSERT INTO twizz_fan_profile (creator_id, fan_id, field, value, source, user_id, at) VALUES (?,?,?,?,'equipe',?,?) ON CONFLICT(creator_id, fan_id, field) DO UPDATE SET value = excluded.value, source = 'equipe', user_id = excluded.user_id, at = excluded.at").run(cid, fan, f, v, req.user.id, Date.now());
    return cardOf(cid, fan);
  }));
  app.post("/api/twizz/inbox/:cid/stage/:fan", auth, inbox, wrap(async req => {
    const cid = creatorOk(req.params.cid), fan = str(req.params.fan), v = req.body?.stage; if (!fan) throw bad("Fan inconnu");
    if (v === null || v === undefined || v === "") db.prepare("DELETE FROM twizz_fan_stage WHERE creator_id = ? AND fan_id = ?").run(cid, fan);
    else { const n = Math.round(+v); if (!(n >= 0 && n <= 3)) throw bad("Étape inconnue");
      db.prepare("INSERT INTO twizz_fan_stage (creator_id, fan_id, stage, user_id, at) VALUES (?,?,?,?,?) ON CONFLICT(creator_id, fan_id) DO UPDATE SET stage = excluded.stage, user_id = excluded.user_id, at = excluded.at").run(cid, fan, n, req.user.id, Date.now()); }
    return cardOf(cid, fan);
  }));
  // « En bref » : l'IA lit la conversation (page 1, déjà en cache) et résume le fan ; gardé 12 h, « Relire » le refait
  app.post("/api/twizz/inbox/:cid/brief/:conv", auth, inbox, wrap(async req => {
    if (!ai || !ai.fanBrief) throw bad("Assistant IA indisponible");
    const cid = creatorOk(req.params.cid), conv = str(req.params.conv), fan = str(req.body?.fan); if (!fan) throw bad("Fan inconnu");
    const old = cardOf(cid, fan); if (old.brief && !req.body?.again && Date.now() - old.brief.at < 12 * 3600e3) return old;
    const k = req.user.id + ":brief:" + conv; if (Date.now() - (aiLast.get(k) || 0) < 4000) throw bad("Doucement : attends quelques secondes"); aiLast.set(k, Date.now());
    const j = await G(`/messages/find-all-messages?conversationId=${enc(conv)}&creatorId=${enc(cid)}&page=1`, 15e3);
    const L = ((j && j.data && j.data.data) || []).map(m => msg(m, fan)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-40);
    const line = m => m.type === "FILE" && !m.fromFan ? `[CRÉATRICE ENVOIE ${m.medias.length > 1 ? m.medias.length + " MÉDIAS" : "UN MÉDIA"}${m.price > 0 ? ` À ${m.price} € — ${m.status === "accepted" ? "acheté" : "pas encore acheté"}` : " GRATUIT"}]${m.text ? " " + m.text : ""}`
      : `[${m.fromFan ? "FAN" : "CRÉATRICE"} · ${new Date(m.at).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })}] ${m.text || (m.medias.length ? "(média)" : "")}`;
    const cr = db.prepare("SELECT label FROM twizz_creators WHERE twizz_id = ?").get(cid) || {}, note = db.prepare("SELECT text FROM twizz_fan_notes WHERE creator_id = ? AND fan_id = ?").get(cid, fan);
    const f = db.prepare("SELECT spend FROM twizz_fan_facts WHERE creator_id = ? AND fan_id = ?").get(cid, fan);
    const r = await ai.fanBrief({ creator: cr.label || "la créatrice", fan: str(req.body?.name) || "le fan", spend: f && f.spend != null ? f.spend : null, note: note ? note.text : "",
      known: Object.fromEntries(Object.entries(old.profile).map(([k, v]) => [k, v.value])), transcript: L.map(line).join("\n") }, { user: req.user.id });
    const now = Date.now();
    db.prepare("INSERT INTO twizz_fan_brief (creator_id, fan_id, conv_id, data, user_id, at) VALUES (?,?,?,?,?,?) ON CONFLICT(creator_id, fan_id) DO UPDATE SET conv_id = excluded.conv_id, data = excluded.data, user_id = excluded.user_id, at = excluded.at")
      .run(cid, fan, conv, JSON.stringify({ prenom: r.prenom, brief: r.brief, etat: r.etat, action: r.action, difficulte: r.difficulte, n: L.length }), req.user.id, now);
    // ce que l'IA a repéré remplit seulement les cases vides (l'équipe garde la main)
    for (const fld of PFIELDS) { const v = String((r.profil || {})[fld] || "").trim().slice(0, 120); if (v && !old.profile[fld])
      db.prepare("INSERT OR IGNORE INTO twizz_fan_profile (creator_id, fan_id, field, value, source, user_id, at) VALUES (?,?,?,?,'ia',?,?)").run(cid, fan, fld, v, req.user.id, now); }
    return cardOf(cid, fan);
  }));

  /* ---------- tags des fans ---------- */
  const TAG_PAL = ["#5fd3a2", "#7db4ff", "#b49cff", "#ff8fb1", "#f0b54a", "#6fe0e0", "#ff8a8a", "#e8c27a"];
  const low = x => String(x || "").toLocaleLowerCase("fr");
  const tagOut = t => ({ id: t.id, name: t.name, color: t.color, rule: t.rule || null, thr: t.thr, active: !!t.active });
  const fanTags = (cid, fan) => ({
    tags: db.prepare("SELECT t.id, t.name, t.color, t.rule, t.thr, ft.auto, ft.at, u.username by FROM twizz_fan_tags ft JOIN twizz_tags t ON t.id = ft.tag_id LEFT JOIN users u ON u.id = ft.user_id WHERE ft.creator_id = ? AND ft.fan_id = ? AND (t.rule IS NULL OR t.active = 1) ORDER BY t.rule IS NULL, ft.at")
      .all(cid, fan).map(r => ({ id: r.id, name: r.name, color: r.color, rule: r.rule || null, thr: r.thr, auto: !!r.auto, at: r.at, by: r.by || null })),
    log: db.prepare("SELECT l.action, l.at, t.name, t.color, t.rule, t.thr, u.username by FROM twizz_tag_log l JOIN twizz_tags t ON t.id = l.tag_id LEFT JOIN users u ON u.id = l.user_id WHERE l.creator_id = ? AND l.fan_id = ? ORDER BY l.at DESC LIMIT 4")
      .all(cid, fan).map(r => ({ action: r.action, at: r.at, name: r.name, color: r.color, rule: r.rule || null, thr: r.thr, by: r.by || null }))
  });
  // pour la liste d'une créatrice : les tags, combien de fans chacun, et les tags de chaque fan (filtre de la liste)
  app.get("/api/twizz/inbox/:cid/tags", auth, inbox, wrap(async req => {
    const cid = creatorOk(req.params.cid), T = db.prepare("SELECT * FROM twizz_tags WHERE rule IS NULL OR active = 1 ORDER BY rule IS NULL, id").all(), ok = new Set(T.map(t => t.id)), map = {}, n = {};
    db.prepare("SELECT fan_id, tag_id FROM twizz_fan_tags WHERE creator_id = ?").all(cid).forEach(r => { if (!ok.has(r.tag_id)) return; (map[r.fan_id] || (map[r.fan_id] = [])).push(r.tag_id); n[r.tag_id] = (n[r.tag_id] || 0) + 1; });
    return { tags: T.map(t => ({ ...tagOut(t), n: n[t.id] || 0 })), map };
  }));
  app.get("/api/twizz/inbox/:cid/tags/:fan", auth, inbox, wrap(async req => fanTags(creatorOk(req.params.cid), str(req.params.fan))));
  // poser ou enlever un tag à la main (les tags des règles se posent et s'enlèvent tout seuls)
  app.post("/api/twizz/inbox/:cid/tags/:fan", auth, inbox, wrap(async req => {
    const cid = creatorOk(req.params.cid), fan = str(req.params.fan), b = req.body || {}, now = Date.now(); if (!fan) throw bad("Fan inconnu");
    if (b.remove) {
      const t = db.prepare("SELECT * FROM twizz_tags WHERE id = ?").get(+b.remove); if (!t) throw bad("Tag introuvable");
      if (t.rule) throw bad("Ce tag est posé par une règle du manager : il s'enlève tout seul quand la règle ne s'applique plus");
      if (db.prepare("DELETE FROM twizz_fan_tags WHERE creator_id = ? AND fan_id = ? AND tag_id = ?").run(cid, fan, t.id).changes)
        db.prepare("INSERT INTO twizz_tag_log (creator_id, fan_id, tag_id, action, user_id, at) VALUES (?,?,?,'-',?,?)").run(cid, fan, t.id, req.user.id, now);
      return fanTags(cid, fan);
    }
    let id = +b.add || 0;
    if (!id) { const name = String(b.name || "").trim().replace(/\s+/g, " ").slice(0, 30); if (!name) throw bad("Donne un nom au tag");
      const all = db.prepare("SELECT * FROM twizz_tags").all(), ex = all.find(t => low(t.name) === low(name));
      if (ex) id = ex.id;
      else { const color = /^#[0-9a-f]{6}$/i.test(str(b.color)) ? str(b.color) : TAG_PAL[all.length % TAG_PAL.length];
        id = Number(db.prepare("INSERT INTO twizz_tags (name, color, active, user_id, at) VALUES (?,?,1,?,?)").run(name, color, req.user.id, now).lastInsertRowid); } }
    const t = db.prepare("SELECT * FROM twizz_tags WHERE id = ?").get(id); if (!t) throw bad("Tag introuvable");
    if (t.rule) throw bad("Ce tag est posé tout seul par une règle du manager");
    if (db.prepare("INSERT OR IGNORE INTO twizz_fan_tags (creator_id, fan_id, tag_id, auto, user_id, at) VALUES (?,?,?,0,?,?)").run(cid, fan, id, req.user.id, now).changes)
      db.prepare("INSERT INTO twizz_tag_log (creator_id, fan_id, tag_id, action, user_id, at) VALUES (?,?,?,'+',?,?)").run(cid, fan, id, req.user.id, now);
    return { ...fanTags(cid, fan), added: id };
  }));
  // l'IA propose 2 tags d'après la conversation (une seule lecture de la page 1, gardée 15 min)
  const tagAi = new Map();
  app.post("/api/twizz/inbox/:cid/tag-ai/:conv", auth, inbox, wrap(async req => {
    if (!ai || !ai.tagSuggest) throw bad("Assistant IA indisponible");
    const cid = creatorOk(req.params.cid), conv = str(req.params.conv), fan = str(req.body?.fan), key = cid + ":" + conv, hit = tagAi.get(key);
    const cur = fanTags(cid, fan).tags.map(t => t.name), clean = r => ({ tags: r.tags.filter(x => !cur.some(c => low(c) === low(x.name))) });
    if (hit && Date.now() - hit.at < 15 * 60e3) return clean(hit.r);
    const k = req.user.id + ":tag:" + conv; if (Date.now() - (aiLast.get(k) || 0) < 4000) throw bad("Doucement : attends quelques secondes"); aiLast.set(k, Date.now());
    const j = await G(`/messages/find-all-messages?conversationId=${enc(conv)}&creatorId=${enc(cid)}&page=1`, 15e3);
    const L = ((j && j.data && j.data.data) || []).map(m => msg(m, fan)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-40);
    const manual = db.prepare("SELECT * FROM twizz_tags WHERE rule IS NULL").all(), cr = db.prepare("SELECT label FROM twizz_creators WHERE twizz_id = ?").get(cid) || {};
    const out = await ai.tagSuggest({ creator: cr.label || "la créatrice", existing: manual.map(t => t.name), current: cur,
      transcript: L.map(m => `[${m.fromFan ? "FAN" : "CRÉATRICE"}] ${m.text || (m.medias.length ? "(média)" : "")}`).join("\n") }, { user: req.user.id });
    const r = { tags: out.tags.map(x => { const ex = manual.find(t => low(t.name) === low(x.name)); return { name: ex ? ex.name : x.name, why: x.why, id: ex ? ex.id : null, color: ex ? ex.color : null }; }) };
    tagAi.set(key, { at: Date.now(), r }); return clean(r);
  }));
  // page Tags du manager : règles automatiques, tags de l'équipe, ce que valent les fans de chaque tag
  const THR_MAX = { gp: 100000, vid: 99, nv: 365, in: 365 };
  const adminTags = () => {
    const T = db.prepare("SELECT * FROM twizz_tags ORDER BY rule IS NULL, id").all(), F = db.prepare("SELECT * FROM twizz_fan_facts").all(), now = Date.now(), cnt = {};
    db.prepare("SELECT ft.tag_id, COUNT(*) n, SUM(f.spend) s, SUM(CASE WHEN f.spend IS NOT NULL THEN 1 ELSE 0 END) k FROM twizz_fan_tags ft LEFT JOIN twizz_fan_facts f ON f.creator_id = ft.creator_id AND f.fan_id = ft.fan_id GROUP BY ft.tag_id").all().forEach(r => cnt[r.tag_id] = r);
    return { tags: T.map(t => { const c = cnt[t.id] || {}; return { ...tagOut(t), n: c.n || 0, spend: c.s || 0, spendKnown: c.k || 0, would: t.rule ? F.filter(f => known(t, f) && matches(t, f, now)).length : null }; }),
      facts: { fans: F.length, spend: F.filter(f => f.spend != null).length, buys: F.filter(f => f.buys != null).length, first: F.filter(f => f.first_at != null).length } };
  };
  app.get("/api/tags/admin", auth, mgr, (req, res) => res.json(adminTags()));
  app.post("/api/tags/admin", auth, mgr, wrap(async req => {
    const b = req.body || {}, name = String(b.name || "").trim().replace(/\s+/g, " ").slice(0, 30); if (!name) throw bad("Donne un nom au tag");
    const all = db.prepare("SELECT * FROM twizz_tags").all(); if (all.some(t => low(t.name) === low(name))) throw bad("Ce tag existe déjà");
    db.prepare("INSERT INTO twizz_tags (name, color, active, user_id, at) VALUES (?,?,1,?,?)").run(name, /^#[0-9a-f]{6}$/i.test(str(b.color)) ? str(b.color) : TAG_PAL[all.length % TAG_PAL.length], req.user.id, Date.now());
    return adminTags();
  }));
  app.post("/api/tags/admin/:id", auth, mgr, wrap(async req => {
    const t = db.prepare("SELECT * FROM twizz_tags WHERE id = ?").get(+req.params.id); if (!t) throw bad("Tag introuvable");
    const b = req.body || {}, name = b.name != null ? String(b.name).trim().replace(/\s+/g, " ").slice(0, 30) : t.name, color = /^#[0-9a-f]{6}$/i.test(str(b.color)) ? str(b.color) : t.color;
    if (!name) throw bad("Donne un nom au tag");
    if (low(name) !== low(t.name) && db.prepare("SELECT * FROM twizz_tags").all().some(x => x.id !== t.id && low(x.name) === low(name))) throw bad("Ce nom est déjà pris");
    let active = t.active, thr = t.thr;
    if (t.rule) { if (b.active != null) active = b.active ? 1 : 0; if (b.thr != null) { if (!isFinite(+b.thr) || +b.thr < 1 || +b.thr > THR_MAX[t.rule]) throw bad("Seuil invalide"); thr = Math.round(+b.thr * 100) / 100; } }
    db.prepare("UPDATE twizz_tags SET name = ?, color = ?, active = ?, thr = ? WHERE id = ?").run(name, color, active, thr, t.id);
    if (t.rule && (active !== t.active || thr !== t.thr)) applyAll();
    return adminTags();
  }));
  app.delete("/api/tags/admin/:id", auth, mgr, wrap(async req => {
    const t = db.prepare("SELECT * FROM twizz_tags WHERE id = ?").get(+req.params.id); if (!t) throw bad("Tag introuvable"); if (t.rule) throw bad("Un tag de règle se coupe, il ne se supprime pas");
    db.prepare("DELETE FROM twizz_fan_tags WHERE tag_id = ?").run(t.id); db.prepare("DELETE FROM twizz_tag_log WHERE tag_id = ?").run(t.id); db.prepare("DELETE FROM twizz_tags WHERE id = ?").run(t.id);
    return adminTags();
  }));

  /* ---------- scripts ---------- */
  // les managers et le fondateur gèrent la bibliothèque ; la messagerie (fondateur pour l'instant) s'en sert
  // un script = un déroulé d'étapes ; chaque étape : un message, des médias du coffre (payants ou non) et, si payant, une relance s'il n'achète pas
  const cleanMedia = M => (Array.isArray(M) ? M : []).slice(0, 20).map(f => ({ id: str(f && f.id), thumb: str(f && f.thumb).slice(0, 2000), url: str(f && f.url).slice(0, 2000), type: str(f && f.type).slice(0, 60),
    keys: (Array.isArray(f && f.keys) ? f.keys : []).map(str).filter(Boolean).slice(0, 8), album: str(f && f.album) })).filter(f => f.id);
  const cleanStep = x => { const media = cleanMedia(x && x.media), price = media.length && x.price != null && x.price !== "" && isFinite(+x.price) ? Math.max(0, Math.round(+x.price * 100) / 100) : null;
    return { text: String((x && x.text) || "").trim().slice(0, 2000), media, price, relance: media.length && price ? String((x && x.relance) || "").trim().slice(0, 2000) : "" }; };
  const stepsOf = r => { try { const L = JSON.parse(r.steps || "null"); if (Array.isArray(L) && L.length) return L; } catch (e) {}
    let media = []; try { media = JSON.parse(r.media || "[]") || []; } catch (e) {} return [{ text: r.body || "", media, price: r.price == null ? null : +r.price, relance: "" }]; };
  const scriptOut = r => ({ id: r.id, creator: r.creator_id || null, cat: r.cat || "", title: r.title || "", body: r.body || "", uses: r.uses || 0, by: r.by || null, pinned: !!r.pinned,
    source: r.source || "site", at: r.at || null, updatedAt: r.updated_at || r.at || null, updatedBy: r.ub || r.by || null, steps: stepsOf(r) });
  const SQL_LIST = "SELECT s.*, u.username by, v.username ub FROM twizz_scripts s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN users v ON v.id = s.updated_by";
  app.get("/api/twizz/scripts", auth, mgrOrInbox, (req, res) => {
    const cid = str(req.query.cid);
    res.json({ items: db.prepare(`${SQL_LIST} WHERE s.creator_id IS NULL OR s.creator_id = '' OR s.creator_id = ? ORDER BY s.pinned DESC, s.uses DESC, s.id DESC`).all(cid).map(scriptOut) });
  });
  // la bibliothèque complète pour la page Scripts : scripts, créatrices, usage des 14 derniers jours et par chatter
  app.get("/api/scripts/all", auth, mgr, (req, res) => {
    const since = Date.now() - 14 * 864e5, day = t => Math.floor((t - since) / 864e5);
    const items = db.prepare(`${SQL_LIST} ORDER BY s.pinned DESC, s.uses DESC, s.id DESC`).all().map(scriptOut);
    const U = db.prepare("SELECT k.script_id, k.at, u.username name FROM twizz_script_uses k LEFT JOIN users u ON u.id = k.user_id WHERE k.at > ?").all(since);
    const by = {}; U.forEach(r => { const o = by[r.script_id] || (by[r.script_id] = { days: Array(14).fill(0), who: {} }); const d = day(r.at); if (d >= 0 && d < 14) o.days[d]++; if (r.name) o.who[r.name] = (o.who[r.name] || 0) + 1; });
    items.forEach(x => { const o = by[x.id] || { days: Array(14).fill(0), who: {} }; x.days = o.days; x.week = o.days.slice(7).reduce((a, b) => a + b, 0); x.who = Object.entries(o.who).sort((a, b) => b[1] - a[1]).map(([n, k]) => ({ name: n, n: k })); });
    res.json({ items, creators: mapped().map(c => ({ id: c.id, label: c.label, note: c.note || "" })), twizzPath: S.get("twizz_scripts_path", "") || null });
  });
  const saveScript = (b, uid) => {
    const title = String(b.title || "").trim().slice(0, 80), cat = String(b.cat || "").trim().slice(0, 30), creator = b.creator ? creatorOk(str(b.creator)) : null;
    const old = b.id ? db.prepare("SELECT * FROM twizz_scripts WHERE id = ?").get(+b.id) : null;
    if (b.id && !old) throw bad("Script introuvable");
    if (old && b.pinned === undefined) b.pinned = !!old.pinned;
    // les étapes ; sans étapes envoyées (ancien format : un seul message), on garde celles déjà enregistrées
    const raw = Array.isArray(b.steps) ? b.steps : old && b.body === undefined ? stepsOf(old) : [{ text: b.body, media: b.media, price: b.price }];
    const steps = raw.slice(0, 15).map(cleanStep).filter(x => x.text || x.media.length);
    if (!steps.length) throw bad("Le script est vide : écris au moins une étape");
    if (steps.some(x => x.media.length) && !creator) throw bad("Un script avec des médias doit être pour une seule créatrice : les médias viennent de son coffre");
    const body = steps.map(x => x.text).filter(Boolean).join("\n\n").slice(0, 8000), sj = JSON.stringify(steps);
    if (old) { db.prepare("UPDATE twizz_scripts SET creator_id = ?, cat = ?, title = ?, body = ?, pinned = ?, steps = ?, media = NULL, price = NULL, updated_at = ?, updated_by = ? WHERE id = ?").run(creator, cat, title, body, b.pinned ? 1 : 0, sj, Date.now(), uid, old.id); return old.id; }
    return Number(db.prepare("INSERT INTO twizz_scripts (creator_id, cat, title, body, uses, user_id, at, updated_at, updated_by, source, ext_id, pinned, steps) VALUES (?,?,?,?,0,?,?,?,?,?,?,?,?)")
      .run(creator, cat, title, body, uid, Date.now(), Date.now(), uid, b.source || "site", b.ext ? str(b.ext) : null, b.pinned ? 1 : 0, sj).lastInsertRowid);
  };
  app.post("/api/twizz/scripts", auth, mgr, wrap(async req => ({ ok: true, id: saveScript(req.body || {}, req.user.id) })));
  app.post("/api/scripts/bulk", auth, mgr, wrap(async req => {
    const L = (req.body?.items || []).slice(0, 300); let n = 0;
    for (const x of L) { if (x.ext && db.prepare("SELECT 1 FROM twizz_scripts WHERE ext_id = ?").get(str(x.ext))) continue; try { saveScript({ ...x, id: null }, req.user.id); n++; } catch (e) {} }
    return { ok: true, added: n };
  }));
  app.post("/api/twizz/scripts/:id/use", auth, (req, res) => { db.prepare("UPDATE twizz_scripts SET uses = uses + 1 WHERE id = ?").run(+req.params.id);
    db.prepare("INSERT INTO twizz_script_uses (script_id, user_id, at) VALUES (?,?,?)").run(+req.params.id, req.user.id, Date.now()); res.json({ ok: true }); });
  // déroulé d'un script sur un fan : l'étape suivante à envoyer, le dernier PPV envoyé (pour proposer la relance s'il n'achète pas)
  const runOut = r => r ? { scriptId: r.script_id, step: r.step, ppvMsg: r.ppv_msg || null, ppvStep: r.ppv_step == null ? null : r.ppv_step, relanced: !!r.relanced, at: r.at, by: r.by || null } : null;
  const runGet = (cid, fan) => runOut(db.prepare("SELECT r.*, u.username by FROM twizz_script_runs r LEFT JOIN users u ON u.id = r.user_id WHERE r.creator_id = ? AND r.fan_id = ?").get(cid, fan));
  app.get("/api/twizz/inbox/:cid/run/:fan", auth, inbox, wrap(async req => ({ run: runGet(creatorOk(req.params.cid), str(req.params.fan)) })));
  app.post("/api/twizz/inbox/:cid/run/:fan", auth, inbox, wrap(async req => {
    const cid = creatorOk(req.params.cid), fan = str(req.params.fan), b = req.body || {}, sc = db.prepare("SELECT * FROM twizz_scripts WHERE id = ?").get(+b.script);
    if (!fan || !sc) throw bad("Script introuvable"); const n = stepsOf(sc).length, step = Math.max(0, Math.min(n, Math.round(+b.step || 0)));
    const cur = db.prepare("SELECT * FROM twizz_script_runs WHERE creator_id = ? AND fan_id = ?").get(cid, fan), same = cur && cur.script_id === sc.id;
    if (!same) { db.prepare("UPDATE twizz_scripts SET uses = uses + 1 WHERE id = ?").run(sc.id); db.prepare("INSERT INTO twizz_script_uses (script_id, user_id, at) VALUES (?,?,?)").run(sc.id, req.user.id, Date.now()); }
    const ppvMsg = b.ppvMsg !== undefined ? (b.ppvMsg ? str(b.ppvMsg) : null) : same ? cur.ppv_msg : null, ppvStep = b.ppvStep !== undefined ? (b.ppvStep == null ? null : +b.ppvStep) : same ? cur.ppv_step : null;
    const relanced = b.relanced !== undefined ? (b.relanced ? 1 : 0) : same && ppvMsg === cur.ppv_msg ? cur.relanced : 0;
    db.prepare("INSERT INTO twizz_script_runs (creator_id, fan_id, script_id, step, ppv_msg, ppv_step, relanced, user_id, at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(creator_id, fan_id) DO UPDATE SET script_id = excluded.script_id, step = excluded.step, ppv_msg = excluded.ppv_msg, ppv_step = excluded.ppv_step, relanced = excluded.relanced, user_id = excluded.user_id, at = excluded.at")
      .run(cid, fan, sc.id, step, ppvMsg, ppvStep, relanced, req.user.id, Date.now());
    return { run: runGet(cid, fan) };
  }));
  app.delete("/api/twizz/inbox/:cid/run/:fan", auth, inbox, wrap(async req => { db.prepare("DELETE FROM twizz_script_runs WHERE creator_id = ? AND fan_id = ?").run(creatorOk(req.params.cid), str(req.params.fan)); return { run: null }; }));
  app.delete("/api/twizz/scripts/:id", auth, mgr, (req, res) => { db.prepare("DELETE FROM twizz_scripts WHERE id = ?").run(+req.params.id); db.prepare("DELETE FROM twizz_script_uses WHERE script_id = ?").run(+req.params.id); db.prepare("DELETE FROM twizz_script_runs WHERE script_id = ?").run(+req.params.id); res.json({ ok: true }); });
  // import depuis Twizz : l'adresse des scripts n'est pas connue, on essaie quelques adresses possibles (une seule fois, à la demande)
  const SCRIPT_PATHS = ["/scripts?creatorId=%c", "/scripts/creator/%c", "/business/scripts?creatorId=%c", "/chat-scripts?creatorId=%c", "/message-scripts?creatorId=%c", "/messages/scripts?creatorId=%c",
    "/quick-messages?creatorId=%c", "/saved-messages?creatorId=%c", "/message-templates?creatorId=%c", "/templates?creatorId=%c", "/business/quick-replies?creatorId=%c", "/quick-replies?creatorId=%c"];
  const textOf = x => str(x && (x.text || x.content || x.message || x.body || x.script || x.value || ""));
  // un script Twizz : ses étapes si elles existent (noms de champs inconnus : on essaie les plus probables), sinon un seul message
  const twStep = x => ({ text: textOf(x).slice(0, 2000), media: arr(x.medias || x.quickFiles || x.files || x.media || []).map(file).filter(f => f.id), price: isFinite(+x.price) && x.price != null ? +x.price : null });
  const mapTw = (x, cid) => { const L = [x.steps, x.messages, x.sequence, x.items].find(a => Array.isArray(a) && a.length), steps = (L ? L.map(twStep) : [twStep(x)]).filter(s => s.text || s.media.length);
    return { ext: str(x._id || x.id || ""), title: str(x.title || x.name || x.label || "").slice(0, 80), body: steps.map(s => s.text).join("\n\n"), cat: str(x.category || x.folder || x.type || x.tag || "").slice(0, 30), creator: cid, steps }; };
  app.post("/api/scripts/import-twizz", auth, mgr, wrap(async req => {
    const C = mapped(); if (!C.length) throw bad("Teste d'abord la connexion Twizz");
    let path = S.get("twizz_scripts_path", "") || null; const tried = [];
    if (!path) for (const p of SCRIPT_PATHS) { tried.push(p.split("?")[0]);
      try { const j = await call("GET", p.replace("%c", enc(C[0].id)), null, true), L = arr(j); if (L.length && L.some(x => textOf(x))) { path = p; S.set("twizz_scripts_path", p); break; } } catch (e) {} }
    if (!path) return { found: false, tried };
    const items = []; for (const c of C) { try { const j = await call("GET", path.replace("%c", enc(c.id)), null, true); arr(j).map(x => mapTw(x, c.id)).filter(x => x.steps.length).forEach(x => items.push({ ...x, creatorLabel: c.label })); } catch (e) {} }
    const known = new Set(db.prepare("SELECT ext_id FROM twizz_scripts WHERE ext_id IS NOT NULL").all().map(r => r.ext_id));
    return { found: true, items: items.map(x => ({ ...x, already: !!(x.ext && known.has(x.ext)) })) };
  }));
  // l'IA réécrit un script en 3 variantes, dans le ton de la créatrice
  app.post("/api/scripts/ai", auth, mgr, wrap(async req => {
    if (!ai || !ai.scriptVariants) throw bad("Assistant IA indisponible");
    const b = req.body || {}, body = String(b.body || "").trim().slice(0, 2000); if (!body && !String(b.title || "").trim()) throw bad("Écris d'abord le script ou son titre");
    const cr = b.creator ? db.prepare("SELECT label, note FROM twizz_creators WHERE twizz_id = ?").get(str(b.creator)) : null;
    return await ai.scriptVariants({ body, title: String(b.title || "").slice(0, 80), cat: String(b.cat || "").slice(0, 30), goal: String(b.goal || "").slice(0, 40), creator: cr ? cr.label : "", rules: cr ? cr.note || "" : "" }, { user: req.user.id });
  }));

  /* ---------- assistant IA : 3 réponses proposées au chatter ---------- */
  const aiLast = new Map();
  app.post("/api/twizz/inbox/:cid/ai/:conv", auth, inbox, wrap(async req => {
    if (!ai || !ai.replies) throw bad("Assistant IA indisponible");
    const cid = creatorOk(req.params.cid), conv = str(req.params.conv), fan = str(req.body?.fan);
    const k = req.user.id + ":" + conv; if (Date.now() - (aiLast.get(k) || 0) < 4000) throw bad("Doucement : attends quelques secondes avant de redemander");
    aiLast.set(k, Date.now());
    const j = await G(`/messages/find-all-messages?conversationId=${enc(conv)}&creatorId=${enc(cid)}&page=1`, 15e3);
    let L = ((j && j.data && j.data.data) || []).map(m => msg(m, fan));
    // pas assez de messages de l'équipe pour connaître sa façon d'écrire : on lit la page d'avant
    if (L.filter(m => !m.fromFan && m.text).length < 8 && ((j && j.data && j.data.totalPages) || 1) > 1) {
      const j2 = await G(`/messages/find-all-messages?conversationId=${enc(conv)}&creatorId=${enc(cid)}&page=2`, 120e3).catch(() => null);
      L = L.concat(((j2 && j2.data && j2.data.data) || []).map(m => msg(m, fan))); }
    L = L.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-40);
    const line = m => m.type === "FILE" && !m.fromFan ? `[CRÉATRICE ENVOIE ${m.medias.length > 1 ? m.medias.length + " MÉDIAS" : "UN MÉDIA"}${m.price > 0 ? ` À ${m.price} € — ${m.status === "accepted" ? "acheté" : "pas encore acheté"}` : " GRATUIT"}]${m.text ? " " + m.text : ""}`
      : `[${m.fromFan ? "FAN" : "CRÉATRICE"}] ${m.text || (m.medias.length ? "(média)" : "")}`;
    const cr = db.prepare("SELECT label, note FROM twizz_creators WHERE twizz_id = ?").get(cid) || {};
    const note = db.prepare("SELECT text FROM twizz_fan_notes WHERE creator_id = ? AND fan_id = ?").get(cid, fan);
    let stats = ""; try { const sj = await G(`/business/get-fan-purchase-stats/${enc(fan)}?creatorId=${enc(cid)}`, 600e3), d = (sj && (sj.data ?? sj)) || {};
      const tk = Object.keys(d).find(x => /totalSpent|spent/i.test(x)), nk = Object.keys(d).find(x => /totalPurchases|purchases$/i.test(x));
      stats = [tk ? `a dépensé ${d[tk]} € au total` : "", nk ? `${d[nk]} achats` : ""].filter(Boolean).join(", "); } catch (e) {}
    const r = await ai.replies({ creator: cr.label || "la créatrice", rules: cr.note || "", note: note && note.text || "", fan: [str(req.body?.name), stats].filter(Boolean).join(", ") || "rien de particulier",
      transcript: L.map(line).filter(Boolean).join("\n") }, { user: req.user.id });
    return r;
  }));

  /* ---------- actions (bloquées tant que l'envoi n'est pas activé) ---------- */
  app.post("/api/twizz/inbox/:cid/send", auth, inbox, wrap(async req => {
    mustSend(req); const cid = creatorOk(req.params.cid), text = String(req.body?.text || "").trim().slice(0, 4000), conversationId = str(req.body?.conversationId);
    if (!text || !conversationId) throw bad("Message vide");
    const j = await call("POST", "/messages/send-message", { temp_id: `temp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`, conversationId, type: "TEXT", text, creatorId: cid }, true);
    if (j && j.data && j.data._id) db.prepare("INSERT INTO twizz_sent (msg_id, conv_id, fan_id, creator_id, user_id, price, at) VALUES (?,?,?,?,?,?,?)").run(str(j.data._id), conversationId, str(req.body?.fan), cid, req.user.id, null, Date.now());
    drop(conversationId, `/conversations/user/${enc(cid)}`);
    return { ok: true, message: j && j.data ? msg(j.data, str(req.body?.fan)) : null };
  }));
  // média du coffre envoyé dans la conversation, payant ou gratuit
  app.post("/api/twizz/inbox/:cid/send-media", auth, inbox, wrap(async req => {
    mustSend(req); const cid = creatorOk(req.params.cid), b = req.body || {};
    const conversationId = str(b.conversationId), fan = str(b.fan), files = (b.files || []).map(str).filter(Boolean).slice(0, 20), price = Math.max(0, Math.round((+b.price || 0) * 100) / 100);
    if (!conversationId || !fan || !files.length) throw bad("Choisis au moins un média");
    const f = new FormData();
    f.set("text", String(b.text || "").slice(0, 2000)); f.set("price", String(price)); f.set("expireTimeType", "UNLIMITED");
    f.set("isConversation", "true"); f.set("conversationId", conversationId); f.set("receivers", JSON.stringify([fan]));
    f.set("fileIds", "[]"); f.set("quickFiles", JSON.stringify(files.map(id => ({ id, isPrivate: true })))); f.set("creatorId", cid);
    const j = await call("POST", "/mediapush/conversation", f, true);
    const d = (j && j.data) || j || {}, nm = d.newMessage || null;
    if (!nm && d.message) throw bad("Twizz a refusé l'envoi : " + d.message);
    db.prepare("INSERT INTO twizz_sent (msg_id, conv_id, fan_id, creator_id, user_id, price, at, files) VALUES (?,?,?,?,?,?,?,?)").run(str(nm && nm._id), conversationId, fan, cid, req.user.id, price, Date.now(), JSON.stringify(files));
    if (b.acceptId) await call("PATCH", "/messages/update-message-status", { messageId: str(b.acceptId), action: "accepted", creatorId: cid, userType: "creator" }, true).catch(() => {});
    drop(conversationId, `/conversations/user/${enc(cid)}`);
    return { ok: true, message: nm ? msg(nm, fan) : null };
  }));
  // demande d'un fan : accepter (après envoi du contenu) ou refuser
  app.post("/api/twizz/inbox/:cid/request", auth, inbox, wrap(async req => {
    mustSend(req); const cid = creatorOk(req.params.cid), action = req.body?.action === "accepted" ? "accepted" : "refused";
    await call("PATCH", "/messages/update-message-status", { messageId: str(req.body?.messageId), action, creatorId: cid, userType: "creator" }, true); drop("find-all-messages", `/conversations/user/${enc(cid)}`); return { ok: true };
  }));
  // marquer une conversation comme lue (seulement quand on le demande)
  app.post("/api/twizz/inbox/:cid/read", auth, inbox, wrap(async req => {
    mustSend(req); const cid = creatorOk(req.params.cid);
    await call("PATCH", "/messages/read-all-messages", { conversationId: str(req.body?.conversationId), creatorId: cid }, true); drop(str(req.body?.conversationId), `/conversations/user/${enc(cid)}`); return { ok: true };
  }));
};
