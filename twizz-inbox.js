// Messagerie Twizz sur le site — VERSION DE TEST, réservée au fondateur.
// Le site relaie les conversations du CRM Twizz Business. Rien n'est marqué comme lu automatiquement,
// et l'envoi est bloqué tant que le fondateur n'a pas activé l'interrupteur « Envoi activé ».
module.exports = function mount(app, db, auth, admin, { twizz }) {
  const { call, S } = twizz;
  db.exec("CREATE TABLE IF NOT EXISTS twizz_fan_notes (creator_id TEXT, fan_id TEXT, text TEXT, user_id INTEGER, at INTEGER, PRIMARY KEY (creator_id, fan_id))");
  if (!db.prepare("PRAGMA table_info(twizz_sent)").all().some(x => x.name === "files")) db.exec("ALTER TABLE twizz_sent ADD COLUMN files TEXT");
  const founder = (req, res, next) => req.user.rk === "founder" && !req.viewAs ? next() : res.status(403).json({ error: "Messagerie en test : réservée au fondateur" });
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
  function conv(c, cid) {
    const fanRaw = c.interlocutor || c.fan || c.user || (Array.isArray(c.participants) ? c.participants.find(x => str(x._id || x.userId) !== cid) : null) || {};
    const fan = person(fanRaw), last = c.lastMessage || c.last_message || {};
    return { id: str(c._id || c.id), fan, last: { id: str(last._id || ""), text: str(last.text || ""), type: str(last.type || ""), at: last.createdAt || c.updatedAt || c.createdAt || null, fromFan: !!fan.id && str(last.senderId) === fan.id },
      unread: +(c.unreadCount ?? c.unread ?? c.unreadMessages ?? 0) || 0, type: str(c.type || ""), tags: (c.tags || []).map(t => str(t.name || t.label || t)).filter(Boolean) };
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
  app.get("/api/twizz/inbox/state", auth, founder, (req, res) => res.json({ send: sendOn(), creators: mapped(), configured: twizz.configured() }));
  app.post("/api/twizz/inbox/state", auth, founder, (req, res) => { if (typeof req.body?.send === "boolean") S.set("twizz_inbox_send", req.body.send); res.json({ send: sendOn() }); });
  app.get("/api/twizz/inbox/:cid/unread", auth, founder, wrap(async req => { const cid = creatorOk(req.params.cid);
    const j = await G(`/conversations/stats/get-unread-by-types?creatorId=${enc(cid)}`); return { raw: j && (j.data ?? j) }; }));
  app.get("/api/twizz/inbox/:cid/conversations", auth, founder, wrap(async req => {
    const cid = creatorOk(req.params.cid), type = ["GENERAL", "TO_DELIVER"].includes(req.query.type) ? req.query.type : "GENERAL", page = Math.max(1, +req.query.page || 1);
    const q = String(req.query.q || "").trim().slice(0, 60);
    const fresh = req.query.fresh === "1"; if (fresh) drop(`/conversations/user/${enc(cid)}?page=${page}&type=${type}`);
    const j = q ? await G(`/conversations/user/${enc(cid)}/search?search=${enc(q)}`, 10e3) : await G(`/conversations/user/${enc(cid)}?page=${page}&type=${type}&creatorId=${enc(cid)}`, 20e3);
    const d = j && j.data, items = arr(j).map(c => conv(c, cid));
    const by = authors(items.filter(c => !c.last.fromFan).map(c => c.last.id)); items.forEach(c => { c.last.by = by[c.last.id] || null; });
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
  app.get("/api/twizz/inbox/:cid/vault", auth, founder, wrap(async req => {
    const cid = creatorOk(req.params.cid), j = await G(`/quick-files/albums?creatorId=${enc(cid)}`, 300e3);
    return { albums: arr(j).map(a => ({ id: str(a._id || a.id), name: str(a.name || a.title || "Album"), count: +(a.filesCount ?? a.count ?? (a.files || []).length ?? 0) || 0,
      cover: file((a.files || [])[0] || a.cover || {}).thumb })), sample: req.query.debug ? arr(j)[0] : undefined };
  }));
  app.get("/api/twizz/inbox/:cid/vault/:album", auth, founder, wrap(async req => {
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
