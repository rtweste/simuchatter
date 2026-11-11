// Ventes déclarées par les chatters (capture d'écran + montant brut), validées ou refusées par le manager.
const express = require("express");
const path = require("path");
const fs = require("fs");

const TZ = "Europe/Paris";
const parisDate = ms => new Date(ms).toLocaleDateString("sv-SE", { timeZone: TZ });
const periodOfDate = d => { const [y, m, day] = d.split("-"); return `${y}-${m}-${Number(day) <= 15 ? "A" : "B"}`; };
const MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "image/gif": "gif" };

module.exports = function mount(app, db, auth, admin, dataDir) {
  const UP = path.join(dataDir, "uploads");
  fs.mkdirSync(UP, { recursive: true });
  db.exec(`
  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, model_id INTEGER NOT NULL,
    amount REAL NOT NULL, declared_amount REAL NOT NULL, sold_at INTEGER NOT NULL, note TEXT,
    image TEXT, mime TEXT, status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT, reviewed_by INTEGER, reviewed_at INTEGER, created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS sales_status ON sales(status, created_at);
  CREATE INDEX IF NOT EXISTS sales_user ON sales(user_id, sold_at);
  `);
  const num = (v, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
  const pub = s => ({ id: s.id, user_id: s.user_id, username: s.username, model_id: s.model_id, model_name: s.model_name,
    amount: s.amount, declared_amount: s.declared_amount, sold_at: s.sold_at, note: s.note, status: s.status, reason: s.reason,
    reviewer: s.reviewer, reviewed_at: s.reviewed_at, created_at: s.created_at, period: periodOfDate(parisDate(s.sold_at)) });
  const SELECT = `SELECT s.*, u.username, m.name model_name, r.username reviewer FROM sales s
    JOIN users u ON u.id = s.user_id JOIN models m ON m.id = s.model_id LEFT JOIN users r ON r.id = s.reviewed_by`;

  /* ---------- Déclarer une vente (image envoyée telle quelle dans le corps de la requête) ---------- */
  app.post("/api/sales", auth, express.raw({ type: "image/*", limit: "12mb" }), (req, res) => {
    const model_id = parseInt(req.query.model_id, 10);
    const amount = num(String(req.query.amount || "").replace(",", "."), 0.01, 100000);
    const sold_at = num(req.query.sold_at, 1e12, 1e13) || Date.now();
    const note = String(req.query.note || "").slice(0, 300);
    const mime = (req.headers["content-type"] || "").split(";")[0];
    if (!db.prepare("SELECT 1 FROM models WHERE id = ?").get(model_id)) return res.status(400).json({ error: "Choisissez une créatrice" });
    if (amount === null) return res.status(400).json({ error: "Montant invalide" });
    if (sold_at > Date.now() + 5 * 60e3) return res.status(400).json({ error: "La date de vente est dans le futur" });
    if (!MIME[mime] || !Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: "Ajoutez une capture d'écran (image)" });
    const info = db.prepare(`INSERT INTO sales (user_id, model_id, amount, declared_amount, sold_at, note, mime, created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(req.user.id, model_id, amount, amount, sold_at, note, mime, Date.now());
    const file = `sale-${info.lastInsertRowid}-${Date.now().toString(36)}.${MIME[mime]}`;
    fs.writeFileSync(path.join(UP, file), req.body);
    db.prepare("UPDATE sales SET image = ? WHERE id = ?").run(file, info.lastInsertRowid);
    res.json({ ok: true, id: info.lastInsertRowid });
  });

  /* ---------- Mes ventes (chatter) ---------- */
  app.get("/api/sales/mine", auth, (req, res) => {
    const rows = db.prepare(`${SELECT} WHERE s.user_id = ? ORDER BY s.sold_at DESC LIMIT 300`).all(req.user.id).map(pub);
    // créatrices sur lesquelles le chatter est pointé en ce moment (principale puis renforts)
    let active = [];
    try { active = db.prepare("SELECT model_id, reinforce FROM clocks WHERE user_id = ? AND end_at IS NULL AND (until_at IS NULL OR until_at > ?) ORDER BY reinforce, start_at").all(req.user.id, Date.now()); } catch (e) {}
    res.json({ sales: rows, models: db.prepare("SELECT id, name FROM models ORDER BY name").all(), active });
  });
  app.delete("/api/sales/:id", auth, (req, res) => {
    const s = db.prepare("SELECT * FROM sales WHERE id = ?").get(parseInt(req.params.id, 10));
    if (!s) return res.status(404).json({ error: "Vente introuvable" });
    const isAdmin = req.user.role === "admin";
    if (!isAdmin && (s.user_id !== req.user.id || s.status !== "pending")) return res.status(403).json({ error: "Seules vos ventes en attente peuvent être supprimées" });
    if (s.image) fs.rm(path.join(UP, s.image), { force: true }, () => {});
    db.prepare("DELETE FROM sales WHERE id = ?").run(s.id);
    res.json({ ok: true });
  });

  /* ---------- Capture d'écran (visible par l'auteur et les managers) ---------- */
  app.get("/api/sales/:id/image", auth, (req, res) => {
    const s = db.prepare("SELECT user_id, image, mime FROM sales WHERE id = ?").get(parseInt(req.params.id, 10));
    if (!s || !s.image || (s.user_id !== req.user.id && req.user.role !== "admin")) return res.status(404).end();
    const f = path.join(UP, path.basename(s.image));
    if (!fs.existsSync(f)) return res.status(404).end();
    res.set("Content-Type", s.mime || "image/jpeg"); res.set("Cache-Control", "private, max-age=86400");
    fs.createReadStream(f).pipe(res);
  });

  /* ---------- Manager : file de validation ---------- */
  app.get("/api/admin/sales", auth, admin, (req, res) => {
    const where = []; const args = [];
    if (["pending", "validated", "refused"].includes(req.query.status)) { where.push("s.status = ?"); args.push(req.query.status); }
    if (req.query.user) { where.push("s.user_id = ?"); args.push(parseInt(req.query.user, 10)); }
    let rows = db.prepare(`${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${req.query.status === "pending" ? "s.created_at ASC" : "s.sold_at DESC"} LIMIT 500`).all(...args).map(pub);
    if (/^\d{4}-\d{2}-[AB]$/.test(req.query.period || "")) rows = rows.filter(r => r.period === req.query.period);
    res.json({ sales: rows, pending: db.prepare("SELECT COUNT(*) n FROM sales WHERE status = 'pending'").get().n,
      people: db.prepare("SELECT id, username FROM users ORDER BY username").all() });
  });
  app.get("/api/admin/sales/count", auth, admin, (req, res) =>
    res.json({ pending: db.prepare("SELECT COUNT(*) n FROM sales WHERE status = 'pending'").get().n }));
  app.post("/api/admin/sales/:id/review", auth, admin, (req, res) => {
    const s = db.prepare("SELECT * FROM sales WHERE id = ?").get(parseInt(req.params.id, 10));
    if (!s) return res.status(404).json({ error: "Vente introuvable" });
    const decision = req.body?.decision;
    if (!["validated", "refused", "pending"].includes(decision)) return res.status(400).json({ error: "Décision invalide" });
    let amount = s.amount;
    if (req.body.amount !== undefined && req.body.amount !== "") {
      amount = num(String(req.body.amount).replace(",", "."), 0.01, 100000);
      if (amount === null) return res.status(400).json({ error: "Montant invalide" });
    }
    db.prepare("UPDATE sales SET status = ?, amount = ?, reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?")
      .run(decision, amount, decision === "refused" ? String(req.body.reason || "").slice(0, 300) : null,
        decision === "pending" ? null : req.user.id, decision === "pending" ? null : Date.now(), s.id);
    res.json({ ok: true });
  });

  /* ---------- Pour la compta : ventes validées par chatter et créatrice sur une période ---------- */
  return function validatedByPeriod(pkey) {
    const out = {};
    db.prepare("SELECT user_id, model_id, amount, sold_at FROM sales WHERE status = 'validated'").all()
      .filter(s => periodOfDate(parisDate(s.sold_at)) === pkey)
      .forEach(s => { const k = s.user_id + ":" + s.model_id; out[k] = (out[k] || 0) + s.amount; });
    return out;
  };
};
