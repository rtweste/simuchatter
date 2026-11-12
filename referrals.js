// Parrainage : chaque chatter a un lien vers la candidature publique ; on suit ses filleuls jusqu'au recrutement
// et une prime (réglable) est proposée au manager quand le filleul a fini son premier mois.
const crypto = require("crypto");
module.exports = function mount(app, db, auth, admin, ctx) {
  const { compta, gest } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS referrals (id INTEGER PRIMARY KEY, app_id INTEGER UNIQUE NOT NULL, referrer_id INTEGER NOT NULL, created_at INTEGER NOT NULL,
      hired_at INTEGER, eligible_at INTEGER, status TEXT NOT NULL DEFAULT 'pending', prime REAL, decided_at INTEGER, decided_by INTEGER);
    CREATE TABLE IF NOT EXISTS ref_hits (user_id INTEGER NOT NULL, day TEXT NOT NULL, ip_hash TEXT NOT NULL, PRIMARY KEY (user_id, day, ip_hash));`);
  if (!db.prepare("PRAGMA table_info(applications)").all().some(x => x.name === "ref_user")) { try { db.exec("ALTER TABLE applications ADD COLUMN ref_user INTEGER"); } catch (e) {} }
  const getSet = (k, d) => { const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(k); return r ? r.value : d; };
  const setSet = (k, v) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
  const CFG = () => { let c = {}; try { c = JSON.parse(getSet("referral", "{}")); } catch (e) {} return { prime: c.prime ?? 50, days: c.days ?? 30 }; };
  const eur = n => (Math.round(n * 100) / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " €";
  const day = ms => new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const code = u => String(u.username || "").toLowerCase();
  // un parrain : chatter ou manager actif, trouvé par son identifiant (insensible à la casse)
  const byCode = c => { c = String(c || "").trim().toLowerCase().replace(/[^\w.\-]/g, "").slice(0, 40); if (!c) return null;
    return db.prepare("SELECT id, username, role, created_at FROM users WHERE lower(username) = ? AND active = 1 AND role IN ('chatter','admin')").get(c) || null; };

  // appelé par la candidature publique : rattache la candidature à son parrain
  function attach(appId, ref) { const u = byCode(ref); if (!u) return null;
    db.prepare("UPDATE applications SET ref_user = ? WHERE id = ?").run(u.id, appId);
    db.prepare("INSERT OR IGNORE INTO referrals (app_id, referrer_id, created_at) VALUES (?,?,?)").run(appId, u.id, Date.now());
    return u; }

  // suivi : recrutement (le compte élève devient chatter), puis fin du premier mois
  function sync() { try {
    const now = Date.now(), c = CFG();
    db.prepare(`SELECT r.*, a.status app_status, a.user_id, u.role, u.active FROM referrals r JOIN applications a ON a.id = r.app_id LEFT JOIN users u ON u.id = a.user_id
      WHERE r.status = 'pending'`).all().forEach(r => {
      if (r.app_status === "refused" || (r.user_id && r.active === 0)) { db.prepare("UPDATE referrals SET status = 'lost' WHERE id = ?").run(r.id); return; }
      if (r.user_id && r.role === "chatter" && !r.hired_at) { db.prepare("UPDATE referrals SET hired_at = ?, eligible_at = ? WHERE id = ?").run(now, now + c.days * 864e5, r.id); r.hired_at = now; r.eligible_at = now + c.days * 864e5; }
      if (r.hired_at && r.eligible_at <= now && r.role === "chatter") db.prepare("UPDATE referrals SET status = 'to_validate', prime = ? WHERE id = ?").run(c.prime, r.id);
    });
  } catch (e) { console.error("parrainage", e.message); } }
  setInterval(sync, 15 * 60e3).unref(); setTimeout(sync, 10e3).unref();

  // étapes du filleul : candidature → formation → entretien → recruté → 1er mois
  const STEPS = ["Candidature", "Formation", "Entretien", "Recruté", "1er mois"];
  function stageOf(r) {
    const now = Date.now();
    if (r.status === "paid") return { step: 5, tag: `Prime versée · ${eur(r.prime || 0)}`, kind: "paid" };
    if (r.status === "to_validate") return { step: 5, tag: "Prime en validation", kind: "wait" };
    if (r.status === "refused") return { step: 4, tag: "Prime refusée", kind: "off" };
    if (r.status === "lost" || r.app_status === "refused" || r.active === 0) return { step: 0, tag: "Pas retenu", kind: "off" };
    if (r.hired_at) return { step: 4, tag: `Recruté · prime dans ${Math.max(1, Math.ceil((r.eligible_at - now) / 864e5))} j`, kind: "on" };
    if (r.user_id && r.role === "trainee") {
      let t = null; try { t = gest.training && gest.training(r.user_id); } catch (e) {}
      const iv = db.prepare("SELECT done_at FROM interviews WHERE user_id = ?").get(r.user_id);
      if (t && t.done >= t.total && t.total) return { step: 3, tag: iv ? "Entretien en cours" : "Entretien à passer", kind: "on" };
      return { step: 2, tag: t && t.total ? `En formation · ${t.done}/${t.total}` : "En formation", kind: "on" };
    }
    return { step: 1, tag: r.app_status === "new" ? "Candidature reçue" : "Candidature acceptée", kind: "new" };
  }
  const ROWS = `SELECT r.*, a.first_name, a.at app_at, a.status app_status, a.user_id, a.ai_score, u.role, u.active, u.username fil_username, p.username ref_username
    FROM referrals r JOIN applications a ON a.id = r.app_id LEFT JOIN users u ON u.id = a.user_id JOIN users p ON p.id = r.referrer_id`;

  /* ----- page publique /postuler ----- */
  const hitsMem = new Map();
  app.get("/api/ref/:code", (req, res) => {
    const u = byCode(req.params.code); if (!u) return res.json({ ok: false });
    const months = Math.max(0, Math.floor((Date.now() - (u.created_at || Date.now())) / (30.4 * 864e5)));
    res.json({ ok: true, name: u.username, months, manager: u.role === "admin" });
  });
  app.post("/api/ref/:code/hit", (req, res) => {
    const u = byCode(req.params.code); if (!u) return res.json({ ok: false });
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    const h = crypto.createHash("sha256").update(ip + "|ref").digest("hex").slice(0, 16), k = h + day(Date.now());
    if ((hitsMem.get(k) || 0) > 30) return res.json({ ok: true }); hitsMem.set(k, (hitsMem.get(k) || 0) + 1); if (hitsMem.size > 5000) hitsMem.clear();
    try { db.prepare("INSERT OR IGNORE INTO ref_hits (user_id, day, ip_hash) VALUES (?,?,?)").run(u.id, day(Date.now()), h); } catch (e) {}
    res.json({ ok: true });
  });

  /* ----- chatter ----- */
  app.get("/api/referrals/me", auth, (req, res) => {
    sync(); const uid = req.user.id, c = CFG(), since = day(Date.now() - 90 * 864e5);
    const rows = db.prepare(`${ROWS} WHERE r.referrer_id = ? ORDER BY r.created_at DESC`).all(uid);
    const kids = rows.map(r => ({ id: r.id, name: r.fil_username || r.first_name, invited_at: r.created_at, ...stageOf(r) }));
    const paid = rows.filter(r => r.status === "paid").reduce((t, r) => t + (r.prime || 0), 0);
    const pending = rows.filter(r => r.status === "pending" || r.status === "to_validate").filter(r => !(r.app_status === "refused" || r.active === 0)).length * c.prime;
    res.json({ code: code(req.user), link: "/postuler?ref=" + encodeURIComponent(code(req.user)), prime: c.prime, days: c.days, steps: STEPS,
      stats: { clicks: db.prepare("SELECT COUNT(*) n FROM ref_hits WHERE user_id = ? AND day >= ?").get(uid, since).n, apps: rows.length,
        training: kids.filter(k => k.step === 2 || k.step === 3).length, hired: rows.filter(r => r.hired_at).length },
      paid, pending, kids });
  });

  // QR code du lien personnel (SVG)
  app.get("/api/referrals/qr.svg", auth, (req, res) => {
    const host = req.get("host") || "stellads.fr", proto = /^(localhost|127\.)/.test(host) ? "http" : "https";
    require("qrcode").toString(`${proto}://${host}/postuler?ref=${encodeURIComponent(code(req.user))}`, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0a0a0a", light: "#00000000" } }, (e, s) => {
      if (e) return res.status(500).end(); res.type("image/svg+xml").set("Cache-Control", "private, max-age=3600").send(s); });
  });
  app.get("/api/referrals/link", auth, (req, res) => { const host = req.get("host") || "stellads.fr", proto = /^(localhost|127\.)/.test(host) ? "http" : "https"; res.json({ url: `${proto}://${host}/postuler?ref=${encodeURIComponent(code(req.user))}` }); });

  /* ----- manager ----- */
  app.get("/api/admin/referrals", auth, admin, (req, res) => {
    sync(); const c = CFG(), since = Date.now() - 90 * 864e5;
    const rows = db.prepare(`${ROWS} ORDER BY r.created_at DESC`).all();
    const total = db.prepare("SELECT COUNT(*) n FROM applications WHERE at > ?").get(since).n;
    const refd = rows.filter(r => r.app_at > since);
    const hiredOf = list => list.filter(r => r.hired_at).length;
    const nonRef = db.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN u.role = 'chatter' THEN 1 ELSE 0 END) h FROM applications a LEFT JOIN users u ON u.id = a.user_id WHERE a.at > ? AND a.ref_user IS NULL`).get(since);
    const top = {}; refd.forEach(r => { const t = top[r.referrer_id] = top[r.referrer_id] || { username: r.ref_username, apps: 0, hired: 0 }; t.apps++; if (r.hired_at) t.hired++; });
    res.json({ settings: c,
      kpis: { refApps: refd.length, totalApps: total, refRate: refd.length ? Math.round(hiredOf(refd) / refd.length * 100) : 0, baseRate: nonRef.n ? Math.round((nonRef.h || 0) / nonRef.n * 100) : 0,
        paid: rows.filter(r => r.status === "paid").reduce((t, r) => t + (r.prime || 0), 0), paidN: rows.filter(r => r.status === "paid").length, toValidate: rows.filter(r => r.status === "to_validate").length },
      toPay: rows.filter(r => r.status === "to_validate").map(r => ({ id: r.id, referrer: r.ref_username, filleul: r.fil_username || r.first_name, hired_at: r.hired_at, eligible_at: r.eligible_at, prime: r.prime ?? c.prime })),
      apps: rows.slice(0, 40).map(r => ({ id: r.id, app_id: r.app_id, name: r.fil_username || r.first_name, referrer: r.ref_username, score: r.ai_score, at: r.created_at, ...stageOf(r) })),
      top: Object.values(top).sort((a, b) => b.hired - a.hired || b.apps - a.apps).slice(0, 6) });
  });
  app.post("/api/admin/referrals/settings", auth, admin, (req, res) => {
    const c = CFG(), p = +req.body?.prime, d = +req.body?.days;
    if (Number.isFinite(p)) c.prime = Math.max(0, Math.min(2000, Math.round(p * 100) / 100));
    if (Number.isFinite(d)) c.days = Math.max(0, Math.min(180, Math.round(d)));
    setSet("referral", JSON.stringify(c)); gest.log(req.user.id, "s", "a modifié la prime de parrainage", `${eur(c.prime)} après ${c.days} jours`); res.json({ ok: true, settings: c });
  });
  app.post("/api/admin/referrals/:id", auth, admin, (req, res) => {
    const r = db.prepare(`${ROWS} WHERE r.id = ?`).get(parseInt(req.params.id, 10));
    if (!r || r.status !== "to_validate") return res.status(400).json({ error: "Cette prime n'est pas à valider" });
    const now = Date.now();
    if (req.body?.decision === "approve") {
      const amount = r.prime ?? CFG().prime, pkey = compta.periodOfDate(compta.parisDate(now));
      if (amount > 0) db.prepare("INSERT INTO pay_adjust (period, user_id, amount, reason, created_at, created_by) VALUES (?,?,?,?,?,?)").run(pkey, r.referrer_id, amount, `Prime de parrainage · ${r.fil_username || r.first_name}`, now, req.user.id);
      db.prepare("UPDATE referrals SET status = 'paid', prime = ?, decided_at = ?, decided_by = ? WHERE id = ?").run(amount, now, req.user.id, r.id);
      gest.log(req.user.id, "a", `a validé la prime de parrainage de **${r.ref_username}**`, `${r.fil_username || r.first_name} · +${eur(amount)} sur sa paie`);
    } else if (req.body?.decision === "refuse") {
      db.prepare("UPDATE referrals SET status = 'refused', decided_at = ?, decided_by = ? WHERE id = ?").run(now, req.user.id, r.id);
      gest.log(req.user.id, "a", `a refusé la prime de parrainage de **${r.ref_username}**`, r.fil_username || r.first_name);
    } else return res.status(400).json({ error: "Décision invalide" });
    res.json({ ok: true });
  });
  return { attach, sync };
};
