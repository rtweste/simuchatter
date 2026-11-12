// Mon profil (chatters et managers, pas les élèves) + Paramètres (notifications, appareils reliés) + carte de profil dans le chat
// - nom affiché, phrase d'accroche, couleur, photo (petite image recadrée côté navigateur), créatrices
// - où recevoir sa paie (crypto, virement, PayPal) : visible seulement par le fondateur
// - le shift en cours ou le prochain shift, affiché sur le profil et sur la carte
module.exports = function mount(app, db, auth, ctx) {
  const { bcrypt, PERM } = ctx;
  const has = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c);
  for (const [c, t] of [["display_name", "TEXT"], ["bio", "TEXT"], ["color", "TEXT"], ["pay_method", "TEXT"], ["pay_network", "TEXT"], ["pay_address", "TEXT"], ["pay_iban", "TEXT"], ["pay_paypal", "TEXT"]])
    if (!has("users", c)) db.exec(`ALTER TABLE users ADD COLUMN ${c} ${t}`);
  db.exec("CREATE TABLE IF NOT EXISTS user_avatars (user_id INTEGER PRIMARY KEY, data BLOB NOT NULL, mime TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  const COLORS = ["#7cc4ff", "#b8a4ff", "#ff8ac2", "#ff8a7a", "#ffb14a", "#ffd23f", "#5fd3a2", "#ededed"];
  const NETS = ["USDT · TRC20", "USDT · ERC20", "USDC · Solana", "Bitcoin"];
  const noTrainee = (req, res, next) => req.user.role === "trainee" ? res.status(403).json({ error: "Le profil se débloque quand tu deviens chatter" }) : next();
  const tbl = n => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(n);
  const parisDate = ms => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date(ms));
  const parisHM = ms => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
  // shift en cours (pointé) ou prochain shift prévu
  function shiftOf(uid) {
    const now = Date.now();
    try { if (tbl("clocks")) { const c = db.prepare("SELECT c.id, c.start_at, c.reinforce, m.name model FROM clocks c JOIN models m ON m.id = c.model_id WHERE c.user_id = ? AND c.end_at IS NULL ORDER BY c.reinforce, c.start_at LIMIT 1").get(uid);
      if (c) { const p = tbl("pauses") ? db.prepare("SELECT 1 FROM pauses WHERE clock_id = ? AND end_at IS NULL").get(c.id) : null;
        return { state: p ? "pause" : "on", model: c.model, since: c.start_at, reinforce: !!c.reinforce }; } } } catch (e) {}
    try { if (tbl("shifts")) { const today = parisDate(now), hm = parisHM(now);
      const s = db.prepare("SELECT s.date, s.start, s.end, m.name model FROM shifts s JOIN models m ON m.id = s.model_id WHERE s.user_id = ? AND (s.date > ? OR (s.date = ? AND s.end > ?)) ORDER BY s.date, s.start LIMIT 1").get(uid, today, today, hm);
      if (s) return { state: "next", model: s.model, date: s.date, start: s.start, end: s.end, today: s.date === today }; } } catch (e) {}
    return { state: "none" };
  }
  function card(u) {
    const tl = u.team_lead ? db.prepare("SELECT username, display_name FROM users WHERE id = ?").get(u.team_lead) : null;
    const models = db.prepare("SELECT m.name FROM user_models um JOIN models m ON m.id = um.model_id WHERE um.user_id = ? ORDER BY m.name").all(u.id).map(r => r.name);
    let sales = 0, wins = 0;
    try { sales = db.prepare("SELECT COUNT(*) n FROM sales WHERE user_id = ? AND status = 'validated' AND sold_at > ?").get(u.id, Date.now() - 15 * 864e5).n; } catch (e) {}
    try { wins = db.prepare("SELECT COUNT(*) n FROM challenge_results WHERE user_id = ? AND won = 1").get(u.id).n; } catch (e) {}
    const av = db.prepare("SELECT updated_at FROM user_avatars WHERE user_id = ?").get(u.id);
    return { id: u.id, username: u.username, name: u.display_name || u.username, bio: u.bio || "", color: COLORS.includes(u.color) ? u.color : COLORS[1],
      avatar: av ? `/api/avatar/${u.id}?v=${av.updated_at}` : null, role: u.role, roleLabel: PERM.LABEL[PERM.rk(u)] || (u.role === "admin" ? "Manager" : "Chatter"),
      team: tl ? (tl.display_name || tl.username) : null, models, months: Math.max(0, Math.floor((Date.now() - u.created_at) / (30.44 * 864e5))), sales, wins, shift: shiftOf(u.id) };
  }
  const user = id => db.prepare("SELECT * FROM users WHERE id = ?").get(id);

  app.get("/api/profile", auth, noTrainee, (req, res) => {
    const u = user(req.user.id);
    res.json({ ...card(u), colors: COLORS, nets: NETS, allModels: db.prepare("SELECT id, name FROM models ORDER BY name").all(),
      mine: db.prepare("SELECT model_id FROM user_models WHERE user_id = ?").all(u.id).map(r => r.model_id),
      pay: { method: u.pay_method || "crypto", network: u.pay_network || NETS[0], address: u.pay_address || "", iban: u.pay_iban || "", paypal: u.pay_paypal || "" } });
  });
  app.put("/api/profile", auth, noTrainee, (req, res) => {
    const b = req.body || {}, u = user(req.user.id);
    const name = String(b.name ?? u.display_name ?? "").trim().slice(0, 24), bio = String(b.bio ?? u.bio ?? "").trim().slice(0, 80);
    const color = COLORS.includes(b.color) ? b.color : u.color;
    const p = b.pay || {}, method = ["crypto", "iban", "paypal"].includes(p.method) ? p.method : (u.pay_method || "crypto");
    const net = NETS.includes(p.network) ? p.network : (u.pay_network || NETS[0]);
    const addr = String(p.address ?? u.pay_address ?? "").trim().slice(0, 120), iban = String(p.iban ?? u.pay_iban ?? "").replace(/\s+/g, " ").trim().toUpperCase().slice(0, 42), pp = String(p.paypal ?? u.pay_paypal ?? "").trim().slice(0, 120);
    if (addr && !/^[A-Za-z0-9]{20,100}$/.test(addr)) return res.status(400).json({ error: "Adresse de portefeuille invalide : vérifie qu'elle est complète" });
    if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9 ]{10,38}$/.test(iban)) return res.status(400).json({ error: "IBAN invalide" });
    if (pp && !/^\S+@\S+\.\S+$/.test(pp)) return res.status(400).json({ error: "Adresse PayPal invalide" });
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE users SET display_name = ?, bio = ?, color = ?, pay_method = ?, pay_network = ?, pay_address = ?, pay_iban = ?, pay_paypal = ? WHERE id = ?")
        .run(name || null, bio || null, color || null, method, net, addr || null, iban || null, pp || null, u.id);
      if (Array.isArray(b.models)) { db.prepare("DELETE FROM user_models WHERE user_id = ?").run(u.id);
        b.models.map(Number).filter(id => db.prepare("SELECT 1 FROM models WHERE id = ?").get(id)).forEach(id => db.prepare("INSERT OR IGNORE INTO user_models (user_id, model_id) VALUES (?,?)").run(u.id, id)); }
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    res.json(card(user(u.id)));
  });
  // photo : image déjà recadrée et réduite par le navigateur (JPEG ou WebP, 60 Ko max)
  app.post("/api/profile/avatar", auth, noTrainee, (req, res) => {
    if (req.body?.remove) { db.prepare("DELETE FROM user_avatars WHERE user_id = ?").run(req.user.id); return res.json(card(user(req.user.id))); }
    const m = /^data:(image\/(?:jpeg|webp|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.data || ""));
    if (!m) return res.status(400).json({ error: "Image invalide" });
    const buf = Buffer.from(m[2], "base64"); if (buf.length > 60000) return res.status(400).json({ error: "Image trop lourde" });
    db.prepare("INSERT INTO user_avatars (user_id, data, mime, updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, mime = excluded.mime, updated_at = excluded.updated_at").run(req.user.id, buf, m[1], Date.now());
    res.json(card(user(req.user.id)));
  });
  app.get("/api/avatar/:id", auth, (req, res) => {
    const a = db.prepare("SELECT data, mime FROM user_avatars WHERE user_id = ?").get(parseInt(req.params.id, 10));
    if (!a) return res.status(404).end();
    res.set("Content-Type", a.mime); res.set("Cache-Control", "private, max-age=604800"); res.send(Buffer.from(a.data));
  });
  // carte visible par l'équipe (chat, planning)
  app.get("/api/users/:id/card", auth, (req, res) => {
    const u = user(parseInt(req.params.id, 10)); if (!u || !u.active) return res.status(404).json({ error: "Compte introuvable" });
    res.json(card(u));
  });
  // sécurité
  app.post("/api/profile/password", auth, noTrainee, (req, res) => {
    const u = user(req.user.id), cur = String(req.body?.current || ""), nx = String(req.body?.next || "");
    if (!bcrypt.compareSync(cur, u.pass_hash)) return res.status(400).json({ error: "Mot de passe actuel incorrect" });
    if (nx.length < 8) return res.status(400).json({ error: "Le nouveau mot de passe doit faire au moins 8 caractères" });
    db.prepare("UPDATE users SET pass_hash = ? WHERE id = ?").run(bcrypt.hashSync(nx, 10), u.id);
    db.prepare("DELETE FROM tokens WHERE user_id = ? AND token <> ?").run(u.id, req.cookies.tok);
    res.json({ ok: true });
  });
  app.post("/api/profile/logout-all", auth, (req, res) => { const n = db.prepare("DELETE FROM tokens WHERE user_id = ? AND token <> ?").run(req.user.id, req.cookies.tok).changes; res.json({ ok: true, n }); });
  // appareils reliés aux notifications
  const devLabel = ua => { ua = String(ua || ""); const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Téléphone Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Ordinateur Windows" : /Linux/.test(ua) ? "Ordinateur Linux" : "Appareil";
    const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : ""; return { os, br, phone: /iPhone|Android|iPad/.test(ua) }; };
  app.get("/api/push/devices", auth, (req, res) => {
    if (!tbl("push_subs")) return res.json([]);
    res.json(db.prepare("SELECT id, ua, standalone, created_at, last_ok, endpoint FROM push_subs WHERE user_id = ? ORDER BY created_at DESC").all(req.user.id)
      .map(d => ({ id: d.id, ...devLabel(d.ua), app: !!d.standalone, created_at: d.created_at, last_ok: d.last_ok, endpoint: d.endpoint })));
  });
  app.delete("/api/push/devices/:id", auth, (req, res) => { if (tbl("push_subs")) db.prepare("DELETE FROM push_subs WHERE id = ? AND user_id = ?").run(parseInt(req.params.id, 10), req.user.id); res.json({ ok: true }); });
  // infos de paie : fondateur seulement
  app.get("/api/admin/users/:id/pay", auth, (req, res) => {
    if (req.user.rk !== "founder") return res.status(403).json({ error: "Réservé au fondateur" });
    const u = user(parseInt(req.params.id, 10)); if (!u) return res.status(404).json({ error: "Compte introuvable" });
    res.json({ method: u.pay_method || null, network: u.pay_network || null, address: u.pay_address || null, iban: u.pay_iban || null, paypal: u.pay_paypal || null });
  });
  return { card, shiftOf };
};
