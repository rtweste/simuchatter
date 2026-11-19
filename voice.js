// Salons vocaux (remplacent Discord) : audio en direct entre les participants d'un même salon (WebRTC pair à pair),
// partage d'écran visible par les managers seulement. Le serveur ne transporte que la signalisation et la présence.
// Une personne est dans un seul salon à la fois.
module.exports = function mount(app, db, auth, admin, { gest, planning }) {
  const ROOM = new Map();   // user_id -> { id, room, name, role, mgr, color, avatar, muted, deaf, sharing, joined, res:Set }
  const LEFT = new Map();   // user_id -> moment du départ du salon Équipe (tolérance des rechargements)
  const send = (res, ev, data) => { try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch (e) {} };
  const to = (uid, ev, data) => { const p = ROOM.get(uid); if (p) p.res.forEach(r => send(r, ev, data)); };
  // diffusion aux participants d'un salon
  const all = (room, ev, data, except) => ROOM.forEach((p, uid) => { if (p.room === room && uid !== except) p.res.forEach(r => send(r, ev, data)); });
  const isMgr = u => u.role === "admin" && u.rk !== "assistant";
  // les salons et qui peut les voir
  const ROOMS = [
    { id: "equipe", name: "Équipe", emoji: "🔊", can: u => u.role !== "trainee" },
    { id: "managers", name: "Managers", emoji: "🛡️", can: isMgr },
    { id: "formation", name: "Formation", emoji: "🎓", can: u => u.role === "trainee" || isMgr(u) },
    { id: "entretiens", name: "Entretiens", emoji: "💼", can: u => u.role === "trainee" || isMgr(u) }
  ];
  const roomsFor = u => ROOMS.filter(r => r.can(u));
  const roomOf = id => ROOMS.find(r => r.id === id);
  const pub = p => ({ id: p.id, room: p.room, name: p.name, role: p.role, mgr: p.mgr, color: p.color, avatar: p.avatar, muted: p.muted, deaf: p.deaf, sharing: p.sharing, joined: p.joined });
  const log = (...a) => { try { gest.log(...a); } catch (e) {} };

  /* ---------- temps passé dans le vocal ---------- */
  db.exec(`CREATE TABLE IF NOT EXISTS voice_sessions (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, start_at INTEGER NOT NULL, end_at INTEGER, last_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS voice_sessions_user ON voice_sessions(user_id, start_at);`);
  if (!db.prepare("PRAGMA table_info(voice_sessions)").all().some(c => c.name === "room")) db.exec("ALTER TABLE voice_sessions ADD COLUMN room TEXT NOT NULL DEFAULT 'equipe'");
  // redémarrage du serveur : les sessions restées ouvertes s'arrêtent au dernier signe de vie
  db.prepare("UPDATE voice_sessions SET end_at = last_at WHERE end_at IS NULL").run();
  function sessionOpen(uid, room) {
    const now = Date.now(), last = db.prepare("SELECT id, end_at, room FROM voice_sessions WHERE user_id = ? ORDER BY start_at DESC LIMIT 1").get(uid);
    if (last && last.end_at == null && last.room === room) return;
    if (last && last.end_at == null) db.prepare("UPDATE voice_sessions SET end_at = ?, last_at = ? WHERE id = ?").run(now, now, last.id);
    // simple rechargement ou petite coupure (moins d'une minute) : on reprend la même session
    else if (last && last.room === room && now - last.end_at < 60e3) return db.prepare("UPDATE voice_sessions SET end_at = NULL, last_at = ? WHERE id = ?").run(now, last.id);
    db.prepare("INSERT INTO voice_sessions (user_id, start_at, last_at, room) VALUES (?,?,?,?)").run(uid, now, now, room);
  }
  const sessionClose = uid => { const now = Date.now(); db.prepare("UPDATE voice_sessions SET end_at = ?, last_at = ? WHERE user_id = ? AND end_at IS NULL").run(now, now, uid); };
  setInterval(() => { try { const now = Date.now(); ROOM.forEach((p, uid) => db.prepare("UPDATE voice_sessions SET last_at = ? WHERE user_id = ? AND end_at IS NULL").run(now, uid)); } catch (e) {} }, 60e3).unref?.();
  // début de la quinzaine en cours (heure de Paris)
  const parisOffset = ms => { const d = new Date(ms); return new Date(d.toLocaleString("en-US", { timeZone: "Europe/Paris" })) - new Date(d.toLocaleString("en-US", { timeZone: "UTC" })); };
  function periodStart(now) { const o = parisOffset(now), l = new Date(now + o); l.setUTCDate(l.getUTCDate() <= 15 ? 1 : 16); l.setUTCHours(0, 0, 0, 0); return l.getTime() - parisOffset(l.getTime() - o) ; }
  // pauses en cours ou passées : elles ne comptent pas comme du temps où le vocal est obligatoire
  const pausesOf = (from, to) => { const P = {}; try { db.prepare("SELECT user_id, start_at, COALESCE(end_at, ?) AS e FROM pauses WHERE start_at < ? AND COALESCE(end_at, ?) > ?").all(to, to, to, from)
    .forEach(r => (P[r.user_id] = P[r.user_id] || []).push([r.start_at, r.e])); } catch (e) {} return P; };
  // retire des intervalles [a,b] les morceaux couverts par cut
  const minus = (a, b, cut) => { let L = [[a, b]]; (cut || []).forEach(([x, y]) => { L = L.flatMap(([u, v]) => y <= u || x >= v ? [[u, v]] : [[u, Math.max(u, x)], [Math.min(v, y), v]].filter(([p, q]) => q > p)); }); return L; };
  const onPause = uid => { try { return !!db.prepare("SELECT 1 FROM pauses WHERE user_id = ? AND end_at IS NULL").get(uid); } catch (e) { return false; } };
  function stats(from, to) {
    const PA = pausesOf(from, to);
    const ses = {}; db.prepare("SELECT user_id, start_at, COALESCE(end_at, ?) AS e FROM voice_sessions WHERE room = 'equipe' AND COALESCE(end_at, ?) > ? AND start_at < ?").all(to, to, from, to)
      .forEach(r => (ses[r.user_id] = ses[r.user_id] || []).push([Math.max(r.start_at, from), Math.min(r.e, to)]));
    const out = {};
    db.prepare("SELECT c.user_id, u.username, c.start_at, COALESCE(c.end_at, ?) AS e FROM clocks c JOIN users u ON u.id = c.user_id WHERE c.reinforce = 0 AND u.role = 'chatter' AND c.start_at < ? AND COALESCE(c.end_at, ?) > ?").all(to, to, to, from)
      .forEach(c => { const o = out[c.user_id] = out[c.user_id] || { id: c.user_id, username: c.username, shift: 0, inVoice: 0 };
        const a = Math.max(c.start_at, from), b = Math.min(c.e, to); if (b <= a) return;
        minus(a, b, PA[c.user_id]).forEach(([u, v]) => { o.shift += v - u;
          (ses[c.user_id] || []).forEach(([x, y]) => { const ov = Math.min(v, y) - Math.max(u, x); if (ov > 0) o.inVoice += ov; }); }); });
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
    if (req.viewAs) return res.status(403).json({ error: "Pas de vocal en aperçu « vue chatter »" });
    next();
  };
  app.get("/api/voice/ice", auth, allowed, async (req, res) => res.json({ iceServers: await iceServers() }));

  // rejoindre : flux d'événements (présence + signalisation) ; partir = fermer le flux
  app.get("/api/voice/stream", auth, allowed, (req, res) => {
    const uid = req.user.id, R0 = roomOf(String(req.query.room || "")) || roomsFor(req.user)[0];
    if (!R0 || !R0.can(req.user)) return res.status(403).json({ error: "Salon non accessible" });
    const room = R0.id;
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" }); res.flushHeaders?.();
    res.write("retry: 2000\n\n");
    let p = ROOM.get(uid);
    // changement de salon : on part de l'ancien
    if (p && p.room !== room) { all(p.room, "leave", { id: uid }, uid); if (p.room === "equipe") LEFT.set(uid, Date.now()); p.res.forEach(r => { send(r, "replaced", { moved: true }); try { r.end(); } catch (e) {} }); p.res.clear(); ROOM.delete(uid); p = null; }
    const fresh = !p;
    if (!p) { const i = userInfo(uid); p = { id: uid, room, name: i.name, color: i.color, avatar: i.avatar, role: req.user.role, mgr: isMgr(req.user), muted: false, deaf: false, sharing: false, joined: Date.now(), res: new Set() }; ROOM.set(uid, p); }
    // un seul onglet vocal par personne : l'ancien est fermé
    p.res.forEach(r => { send(r, "replaced", {}); try { r.end(); } catch (e) {} }); p.res.clear(); p.res.add(res);
    send(res, "welcome", { me: uid, self: pub(p), mgr: p.mgr, room, rooms: roomsFor(req.user).map(r => ({ id: r.id, name: r.name, emoji: r.emoji })), shift: mustBeIn(uid), peers: [...ROOM.values()].filter(x => x.id !== uid && x.room === room).map(pub) });
    if (fresh) { try { sessionOpen(uid, room); } catch (e) { console.error("vocal session", e.message); } all(room, "join", pub(p), uid);
      if (room !== "equipe" || !LEFT.has(uid) || Date.now() - LEFT.get(uid) > 60e3) log(uid, "pl", `**${req.user.username}** a rejoint le salon vocal ${R0.name}`, ""); }
    else all(room, "rejoin", pub(p), uid);
    if (room === "equipe") LEFT.delete(uid);
    const ka = setInterval(() => { try { res.write(": ping\n\n"); } catch (e) {} }, 20e3);
    req.on("close", () => { clearInterval(ka); const q = ROOM.get(uid); if (!q || !q.res.has(res)) return; q.res.delete(res);
      if (!q.res.size) { ROOM.delete(uid); if (q.room === "equipe") LEFT.set(uid, Date.now()); try { sessionClose(uid); } catch (e) {} all(q.room, "leave", { id: uid }); } });
  });
  // signalisation WebRTC entre deux participants (offre, réponse, candidats ICE) ; kind = "audio" ou "screen"
  app.post("/api/voice/signal", auth, allowed, (req, res) => {
    const me = ROOM.get(req.user.id), target = +req.body?.to; if (!me || !ROOM.has(target) || ROOM.get(target).room !== me.room) return res.status(409).json({ error: "Hors du salon" });
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
    all(p.room, "state", pub(p)); res.json({ ok: true });
  });
  // un manager demande à voir / arrête de voir l'écran d'un chatter
  app.post("/api/voice/watch", auth, allowed, (req, res) => {
    const me = ROOM.get(req.user.id), t = ROOM.get(+req.body?.id);
    if (!me || !me.mgr) return res.status(403).json({ error: "Réservé aux managers" });
    if (!t || !t.sharing || t.room !== me.room) return res.status(400).json({ error: "Cet écran n'est plus partagé" });
    to(t.id, req.body?.stop ? "unwatch" : "watch", { by: me.id, name: me.name }); res.json({ ok: true });
  });
  // un manager demande à un chatter de partager son écran
  app.post("/api/voice/ask-share", auth, allowed, (req, res) => {
    const me = ROOM.get(req.user.id), t = ROOM.get(+req.body?.id);
    if (!me || !me.mgr) return res.status(403).json({ error: "Réservé aux managers" });
    if (!t || t.room !== me.room) return res.status(400).json({ error: "Pas dans le salon" });
    to(t.id, "ask-share", { by: me.id, name: me.name }); res.json({ ok: true });
  });
  // un manager coupe le micro de quelqu'un (la personne peut le réactiver)
  app.post("/api/voice/force-mute", auth, allowed, (req, res) => {
    const me = ROOM.get(req.user.id), t = ROOM.get(+req.body?.id);
    if (!me || !me.mgr) return res.status(403).json({ error: "Réservé aux managers" });
    if (!t || t.room !== me.room || t.id === me.id) return res.status(400).json({ error: "Pas dans le salon" });
    to(t.id, "force-mute", { by: me.id, name: me.name }); log(req.user.id, "pl", `**${req.user.username}** a coupé le micro de **${t.name}** dans le vocal`, ""); res.json({ ok: true });
  });

  // qui est dans le salon (pour le site et les alertes)
  // dans le salon Équipe (ou parti il y a moins de 45 s : rechargement, petite coupure)
  const inRoom = uid => ROOM.get(uid)?.room === "equipe" || (LEFT.has(uid) && Date.now() - LEFT.get(uid) < 45e3);
  // le vocal Équipe est obligatoire : chatter pointé (shift principal) et pas en pause
  const mustBeIn = uid => { const u = db.prepare("SELECT role FROM users WHERE id = ?").get(uid);
    return !!u && u.role === "chatter" && !!db.prepare("SELECT 1 FROM clocks WHERE user_id = ? AND end_at IS NULL AND reinforce = 0").get(uid) && !onPause(uid); };
  // retour de pause il y a moins de 3 min : le temps de revenir dans le vocal
  const justBack = (uid, now) => { try { const r = db.prepare("SELECT MAX(end_at) AS e FROM pauses WHERE user_id = ?").get(uid); return !!(r && r.e && now - r.e < 3 * 60e3); } catch (e) { return false; } };
  const needed = uid => mustBeIn(uid) && !inRoom(uid);
  app.get("/api/voice/presence", auth, (req, res) => {
    const R = req.viewAs ? [] : roomsFor(req.user), ids = new Set(R.map(r => r.id)), people = [...ROOM.values()].filter(p => ids.has(p.room)).sort((a, b) => a.joined - b.joined).map(pub);
    res.json({ count: people.length, me: ROOM.has(req.user.id) || inRoom(req.user.id), myRoom: ROOM.get(req.user.id)?.room || null, shift: mustBeIn(req.user.id),
      rooms: R.map(r => ({ id: r.id, name: r.name, emoji: r.emoji, people: people.filter(p => p.room === r.id) })), people });
  });
  // managers : part du temps de shift passé dans le vocal, sur la quinzaine en cours
  app.get("/api/admin/voice/stats", auth, admin, (req, res) => { const now = Date.now(), from = periodStart(now); res.json({ from, to: now, items: stats(from, now) }); });
  // en shift mais pas dans le vocal depuis plus de 5 min
  function missing() {
    const now = Date.now();
    return db.prepare("SELECT c.user_id, c.start_at, u.username FROM clocks c JOIN users u ON u.id = c.user_id WHERE c.end_at IS NULL AND c.reinforce = 0 AND u.role = 'chatter'").all()
      .filter(c => !inRoom(c.user_id) && !onPause(c.user_id) && now - c.start_at > 5 * 60e3 && !justBack(c.user_id, now) && (!LEFT.has(c.user_id) || now - LEFT.get(c.user_id) > 5 * 60e3));
  }
  return { inRoom, needed, count: () => ROOM.size, missing };
};
