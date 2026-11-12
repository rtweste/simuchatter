// Rôles fins : Fondateur, Manager, Assistante (comptes « admin »), Team Leader (compte « chatter »).
// - grade : 'founder' | 'assistant' | 'tl' | NULL   - team_lead : id du Team Leader d'un chatter ou d'un élève
// - le Fondateur seul : nommer/retirer un manager, paliers de commission, part des créatrices, clôture des périodes
// - l'Assistante : liste blanche de routes manager, et jamais la marge de l'agence
module.exports = function perms(db, getAgency) {
  const cols = () => db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!cols().includes("grade")) db.exec("ALTER TABLE users ADD COLUMN grade TEXT");
  if (!cols().includes("team_lead")) db.exec("ALTER TABLE users ADD COLUMN team_lead INTEGER");
  db.exec("CREATE TABLE IF NOT EXISTS founder_log (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, user_id INTEGER, text TEXT NOT NULL)");

  // un seul Fondateur : FOUNDER_USER, sinon le compte manager initial (ADMIN_USER), sinon le plus ancien manager
  function seedFounder() {
    const want = process.env.FOUNDER_USER && db.prepare("SELECT id FROM users WHERE username = ? AND role = 'admin'").get(process.env.FOUNDER_USER);
    if (want) { db.prepare("UPDATE users SET grade = NULL WHERE grade = 'founder' AND id <> ?").run(want.id); db.prepare("UPDATE users SET grade = 'founder' WHERE id = ?").run(want.id); return; }
    if (db.prepare("SELECT 1 FROM users WHERE grade = 'founder' AND role = 'admin' AND deleted_at IS NULL").get()) return;
    const u = (process.env.ADMIN_USER && db.prepare("SELECT id FROM users WHERE username = ? AND role = 'admin' AND deleted_at IS NULL").get(process.env.ADMIN_USER))
      || db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1 AND deleted_at IS NULL ORDER BY id LIMIT 1").get();
    if (u) { db.prepare("UPDATE users SET grade = 'founder' WHERE id = ?").run(u.id); console.log("👑 Fondateur :", db.prepare("SELECT username FROM users WHERE id = ?").get(u.id).username); }
  }
  // ancien système « team leader + recrue » : les leaders deviennent Team Leaders, les recrues rejoignent leur équipe (la prime reste dans team_leads)
  function mergeOld() {
    try {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'team_leads'").get()) return;
      const k = db.prepare("SELECT value FROM settings WHERE key = 'roles_merge'").get(); if (k) return;
      db.exec("BEGIN");
      try {
        db.prepare("SELECT DISTINCT leader_id FROM team_leads").all().forEach(r => db.prepare("UPDATE users SET grade = 'tl' WHERE id = ? AND role = 'chatter' AND grade IS NULL").run(r.leader_id));
        db.prepare("SELECT recruit_id, leader_id FROM team_leads").all().forEach(r => db.prepare("UPDATE users SET team_lead = ? WHERE id = ? AND team_lead IS NULL").run(r.leader_id, r.recruit_id));
        db.prepare("INSERT INTO settings (key, value) VALUES ('roles_merge', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    } catch (e) { console.error("fusion team leaders", e.message); }
  }
  setTimeout(() => { try { seedFounder(); mergeOld(); } catch (e) { console.error("rôles", e.message); } }, 0);

  const rk = u => !u ? null : u.role === "admin" ? (u.grade === "founder" ? "founder" : u.grade === "assistant" ? "assistant" : "manager")
    : u.role === "chatter" ? (u.grade === "tl" ? "tl" : "chatter") : "trainee";
  const LABEL = { founder: "Fondateur", manager: "Manager", assistant: "Assistante", tl: "Team Leader", chatter: "Chatter", trainee: "En formation" };

  /* ---------- Assistante : routes manager autorisées ---------- */
  const A_GET = /^\/api\/(admin\/(alerts|planning|team(\/\d+)?|compta(\/month|\/history)?|agency|creators|activity|users|challenges(\/live)?|sales\/count|customs\/count|pauses\/live|pauses\/user\/\d+|announcements\/\d+\/reads|roles|clocks|handovers|sanctions)|chat\/.*)$/;
  const A_WRITE = /^\/api\/(admin\/(payouts|shifts(\/\d+)?|swaps\/\d+|help|clocks(\/\d+)?|adjustments(\/\d+)?|announcements\/\d+\/remind|team\/\d+\/notes|notes\/\d+)|chat\/(m\/\d+\/(pin|hide)|mute))$/;
  const assistantOk = req => (req.method === "GET" ? A_GET : A_WRITE).test(req.path) || (req.method === "GET" && A_WRITE.test(req.path));

  /* ---------- Fondateur seul ---------- */
  const normTiers = t => JSON.stringify((t || []).map(x => [Number(x.from) || 0, Number(x.rate) || 0, Number(x.prime) || 0]).sort((a, b) => a[0] - b[0]));
  function founderReason(req) {
    const p = req.path, m = req.method, b = req.body || {};
    if (m === "PUT" && /^\/api\/admin\/models\/\d+\/pct$/.test(p)) { const md = db.prepare("SELECT creator_pct FROM models WHERE id = ?").get(+p.split("/")[4]); if (md && Number(b.creator_pct) === Number(md.creator_pct)) return null; return "la part des créatrices"; }
    if (m === "POST" && /^\/api\/admin\/models\/\d+\/default-pct$/.test(p)) return "la part des créatrices";
    if (m === "POST" && /^\/api\/admin\/periods\/[^/]+\/(close|reopen)$/.test(p)) return "la clôture des périodes";
    if (m === "PUT" && p === "/api/admin/agency") {
      const a = getAgency() || {};
      if (b.tiers !== undefined && normTiers(b.tiers) !== normTiers(a.tiers)) return "les paliers de commission";
      if (b.creatorPct !== undefined && Number(b.creatorPct) !== Number(a.creatorPct)) return "la part des créatrices";
    }
    if (m === "POST" && p === "/api/admin/users" && b.role === "admin") return "la nomination des managers";
    const mm = /^\/api\/admin\/users\/(\d+)$/.exec(p);
    if (m === "PATCH" && mm) {
      const t = db.prepare("SELECT role, grade FROM users WHERE id = ?").get(+mm[1]);
      if (t && t.grade === "founder") return "le compte du Fondateur";
      if (b.role !== undefined && t && (t.role === "admin" || b.role === "admin")) return "la nomination des managers";
    }
    return null;
  }
  const FLOG = { "la part des créatrices": "a modifié la part d’une créatrice", "les paliers de commission": "a modifié les paliers de commission",
    "la clôture des périodes": "a clôturé ou rouvert une période", "la nomination des managers": "a changé un rôle de manager" };
  const flog = (uid, text) => { try { db.prepare("INSERT INTO founder_log (at, user_id, text) VALUES (?,?,?)").run(Date.now(), uid, text); } catch (e) {} };

  // garde des routes manager (remplace le simple « role === admin »)
  function admin(req, res, next) {
    const u = req.user; if (!u || u.role !== "admin") return res.status(403).json({ error: "Réservé au manager" });
    if (u.grade === "assistant" && !assistantOk(req)) return res.status(403).json({ error: "Réservé aux managers" });
    const why = founderReason(req);
    if (why) {
      if (u.grade !== "founder") return res.status(403).json({ error: `Réservé au Fondateur : ${why}` });
      if (FLOG[why]) res.on("finish", () => { if (res.statusCode < 300) flog(u.id, FLOG[why] + (why === "la clôture des périodes" ? ` (${req.path.split("/")[4]})` : "")); });
    }
    if (u.grade === "assistant") stripMargin(res);
    next();
  }
  // l'Assistante ne voit jamais la marge de l'agence
  const MKEYS = new Set(["margin", "agencyShare", "marginHist", "prevMargin", "marginTrend"]);
  const scrub = o => { if (Array.isArray(o)) return o.map(scrub); if (o && typeof o === "object") { const r = {}; for (const k in o) if (!MKEYS.has(k)) r[k] = scrub(o[k]); return r; } return o; };
  function stripMargin(res) { if (res._noMargin) return; res._noMargin = true; const j = res.json.bind(res); res.json = body => j(scrub(body)); }

  return { rk, LABEL, admin, assistantOk, stripMargin, flog };
};
