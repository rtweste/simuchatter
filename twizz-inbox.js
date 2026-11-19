// Messagerie Twizz sur le site — VERSION DE TEST, réservée au fondateur.
// Le site relaie les conversations du CRM Twizz Business. Rien n'est marqué comme lu automatiquement,
// et l'envoi est bloqué tant que le fondateur n'a pas activé l'interrupteur « Envoi activé ».
module.exports = function mount(app, db, auth, admin, { twizz, ai }) {
  const { call, S } = twizz;
  db.exec("CREATE TABLE IF NOT EXISTS twizz_fan_notes (creator_id TEXT, fan_id TEXT, text TEXT, user_id INTEGER, at INTEGER, PRIMARY KEY (creator_id, fan_id))");
  if (!db.prepare("PRAGMA table_info(twizz_sent)").all().some(x => x.name === "files")) db.exec("ALTER TABLE twizz_sent ADD COLUMN files TEXT");
  // scripts : messages tout prêts, pour toutes les créatrices (creator_id vide) ou une seule
  db.exec("CREATE TABLE IF NOT EXISTS twizz_scripts (id INTEGER PRIMARY KEY, creator_id TEXT, cat TEXT, title TEXT, body TEXT, uses INTEGER DEFAULT 0, user_id INTEGER, at INTEGER)");
  for (const [c, t] of [["updated_at", "INTEGER"], ["updated_by", "INTEGER"], ["source", "TEXT"], ["ext_id", "TEXT"], ["pinned", "INTEGER DEFAULT 0"], ["media", "TEXT"], ["price", "REAL"]])
    if (!db.prepare("PRAGMA table_info(twizz_scripts)").all().some(x => x.name === c)) db.exec(`ALTER TABLE twizz_scripts ADD COLUMN ${c} ${t}`);
  db.exec("CREATE TABLE IF NOT EXISTS twizz_script_uses (script_id INTEGER, user_id INTEGER, at INTEGER)");
  const founder = (req, res, next) => req.user.rk === "founder" && !req.viewAs ? next() : res.status(403).json({ error: "Messagerie en test : réservée au fondateur" });
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
  const mustSend = () => { if (!sendOn()) throw bad("L'envoi est coupé : active « Envoi activé » en haut de la messagerie"); };

  /* ---------- mise en forme (tolérante : le format Twizz n'est pas documenté) ---------- */
  const person = p => { p = p || {}; const full = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
    return { id: str(p.userId || p._id || p.id), name: str(p.name || full || p.username || "Fan"), username: str(p.username || ""), avatar: str(p.avatar || p.avatarPath || p.avatarUrl || "") }; };
  // non lus : Twizz ne documente pas le nom du champ ; on essaie les noms connus, puis « dernier message du fan pas encore lu »
  const UNREAD_KEYS = ["unreadCount", "unread", "unreadMessages", "unreadMessagesCount", "unread_count", "unreadMessageCount", "countUnread", "nbUnread", "creatorUnreadCount", "unreadCountCreator", "unreadByCreator", "newMessages", "newMessagesCount"];
  function unreadOf(c, cid, fanId, last) {
    for (const k of UNREAD_KEYS) { const v = c[k]; if (typeof v === "number") return v; if (v && typeof v === "object" && typeof v[cid] === "number") return v[cid]; }
    const fromFan = !!fanId && str(last.senderId || (last.sender && (last.sender._id || last.sender.id))) === fanId;
    for (const k of ["isRead", "read", "seen", "isSeen", "readByCreator"]) if (typeof last[k] === "boolean") return fromFan && !last[k] ? 1 : 0;
    for (const k of ["isRead", "read", "seen", "isSeen"]) if (typeof c[k] === "boolean") return fromFan && !c[k] ? 1 : 0;
    for (const [k, v] of Object.entries(c)) if (/unread|nonlu|notread|unseen/i.test(k) && typeof v === "number") return v;
    return 0;
  }
  function conv(c, cid) {
    const fanRaw = c.interlocutor || c.fan || c.user || (Array.isArray(c.participants) ? c.participants.find(x => str(x._id || x.userId) !== cid) : null) || {};
    const fan = person(fanRaw), last = c.lastMessage || c.last_message || {};
    return { id: str(c._id || c.id), fan, last: { id: str(last._id || ""), text: str(last.text || ""), type: str(last.type || ""), at: last.createdAt || c.updatedAt || c.createdAt || null, fromFan: !!fan.id && str(last.senderId) === fan.id },
      unread: unreadOf(c, cid, fan.id, last), type: str(c.type || ""), tags: (c.tags || []).map(t => str(t.name || t.label || t)).filter(Boolean) };
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
  app.get("/api/twizz/inbox/stream", auth, founder, (req, res) => {
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
    return { conversation: shape(x), unreadDetected: conv(x, c0.id).unread };
  }));
  app.get("/api/twizz/inbox/state", auth, founder, (req, res) => res.json({ send: sendOn(), creators: mapped(), configured: twizz.configured() }));
  app.post("/api/twizz/inbox/state", auth, founder, (req, res) => { if (typeof req.body?.send === "boolean") S.set("twizz_inbox_send", req.body.send); res.json({ send: sendOn() }); });
  // non lus d'une créatrice : nombre de conversations non lues, lu dans sa liste (même requête et même cache que la liste)
  app.get("/api/twizz/inbox/:cid/unread", auth, founder, wrap(async req => { const cid = creatorOk(req.params.cid);
    const j = await G(`/conversations/user/${enc(cid)}?page=1&type=GENERAL&creatorId=${enc(cid)}`, 60e3);
    return { count: arr(j).map(c => conv(c, cid)).filter(c => c.unread > 0).length }; }));
  app.get("/api/twizz/inbox/:cid/conversations", auth, founder, wrap(async req => {
    const cid = creatorOk(req.params.cid), type = ["GENERAL", "TO_DELIVER"].includes(req.query.type) ? req.query.type : "GENERAL", page = Math.max(1, +req.query.page || 1);
    const q = String(req.query.q || "").trim().slice(0, 60);
    const fresh = req.query.fresh === "1"; if (fresh) drop(`/conversations/user/${enc(cid)}?page=${page}&type=${type}`);
    const j = q ? await G(`/conversations/user/${enc(cid)}/search?search=${enc(q)}`, 10e3) : await G(`/conversations/user/${enc(cid)}?page=${page}&type=${type}&creatorId=${enc(cid)}`, 20e3);
    const d = j && j.data, items = arr(j).map(c => conv(c, cid));
    const by = authors(items.filter(c => !c.last.fromFan).map(c => c.last.id));
    const near = db.prepare("SELECT u.username name, s.at FROM twizz_sent s JOIN users u ON u.id = s.user_id WHERE s.conv_id = ? ORDER BY s.at DESC LIMIT 1");
    items.forEach(c => { if (c.last.fromFan) return; c.last.by = by[c.last.id] || null;
      if (!c.last.by && c.last.at) { const r = near.get(c.id); if (r && Math.abs(r.at - Date.parse(c.last.at)) < 120e3) c.last.by = r.name; } });
    return { items, page, more: !!(d && (d.totalPages ? page < d.totalPages : arr(j).length >= 10)), sample: req.query.debug ? arr(j)[0] : undefined };
  }));
  app.get("/api/twizz/inbox/:cid/messages/:conv", auth, founder, wrap(async req => {
    const cid = creatorOk(req.params.cid), page = Math.max(1, +req.query.page || 1), fanId = str(req.query.fan);
    const path = `/messages/find-all-messages?conversationId=${enc(req.params.conv)}&creatorId=${enc(cid)}&page=${page}`;
    if (req.query.fresh === "1") drop(path);
    const j = await G(path, 15e3);
    const d = (j && j.data) || {}, L = (d.data || []).map(m => msg(m, fanId)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const by = authors(L.filter(m => !m.fromFan).map(m => m.id)); L.forEach(m => { if (!m.fromFan) m.by = by[m.id] || null; });
    return { items: L, page, totalPages: d.totalPages || 1, note: d.creatorFanNote || null, sample: req.query.debug ? (d.data || [])[0] : undefined };
  }));
  app.get("/api/twizz/inbox/:cid/fan/:fan", auth, founder, wrap(async req => {
    const cid = creatorOk(req.params.cid), fan = enc(req.params.fan);
    const [stats, tags, recent] = await Promise.all([G(`/business/get-fan-purchase-stats/${fan}?creatorId=${enc(cid)}`, 120e3).catch(e => ({ error: e.message })),
      G(`/creator-fan-tags/${fan}?creatorId=${enc(cid)}`, 120e3).catch(() => null), G(`/creator-fan-tags/recent-purchase?fanId=${fan}&creatorId=${enc(cid)}`, 120e3).catch(() => null)]);
    // on garde les chiffres et textes courts, quelle que soit la forme exacte de la réponse
    const flat = {}; const walk = (o, pre) => { if (!o || typeof o !== "object") return; for (const [k, v] of Object.entries(o)) { if (["_id", "__v", "fanId", "creatorId"].includes(k)) continue;
      if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length < 40)) flat[pre + k] = v; else if (v && typeof v === "object" && !Array.isArray(v) && pre.split(".").length < 3) walk(v, pre + k + "."); } };
    walk(stats && (stats.data ?? stats), "");
    // derniers achats : on garde montant, type et date, quel que soit le nom exact des champs
    const rec = arr(recent).slice(0, 8).map(x => ({ amount: +(x.netPrice ?? x.amount ?? x.price ?? x.total ?? 0) || 0, type: str(x.type || x.category || x.kind || ""), at: x.createdAt || x.date || x.purchasedAt || null })).filter(x => x.amount > 0);
    return { stats: flat, error: stats && stats.error, tags: arr(tags).map(t => ({ name: str(t.name || t.label || t.tag || t), color: str(t.color || "") })).filter(t => t.name), recent: rec };
  }));
  // coffre de la créatrice (albums « quick-files » de Twizz)
  app.get("/api/twizz/inbox/:cid/vault", auth, mgr, wrap(async req => {
    const cid = creatorOk(req.params.cid), j = await G(`/quick-files/albums?creatorId=${enc(cid)}`, 300e3);
    return { albums: arr(j).map(a => ({ id: str(a._id || a.id), name: str(a.name || a.title || "Album"), count: +(a.filesCount ?? a.count ?? (a.files || []).length ?? 0) || 0,
      cover: file((a.files || [])[0] || a.cover || {}).thumb })), sample: req.query.debug ? arr(j)[0] : undefined };
  }));
  app.get("/api/twizz/inbox/:cid/vault/:album", auth, mgr, wrap(async req => {
    const cid = creatorOk(req.params.cid), j = await G(`/quick-files/album/${enc(req.params.album)}?creatorId=${enc(cid)}`, 300e3);
    const d = j && (j.data ?? j), L = Array.isArray(d) ? d : (d && (d.files || d.quickFiles || d.items)) || [];
    return { files: L.map(file).filter(f => f.id), sample: req.query.debug ? L[0] : undefined };
  }));

  // historique d'un fan : médias envoyés (achetés ou pas), qui les a envoyés, l'équipe sur ce fan, la note d'équipe
  // (3 pages de messages au plus, gardées 2 min : peu de requêtes vers Twizz)
  app.get("/api/twizz/inbox/:cid/history/:conv", auth, founder, wrap(async req => {
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
    const tw = twNote && (twNote.note || twNote.text || twNote.content || (typeof twNote === "string" ? twNote : "")) || "";
    return { items, siteFiles: site, team: Object.values(team).sort((a, b) => b.amount - a.amount || b.msgs - a.msgs), note, twizzNote: str(tw), partial: pages > 3 };
  }));
  // note d'équipe sur un fan : enregistrée sur le site seulement (rien n'est écrit chez Twizz)
  app.post("/api/twizz/inbox/:cid/note/:fan", auth, founder, wrap(async req => {
    const cid = creatorOk(req.params.cid), fan = str(req.params.fan), text = String(req.body?.text || "").trim().slice(0, 1000), at = Date.now();
    if (!fan) throw bad("Fan inconnu");
    db.prepare("INSERT INTO twizz_fan_notes (creator_id, fan_id, text, user_id, at) VALUES (?,?,?,?,?) ON CONFLICT(creator_id, fan_id) DO UPDATE SET text = excluded.text, user_id = excluded.user_id, at = excluded.at").run(cid, fan, text, req.user.id, at);
    return { ok: true, note: { text, at, by: req.user.username } };
  }));
  // total dépensé d'un fan (pour classer la file « À traiter »), gardé 10 min
  app.get("/api/twizz/inbox/:cid/spend/:fan", auth, founder, wrap(async req => {
    const cid = creatorOk(req.params.cid), j = await G(`/business/get-fan-purchase-stats/${enc(req.params.fan)}?creatorId=${enc(cid)}`, 600e3), d = (j && (j.data ?? j)) || {};
    const k = Object.keys(d).find(k => /totalSpent|spent/i.test(k)); return { total: k ? +d[k] || 0 : null };
  }));

  /* ---------- scripts ---------- */
  // les managers et le fondateur gèrent la bibliothèque ; la messagerie (fondateur pour l'instant) s'en sert
  const scriptOut = r => ({ id: r.id, creator: r.creator_id || null, cat: r.cat || "", title: r.title || "", body: r.body || "", uses: r.uses || 0, by: r.by || null, pinned: !!r.pinned,
    source: r.source || "site", at: r.at || null, updatedAt: r.updated_at || r.at || null, updatedBy: r.ub || r.by || null,
    media: (() => { try { return JSON.parse(r.media || "[]"); } catch (e) { return []; } })(), price: r.price == null ? null : +r.price });
  const SQL_LIST = "SELECT s.*, u.username by, v.username ub FROM twizz_scripts s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN users v ON v.id = s.updated_by";
  app.get("/api/twizz/scripts", auth, mgr, (req, res) => {
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
    const title = String(b.title || "").trim().slice(0, 80), body = String(b.body || "").trim().slice(0, 2000), cat = String(b.cat || "").trim().slice(0, 30);
    const creator = b.creator ? creatorOk(str(b.creator)) : null;
    // la messagerie modifie un script sans connaître ses médias ni son épingle : on garde ceux déjà enregistrés
    const old = b.id ? db.prepare("SELECT media, price, pinned FROM twizz_scripts WHERE id = ?").get(+b.id) : null;
    if (old && b.media === undefined) { try { b.media = JSON.parse(old.media || "[]"); } catch (e) { b.media = []; } b.price = old.price; }
    if (old && b.pinned === undefined) b.pinned = !!old.pinned;
    // médias du coffre joints au script (envoyés payants ou gratuits depuis la messagerie) : forcément ceux d'une seule créatrice
    const media = (Array.isArray(b.media) ? b.media : []).slice(0, 20).map(f => ({ id: str(f && f.id), thumb: str(f && f.thumb).slice(0, 2000), url: str(f && f.url).slice(0, 2000), type: str(f && f.type).slice(0, 60),
      keys: (Array.isArray(f && f.keys) ? f.keys : []).map(str).filter(Boolean).slice(0, 8), album: str(f && f.album) })).filter(f => f.id);
    const price = media.length && b.price != null && b.price !== "" && isFinite(+b.price) ? Math.max(0, Math.round(+b.price * 100) / 100) : null;
    if (!body && !media.length) throw bad("Le script est vide");
    if (media.length && !creator) throw bad("Un script avec des médias doit être pour une seule créatrice : les médias viennent de son coffre");
    const mj = media.length ? JSON.stringify(media) : null;
    if (b.id) { db.prepare("UPDATE twizz_scripts SET creator_id = ?, cat = ?, title = ?, body = ?, pinned = ?, media = ?, price = ?, updated_at = ?, updated_by = ? WHERE id = ?").run(creator, cat, title, body, b.pinned ? 1 : 0, mj, price, Date.now(), uid, +b.id); return +b.id; }
    return Number(db.prepare("INSERT INTO twizz_scripts (creator_id, cat, title, body, uses, user_id, at, updated_at, updated_by, source, ext_id, pinned, media, price) VALUES (?,?,?,?,0,?,?,?,?,?,?,?,?,?)")
      .run(creator, cat, title, body, uid, Date.now(), Date.now(), uid, b.source || "site", b.ext ? str(b.ext) : null, b.pinned ? 1 : 0, mj, price).lastInsertRowid);
  };
  app.post("/api/twizz/scripts", auth, mgr, wrap(async req => ({ ok: true, id: saveScript(req.body || {}, req.user.id) })));
  app.post("/api/scripts/bulk", auth, mgr, wrap(async req => {
    const L = (req.body?.items || []).slice(0, 300); let n = 0;
    for (const x of L) { if (x.ext && db.prepare("SELECT 1 FROM twizz_scripts WHERE ext_id = ?").get(str(x.ext))) continue; try { saveScript({ ...x, id: null }, req.user.id); n++; } catch (e) {} }
    return { ok: true, added: n };
  }));
  app.post("/api/twizz/scripts/:id/use", auth, (req, res) => { db.prepare("UPDATE twizz_scripts SET uses = uses + 1 WHERE id = ?").run(+req.params.id);
    db.prepare("INSERT INTO twizz_script_uses (script_id, user_id, at) VALUES (?,?,?)").run(+req.params.id, req.user.id, Date.now()); res.json({ ok: true }); });
  app.delete("/api/twizz/scripts/:id", auth, mgr, (req, res) => { db.prepare("DELETE FROM twizz_scripts WHERE id = ?").run(+req.params.id); db.prepare("DELETE FROM twizz_script_uses WHERE script_id = ?").run(+req.params.id); res.json({ ok: true }); });
  // import depuis Twizz : l'adresse des scripts n'est pas connue, on essaie quelques adresses possibles (une seule fois, à la demande)
  const SCRIPT_PATHS = ["/scripts?creatorId=%c", "/scripts/creator/%c", "/business/scripts?creatorId=%c", "/chat-scripts?creatorId=%c", "/message-scripts?creatorId=%c", "/messages/scripts?creatorId=%c",
    "/quick-messages?creatorId=%c", "/saved-messages?creatorId=%c", "/message-templates?creatorId=%c", "/templates?creatorId=%c", "/business/quick-replies?creatorId=%c", "/quick-replies?creatorId=%c"];
  const textOf = x => str(x && (x.text || x.content || x.message || x.body || x.script || x.value || ""));
  const mapTw = (x, cid) => ({ ext: str(x._id || x.id || ""), title: str(x.title || x.name || x.label || "").slice(0, 80), body: textOf(x).slice(0, 2000), cat: str(x.category || x.folder || x.type || x.tag || "").slice(0, 30), creator: cid,
    media: arr(x.medias || x.quickFiles || x.files || x.media || []).map(file).filter(f => f.id), price: isFinite(+x.price) && x.price != null ? +x.price : null });
  app.post("/api/scripts/import-twizz", auth, mgr, wrap(async req => {
    const C = mapped(); if (!C.length) throw bad("Teste d'abord la connexion Twizz");
    let path = S.get("twizz_scripts_path", "") || null; const tried = [];
    if (!path) for (const p of SCRIPT_PATHS) { tried.push(p.split("?")[0]);
      try { const j = await call("GET", p.replace("%c", enc(C[0].id)), null, true), L = arr(j); if (L.length && L.some(x => textOf(x))) { path = p; S.set("twizz_scripts_path", p); break; } } catch (e) {} }
    if (!path) return { found: false, tried };
    const items = []; for (const c of C) { try { const j = await call("GET", path.replace("%c", enc(c.id)), null, true); arr(j).map(x => mapTw(x, c.id)).filter(x => x.body || x.media.length).forEach(x => items.push({ ...x, creatorLabel: c.label })); } catch (e) {} }
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
  app.post("/api/twizz/inbox/:cid/ai/:conv", auth, founder, wrap(async req => {
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
  app.post("/api/twizz/inbox/:cid/send", auth, founder, wrap(async req => {
    mustSend(); const cid = creatorOk(req.params.cid), text = String(req.body?.text || "").trim().slice(0, 4000), conversationId = str(req.body?.conversationId);
    if (!text || !conversationId) throw bad("Message vide");
    const j = await call("POST", "/messages/send-message", { temp_id: `temp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`, conversationId, type: "TEXT", text, creatorId: cid }, true);
    if (j && j.data && j.data._id) db.prepare("INSERT INTO twizz_sent (msg_id, conv_id, fan_id, creator_id, user_id, price, at) VALUES (?,?,?,?,?,?,?)").run(str(j.data._id), conversationId, str(req.body?.fan), cid, req.user.id, null, Date.now());
    drop(conversationId, `/conversations/user/${enc(cid)}`);
    return { ok: true, message: j && j.data ? msg(j.data, str(req.body?.fan)) : null };
  }));
  // média du coffre envoyé dans la conversation, payant ou gratuit
  app.post("/api/twizz/inbox/:cid/send-media", auth, founder, wrap(async req => {
    mustSend(); const cid = creatorOk(req.params.cid), b = req.body || {};
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
  app.post("/api/twizz/inbox/:cid/request", auth, founder, wrap(async req => {
    mustSend(); const cid = creatorOk(req.params.cid), action = req.body?.action === "accepted" ? "accepted" : "refused";
    await call("PATCH", "/messages/update-message-status", { messageId: str(req.body?.messageId), action, creatorId: cid, userType: "creator" }, true); drop("find-all-messages", `/conversations/user/${enc(cid)}`); return { ok: true };
  }));
  // marquer une conversation comme lue (seulement quand on le demande)
  app.post("/api/twizz/inbox/:cid/read", auth, founder, wrap(async req => {
    mustSend(); const cid = creatorOk(req.params.cid);
    await call("PATCH", "/messages/read-all-messages", { conversationId: str(req.body?.conversationId), creatorId: cid }, true); drop(str(req.body?.conversationId), `/conversations/user/${enc(cid)}`); return { ok: true };
  }));
};
