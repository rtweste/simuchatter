// Studio : contenus personnalisés (demande du fan → production → livraison au chatter), fiches des créatrices, pauses pendant les shifts.
const path = require("path");
const fs = require("fs");
const express = require("express");

const IMG = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const MEDIA = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-m4v": "m4v", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/wav": "wav", "audio/webm": "weba", "application/zip": "zip" };
const MAX_UPLOAD = 800 * 1024 * 1024;

module.exports = function mount(app, db, auth, admin, { dataDir, gest, planning }) {
  const UP = path.join(dataDir, "uploads"), ST = path.join(dataDir, "studio");
  fs.mkdirSync(UP, { recursive: true }); fs.mkdirSync(ST, { recursive: true });
  const col = (t, c, type) => { if (!db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${type}`); };
  db.exec(`
  CREATE TABLE IF NOT EXISTS customs (id INTEGER PRIMARY KEY, sale_id INTEGER, user_id INTEGER NOT NULL, model_id INTEGER NOT NULL,
    fan TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'video', duration INTEGER, qty INTEGER, request TEXT NOT NULL, due_at INTEGER, urgent INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'todo', file TEXT, mime TEXT, size INTEGER, fname TEXT, mgr_note TEXT,
    created_at INTEGER NOT NULL, started_at INTEGER, ready_at INTEGER, delivered_at INTEGER, seen INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS customs_user ON customs(user_id, created_at);
  CREATE INDEX IF NOT EXISTS customs_status ON customs(status, due_at);
  CREATE TABLE IF NOT EXISTS pauses (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, clock_id INTEGER NOT NULL, start_at INTEGER NOT NULL, end_at INTEGER, over_logged INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS pauses_clock ON pauses(clock_id);
  `);
  col("customs", "price", "REAL");   // prix payé par le fan (demande envoyée sans vente déclarée : la vente arrive de Twizz)
  col("customs", "tw_tx", "TEXT"); col("customs", "paid_at", "INTEGER");   // vente Twizz retrouvée pour cette demande
  col("models", "profile", "TEXT"); col("models", "photos", "TEXT"); col("models", "photo_focus", "TEXT");
  const J = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };
  const user = id => db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(id);
  const eur = n => Math.round(n * 100) / 100 + " €";
  const log = (...a) => { try { gest.log(...a); } catch (e) {} };
  const AG = () => gest.agency();
  const str = (v, n) => String(v ?? "").trim().slice(0, n);

  /* ===================== CONTENUS PERSONNALISÉS ===================== */
  const KINDS = { video: "Vidéo", photos: "Photos", audio: "Audio", autre: "Autre", snap: "Snap" };
  const SEL = `SELECT c.*, u.username, m.name model_name, s.amount, s.status sale_status FROM customs c JOIN users u ON u.id = c.user_id JOIN models m ON m.id = c.model_id LEFT JOIN sales s ON s.id = c.sale_id`;
  const pubC = c => ({ id: c.id, sale_id: c.sale_id, user_id: c.user_id, username: c.username, model_id: c.model_id, model_name: c.model_name, fan: c.fan, kind: c.kind, kindLabel: KINDS[c.kind] || c.kind,
    duration: c.duration, qty: c.qty, request: c.request, due_at: c.due_at, urgent: !!c.urgent, status: c.status, amount: c.amount != null ? c.amount : c.price, price: c.price, sale_status: c.sale_status, mgr_note: c.mgr_note,
    file: c.file ? { mime: c.mime, size: c.size, name: c.fname } : null, pay: payOf(c), paid_at: c.paid_at || null, created_at: c.created_at, started_at: c.started_at, ready_at: c.ready_at, delivered_at: c.delivered_at, seen: !!c.seen });
  const getC = id => db.prepare(`${SEL} WHERE c.id = ?`).get(id);
  // paiement de la demande sur Twizz : vu, en attente (on cherche pendant 2 h après la demande), introuvable
  const twOn = () => { try { const r = db.prepare("SELECT value FROM settings WHERE key = 'twizz_on'").get(); return !!r && r.value === "true"; } catch (e) { return false; } };
  const payOf = c => c.paid_at ? "ok" : c.price == null || c.sale_id || !twOn() ? null : Date.now() - c.created_at > 2.2 * 3600e3 ? "missing" : "wait";

  app.post("/api/customs", auth, (req, res) => {
    const b = req.body || {}, sale = db.prepare("SELECT * FROM sales WHERE id = ?").get(parseInt(b.sale_id, 10));
    if (!sale || sale.user_id !== req.user.id) return res.status(404).json({ error: "Vente introuvable" });
    if (db.prepare("SELECT 1 FROM customs WHERE sale_id = ?").get(sale.id)) return res.status(400).json({ error: "Une demande existe déjà pour cette vente" });
    const fan = str(b.fan, 60), request = str(b.request, 1500), kind = KINDS[b.kind] ? b.kind : "video";
    if (!fan) return res.status(400).json({ error: "Indique le pseudo du fan" });
    if (request.length < 8) return res.status(400).json({ error: "Décris la demande du fan" });
    const due = Number(b.due_at) || null; if (due && due < Date.now() - 864e5) return res.status(400).json({ error: "La date de livraison est passée" });
    const dur = b.duration != null && b.duration !== "" ? Math.max(0, Math.min(36000, Math.round(Number(b.duration)))) : null, qty = b.qty ? Math.max(1, Math.min(200, Math.round(Number(b.qty)))) : null;
    const id = db.prepare("INSERT INTO customs (sale_id, user_id, model_id, fan, kind, duration, qty, request, due_at, urgent, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(sale.id, req.user.id, sale.model_id, fan, kind, dur, qty, request, due, b.urgent ? 1 : 0, Date.now()).lastInsertRowid;
    const m = db.prepare("SELECT name FROM models WHERE id = ?").get(sale.model_id);
    log(req.user.id, "v", `**${req.user.username}** a demandé un contenu perso pour **${fan}**`, `${KINDS[kind]} · ${m ? m.name : ""}${due ? " · pour le " + new Date(due).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" }) : ""}`);
    res.json({ ok: true, id });
  });
  // ventes automatiques Twizz : le fan a payé sur Twizz (la vente arrive toute seule) ; le chatter envoie juste la demande au Studio
  // Snap : prix payé, créatrice, Snap du fan · contenu perso : prix payé, créatrice, pseudo du fan et sa demande
  app.post("/api/customs/direct", auth, (req, res) => {
    if (!["chatter", "admin"].includes(req.user.role)) return res.status(403).json({ error: "Réservé aux chatters" });
    const b = req.body || {}, model = db.prepare("SELECT id, name FROM models WHERE id = ?").get(parseInt(b.model_id, 10));
    if (!model) return res.status(400).json({ error: "Choisis la créatrice" });
    const price = Math.round(Number(String(b.price ?? "").replace(",", ".")) * 100) / 100;
    if (!(price > 0 && price <= 100000)) return res.status(400).json({ error: "Indique le prix payé par le fan" });
    const snap = b.kind === "snap";
    const fan = str(b.fan, 60).replace(/^@/, ""), kind = snap ? "snap" : KINDS[b.kind] && b.kind !== "snap" ? b.kind : "video";
    if (!fan) return res.status(400).json({ error: snap ? "Indique le Snap du fan" : "Indique le pseudo du fan" });
    const request = snap ? (str(b.request, 1500) || "Session Snap") : str(b.request, 1500);
    if (!snap && request.length < 8) return res.status(400).json({ error: "Décris la demande du fan" });
    const due = snap ? null : Number(b.due_at) || null; if (due && due < Date.now() - 864e5) return res.status(400).json({ error: "La date de livraison est passée" });
    const dur = !snap && b.duration != null && b.duration !== "" ? Math.max(0, Math.min(36000, Math.round(Number(b.duration)))) : null, qty = !snap && b.qty ? Math.max(1, Math.min(200, Math.round(Number(b.qty)))) : null;
    const id = db.prepare("INSERT INTO customs (sale_id, user_id, model_id, fan, kind, duration, qty, request, due_at, urgent, created_at, price) VALUES (NULL,?,?,?,?,?,?,?,?,?,?,?)")
      .run(req.user.id, model.id, fan, kind, dur, qty, request, due, b.urgent ? 1 : 0, Date.now(), price).lastInsertRowid;
    try { app.locals.twizzMatch && app.locals.twizzMatch(id); } catch (e) {}   // la vente est peut-être déjà arrivée de Twizz
    log(req.user.id, "v", snap ? `**${req.user.username}** a envoyé un Snap au Studio : **${fan}**` : `**${req.user.username}** a demandé un contenu perso pour **${fan}**`, `${snap ? "Snap" : KINDS[kind]} · ${model.name} · ${eur(price)}`);
    res.json({ ok: true, id, pay: payOf(db.prepare("SELECT * FROM customs WHERE id = ?").get(id)) });
  });
  app.get("/api/customs/mine", auth, (req, res) => {
    const rows = db.prepare(`${SEL} WHERE c.user_id = ? AND (c.status <> 'delivered' OR c.delivered_at > ?) ORDER BY c.created_at DESC LIMIT 60`).all(req.user.id, Date.now() - 30 * 864e5).map(pubC);
    res.json({ customs: rows, ready: rows.filter(c => c.status === "ready").length });
  });
  app.post("/api/customs/:id/seen", auth, (req, res) => { db.prepare("UPDATE customs SET seen = 1 WHERE id = ? AND user_id = ?").run(+req.params.id, req.user.id); res.json({ ok: true }); });
  app.post("/api/customs/:id/delivered", auth, (req, res) => {
    const c = getC(+req.params.id); if (!c || (c.user_id !== req.user.id && req.user.role !== "admin")) return res.status(404).json({ error: "Demande introuvable" });
    if (c.status !== "ready") return res.status(400).json({ error: "Le contenu n'est pas encore prêt" });
    db.prepare("UPDATE customs SET status = 'delivered', delivered_at = ?, seen = 1 WHERE id = ?").run(Date.now(), c.id);
    log(req.user.id, "v", `**${c.username}** a envoyé le contenu perso à **${c.fan}**`, `${c.model_name} · livré`);
    res.json({ ok: true });
  });
  app.get("/api/customs/:id/file", auth, (req, res) => {
    const c = db.prepare("SELECT * FROM customs WHERE id = ?").get(+req.params.id);
    if (!c || !c.file || (c.user_id !== req.user.id && req.user.role !== "admin")) return res.status(404).end();
    const f = path.join(ST, path.basename(c.file)); if (!fs.existsSync(f)) return res.status(404).end();
    if (req.query.dl) res.attachment(c.fname || path.basename(c.file));
    res.sendFile(f, { headers: { "Content-Type": c.mime || "application/octet-stream", "Cache-Control": "private, max-age=3600" } });
  });
  // manager
  app.get("/api/admin/customs", auth, admin, (req, res) => {
    const rows = db.prepare(`${SEL} WHERE c.status <> 'cancelled' AND (c.status <> 'delivered' OR c.delivered_at > ?) ORDER BY COALESCE(c.due_at, c.created_at + 7 * 86400000)`).all(Date.now() - 14 * 864e5).map(pubC);
    res.json({ customs: rows, models: db.prepare("SELECT id, name FROM models ORDER BY name").all() });
  });
  app.get("/api/admin/customs/count", auth, admin, (req, res) => res.json({ n: db.prepare("SELECT COUNT(*) n FROM customs WHERE status IN ('todo','prod')").get().n }));
  app.put("/api/admin/customs/:id", auth, admin, (req, res) => {
    const c = getC(+req.params.id); if (!c) return res.status(404).json({ error: "Demande introuvable" });
    const b = req.body || {};
    if (b.status && ["todo", "prod", "ready", "delivered", "cancelled"].includes(b.status)) {
      if (b.status === "ready" && !c.file) return res.status(400).json({ error: "Ajoute d'abord le fichier" });
      db.prepare("UPDATE customs SET status = ?, started_at = CASE WHEN ? = 'prod' AND started_at IS NULL THEN ? ELSE started_at END, ready_at = CASE WHEN ? = 'ready' THEN ? ELSE ready_at END, seen = CASE WHEN ? = 'ready' THEN 0 ELSE seen END, delivered_at = CASE WHEN ? = 'delivered' THEN COALESCE(delivered_at, ?) ELSE delivered_at END WHERE id = ?")
        .run(b.status, b.status, Date.now(), b.status, Date.now(), b.status, b.status, Date.now(), c.id);
    }
    if (b.mgr_note !== undefined) db.prepare("UPDATE customs SET mgr_note = ? WHERE id = ?").run(str(b.mgr_note, 600) || null, c.id);
    if (b.due_at !== undefined) db.prepare("UPDATE customs SET due_at = ? WHERE id = ?").run(Number(b.due_at) || null, c.id);
    res.json({ ok: true, custom: pubC(getC(c.id)) });
  });
  // envoi du fichier final en flux (pas de copie en mémoire, jusqu'à 800 Mo)
  app.post("/api/admin/customs/:id/upload", auth, admin, (req, res) => {
    const c = getC(+req.params.id); if (!c) return res.status(404).json({ error: "Demande introuvable" });
    const mime = (req.headers["content-type"] || "").split(";")[0], ext = MEDIA[mime];
    if (!ext) return res.status(400).json({ error: "Format non pris en charge (vidéo, photo, audio ou zip)" });
    const len = Number(req.headers["content-length"] || 0); if (len > MAX_UPLOAD) return res.status(413).json({ error: "Fichier trop lourd (800 Mo max)" });
    const name = `custom-${c.id}-${Date.now().toString(36)}.${ext}`, tmp = path.join(ST, name + ".part"), out = fs.createWriteStream(tmp);
    let size = 0, failed = false;
    req.on("data", ch => { size += ch.length; if (size > MAX_UPLOAD && !failed) { failed = true; req.unpipe(out); out.destroy(); fs.rm(tmp, { force: true }, () => {}); res.status(413).json({ error: "Fichier trop lourd (800 Mo max)" }); } });
    req.pipe(out);
    out.on("finish", () => { if (failed) return;
      if (size < 100) { fs.rm(tmp, { force: true }, () => {}); return res.status(400).json({ error: "Fichier vide" }); }
      fs.renameSync(tmp, path.join(ST, name));
      if (c.file) fs.rm(path.join(ST, path.basename(c.file)), { force: true }, () => {});
      const fname = str(decodeURIComponent(req.headers["x-filename"] || ""), 120) || name;
      db.prepare("UPDATE customs SET file = ?, mime = ?, size = ?, fname = ?, status = 'ready', ready_at = ?, seen = 0, started_at = COALESCE(started_at, ?) WHERE id = ?").run(name, mime, size, fname, Date.now(), Date.now(), c.id);
      log(req.user.id, "v", `Contenu perso prêt pour **${c.username}**`, `${c.fan} · ${c.model_name} · transmis au chatter`);
      res.json({ ok: true, custom: pubC(getC(c.id)) }); });
    out.on("error", () => { if (!failed) { failed = true; res.status(500).json({ error: "Échec de l'envoi" }); } });
    req.on("aborted", () => { failed = true; out.destroy(); fs.rm(tmp, { force: true }, () => {}); });
  });
  app.delete("/api/admin/customs/:id/file", auth, admin, (req, res) => {
    const c = getC(+req.params.id); if (!c) return res.status(404).json({ error: "Demande introuvable" });
    if (c.file) fs.rm(path.join(ST, path.basename(c.file)), { force: true }, () => {});
    db.prepare("UPDATE customs SET file = NULL, mime = NULL, size = NULL, fname = NULL, status = CASE WHEN status IN ('ready','delivered') THEN 'prod' ELSE status END WHERE id = ?").run(c.id);
    res.json({ ok: true });
  });

  /* ===================== FICHES DES CRÉATRICES ===================== */
  const PROFILE_KEYS = { tagline: 140, age: 10, city: 60, sign: 30, accent: 9, voice: 1200, emojis: 60, story: 1500, fanTips: 1200 };
  const LIST_KEYS = { traits: 12, likes: 16, avoid: 16, does: 16, doesnt: 16, catalogue: 20, samples: 6 };
  const SLIDERS = ["douceur", "familiarite", "emojis", "rythme"];
  function cleanProfile(p) {
    const o = {}; p = p || {};
    for (const [k, n] of Object.entries(PROFILE_KEYS)) o[k] = str(p[k], n);
    if (!/^#[0-9a-f]{6}$/i.test(o.accent)) o.accent = "";
    for (const [k, n] of Object.entries(LIST_KEYS)) o[k] = (Array.isArray(p[k]) ? p[k] : String(p[k] || "").split("\n")).map(x => str(x, 200)).filter(Boolean).slice(0, n);
    o.sliders = {}; SLIDERS.forEach(k => { const v = Number(p.sliders?.[k]); o.sliders[k] = Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 50; });
    return o;
  }
  const photoUrl = (m, i) => `/api/creators/${m.id}/photo/${i}?v=${encodeURIComponent((J(m.photos, [])[i] || "").slice(-10))}`;
  app.get("/api/creators", auth, (req, res) => {
    if (req.user.role === "trainee") return res.status(403).json({ error: "Réservé aux chatters" });
    const now = Date.now(), since = now - 30 * 864e5;
    const live = db.prepare("SELECT c.model_id, u.username FROM clocks c JOIN users u ON u.id = c.user_id WHERE c.end_at IS NULL").all();
    const ms = db.prepare("SELECT * FROM models ORDER BY name").all().map(m => {
      const mine = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) t, MAX(amount) best FROM sales WHERE user_id = ? AND model_id = ? AND status = 'validated'").get(req.user.id, m.id);
      const team = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) t, ROUND(AVG(amount)) avg FROM sales WHERE model_id = ? AND status = 'validated' AND sold_at > ?").get(m.id, since);
      const top = db.prepare("SELECT u.username, SUM(s.amount) t FROM sales s JOIN users u ON u.id = s.user_id WHERE s.model_id = ? AND s.status = 'validated' AND s.sold_at > ? GROUP BY s.user_id ORDER BY t DESC LIMIT 1").get(m.id, since);
      const hours = db.prepare("SELECT s.amount, s.sold_at FROM sales s WHERE s.model_id = ? AND s.status = 'validated' AND s.sold_at > ?").all(m.id, since * 1 - 60 * 864e5);
      const byH = Array(24).fill(0); hours.forEach(x => { byH[+new Date(x.sold_at).toLocaleTimeString("fr-FR", { hour: "2-digit", timeZone: "Europe/Paris" }).slice(0, 2)] += x.amount; });
      const fo = J(m.photo_focus, {});
      return { id: m.id, name: m.name, style: m.style, prices: m.prices, profile: cleanProfile(J(m.profile, {})), photos: J(m.photos, []).map((_, i) => photoUrl(m, i)), focus: J(m.photos, []).map(f => fo[f] || [50, 35]),
        mine: { n: mine.n, total: Math.round(mine.t), best: mine.best || 0 }, team: { n: team.n, total: Math.round(team.t), avg: team.avg || 0, top: top ? top.username : null },
        goldHour: byH.some(v => v) ? byH.indexOf(Math.max(...byH)) : null, live: [...new Set(live.filter(l => l.model_id === m.id).map(l => l.username))] };
    });
    res.json({ creators: ms, admin: req.user.role === "admin" });
  });
  app.put("/api/admin/creators/:id/profile", auth, admin, (req, res) => {
    const m = db.prepare("SELECT * FROM models WHERE id = ?").get(+req.params.id); if (!m) return res.status(404).json({ error: "Créatrice introuvable" });
    const p = cleanProfile(req.body?.profile); db.prepare("UPDATE models SET profile = ? WHERE id = ?").run(JSON.stringify(p), m.id);
    log(req.user.id, "a", `a mis à jour la fiche de **${m.name}**`, "Fiche pour les chatters"); res.json({ ok: true, profile: p });
  });
  app.post("/api/admin/creators/:id/photo", auth, admin, express.raw({ type: "image/*", limit: "15mb" }), (req, res) => {
    const m = db.prepare("SELECT * FROM models WHERE id = ?").get(+req.params.id); if (!m) return res.status(404).json({ error: "Créatrice introuvable" });
    const mime = (req.headers["content-type"] || "").split(";")[0]; if (!IMG[mime] || !Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: "Image JPG, PNG, WEBP ou GIF" });
    const ph = J(m.photos, []); if (ph.length >= 8) return res.status(400).json({ error: "8 photos maximum" });
    const f = `creator-${m.id}-${Date.now().toString(36)}.${IMG[mime]}`; fs.writeFileSync(path.join(UP, f), req.body);
    const front = req.query.cover === "1"; front ? ph.unshift(f) : ph.push(f); db.prepare("UPDATE models SET photos = ? WHERE id = ?").run(JSON.stringify(ph), m.id);
    res.json({ ok: true });
  });
  app.delete("/api/admin/creators/:id/photo/:i", auth, admin, (req, res) => {
    const m = db.prepare("SELECT * FROM models WHERE id = ?").get(+req.params.id); if (!m) return res.status(404).json({ error: "Créatrice introuvable" });
    const ph = J(m.photos, []), i = +req.params.i; if (ph[i]) { fs.rm(path.join(UP, path.basename(ph[i])), { force: true }, () => {}); ph.splice(i, 1); }
    db.prepare("UPDATE models SET photos = ? WHERE id = ?").run(JSON.stringify(ph), m.id); res.json({ ok: true });
  });
  app.post("/api/admin/creators/:id/photo/:i/cover", auth, admin, (req, res) => {
    const m = db.prepare("SELECT * FROM models WHERE id = ?").get(+req.params.id); if (!m) return res.status(404).json({ error: "Créatrice introuvable" });
    const ph = J(m.photos, []), i = +req.params.i; if (ph[i]) { const [x] = ph.splice(i, 1); ph.unshift(x); }
    db.prepare("UPDATE models SET photos = ? WHERE id = ?").run(JSON.stringify(ph), m.id); res.json({ ok: true });
  });
  // point de la photo à garder visible quand elle est recadrée (carte verticale, vignettes)
  app.post("/api/admin/creators/:id/photo/:i/focus", auth, admin, (req, res) => {
    const m = db.prepare("SELECT * FROM models WHERE id = ?").get(+req.params.id), f = m && J(m.photos, [])[+req.params.i]; if (!f) return res.status(404).json({ error: "Photo introuvable" });
    const c = v => Math.max(0, Math.min(100, Math.round(Number(v) || 0))), fo = J(m.photo_focus, {}); fo[f] = [c(req.body?.x), c(req.body?.y)];
    db.prepare("UPDATE models SET photo_focus = ? WHERE id = ?").run(JSON.stringify(fo), m.id); res.json({ ok: true });
  });
  app.get("/api/creators/:id/photo/:i", auth, (req, res) => {
    const m = db.prepare("SELECT photos FROM models WHERE id = ?").get(+req.params.id), f = m && J(m.photos, [])[+req.params.i];
    if (!f) return res.status(404).end(); const p = path.join(UP, path.basename(f)); if (!fs.existsSync(p)) return res.status(404).end();
    res.sendFile(p, { headers: { "Cache-Control": "private, max-age=604800" } });
  });

  /* ===================== PAUSES ===================== */
  const mainClock = uid => db.prepare("SELECT c.*, m.name model_name FROM clocks c JOIN models m ON m.id = c.model_id WHERE c.user_id = ? AND c.end_at IS NULL AND c.reinforce = 0").get(uid);
  const cfg = () => { const a = AG(); return { max: a.pauseMax ?? 15, count: a.pauseCount ?? 2 }; };
  function sweepPauses() {
    try {
      db.prepare("UPDATE pauses SET end_at = (SELECT end_at FROM clocks WHERE clocks.id = pauses.clock_id) WHERE end_at IS NULL AND (SELECT end_at FROM clocks WHERE clocks.id = pauses.clock_id) IS NOT NULL").run();
      const { max } = cfg(), now = Date.now();
      db.prepare("SELECT p.*, u.username FROM pauses p JOIN users u ON u.id = p.user_id WHERE p.end_at IS NULL AND p.over_logged = 0 AND p.start_at < ?").all(now - max * 60e3).filter(p => p.start_at < now - (max + (p.bonus || 0)) * 60e3).forEach(p => {
        db.prepare("UPDATE pauses SET over_logged = 1 WHERE id = ?").run(p.id);
        log(p.user_id, "pl", `**${p.username}** dépasse sa pause`, `Pause commencée à ${new Date(p.start_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })} · limite ${max} min`);
      });
    } catch (e) {}
  }
  setInterval(sweepPauses, 30e3);
  const pauseState = uid => {
    sweepPauses(); const c = mainClock(uid), k = cfg();
    const list = c ? db.prepare("SELECT id, start_at, end_at, bonus FROM pauses WHERE clock_id = ? ORDER BY start_at").all(c.id) : [];
    const open = list.find(p => !p.end_at) || null;
    return { enabled: k.count > 0, max: k.max + (open && open.bonus ? open.bonus : 0), bonus: open && open.bonus ? open.bonus : 0, count: k.count, used: list.length, left: Math.max(0, k.count - list.length), open, list, clock: c ? { id: c.id, start_at: c.start_at, model_name: c.model_name } : null,
      total: list.reduce((t, p) => t + ((p.end_at || Date.now()) - p.start_at), 0),
      bonusLeft: (() => { try { const r = db.prepare("SELECT qty FROM stella_inv WHERE user_id = ? AND item_id = 'pause15'").get(uid); return r ? r.qty : 0; } catch (e) { return 0; } })() };
  };
  app.get("/api/pause/me", auth, (req, res) => res.json(pauseState(req.user.id)));
  app.post("/api/pause/start", auth, (req, res) => {
    const s = pauseState(req.user.id);
    if (!s.clock) return res.status(400).json({ error: "Commence d'abord ton shift" });
    if (!s.enabled) return res.status(400).json({ error: "Les pauses sont désactivées par le manager" });
    if (s.open) return res.status(400).json({ error: "Tu es déjà en pause" });
    if (s.left <= 0) return res.status(400).json({ error: `Tu as déjà pris tes ${s.count} pause${s.count > 1 ? "s" : ""} de ce shift` });
    db.prepare("INSERT INTO pauses (user_id, clock_id, start_at) VALUES (?,?,?)").run(req.user.id, s.clock.id, Date.now());
    log(req.user.id, "pl", `**${req.user.username}** est en pause`, `${s.used + 1}ᵉ pause sur ${s.count} · ${s.clock.model_name}`);
    res.json({ ok: true, state: pauseState(req.user.id) });
  });
  app.post("/api/pause/end", auth, (req, res) => {
    const s = pauseState(req.user.id); if (!s.open) return res.status(400).json({ error: "Tu n'es pas en pause" });
    const now = Date.now(), min = Math.round((now - s.open.start_at) / 60e3);
    db.prepare("UPDATE pauses SET end_at = ? WHERE id = ?").run(now, s.open.id);
    if (min > s.max) log(req.user.id, "pl", `**${req.user.username}** reprend après **${min} min** de pause`, `Dépassement de ${min - s.max} min (limite ${s.max} min)`);
    res.json({ ok: true, state: pauseState(req.user.id) });
  });
  app.get("/api/admin/pauses/live", auth, admin, (req, res) => {
    sweepPauses(); const { max } = cfg();
    res.json({ max, pauses: db.prepare("SELECT p.id, p.user_id, p.start_at, u.username, m.name model_name FROM pauses p JOIN users u ON u.id = p.user_id JOIN clocks c ON c.id = p.clock_id JOIN models m ON m.id = c.model_id WHERE p.end_at IS NULL").all() });
  });
  // stats des pauses d'un chatter (fiche manager)
  app.get("/api/admin/pauses/user/:id", auth, admin, (req, res) => {
    const { max } = cfg(), rows = db.prepare("SELECT start_at, end_at FROM pauses WHERE user_id = ? AND start_at > ? ORDER BY start_at DESC").all(+req.params.id, Date.now() - 14 * 864e5);
    const d = rows.map(p => ((p.end_at || Date.now()) - p.start_at) / 60e3);
    res.json({ max, n: rows.length, avg: d.length ? Math.round(d.reduce((a, b) => a + b, 0) / d.length) : 0, over: d.filter(x => x > max).length, recent: rows.slice(0, 6) });
  });

  return { pauseState, openPauses: () => db.prepare("SELECT user_id, start_at FROM pauses WHERE end_at IS NULL").all() };
};
