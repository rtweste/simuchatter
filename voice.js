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

  /* ---------- temps passé dans le vocal ---------- */
  db.exec(`CREATE TABLE IF NOT EXISTS voice_sessions (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, start_at INTEGER NOT NULL, end_at INTEGER, last_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS voice_sessions_user ON voice_sessions(user_id, start_at);`);
  // redémarrage du serveur : les sessions restées ouvertes s'arrêtent au dernier signe de vie
  db.prepare("UPDATE voice_sessions SET end_at = last_at WHERE end_at IS NULL").run();
  function sessionOpen(uid) {
    const now = Date.now(), last = db.prepare("SELECT id, end_at FROM voice_sessions WHERE user_id = ? ORDER BY start_at DESC LIMIT 1").get(uid);
    if (last && last.end_at == null) return;
    // simple rechargement (moins d'une minute) : on reprend la même session
    if (last && now - last.end_at < 60e3) db.prepare("UPDATE voice_sessions SET end_at = NULL, last_at = ? WHERE id = ?").run(now, last.id);
    else db.prepare("INSERT INTO voice_sessions (user_id, start_at, last_at) VALUES (?,?,?)").run(uid, now, now);
  }
  const sessionClose = uid => { const now = Date.now(); db.prepare("UPDATE voice_sessions SET end_at = ?, last_at = ? WHERE user_id = ? AND end_at IS NULL").run(now, now, uid); };
  setInterval(() => { try { const now = Date.now(); ROOM.forEach((p, uid) => db.prepare("UPDATE voice_sessions SET last_at = ? WHERE user_id = ? AND end_at IS NULL").run(now, uid)); } catch (e) {} }, 60e3).unref?.();
  // début de la quinzaine en cours (heure de Paris)
  const parisOffset = ms => { const d = new Date(ms); return new Date(d.toLocaleString("en-US", { timeZone: "Europe/Paris" })) - new Date(d.toLocaleString("en-US", { timeZone: "UTC" })); };
  function periodStart(now) { const o = parisOffset(now), l = new Date(now + o); l.setUTCDate(l.getUTCDate() <= 15 ? 1 : 16); l.setUTCHours(0, 0, 0, 0); return l.getTime() - parisOffset(l.getTime() - o) ; }
  function stats(from, to) {
    const ses = {}; db.prepare("SELECT user_id, start_at, COALESCE(end_at, ?) AS e FROM voice_sessions WHERE COALESCE(end_at, ?) > ? AND start_at < ?").all(to, to, from, to)
      .forEach(r => (ses[r.user_id] = ses[r.user_id] || []).push([Math.max(r.start_at, from), Math.min(r.e, to)]));
    const out = {};
    db.prepare("SELECT c.user_id, u.username, c.start_at, COALESCE(c.end_at, ?) AS e FROM clocks c JOIN users u ON u.id = c.user_id WHERE c.reinforce = 0 AND u.role = 'chatter' AND c.start_at < ? AND COALESCE(c.end_at, ?) > ?").all(to, to, to, from)
      .forEach(c => { const o = out[c.user_id] = out[c.user_id] || { id: c.user_id, username: c.username, shift: 0, inVoice: 0 };
        const a = Math.max(c.start_at, from), b = Math.min(c.e, to); if (b <= a) return; o.shift += b - a;
        (ses[c.user_id] || []).forEach(([x, y]) => { const ov = Math.min(b, y) - Math.max(a, x); if (ov > 0) o.inVoice += ov; }); });
    const total = {}; Object.entries(ses).forEach(([uid, L]) => total[uid] = L.reduce((t, [x, y]) => t + Math.max(0, y - x), 0));
    return Object.values(out).filter(o => o.shift > 60e3).map(o => ({ ...o, inVoice: Math.min(o.inVoice, o.shift), total: total[o.id] || 0, pct: Math.round(100 * Math.min(o.inVoice, o.shift) / o.shift) }));
  }
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
    if (fresh) { try { sessionOpen(uid); } catch (e) { console.error("vocal session", e.message); } all("join", pub(p), uid); if (!LEFT.has(uid) || Date.now() - LEFT.get(uid) > 60e3) log(uid, "pl", `**${req.user.username}** a rejoint le salon vocal`, ""); }
    else all("rejoin", pub(p), uid);
    LEFT.delete(uid);
    const ka = setInterval(() => { try { res.write(": ping\n\n"); } catch (e) {} }, 20e3);
    req.on("close", () => { clearInterval(ka); const q = ROOM.get(uid); if (!q) return; q.res.delete(res);
      if (!q.res.size) { ROOM.delete(uid); LEFT.set(uid, Date.now()); try { sessionClose(uid); } catch (e) {} all("leave", { id: uid }); } });
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
  app.get("/api/voice/presence", auth, (req, res) => res.json({ count: ROOM.size, ids: [...ROOM.keys()], me: inRoom(req.user.id),
    people: req.user.role === "trainee" ? [] : [...ROOM.values()].sort((a, b) => a.joined - b.joined).map(pub) }));
  // managers : part du temps de shift passé dans le vocal, sur la quinzaine en cours
  app.get("/api/admin/voice/stats", auth, admin, (req, res) => { const now = Date.now(), from = periodStart(now); res.json({ from, to: now, items: stats(from, now) }); });
  // en shift mais pas dans le vocal depuis plus de 5 min
  function missing() {
    const now = Date.now();
    return db.prepare("SELECT c.user_id, c.start_at, u.username FROM clocks c JOIN users u ON u.id = c.user_id WHERE c.end_at IS NULL AND c.reinforce = 0 AND u.role = 'chatter'").all()
      .filter(c => !inRoom(c.user_id) && now - c.start_at > 5 * 60e3 && (!LEFT.has(c.user_id) || now - LEFT.get(c.user_id) > 5 * 60e3));
  }
  return { inRoom, count: () => ROOM.size, missing };
};
