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
  // détection des captures en double (empreinte de l'image)
  const IH = require("./imghash");
  for (const [c, t] of [["sha", "TEXT"], ["phash", "TEXT"], ["ratio", "REAL"], ["dup_of", "INTEGER"], ["dup_kind", "TEXT"], ["dup_dist", "INTEGER"], ["dup_checked", "INTEGER"]])
    if (!db.prepare("PRAGMA table_info(sales)").all().some(x => x.name === c)) db.exec(`ALTER TABLE sales ADD COLUMN ${c} ${t}`);
  db.exec("CREATE INDEX IF NOT EXISTS sales_sha ON sales(sha)");
  const DUP_DAYS = 180;
  // cherche une vente plus ancienne avec la même capture (identique) ou une capture très ressemblante
  const fileOf = id => { const r = db.prepare("SELECT image, mime FROM sales WHERE id = ?").get(id); if (!r || !r.image) return null;
    const f = path.join(UP, path.basename(r.image)); return fs.existsSync(f) ? { buf: fs.readFileSync(f), mime: r.mime } : null; };
  function findDup(id, fp, buf, mime) {
    const since = Date.now() - DUP_DAYS * 864e5;
    const same = db.prepare("SELECT id FROM sales WHERE sha = ? AND id <> ? AND created_at > ? ORDER BY id LIMIT 1").get(fp.sha, id, since);
    if (same) return { of: same.id, kind: "same", dist: 0 };
    if (!fp.phash) return null;
    // 1) tri rapide par empreinte, 2) vérification fine pixel par pixel sur les quelques candidats
    const cands = [];
    for (const r of db.prepare("SELECT id, phash, ratio FROM sales WHERE phash IS NOT NULL AND id <> ? AND created_at > ?").all(id, since)) {
      if (fp.ratio && r.ratio && Math.abs(fp.ratio - r.ratio) > .08) continue;
      const d = IH.distance(fp.phash, r.phash); if (d <= IH.CLOSE) cands.push({ id: r.id, d });
    }
    if (!cands.length) return null;
    if (!buf) { const me = fileOf(id); if (!me) return null; buf = me.buf; mime = me.mime; }
    for (const c of cands.sort((a, b) => a.d - b.d).slice(0, 6)) {
      const o = fileOf(c.id); if (!o) continue;
      const diff = IH.fineDiff(buf, mime, o.buf, o.mime);
      if (diff !== null && diff <= IH.FINE) return { of: c.id, kind: "close", dist: Math.round(diff * 10000) };
    }
    return null;
  }
  const saveDup = (id, dup) => db.prepare("UPDATE sales SET dup_of = ?, dup_kind = ?, dup_dist = ?, dup_checked = 1 WHERE id = ?").run(dup ? dup.of : null, dup ? dup.kind : null, dup ? dup.dist : null, id);
  // anciennes ventes : on calcule leur empreinte en arrière-plan, sans ralentir le site
  (function backfill() {
    const rows = db.prepare("SELECT id, image, mime FROM sales WHERE sha IS NULL AND image IS NOT NULL ORDER BY id").all(); let i = 0;
    const step = () => { if (i >= rows.length) { const todo = db.prepare("SELECT id, sha, phash, ratio FROM sales WHERE dup_checked IS NULL AND sha IS NOT NULL ORDER BY id").all();
        todo.forEach(r => { try { saveDup(r.id, findDup(r.id, r)); } catch (e) {} }); return; }
      const r = rows[i++]; try { const f = path.join(UP, path.basename(r.image)); if (fs.existsSync(f)) { const fp = IH.fingerprint(fs.readFileSync(f), r.mime);
        db.prepare("UPDATE sales SET sha = ?, phash = ?, ratio = ? WHERE id = ?").run(fp.sha, fp.phash, fp.ratio, r.id); } else db.prepare("UPDATE sales SET sha = '', dup_checked = 1 WHERE id = ?").run(r.id); } catch (e) {}
      setTimeout(step, 30); };
    setTimeout(step, 4000);
  })();
  // lecture des captures par l'IA : montant et état du média (Accepté / En attente)
  const AI = require("./ai");
  for (const [c, t] of [["ai_amount", "REAL"], ["ai_status", "TEXT"], ["ai_sale", "INTEGER"], ["ai_note", "TEXT"], ["ai_at", "INTEGER"]])
    if (!db.prepare("PRAGMA table_info(sales)").all().some(x => x.name === c)) db.exec(`ALTER TABLE sales ADD COLUMN ${c} ${t}`);
  const scans = new Map();   // empreinte de l'image → lecture déjà faite pendant que le chatter remplissait le formulaire
  const shaOf = buf => require("crypto").createHash("sha256").update(buf).digest("hex");
  async function scan(buf, mime, tag) {
    const k = shaOf(buf), c = scans.get(k); if (c && Date.now() - c.t < 3600e3) return c.r;
    if (!AI.saleCanRead(mime)) return null;
    const r = await AI.readSale(buf, mime, tag); if (r) { scans.set(k, { r, t: Date.now() }); if (scans.size > 500) scans.delete(scans.keys().next().value); }
    return r;
  }
  const saveAi = (id, r) => db.prepare("UPDATE sales SET ai_amount = ?, ai_status = ?, ai_sale = ?, ai_note = ?, ai_at = ? WHERE id = ?")
    .run(r && typeof r.amount === "number" ? Math.round(r.amount * 100) / 100 : null, r ? r.status : "unread", r ? (r.is_sale ? 1 : 0) : null, r ? String(r.notes || "").slice(0, 200) || null : null, Date.now(), id);
  async function analyze(id, buf, mime, uid) { try { saveAi(id, await scan(buf, mime, { user: uid })); } catch (e) { console.error("lecture capture", id, e.message); try { saveAi(id, null); } catch (_) {} } }
  // verdict pour le manager
  const aiInfo = s => {
    if (!s.ai_at) return s.status === "pending" && s.image ? { state: "waiting" } : null;
    if (s.ai_status === "unread" || s.ai_sale === null) return { state: "unread" };
    const o = { amount: s.ai_amount, status: s.ai_status, note: s.ai_note };
    if (!s.ai_sale) return { ...o, state: "notsale" };
    if (s.ai_status === "pending") return { ...o, state: "pending" };
    if (s.ai_status === "refused") return { ...o, state: "refused" };
    if (s.ai_amount != null && Math.abs(s.ai_amount - s.declared_amount) > .5) return { ...o, state: "mismatch" };
    if (s.ai_amount == null) return { ...o, state: "noamount" };
    return { ...o, state: s.ai_status === "accepted" ? "ok" : "unsure" };
  };
  // ventes en attente pas encore lues (après la mise en ligne) : lues tranquillement en arrière-plan
  setTimeout(async function bf() { try {
    const r = db.prepare("SELECT id, image, mime, user_id FROM sales WHERE status = 'pending' AND ai_at IS NULL AND image IS NOT NULL ORDER BY id LIMIT 1").get();
    if (!r) return; const f = path.join(UP, path.basename(r.image));
    if (fs.existsSync(f)) await analyze(r.id, fs.readFileSync(f), r.mime, r.user_id); else saveAi(r.id, null);
    setTimeout(bf, 1500); } catch (e) {} }, 8000);
  const dupInfo = s => { if (!s.dup_of) return null; const o = db.prepare("SELECT s.id, s.user_id, s.amount, s.sold_at, s.status, u.username, m.name model_name FROM sales s JOIN users u ON u.id = s.user_id JOIN models m ON m.id = s.model_id WHERE s.id = ?").get(s.dup_of);
    return o ? { kind: s.dup_kind, dist: s.dup_dist, id: o.id, username: o.username, sameUser: o.user_id === s.user_id, amount: o.amount, sold_at: o.sold_at, status: o.status, model_name: o.model_name } : null; };
  const locked = ms => { try { return !!db.prepare("SELECT 1 FROM period_locks WHERE period = ?").get(periodOfDate(parisDate(ms))); } catch (e) { return false; } };
  const num = (v, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
  const pub = s => ({ id: s.id, user_id: s.user_id, username: s.username, model_id: s.model_id, model_name: s.model_name,
    amount: s.amount, declared_amount: s.declared_amount, sold_at: s.sold_at, note: s.note, status: s.status, reason: s.reason,
    reviewer: s.reviewer, reviewed_at: s.reviewed_at, created_at: s.created_at, period: periodOfDate(parisDate(s.sold_at)), dup: dupInfo(s), ai: aiInfo(s) });
  const SELECT = `SELECT s.*, u.username, m.name model_name, r.username reviewer FROM sales s
    JOIN users u ON u.id = s.user_id JOIN models m ON m.id = s.model_id LEFT JOIN users r ON r.id = s.reviewed_by`;

  /* ---------- Lecture de la capture pendant que le chatter remplit le formulaire (pré-remplit le montant) ---------- */
  const scanHits = new Map();
  app.post("/api/sales/scan", auth, express.raw({ type: "image/*", limit: "12mb" }), async (req, res) => {
    const mime = (req.headers["content-type"] || "").split(";")[0];
    if (!MIME[mime] || !Buffer.isBuffer(req.body) || req.body.length < 100) return res.json({ ok: false });
    const h = (scanHits.get(req.user.id) || []).filter(t => Date.now() - t < 3600e3); if (h.length >= 40) return res.json({ ok: false });   // garde-fou sur le coût
    h.push(Date.now()); scanHits.set(req.user.id, h);
    try { const r = await scan(req.body, mime, { user: req.user.id }); res.json({ ok: !!r, read: r || null }); }
    catch (e) { res.json({ ok: false }); }
  });

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
    if (locked(sold_at)) return res.status(400).json({ error: "Cette quinzaine est clôturée : la vente ne peut plus être ajoutée" });
    if (!MIME[mime] || !Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: "Ajoutez une capture d'écran (image)" });
    let fp = null; try { fp = IH.fingerprint(req.body, mime); } catch (e) {}
    // même capture déjà déclarée par ce chatter : on le prévient tout de suite plutôt que de la faire refuser
    if (fp) { const mine = db.prepare("SELECT amount, sold_at FROM sales WHERE sha = ? AND user_id = ? AND status <> 'refused' ORDER BY id DESC LIMIT 1").get(fp.sha, req.user.id);
      if (mine) return res.status(409).json({ error: `Tu as déjà déclaré cette capture (vente de ${String(mine.amount).replace(".", ",")} € du ${new Date(mine.sold_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" })}). Si c'est une autre vente, prends une nouvelle capture.` }); }
    const info = db.prepare(`INSERT INTO sales (user_id, model_id, amount, declared_amount, sold_at, note, mime, created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(req.user.id, model_id, amount, amount, sold_at, note, mime, Date.now());
    const file = `sale-${info.lastInsertRowid}-${Date.now().toString(36)}.${MIME[mime]}`;
    fs.writeFileSync(path.join(UP, file), req.body);
    db.prepare("UPDATE sales SET image = ? WHERE id = ?").run(file, info.lastInsertRowid);
    if (fp) { db.prepare("UPDATE sales SET sha = ?, phash = ?, ratio = ? WHERE id = ?").run(fp.sha, fp.phash, fp.ratio, info.lastInsertRowid);
      try { saveDup(info.lastInsertRowid, findDup(info.lastInsertRowid, fp, req.body, mime)); } catch (e) {} }
    analyze(info.lastInsertRowid, req.body, mime, req.user.id);   // en arrière-plan : ne ralentit pas l'envoi
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
    if (locked(s.sold_at)) return res.status(400).json({ error: "Cette quinzaine est clôturée : la vente ne peut plus être supprimée" });
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
  app.post("/api/admin/sales/:id/rescan", auth, admin, async (req, res) => {
    const r = db.prepare("SELECT id, image, mime, user_id FROM sales WHERE id = ?").get(parseInt(req.params.id, 10)); if (!r || !r.image) return res.status(404).json({ error: "Capture introuvable" });
    const f = path.join(UP, path.basename(r.image)); if (!fs.existsSync(f)) return res.status(404).json({ error: "Capture introuvable" });
    const buf = fs.readFileSync(f); scans.delete(shaOf(buf)); await analyze(r.id, buf, r.mime, r.user_id);
    res.json({ ok: true, sale: pub(db.prepare(`${SELECT} WHERE s.id = ?`).get(r.id)) });
  });
  app.post("/api/admin/sales/:id/review", auth, admin, (req, res) => {
    const s = db.prepare("SELECT * FROM sales WHERE id = ?").get(parseInt(req.params.id, 10));
    if (!s) return res.status(404).json({ error: "Vente introuvable" });
    if (locked(s.sold_at)) return res.status(400).json({ error: "Cette quinzaine est clôturée : rouvre-la dans la Compta pour modifier cette vente" });
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
