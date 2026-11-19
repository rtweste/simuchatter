// Messagerie Twizz sur le site — VERSION DE TEST, réservée au fondateur.
// Le site relaie les conversations du CRM Twizz Business. Rien n'est marqué comme lu automatiquement,
// et l'envoi est bloqué tant que le fondateur n'a pas activé l'interrupteur « Envoi activé ».
module.exports = function mount(app, db, auth, admin, { twizz }) {
  const { call, S } = twizz;
  const founder = (req, res, next) => req.user.rk === "founder" && !req.viewAs ? next() : res.status(403).json({ error: "Messagerie en test : réservée au fondateur" });
  const G = (path) => call("GET", path, null, true);
  const enc = encodeURIComponent;
  const arr = j => { const d = j && (j.data !== undefined ? j.data : j); if (Array.isArray(d)) return d; if (d && Array.isArray(d.data)) return d.data;
    for (const k of ["conversations", "items", "results", "albums", "files", "list"]) if (d && Array.isArray(d[k])) return d[k]; return []; };
  const str = v => (v == null ? "" : String(v));
  const wrap = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.twizz ? 502 : e.status || 500).json({ error: e.message }); } };
  const bad = msg => { const e = new Error(msg); e.status = 400; return e; };
  const mapped = () => db.prepare("SELECT t.twizz_id id, t.label, t.model_id, m.name model FROM twizz_creators t LEFT JOIN models m ON m.id = t.model_id ORDER BY t.label").all();
  const creatorOk = cid => { if (!db.prepare("SELECT 1 FROM twizz_creators WHERE twizz_id = ?").get(cid)) throw bad("Créatrice inconnue : teste d'abord la connexion Twizz"); return cid; };
  const sendOn = () => !!S.get("twizz_inbox_send", false);
  const mustSend = () => { if (!sendOn()) throw bad("L'envoi est coupé : active « Envoi activé » en haut de la messagerie"); };

  /* ---------- mise en forme (tolérante : le format Twizz n'est pas documenté) ---------- */
  const person = p => { p = p || {}; const full = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
    return { id: str(p.userId || p._id || p.id), name: str(p.name || full || p.username || "Fan"), username: str(p.username || ""), avatar: str(p.avatar || p.avatarPath || p.avatarUrl || "") }; };
  function conv(c, cid) {
    const fanRaw = c.interlocutor || c.fan || c.user || (Array.isArray(c.participants) ? c.participants.find(x => str(x._id || x.userId) !== cid) : null) || {};
    const fan = person(fanRaw), last = c.lastMessage || c.last_message || {};
    return { id: str(c._id || c.id), fan, last: { text: str(last.text || ""), type: str(last.type || ""), at: last.createdAt || c.updatedAt || c.createdAt || null, fromFan: !!fan.id && str(last.senderId) === fan.id },
      unread: +(c.unreadCount ?? c.unread ?? c.unreadMessages ?? 0) || 0, type: str(c.type || ""), tags: (c.tags || []).map(t => str(t.name || t.label || t)).filter(Boolean) };
  }
  function msg(m, fanId) {
    const p = m.mediaPushPrice || {};
    return { id: str(m._id), fromFan: !!fanId && str(m.senderId) === fanId, sender: str(m.senderId), type: str(m.type), text: str(m.text), status: str(m.status), at: m.createdAt,
      read: !!m.isRead, price: p.resultPrice ?? p.price ?? null, mediaPushId: str(m.mediaPushId || ""),
      medias: (m.medias || []).map(x => ({ url: str(x.url), thumb: str((x.thumbnails && (x.thumbnails.small || x.thumbnails.medium || x.thumbnails[0])) || x.thumbnail || ""), audio: !!x.isAudio, private: !!x.isPrivate })) };
  }
  const file = f => ({ id: str(f._id || f.id || f.fileId), url: str(f.url || f.Location || f.path || ""), thumb: str((f.thumbnails && (f.thumbnails.small || f.thumbnails.medium || f.thumbnails[0])) || f.thumbnail || f.thumbUrl || f.url || ""),
    type: str(f.type || f.mimeType || f.fileType || ""), name: str(f.originalFileName || f.name || f.filename || "") });

  /* ---------- lecture ---------- */
  app.get("/api/twizz/inbox/state", auth, founder, (req, res) => res.json({ send: sendOn(), creators: mapped(), configured: twizz.configured() }));
  app.post("/api/twizz/inbox/state", auth, founder, (req, res) => { if (typeof req.body?.send === "boolean") S.set("twizz_inbox_send", req.body.send); res.json({ send: sendOn() }); });
  app.get("/api/twizz/inbox/:cid/unread", auth, founder, wrap(async req => { const cid = creatorOk(req.params.cid);
    const j = await G(`/conversations/stats/get-unread-by-types?creatorId=${enc(cid)}`); return { raw: j && (j.data ?? j) }; }));
  app.get("/api/twizz/inbox/:cid/conversations", auth, founder, wrap(async req => {
    const cid = creatorOk(req.params.cid), type = ["GENERAL", "TO_DELIVER"].includes(req.query.type) ? req.query.type : "GENERAL", page = Math.max(1, +req.query.page || 1);
    const q = String(req.query.q || "").trim().slice(0, 60);
    const j = q ? await G(`/conversations/user/${enc(cid)}/search?search=${enc(q)}`) : await G(`/conversations/user/${enc(cid)}?page=${page}&type=${type}&creatorId=${enc(cid)}`);
    const d = j && j.data; return { items: arr(j).map(c => conv(c, cid)), page, more: !!(d && (d.totalPages ? page < d.totalPages : arr(j).length >= 10)), sample: req.query.debug ? arr(j)[0] : undefined };
  }));
  app.get("/api/twizz/inbox/:cid/messages/:conv", auth, founder, wrap(async req => {
    const cid = creatorOk(req.params.cid), page = Math.max(1, +req.query.page || 1), fanId = str(req.query.fan);
    const j = await G(`/messages/find-all-messages?conversationId=${enc(req.params.conv)}&creatorId=${enc(cid)}&page=${page}`);
    const d = (j && j.data) || {}, L = (d.data || []).map(m => msg(m, fanId)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return { items: L, page, totalPages: d.totalPages || 1, note: d.creatorFanNote || null, sample: req.query.debug ? (d.data || [])[0] : undefined };
  }));
  app.get("/api/twizz/inbox/:cid/fan/:fan", auth, founder, wrap(async req => {
    const cid = creatorOk(req.params.cid), fan = enc(req.params.fan);
    const [stats, tags] = [await G(`/business/get-fan-purchase-stats/${fan}?creatorId=${enc(cid)}`).catch(e => ({ error: e.message })), await G(`/creator-fan-tags/${fan}?creatorId=${enc(cid)}`).catch(() => null)];
    // on garde les chiffres et textes courts, quelle que soit la forme exacte de la réponse
    const flat = {}; const walk = (o, pre) => { if (!o || typeof o !== "object") return; for (const [k, v] of Object.entries(o)) { if (["_id", "__v", "fanId", "creatorId"].includes(k)) continue;
      if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length < 40)) flat[pre + k] = v; else if (v && typeof v === "object" && !Array.isArray(v) && pre.split(".").length < 3) walk(v, pre + k + "."); } };
    walk(stats && (stats.data ?? stats), "");
    return { stats: flat, error: stats && stats.error, tags: arr(tags).map(t => str(t.name || t.label || t.tag || t)).filter(Boolean) };
  }));
  // coffre de la créatrice (albums « quick-files » de Twizz)
  app.get("/api/twizz/inbox/:cid/vault", auth, founder, wrap(async req => {
    const cid = creatorOk(req.params.cid), j = await G(`/quick-files/albums?creatorId=${enc(cid)}`);
    return { albums: arr(j).map(a => ({ id: str(a._id || a.id), name: str(a.name || a.title || "Album"), count: +(a.filesCount ?? a.count ?? (a.files || []).length ?? 0) || 0,
      cover: file((a.files || [])[0] || a.cover || {}).thumb })), sample: req.query.debug ? arr(j)[0] : undefined };
  }));
  app.get("/api/twizz/inbox/:cid/vault/:album", auth, founder, wrap(async req => {
    const cid = creatorOk(req.params.cid), j = await G(`/quick-files/album/${enc(req.params.album)}?creatorId=${enc(cid)}`);
    const d = j && (j.data ?? j), L = Array.isArray(d) ? d : (d && (d.files || d.quickFiles || d.items)) || [];
    return { files: L.map(file).filter(f => f.id), sample: req.query.debug ? L[0] : undefined };
  }));

  /* ---------- actions (bloquées tant que l'envoi n'est pas activé) ---------- */
  app.post("/api/twizz/inbox/:cid/send", auth, founder, wrap(async req => {
    mustSend(); const cid = creatorOk(req.params.cid), text = String(req.body?.text || "").trim().slice(0, 4000), conversationId = str(req.body?.conversationId);
    if (!text || !conversationId) throw bad("Message vide");
    const j = await call("POST", "/messages/send-message", { temp_id: `temp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`, conversationId, type: "TEXT", text, creatorId: cid }, true);
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
    db.prepare("INSERT INTO twizz_sent (msg_id, conv_id, fan_id, creator_id, user_id, price, at) VALUES (?,?,?,?,?,?,?)").run(str(nm && nm._id), conversationId, fan, cid, req.user.id, price, Date.now());
    if (b.acceptId) await call("PATCH", "/messages/update-message-status", { messageId: str(b.acceptId), action: "accepted", creatorId: cid, userType: "creator" }, true).catch(() => {});
    return { ok: true, message: nm ? msg(nm, fan) : null };
  }));
  // demande d'un fan : accepter (après envoi du contenu) ou refuser
  app.post("/api/twizz/inbox/:cid/request", auth, founder, wrap(async req => {
    mustSend(); const cid = creatorOk(req.params.cid), action = req.body?.action === "accepted" ? "accepted" : "refused";
    await call("PATCH", "/messages/update-message-status", { messageId: str(req.body?.messageId), action, creatorId: cid, userType: "creator" }, true); return { ok: true };
  }));
  // marquer une conversation comme lue (seulement quand on le demande)
  app.post("/api/twizz/inbox/:cid/read", auth, founder, wrap(async req => {
    mustSend(); const cid = creatorOk(req.params.cid);
    await call("PATCH", "/messages/read-all-messages", { conversationId: str(req.body?.conversationId), creatorId: cid }, true); return { ok: true };
  }));
};
