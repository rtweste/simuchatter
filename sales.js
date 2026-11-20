// Ventes déclarées par les chatters (capture d'écran + montant brut), validées ou refusées par le manager.
const express = require("express");
const path = require("path");
const fs = require("fs");

const TZ = "Europe/Paris";
const parisDate = ms => new Date(ms).toLocaleDateString("sv-SE", { timeZone: TZ });
const periodOfDate = d => { const [y, m, day] = d.split("-"); return `${y}-${m}-${Number(day) <= 15 ? "A" : "B"}`; };
// "2026-11-18T14:32" (heure de Paris) → timestamp
const parisMs = str => { const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(str || ""); if (!m) return null;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const off = (new Date(utc).toLocaleString("en-US", { timeZone: TZ, timeZoneName: "shortOffset" }).match(/GMT([+-]\d+)/) || [])[1];
  return utc - (off ? +off : 1) * 3600e3; };
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
  // com_amount : part de la vente qui compte pour le chatter (null = toute la vente) ; le CA garde toujours le montant entier
  for (const [c, t] of [["ai_amount", "REAL"], ["ai_status", "TEXT"], ["ai_sale", "INTEGER"], ["ai_note", "TEXT"], ["ai_at", "INTEGER"], ["com_amount", "REAL"], ["com_reason", "TEXT"], ["declared_by", "INTEGER"], ["items", "TEXT"], ["ai_when", "INTEGER"]])
    if (!db.prepare("PRAGMA table_info(sales)").all().some(x => x.name === c)) db.exec(`ALTER TABLE sales ADD COLUMN ${c} ${t}`);
  const scans = new Map();   // empreinte de l'image → lecture déjà faite pendant que le chatter remplissait le formulaire
  const shaOf = buf => require("crypto").createHash("sha256").update(buf).digest("hex");
  async function scan(buf, mime, tag) {
    const k = shaOf(buf), c = scans.get(k); if (c && Date.now() - c.t < 3600e3) return c.r;
    if (!AI.saleCanRead(mime)) return null;
    const r = await AI.readSale(buf, mime, tag); if (r) { scans.set(k, { r, t: Date.now() }); if (scans.size > 500) scans.delete(scans.keys().next().value); }
    return r;
  }
  // heure lue sur la capture : gardée seulement si elle est plausible (pas dans le futur, moins de 60 jours)
  const whenOf = r => { const t = r && parisMs(r.heure_achat); return t && t < Date.now() + 3600e3 && t > Date.now() - 60 * 864e5 ? t : null; };
  const saveAi = (id, r) => db.prepare("UPDATE sales SET ai_amount = ?, ai_status = ?, ai_sale = ?, ai_note = ?, ai_at = ?, ai_when = ? WHERE id = ?")
    .run(r && typeof r.amount === "number" ? Math.round(r.amount * 100) / 100 : null, r ? r.status : "unread", r ? (r.is_sale ? 1 : 0) : null, r ? String(r.notes || "").slice(0, 200) || null : null, Date.now(), whenOf(r), id);
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
  /* ---------- Catégories, retard et historique des actions sur chaque vente ---------- */
  const SC = require("./salecats");
  db.exec(`CREATE TABLE IF NOT EXISTS sale_events (id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL, at INTEGER NOT NULL, by_id INTEGER, action TEXT NOT NULL, detail TEXT, from_user INTEGER, to_user INTEGER);
    CREATE INDEX IF NOT EXISTS sale_events_sale ON sale_events(sale_id, at);`);
  const logEv = (saleId, by, action, detail, from, to) => { try { db.prepare("INSERT INTO sale_events (sale_id, at, by_id, action, detail, from_user, to_user) VALUES (?,?,?,?,?,?,?)").run(saleId, Date.now(), by || null, action, detail || null, from || null, to || null); } catch (e) { console.error("journal vente", e.message); } };
  const euro = n => String(Math.round(n * 100) / 100).replace(".", ",") + " €";
  const UNIT_TXT = { photo: ["photo", "photos"], video: ["vidéo", "vidéos"], min: ["min", "min"] };
  const itemsOf = s => { try { const a = JSON.parse(s.items || "null"); return Array.isArray(a) ? a : null; } catch (e) { return null; } };
  // prix minimum attendu pour le contenu vendu (réglages actuels) ; null si aucune catégorie n'a de minimum
  const minOf = items => { if (!items) return null; const C = SC.cats(db); let t = 0, any = false;
    items.forEach(it => { const c = C.find(x => x.k === it.k); if (c && c.min) { any = true; t += c.min * (c.u ? it.q || 1 : 1); } });
    return any ? Math.round(t * 100) / 100 : null; };
  const lateOf = s => { const h = (s.created_at - s.sold_at) / 3.6e6; return h > SC.lateHours(db) ? Math.round(h) : null; };
  const whenOff = s => s.ai_when && Math.abs(s.ai_when - s.sold_at) > 3 * 3.6e6 ? s.ai_when : null;
  const pub = s => ({ id: s.id, user_id: s.user_id, username: s.username, model_id: s.model_id, model_name: s.model_name,
    amount: s.amount, declared_amount: s.declared_amount, sold_at: s.sold_at, note: s.note, status: s.status, reason: s.reason,
    // part du chatter : décidée à la validation, ou proposée par le manager qui a déclaré la vente (vente en attente)
    com_amount: s.status !== "refused" ? s.com_amount ?? null : null, com_reason: s.status !== "refused" ? s.com_reason || null : null,
    source: s.source || null, declared_by: s.declared_by || null, reviewer: s.reviewer, declarer: s.declared_by && s.declared_by !== s.user_id ? s.declarer || null : null, reviewed_at: s.reviewed_at, created_at: s.created_at, period: periodOfDate(parisDate(s.sold_at)), dup: dupInfo(s), ai: aiInfo(s),
    items: itemsOf(s), min_total: minOf(itemsOf(s)), late_h: lateOf(s), ai_when: s.ai_when || null, when_off: whenOff(s) });
  const SELECT = `SELECT s.*, u.username, m.name model_name, r.username reviewer, dd.username declarer FROM sales s
    JOIN users u ON u.id = s.user_id JOIN models m ON m.id = s.model_id LEFT JOIN users r ON r.id = s.reviewed_by LEFT JOIN users dd ON dd.id = s.declared_by`;

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

  // ventes automatiques Twizz : les chatters ne déclarent plus de ventes
  const twAuto = () => { try { const r = db.prepare("SELECT value FROM settings WHERE key = 'twizz_on'").get(); return !!r && r.value === "true"; } catch (e) { return false; } };
  app.get("/api/sales/cats", auth, (req, res) => res.json({ cats: SC.cats(db), lateHours: SC.lateHours(db), auto: twAuto() }));

  /* ---------- Déclarer une vente pour un autre chatter : fondateur et managers qui vendent ---------- */
  const canDeclareFor = u => u.role === "admin" && (u.rk === "founder" || !!(db.prepare("SELECT sells FROM users WHERE id = ?").get(u.id) || {}).sells);
  const targetsOf = me => db.prepare("SELECT id, username, role FROM users WHERE active = 1 AND id <> ? AND (role = 'chatter' OR (role = 'admin' AND sells = 1)) ORDER BY username COLLATE NOCASE").all(me);
  // « Ancien chatter » : compte technique (désactivé, invisible dans l'équipe) pour faire entrer au CA les ventes
  // d'un chatter qui n'est plus là, sans commission
  function exUser() {
    const k = db.prepare("SELECT value FROM settings WHERE key = 'ex_chatter'").get(), id = k && +k.value;
    if (id && db.prepare("SELECT 1 FROM users WHERE id = ?").get(id)) return id;
    let name = "Ancien chatter", n = 1; while (db.prepare("SELECT 1 FROM users WHERE username = ?").get(name)) name = "Ancien chatter " + ++n;
    const nid = db.prepare("INSERT INTO users (username, pass_hash, role, created_at, active, deleted_at) VALUES (?,?,?,?,0,?)").run(name, "!", "chatter", Date.now(), Date.now()).lastInsertRowid;
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ex_chatter', ?)").run(String(nid)); return nid;
  }
  app.get("/api/sales/targets", auth, (req, res) => {
    if (!canDeclareFor(req.user)) return res.status(403).json({ error: "Réservé au fondateur et aux managers qui vendent" });
    res.json({ self: !!(db.prepare("SELECT sells FROM users WHERE id = ?").get(req.user.id) || {}).sells, users: targetsOf(req.user.id), exId: exUser(),
      models: db.prepare("SELECT id, name FROM models ORDER BY name").all() });
  });

  /* ---------- Déclarer une vente (image envoyée telle quelle dans le corps de la requête) ---------- */
  app.post("/api/sales", auth, express.raw({ type: "image/*", limit: "12mb" }), (req, res) => {
    // ventes automatiques Twizz : les chatters ne déclarent plus (Snap et contenu perso : la demande part au Studio, la vente arrive de Twizz)
    if (twAuto() && req.user.role !== "admin") return res.status(400).json({ error: "Les ventes Twizz arrivent toutes seules. Pour un Snap ou un contenu perso, touche « Snap ou perso » : la demande part au Studio." });
    const model_id = parseInt(req.query.model_id, 10);
    const amount = num(String(req.query.amount || "").replace(",", "."), 0.01, 100000);
    const sold_at = num(req.query.sold_at, 1e12, 1e13) || Date.now();
    const note = String(req.query.note || "").slice(0, 300);
    const mime = (req.headers["content-type"] || "").split(";")[0];
    // vente déclarée pour un autre chatter (fondateur, ou manager qui vend)
    const forId = parseInt(req.query.for_user, 10), other = forId && forId !== req.user.id;
    if (other && !canDeclareFor(req.user)) return res.status(403).json({ error: "Seuls le fondateur et les managers qui vendent peuvent déclarer une vente pour un autre chatter" });
    const exTarget = other && forId === exUser();
    const target = other ? (exTarget ? { id: forId, username: "Ancien chatter" } : targetsOf(req.user.id).find(u => u.id === forId)) : null;
    if (other && !target) return res.status(400).json({ error: "Chatter introuvable ou inactif" });
    const uid = other ? target.id : req.user.id;
    // vente déclarée pour un chatter : le manager peut retirer tout ou partie de sa commission (ex. vente refusée qu'on fait entrer au CA)
    let com = null, comWhy = null;
    if (exTarget) { com = 0; comWhy = String(req.query.com_reason || "").trim().slice(0, 200) || "Vente d'un ancien chatter"; }
    else if (other && req.query.com_amount !== undefined && req.query.com_amount !== "") {
      com = num(String(req.query.com_amount).replace(",", "."), 0, 1e6);
      if (com === null) return res.status(400).json({ error: "Part du chatter invalide" });
      comWhy = String(req.query.com_reason || "").trim().slice(0, 200);
      if (!comWhy) return res.status(400).json({ error: "Indique pourquoi la commission est réduite : le chatter le verra" });
    }
    if (!other && req.user.role === "admin" && !(db.prepare("SELECT sells FROM users WHERE id = ?").get(req.user.id) || {}).sells) return res.status(403).json({ error: "Active « Déclare ses propres ventes » sur ton compte dans Équipe" });
    if (!db.prepare("SELECT 1 FROM models WHERE id = ?").get(model_id)) return res.status(400).json({ error: "Choisissez une créatrice" });
    if (amount === null) return res.status(400).json({ error: "Montant invalide" });
    // ce qui a été vendu : au moins une catégorie, avec sa quantité (photos, vidéos, minutes)
    let items; try { items = JSON.parse(String(req.query.items || "[]")); } catch (e) { items = []; }
    const C = SC.cats(db);
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "Choisis ce qui a été vendu (catégorie). Si tu ne vois pas les catégories, recharge la page." });
    const seenK = new Set(); items = items.slice(0, 12).map(it => { const c = C.find(x => x.k === String(it.k)); if (!c || seenK.has(c.k)) return null; seenK.add(c.k);
      const q = c.u ? Math.round(Number(it.q)) : null; if (c.u && !(q >= 1 && q <= 1000)) return { bad: c };
      // vidéo masturbation : avec ou sans jouet (obligatoire)
      if (c.k === "vmasturb") { if (!["avec jouet", "sans jouet"].includes(it.o)) return { badO: c }; return { k: c.k, l: c.l, u: c.u, q, o: it.o }; }
      return { k: c.k, l: c.l, u: c.u, q }; });
    if (items.some(x => !x)) return res.status(400).json({ error: "Catégorie inconnue : recharge la page" });
    const badO = items.find(x => x && x.badO); if (badO) return res.status(400).json({ error: `Indique si « ${badO.badO.l} » est avec ou sans jouet` });
    const badQ = items.find(x => x.bad); if (badQ) return res.status(400).json({ error: `Indique le nombre de ${UNIT_TXT[badQ.bad.u][1]} pour « ${badQ.bad.l} »` });
    if (items.some(x => x.k === "autre") && !note.trim()) return res.status(400).json({ error: "Pour « Autre », précise dans la note ce qui a été vendu" });
    if (sold_at > Date.now() + 5 * 60e3) return res.status(400).json({ error: "La date de vente est dans le futur" });
    if (locked(sold_at)) return res.status(400).json({ error: "Cette quinzaine est clôturée : la vente ne peut plus être ajoutée" });
    if (!MIME[mime] || !Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: "Ajoutez une capture d'écran (image)" });
    let fp = null; try { fp = IH.fingerprint(req.body, mime); } catch (e) {}
    // même capture déjà déclarée par ce chatter : on le prévient tout de suite plutôt que de la faire refuser
    if (fp) { const mine = db.prepare("SELECT amount, sold_at FROM sales WHERE sha = ? AND user_id = ? AND status <> 'refused' ORDER BY id DESC LIMIT 1").get(fp.sha, uid);
      if (mine && other) return res.status(409).json({ error: `Cette capture est déjà déclarée pour ${target.username} (vente de ${String(mine.amount).replace(".", ",")} €).` });
      if (mine) return res.status(409).json({ error: `Tu as déjà déclaré cette capture (vente de ${String(mine.amount).replace(".", ",")} € du ${new Date(mine.sold_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" })}). Si c'est une autre vente, prends une nouvelle capture.` }); }
    if (com !== null) { com = Math.round(com * 100) / 100; if (com >= amount) { com = null; comWhy = null; } }
    const info = db.prepare(`INSERT INTO sales (user_id, model_id, amount, declared_amount, sold_at, note, mime, created_at, declared_by, items, com_amount, com_reason)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(uid, model_id, amount, amount, sold_at, note, mime, Date.now(), other ? req.user.id : null, JSON.stringify(items), com, comWhy);
    logEv(info.lastInsertRowid, req.user.id, "declared", `${euro(amount)}${other ? " pour " + target.username : ""}${com !== null ? ` · ${com > 0 ? euro(com) + " pour le chatter" : "hors commission"} · ${comWhy}` : ""}`, null, other && !exTarget ? uid : null);
    const file = `sale-${info.lastInsertRowid}-${Date.now().toString(36)}.${MIME[mime]}`;
    fs.writeFileSync(path.join(UP, file), req.body);
    db.prepare("UPDATE sales SET image = ? WHERE id = ?").run(file, info.lastInsertRowid);
    if (fp) { db.prepare("UPDATE sales SET sha = ?, phash = ?, ratio = ? WHERE id = ?").run(fp.sha, fp.phash, fp.ratio, info.lastInsertRowid);
      try { saveDup(info.lastInsertRowid, findDup(info.lastInsertRowid, fp, req.body, mime)); } catch (e) {} }
    analyze(info.lastInsertRowid, req.body, mime, uid);   // en arrière-plan : ne ralentit pas l'envoi
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
    logEv(s.id, req.user.id, "deleted", euro(s.amount), s.user_id);
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
    // ventes Twizz : de quoi ouvrir la conversation du fan sur la vente (créatrice, conversation, fan, PPV envoyé depuis le site)
    try { const tq = db.prepare("SELECT creator_id, conv_id, fan_id, fan_name, at FROM twizz_tx WHERE sale_id = ?"), sq = db.prepare("SELECT msg_id FROM twizz_sent WHERE conv_id = ? AND price > 0 AND at <= ? AND at > ? ORDER BY at DESC LIMIT 1");
      rows.forEach(r => { const t = tq.get(r.id); if (!t || !t.conv_id || !t.fan_id) return; let m = null; try { m = sq.get(t.conv_id, t.at + 60e3, t.at - 7 * 864e5); } catch (e) {}
        r.tw = { cr: t.creator_id, conv: t.conv_id, fan: t.fan_id, name: t.fan_name || "", at: t.at, msg: (m && m.msg_id) || "" }; }); } catch (e) {}
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
    // un manager qui déclare ses ventes ne les valide pas lui-même (un autre manager ou le fondateur s'en charge)
    if (s.user_id === req.user.id && req.user.rk !== "founder") return res.status(403).json({ error: "C'est ta propre vente : un autre manager ou le fondateur doit la valider" });
    if (s.declared_by === req.user.id && req.user.rk !== "founder" && req.body?.decision !== "pending") return res.status(403).json({ error: "Tu as déclaré cette vente toi-même : un autre manager ou le fondateur doit la valider" });
    const decision = req.body?.decision;
    if (!["validated", "refused", "pending"].includes(decision)) return res.status(400).json({ error: "Décision invalide" });
    let amount = s.amount;
    if (req.body.amount !== undefined && req.body.amount !== "") {
      amount = num(String(req.body.amount).replace(",", "."), 0.01, 100000);
      if (amount === null) return res.status(400).json({ error: "Montant invalide" });
    }
    // commission réduite : la vente entre dans le CA mais ne compte (en partie ou pas du tout) pour le chatter
    let com = null, comWhy = null;
    if (decision === "validated" && req.body.com_amount !== undefined && req.body.com_amount !== null && req.body.com_amount !== "") {
      com = num(String(req.body.com_amount).replace(",", "."), 0, amount);
      if (com === null) return res.status(400).json({ error: `La part du chatter doit être entre 0 et ${String(amount).replace(".", ",")} €` });
      com = Math.round(com * 100) / 100;
      if (com >= amount) com = null;
      else { comWhy = String(req.body.com_reason || "").trim().slice(0, 200); if (!comWhy) return res.status(400).json({ error: "Indique la raison : le chatter la verra" }); }
    }
    db.prepare("UPDATE sales SET status = ?, amount = ?, reason = ?, reviewed_by = ?, reviewed_at = ?, com_amount = ?, com_reason = ? WHERE id = ?")
      .run(decision, amount, decision === "refused" ? String(req.body.reason || "").slice(0, 300) : null,
        decision === "pending" ? null : req.user.id, decision === "pending" ? null : Date.now(), com, comWhy, s.id);
    logEv(s.id, req.user.id, decision, decision === "validated" ? `${euro(amount)}${amount !== s.amount ? ` (déclarée ${euro(s.amount)})` : ""}${com !== null ? ` · ${com > 0 ? euro(com) + " pour le chatter" : "hors commission"} · ${comWhy}` : ""}`
      : decision === "refused" ? (String(req.body.reason || "").slice(0, 200) || null) : `était ${s.status === "validated" ? "validée" : s.status === "refused" ? "refusée" : "en attente"}`);
    res.json({ ok: true });
  });

  /* ---------- Modifier une vente : chatter, créatrice, date (réattribution) ---------- */
  const people = () => db.prepare("SELECT id, username, role FROM users WHERE active = 1 AND (role = 'chatter' OR (role = 'admin' AND sells = 1)) ORDER BY username COLLATE NOCASE").all();
  app.get("/api/admin/sales/people", auth, admin, (req, res) => res.json({ users: people(), models: db.prepare("SELECT id, name FROM models ORDER BY name").all() }));
  app.post("/api/admin/sales/:id/edit", auth, admin, (req, res) => {
    const s = db.prepare(`${SELECT} WHERE s.id = ?`).get(parseInt(req.params.id, 10));
    if (!s) return res.status(404).json({ error: "Vente introuvable" });
    const b = req.body || {}, founder = req.user.rk === "founder";
    const uid = b.user_id ? parseInt(b.user_id, 10) : s.user_id, mid = b.model_id ? parseInt(b.model_id, 10) : s.model_id;
    const at = b.sold_at ? num(b.sold_at, 1e12, 1e13) : s.sold_at;
    if (!at) return res.status(400).json({ error: "Date invalide" });
    if (at > Date.now() + 5 * 60e3) return res.status(400).json({ error: "La date de vente est dans le futur" });
    if (!founder && (s.user_id === req.user.id || uid === req.user.id)) return res.status(403).json({ error: "Une vente qui te concerne est modifiée par un autre manager ou le fondateur" });
    if (locked(s.sold_at) || locked(at)) return res.status(400).json({ error: "Cette quinzaine est clôturée : rouvre-la dans la Compta pour modifier cette vente" });
    const u = uid === s.user_id ? { id: s.user_id, username: s.username } : people().find(x => x.id === uid);
    if (!u) return res.status(400).json({ error: "Chatter introuvable ou inactif" });
    const m = db.prepare("SELECT id, name FROM models WHERE id = ?").get(mid); if (!m) return res.status(400).json({ error: "Créatrice introuvable" });
    const ch = [];
    if (u.id !== s.user_id) ch.push(`chatter : ${s.username} → ${u.username}`);
    if (m.id !== s.model_id) ch.push(`créatrice : ${s.model_name} → ${m.name}`);
    const dfmt = ms => new Date(ms).toLocaleString("fr-FR", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    if (Math.abs(at - s.sold_at) >= 60e3) ch.push(`date : ${dfmt(s.sold_at)} → ${dfmt(at)}`);
    if (!ch.length) return res.json({ ok: true, changed: false, sale: pub(s) });
    db.prepare("UPDATE sales SET user_id = ?, model_id = ?, sold_at = ? WHERE id = ?").run(u.id, m.id, at, s.id);
    logEv(s.id, req.user.id, "edited", ch.join(" · "), u.id !== s.user_id ? s.user_id : null, u.id !== s.user_id ? u.id : null);
    res.json({ ok: true, changed: true, sale: pub(db.prepare(`${SELECT} WHERE s.id = ?`).get(s.id)) });
  });
  // historique d'une vente (qui a fait quoi et quand)
  const ACT = { declared: "Déclarée", validated: "Validée", refused: "Refusée", pending: "Remise en attente", edited: "Modifiée", deleted: "Supprimée" };
  app.get("/api/admin/sales/:id/events", auth, admin, (req, res) => {
    const id = parseInt(req.params.id, 10), s = db.prepare(`${SELECT} WHERE s.id = ?`).get(id);
    let ev = db.prepare("SELECT e.at, e.action, e.detail, u.username who FROM sale_events e LEFT JOIN users u ON u.id = e.by_id WHERE e.sale_id = ? ORDER BY e.at, e.id").all(id);
    // ventes d'avant l'historique : on reconstitue ce qu'on sait
    if (s && !ev.some(e => e.action === "declared")) ev.unshift({ at: s.created_at, action: "declared", detail: euro(s.declared_amount), who: s.declarer || s.username, old: true });
    if (s && !ev.some(e => e.action !== "declared") && s.reviewed_at && s.status !== "pending") ev.push({ at: s.reviewed_at, action: s.status, detail: s.status === "refused" ? s.reason : euro(s.amount), who: s.reviewer, old: true });
    res.json({ events: ev.map(e => ({ ...e, label: ACT[e.action] || e.action })) });
  });

  /* ---------- Pour la compta : ventes validées par chatter et créatrice sur une période ---------- */
  // forCom : montants qui comptent pour la paie des chatters (part réduite si le manager l'a décidé), sinon montants du CA
  return function validatedByPeriod(pkey, forCom) {
    const out = {};
    db.prepare(`SELECT user_id, model_id, ${forCom ? "COALESCE(com_amount, amount)" : "amount"} amount, sold_at FROM sales WHERE status = 'validated'`).all()
      .filter(s => periodOfDate(parisDate(s.sold_at)) === pkey)
      .forEach(s => { const k = s.user_id + ":" + s.model_id; out[k] = (out[k] || 0) + s.amount; });
    return out;
  };
};
