// Salon vocal de l'équipe (remplace Discord) : un salon commun, audio en direct entre les participants (WebRTC pair à pair),
// partage d'écran visible par les managers seulement. Le serveur ne transporte que la signalisation et la présence.
module.exports = function mount(app, db, auth, admin, { gest, planning }) {
  const ROOM = new Map();   // user_id -> { id, name, role, rk, color, avatar, muted, deaf, sharing, joined, res:Set }
  const LEFT = new Map();   // user_id -> moment du départ (tolérance des rechargements)
  const send = (res, ev, data) => { try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch (e) {} };
  const to = (uid, ev, data) => { const p = ROOM.get(uid); if (p) p.res.forEach(r => send(r, ev, data)); };
  const all = (ev, data, except) => ROOM.forEach((p, uid) => { if (uid !== except) p.res.forEach(r => send(r, ev, data)); });
  const isMgr = u => u.role === "admin" && u.rk !== "assistant";
  const pub = p => ({ id: p.id, name: p.name, role: p.role, mgr: p.mgr, color: p.color, avatar: p.avatar, muted: p.muted, deaf: p.deaf, sharing: p.sharing, joined: p.joined });
  const log = (...a) => { try { gest.log(...a); } catch (e) {} };
  const userInfo = id => { const u = db.prepare("SELECT id, username, display_name, color, role FROM users WHERE id = ?").get(id) || {};
    let av = null; try { const a = db.prepare("SELECT updated_at FROM user_avatars WHERE user_id = ?").get(id); if (a) av = `/api/avatar/${id}?v=${a.updated_at}`; } catch (e) {}
    return { name: u.display_name || u.username || "?", color: u.color || null, avatar: av }; };

  /* ---------- serveurs de connexion (STUN, et TURN si configuré) ---------- */
  let cfCache = null;
  async function iceServers() {
    const list = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
    // TURN Cloudflare (identifiants temporaires) : CF_TURN_KEY_ID + CF_TURN_KEY_TOKEN
    if (process.env.CF_TURN_KEY_ID && process.env.CF_TURN_KEY_TOKEN) {
      if (!cfCache || cfCache.until < Date.now()) try {
        const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${process.env.CF_TURN_KEY_ID}/credentials/generate`, { method: "POST",
          headers: { Authorization: `Bearer ${process.env.CF_TURN_KEY_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ ttl: 86400 }) });
        const j = await r.json(); if (j.iceServers) cfCache = { until: Date.now() + 12 * 3600e3, servers: [].concat(j.iceServers) };
      } catch (e) { console.error("TURN Cloudflare", e.message); }
      if (cfCache) list.push(...cfCache.servers);
    }
    // TURN classique : TURN_URLS (séparées par des virgules), TURN_USERNAME, TURN_CREDENTIAL
    if (process.env.TURN_URLS) list.push({ urls: process.env.TURN_URLS.split(",").map(s => s.trim()).filter(Boolean), username: process.env.TURN_USERNAME || "", credential: process.env.TURN_CREDENTIAL || "" });
    return list;
  }

  const allowed = (req, res, next) => {
    if (req.user.role === "trainee") return res.status(403).json({ error: "Le salon vocal est réservé à l'équipe" });
    if (req.viewAs) return res.status(403).json({ error: "Pas de vocal en aperçu « vue chatter »" });
    next();
  };
  app.get("/api/voice/ice", auth, allowed, async (req, res) => res.json({ iceServers: await iceServers() }));

  // rejoindre : flux d'événements (présence + signalisation) ; partir = fermer le flux
  app.get("/api/voice/stream", auth, allowed, (req, res) => {
    const uid = req.user.id;
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" }); res.flushHeaders?.();
    res.write("retry: 2000\n\n");
    let p = ROOM.get(uid); const fresh = !p;
    if (!p) { const i = userInfo(uid); p = { id: uid, name: i.name, color: i.color, avatar: i.avatar, role: req.user.role, mgr: isMgr(req.user), muted: false, deaf: false, sharing: false, joined: Date.now(), res: new Set() }; ROOM.set(uid, p); }
    // un seul onglet vocal par personne : l'ancien est fermé
    p.res.forEach(r => { send(r, "replaced", {}); try { r.end(); } catch (e) {} }); p.res.clear(); p.res.add(res);
    send(res, "welcome", { me: uid, mgr: p.mgr, peers: [...ROOM.values()].filter(x => x.id !== uid).map(pub) });
    if (fresh) { all("join", pub(p), uid); if (!LEFT.has(uid) || Date.now() - LEFT.get(uid) > 60e3) log(uid, "pl", `**${req.user.username}** a rejoint le salon vocal`, ""); }
    else all("rejoin", pub(p), uid);
    LEFT.delete(uid);
    const ka = setInterval(() => { try { res.write(": ping\n\n"); } catch (e) {} }, 20e3);
    req.on("close", () => { clearInterval(ka); const q = ROOM.get(uid); if (!q) return; q.res.delete(res);
      if (!q.res.size) { ROOM.delete(uid); LEFT.set(uid, Date.now()); all("leave", { id: uid }); } });
  });
  // signalisation WebRTC entre deux participants (offre, réponse, candidats ICE) ; kind = "audio" ou "screen"
  app.post("/api/voice/signal", auth, allowed, (req, res) => {
    const me = ROOM.get(req.user.id), target = +req.body?.to; if (!me || !ROOM.has(target)) return res.status(409).json({ error: "Hors du salon" });
    const kind = req.body?.kind === "screen" ? "screen" : "audio";
    if (kind === "screen") { const t = ROOM.get(target);
      // l'écran ne circule qu'entre un chatter qui partage et un manager qui regarde
      if (!(me.sharing && t.mgr) && !(me.mgr && t.sharing)) return res.status(403).json({ error: "Écran réservé aux managers" }); }
    to(target, "signal", { from: req.user.id, kind, type: String(req.body?.type || ""), data: req.body?.data ?? null });
    res.json({ ok: true });
  });
  // micro coupé, son coupé, partage d'écran
  app.post("/api/voice/state", auth, allowed, (req, res) => {
    const p = ROOM.get(req.user.id); if (!p) return res.status(409).json({ error: "Hors du salon" });
    for (const k of ["muted", "deaf", "sharing"]) if (typeof req.body?.[k] === "boolean") p[k] = req.body[k];
    if (typeof req.body?.sharing === "boolean") log(req.user.id, "pl", `**${req.user.username}** ${p.sharing ? "partage son écran" : "arrête de partager son écran"}`, "");
    all("state", pub(p)); res.json({ ok: true });
  });
  // un manager demande à voir / arrête de voir l'écran d'un chatter
  app.post("/api/voice/watch", auth, allowed, (req, res) => {
    const me = ROOM.get(req.user.id), t = ROOM.get(+req.body?.id);
    if (!me || !me.mgr) return res.status(403).json({ error: "Réservé aux managers" });
    if (!t || !t.sharing) return res.status(400).json({ error: "Cet écran n'est plus partagé" });
    to(t.id, req.body?.stop ? "unwatch" : "watch", { by: me.id, name: me.name }); res.json({ ok: true });
  });
  // un manager demande à un chatter de partager son écran
  app.post("/api/voice/ask-share", auth, allowed, (req, res) => {
    const me = ROOM.get(req.user.id), t = ROOM.get(+req.body?.id);
    if (!me || !me.mgr) return res.status(403).json({ error: "Réservé aux managers" });
    if (!t) return res.status(400).json({ error: "Pas dans le salon" });
    to(t.id, "ask-share", { by: me.id, name: me.name }); res.json({ ok: true });
  });

  // qui est dans le salon (pour le site et les alertes)
  const inRoom = uid => ROOM.has(uid) || (LEFT.has(uid) && Date.now() - LEFT.get(uid) < 45e3);
  app.get("/api/voice/presence", auth, (req, res) => res.json({ count: ROOM.size, ids: [...ROOM.keys()], me: inRoom(req.user.id) }));
  // en shift mais pas dans le vocal depuis plus de 5 min
  function missing() {
    const now = Date.now();
    return db.prepare("SELECT c.user_id, c.start_at, u.username FROM clocks c JOIN users u ON u.id = c.user_id WHERE c.end_at IS NULL AND c.reinforce = 0 AND u.role = 'chatter'").all()
      .filter(c => !inRoom(c.user_id) && now - c.start_at > 5 * 60e3 && (!LEFT.has(c.user_id) || now - LEFT.get(c.user_id) > 5 * 60e3));
  }
  return { inRoom, count: () => ROOM.size, missing };
};
