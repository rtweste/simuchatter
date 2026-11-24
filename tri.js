// Tri des fans par l'IA : qui paie, qui ne paiera pas, et le passage des payeurs aux chatters.
// Le statut d'un fan se calcule sur des faits lus dans la conversation, jamais sur un avis de Grok :
// - « payeur »   : il a déjà acheté (une fois suffit, n'importe quand) → il passe à un chatter et n'est plus jamais classé time waster ;
// - « retest »   : un doute (une offre vue et pas achetée, ou « j'ai pas d'argent ») → l'IA ne lui propose plus rien pendant un délai, puis le reteste ;
// - « waster »   : time waster, seulement sur des preuves répétées, sur plusieurs jours → réponses lentes et plafonnées, puis nouveau test au bout de 14 jours ;
// - « test »     : tout le reste, l'IA crée le lien puis lui propose un média d'entrée.
module.exports = function mount(app, db, auth, { notify, inbox, perms }) {
  db.exec(`CREATE TABLE IF NOT EXISTS twizz_tri_test (creator_id TEXT NOT NULL, fan_id TEXT NOT NULL, msg_id TEXT NOT NULL, price REAL, at INTEGER, seen INTEGER NOT NULL DEFAULT 0, outcome TEXT NOT NULL DEFAULT 'wait', PRIMARY KEY (creator_id, fan_id, msg_id));
    CREATE TABLE IF NOT EXISTS twizz_tri_said (creator_id TEXT NOT NULL, fan_id TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER, text TEXT, PRIMARY KEY (creator_id, fan_id, day, kind));
    CREATE TABLE IF NOT EXISTS twizz_tri (creator_id TEXT NOT NULL, fan_id TEXT NOT NULL, fan_name TEXT, conv_id TEXT, status TEXT NOT NULL, reason TEXT, until INTEGER, since INTEGER, at INTEGER, PRIMARY KEY (creator_id, fan_id));
    CREATE TABLE IF NOT EXISTS twizz_tri_handoff (id INTEGER PRIMARY KEY, creator_id TEXT NOT NULL, fan_id TEXT NOT NULL, fan_name TEXT, conv_id TEXT, tx_id TEXT, amount REAL, reason TEXT, at INTEGER NOT NULL, taken_by INTEGER, taken_at INTEGER, UNIQUE(creator_id, fan_id));
    CREATE INDEX IF NOT EXISTS twizz_tri_status ON twizz_tri(creator_id, status);`);
  const now = () => Date.now(), str = v => String(v == null ? "" : v), DAY = 864e5, dayOf = t => new Date(t + 3600e3).toISOString().slice(0, 10);   // jour à l'heure de Paris (hiver)
  const J = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
  // les règles, toutes au même endroit
  const R = { window: 30 * DAY,        // on ne juge que sur les 30 derniers jours
    fairMax: 15,                        // une offre ne compte comme test que si son prix est un prix d'entrée (15 € au plus) : refuser 25 € ou un ticket à 75 € ne prouve rien
    seenAfter: 2 * 3600e3,              // « vue et pas achetée » : il a réécrit après l'avoir reçue et elle est toujours fermée 2 h plus tard
    wasterTests: 4, wasterDays: 2,      // time waster : 4 offres d'entrée vues et pas achetées, sur au moins 2 jours différents
    brokeDays: 3,                       // … ou il dit qu'il n'a pas d'argent 3 jours différents
    neverDays: 2,                       // … ou il dit 2 jours différents qu'il ne paie jamais
    wasterTtl: 14 * DAY,                // un time waster est retesté 14 jours après la dernière preuve
    pause1: 1 * DAY, pause2: 3 * DAY }; // doute : pas d'offre pendant 24 h après une offre ratée, 3 jours après deux ou après « pas d'argent »
  const NEVER = /\b(je (ne )?pa(ie|ye) (jamais|pas|rien)|j['’ ]?ach[èe]te (jamais|rien|pas)|jamais pay[ée]|pa(ie|ye)rai? (jamais|pas)|(je )?pa(ie|ye) pas pour|pas question de payer|que du gratuit|gratuit (ou|sinon) rien|je veux (que )?du gratuit)\b/i;
  const PAYDAY = /\b(fin de mois|fin du mois|ma pa(ie|ye)|mon salaire|d[ée]but du mois|quand j['’ ]?(aurai|ai) (ma pa(ie|ye)|mon salaire|touch[ée]))\b/i;
  const isTk = t => /^\s*ticket\b/i.test(str(t));
  // il a acheté un média (preuve qu'il paie) : une vente de média connue du site, un média acheté vu dans la conversation, ou un achat compté dans sa fiche
  const boughtMedia = (cid, fan) => { try { if (db.prepare("SELECT 1 FROM twizz_tx WHERE creator_id = ? AND fan_id = ? AND refund = 0 AND net > 0 AND type IN ('privatemedia','mediapush','collection') LIMIT 1").get(cid, fan)) return true; } catch (e) {}
    try { if (db.prepare("SELECT 1 FROM twizz_tri_test WHERE creator_id = ? AND fan_id = ? AND outcome = 'bought' LIMIT 1").get(cid, fan)) return true; } catch (e) {}
    try { return ((db.prepare("SELECT buys FROM twizz_fan_facts WHERE creator_id = ? AND fan_id = ?").get(cid, fan) || {}).buys || 0) > 0; } catch (e) { return false; } };
  // il a dépensé chez elle d'après Twizz (abonnement compris) : pas une preuve d'achat de média, mais assez pour ne jamais le classer time waster
  const spentOf = (cid, fan) => { try { return (db.prepare("SELECT spend FROM twizz_fan_facts WHERE creator_id = ? AND fan_id = ?").get(cid, fan) || {}).spend || 0; } catch (e) { return 0; } };

  // le statut d'après les preuves gardées ; ne lit rien sur Twizz
  function classify(cid, fan) {
    if (boughtMedia(cid, fan)) return { status: "payeur", reason: "a déjà acheté un média", until: null };
    const t0 = now() - R.window;
    const T = db.prepare("SELECT at, outcome, price FROM twizz_tri_test WHERE creator_id = ? AND fan_id = ? AND at > ? AND outcome IN ('refused','ignored') AND price <= ?").all(cid, fan, t0, R.fairMax);
    const S = db.prepare("SELECT day, kind, at, text FROM twizz_tri_said WHERE creator_id = ? AND fan_id = ? AND at > ?").all(cid, fan, t0);
    const fDays = new Set(T.map(x => dayOf(x.at))).size, broke = S.filter(x => x.kind === "nomoney"), never = S.filter(x => x.kind === "never");
    const last = Math.max(0, ...T.map(x => x.at), ...S.map(x => x.at));
    const why = T.length >= R.wasterTests && fDays >= R.wasterDays ? `${T.length} offres vues et pas achetées, sur ${fDays} jours`
      : never.length >= R.neverDays ? `a dit ${never.length} jours différents qu'il ne paie jamais`
      : broke.length >= R.brokeDays ? `a dit ${broke.length} jours différents qu'il n'a pas d'argent` : "";
    const spent = spentOf(cid, fan);   // il a déjà sorti sa carte chez elle : il y a une chance qu'il paie, donc jamais « time waster », seulement un doute
    if (why && !(spent > 0)) return now() < last + R.wasterTtl ? { status: "waster", reason: why, until: last + R.wasterTtl } : { status: "test", reason: "nouveau test après 14 jours", until: null };
    if (!T.length && !S.length) return { status: "test", reason: "", until: null };
    // un doute, pas un verdict : on arrête de lui proposer pendant un délai, puis on le reteste
    let until = 0, reason = "";
    if (T.length) { const lt = Math.max(...T.map(x => x.at)); until = lt + (T.length >= 2 ? R.pause2 : R.pause1); reason = `${T.length} offre${T.length > 1 ? "s" : ""} vue${T.length > 1 ? "s" : ""} et pas achetée${T.length > 1 ? "s" : ""}`; }
    const sl = [...broke, ...never].sort((a, b) => b.at - a.at)[0];
    if (sl) { let u = sl.at + R.pause2; if (PAYDAY.test(str(sl.text))) { const d = new Date(sl.at); if (d.getUTCDate() >= 15) u = Math.max(u, Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 2, 9)); }   // « fin de mois » : retesté après la paie
      if (u > until) { until = u; reason = sl.kind === "never" ? "a dit qu'il ne paie pas" : PAYDAY.test(str(sl.text)) ? "attend sa paie" : "a dit qu'il n'a pas d'argent"; } }
    return now() < until ? { status: "retest", reason, until } : { status: "test", reason: "nouveau test", until: null };
  }
  function store(cid, fan, name, conv) { const c = classify(cid, fan), old = db.prepare("SELECT status, since FROM twizz_tri WHERE creator_id = ? AND fan_id = ?").get(cid, fan);
    db.prepare(`INSERT INTO twizz_tri (creator_id, fan_id, fan_name, conv_id, status, reason, until, since, at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(creator_id, fan_id) DO UPDATE SET fan_name = COALESCE(NULLIF(excluded.fan_name, ''), fan_name), conv_id = COALESCE(NULLIF(excluded.conv_id, ''), conv_id), status = excluded.status, reason = excluded.reason, until = excluded.until, since = excluded.since, at = excluded.at`)
      .run(cid, fan, str(name).slice(0, 80), str(conv), c.status, c.reason, c.until, old && old.status === c.status ? old.since : now(), now());
    tag(cid, fan, c.status); return c; }
  // le statut en vigueur (une ligne, pas de calcul) : un doute ou un time waster dont le délai est passé redevient « à tester »
  function status(cid, fan) { let r = null; try { r = db.prepare("SELECT status, reason, until FROM twizz_tri WHERE creator_id = ? AND fan_id = ?").get(cid, fan); } catch (e) {}
    if (!r) return { status: "test", reason: "" }; if ((r.status === "waster" || r.status === "retest") && r.until && now() >= r.until) return { status: "test", reason: "nouveau test" }; return r; }

  // ce que l'IA voit dans la conversation devient des preuves : offres payantes (achetée, refusée, vue et laissée fermée) et ce qu'il dit de son argent
  function observe(cid, fan, name, conv, L, o = {}) {
    if (!cid || !fan || !Array.isArray(L)) return status(cid, fan);
    const t0 = now() - R.window, tOf = m => Date.parse(m.at) || 0, lastFanAt = Math.max(0, ...L.filter(m => m.fromFan).map(tOf));
    const up = db.prepare(`INSERT INTO twizz_tri_test (creator_id, fan_id, msg_id, price, at, seen, outcome) VALUES (?,?,?,?,?,?,?) ON CONFLICT(creator_id, fan_id, msg_id) DO UPDATE SET seen = excluded.seen, outcome = excluded.outcome`);
    L.forEach(m => { if (m.fromFan || m.type !== "FILE" || !(m.price > 0) || !m.id || isTk(m.text)) return; const at = tOf(m); if (at < t0) return;
      const seen = lastFanAt > at ? 1 : 0, out = m.status === "accepted" ? "bought" : m.status === "refused" ? "refused" : seen && now() - at >= R.seenAfter ? "ignored" : "wait";
      up.run(cid, fan, str(m.id), +m.price, at, seen, out); });
    const say = db.prepare("INSERT OR IGNORE INTO twizz_tri_said (creator_id, fan_id, day, kind, at, text) VALUES (?,?,?,?,?,?)");
    L.forEach(m => { if (!m.fromFan || !m.text) return; const at = tOf(m); if (at < t0) return; const t = str(m.text);
      if (NEVER.test(t)) say.run(cid, fan, dayOf(at), "never", at, t.slice(0, 200)); else if (o.nomoney && o.nomoney(t)) say.run(cid, fan, dayOf(at), "nomoney", at, t.slice(0, 200)); });
    const c = store(cid, fan, name, conv);
    // un payeur que l'IA croise : il entre dans la liste « à reprendre » (sans notification : il n'y a pas d'achat à l'instant)
    if (c.status === "payeur" && o.list !== false) { const sp = spentOf(cid, fan);
      add({ creator_id: cid, fan_id: fan, fan_name: name, conv_id: conv, reason: sp > 0 ? `déjà acheteur : ${Math.round(sp)} € dépensés` : "déjà acheteur" }, false); }
    return c;
  }

  // les tags du site, posés et retirés par le tri (jamais un tag posé à la main)
  const TAGS = { waster: ["Time waster", "#9a9a9a"], retest: ["À retester", "#f0c46a"], payeur: ["Payeur", "#5fd3a2"] };
  function tag(cid, fan, st) { try { if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'twizz_fan_tags'").get()) return;
      Object.keys(TAGS).forEach(k => { const [name, color] = TAGS[k]; let t = db.prepare("SELECT id FROM twizz_tags WHERE name = ? AND rule IS NULL").get(name);
        if (k === st) { if (!t) { db.prepare("INSERT INTO twizz_tags (name, color, active, at) VALUES (?,?,1,?)").run(name, color, now()); t = db.prepare("SELECT id FROM twizz_tags WHERE name = ? AND rule IS NULL").get(name); }
          if (t && db.prepare("INSERT OR IGNORE INTO twizz_fan_tags (creator_id, fan_id, tag_id, auto, at) VALUES (?,?,?,1,?)").run(cid, fan, t.id, now()).changes) { try { db.prepare("INSERT INTO twizz_tag_log (creator_id, fan_id, tag_id, action, at) VALUES (?,?,?,'auto+',?)").run(cid, fan, t.id, now()); } catch (e) {} } }
        else if (t && db.prepare("DELETE FROM twizz_fan_tags WHERE creator_id = ? AND fan_id = ? AND tag_id = ? AND auto = 1").run(cid, fan, t.id).changes) { try { db.prepare("INSERT INTO twizz_tag_log (creator_id, fan_id, tag_id, action, at) VALUES (?,?,?,'auto-',?)").run(cid, fan, t.id, now()); } catch (e) {} } });
    } catch (e) {} }

  // ---- passage au chatter ----
  // un fan entre dans la liste « à reprendre » (une ligne par fan) ; fresh = un achat vient d'avoir lieu, la ligne remonte et redevient « à prendre »
  function add(h, fresh) { try { const old = db.prepare("SELECT id, taken_at, at FROM twizz_tri_handoff WHERE creator_id = ? AND fan_id = ?").get(h.creator_id, h.fan_id);
      if (old && !fresh) return old.id;   // déjà dans la liste (ou déjà pris) : on n'y touche pas
      if (old && old.taken_at) { db.prepare("UPDATE twizz_tri_handoff SET tx_id = ?, amount = ?, reason = ?, at = ? WHERE id = ?").run(str(h.tx_id), h.amount || null, str(h.reason), now(), old.id); return old.id; }   // un chatter l'a déjà : il reste à lui
      if (old) { db.prepare("UPDATE twizz_tri_handoff SET fan_name = COALESCE(NULLIF(?, ''), fan_name), conv_id = COALESCE(NULLIF(?, ''), conv_id), tx_id = ?, amount = ?, reason = ?, at = ? WHERE id = ?").run(str(h.fan_name).slice(0, 80), str(h.conv_id), str(h.tx_id), h.amount || null, str(h.reason), now(), old.id); return old.id; }
      return db.prepare("INSERT INTO twizz_tri_handoff (creator_id, fan_id, fan_name, conv_id, tx_id, amount, reason, at) VALUES (?,?,?,?,?,?,?,?)").run(h.creator_id, h.fan_id, str(h.fan_name).slice(0, 80), str(h.conv_id), str(h.tx_id), h.amount || null, str(h.reason), now()).lastInsertRowid;
    } catch (e) { return 0; } }
  // l'IA vient de vendre : le fan est payeur, il entre dans la liste (appelé par paid.js, qui prévient les chatters en shift)
  function sold(t, amount) { if (!t || !t.creator_id || !t.fan_id) return 0;
    const id = add({ creator_id: t.creator_id, fan_id: str(t.fan_id), fan_name: t.fan_name, conv_id: t.conv_id, tx_id: t.id, amount, reason: `vient d'acheter ${amount ? amount + " € " : ""}avec l'IA` }, true);
    try { db.prepare("INSERT OR IGNORE INTO twizz_tri_test (creator_id, fan_id, msg_id, price, at, seen, outcome) VALUES (?,?,?,?,?,1,'bought')").run(t.creator_id, str(t.fan_id), "tx:" + t.id, amount || 0, t.at || now()); store(t.creator_id, str(t.fan_id), t.fan_name, t.conv_id); } catch (e) {} return id; }
  // un chatter a écrit dans la conversation depuis le site : le fan est à lui, l'IA le lâche pour de bon
  function take(row, uid, at) { db.prepare("UPDATE twizz_tri_handoff SET taken_by = ?, taken_at = ? WHERE id = ? AND taken_at IS NULL").run(uid, at || now(), row.id);
    try { db.prepare("INSERT INTO twizz_ai_fanoff (creator_id, fan_id, user_id, at) VALUES (?,?,?,?) ON CONFLICT(creator_id, fan_id) DO UPDATE SET user_id = excluded.user_id, at = excluded.at").run(row.creator_id, row.fan_id, uid, now()); } catch (e) {} }
  function sync(cid) { try { const W = cid ? "AND creator_id = ?" : "", A = cid ? [cid] : [];
      db.prepare(`SELECT * FROM twizz_tri_handoff WHERE taken_at IS NULL AND at > ? ${W}`).all(now() - 14 * DAY, ...A).forEach(h => { if (!h.conv_id) return;
        const s = db.prepare("SELECT user_id, at FROM twizz_sent WHERE conv_id = ? AND COALESCE(via, '') <> 'ia' AND user_id IS NOT NULL AND at > ? ORDER BY at LIMIT 1").get(h.conv_id, h.at); if (s) take(h, s.user_id, s.at); }); } catch (e) {} }

  const canOpen = (user, cid) => { try { return !!(user && cid && inbox && inbox.canOpen && inbox.canOpen({ ...user, rk: perms.rk(user) }, cid)); } catch (e) { return false; } };
  const labelOf = cid => { let r = null; try { r = db.prepare("SELECT m.name model, c.label FROM twizz_creators c LEFT JOIN models m ON m.id = c.model_id WHERE c.twizz_id = ?").get(cid); } catch (e) {} return (r && (r.model || r.label)) || "ta créatrice"; };
  const briefOf = (cid, fan) => { let B = {}; try { B = J((db.prepare("SELECT data FROM twizz_fan_brief WHERE creator_id = ? AND fan_id = ?").get(cid, fan) || {}).data, {}) || {}; } catch (e) {}
    return { prenom: str(B.prenom).slice(0, 40), gouts: str(B.gouts).slice(0, 140), resume: str(B.resume).slice(0, 220), etat: str(B.etat).slice(0, 160), action: str(B.action).slice(0, 160) }; };
  function pub(h, user) { const name = h.fan_name || "Un fan", q = new URLSearchParams({ cr: h.creator_id, fan: h.fan_id, name }); if (h.conv_id) q.set("conv", h.conv_id);
    const spend = spentOf(h.creator_id, h.fan_id);
    return { id: h.id, fan: name, creator: labelOf(h.creator_id), reason: h.reason || "", amount: h.amount || 0, spend: Math.round(spend), at: h.at, fresh: !!h.tx_id, brief: briefOf(h.creator_id, h.fan_id),
      url: "/messagerie?" + q, open: { cr: h.creator_id, conv: h.conv_id || "", fan: h.fan_id, name } }; }

  // la liste « à reprendre » de la personne connectée : les payeurs pas encore pris, sur les créatrices qu'elle peut ouvrir (les achats du moment d'abord)
  app.get("/api/tri/handoff", auth, (req, res) => { sync();
    const rows = db.prepare("SELECT * FROM twizz_tri_handoff WHERE taken_at IS NULL AND at > ? ORDER BY (tx_id IS NOT NULL AND tx_id <> '') DESC, at DESC LIMIT 200").all(now() - 7 * DAY).filter(h => canOpen(req.user, h.creator_id));
    res.json({ items: rows.slice(0, 40).map(h => pub(h, req.user)), total: rows.length }); });
  // « je le prends » : le fan sort de la liste et l'IA ne lui répond plus
  app.post("/api/tri/take", auth, (req, res) => { if (req.viewAs) return res.json({ ok: true });
    const h = db.prepare("SELECT * FROM twizz_tri_handoff WHERE id = ?").get(Number(req.body && req.body.id)); if (!h || !canOpen(req.user, h.creator_id)) return res.status(404).json({ error: "Fan introuvable" });
    if (!h.taken_at) take(h, req.user.id); res.json({ ok: true }); });
  // les chiffres du tri pour la page IA
  function stats(cid) { const d0 = Date.parse(dayOf(now()) + "T00:00:00Z") - 3600e3, W = cid ? "AND creator_id = ?" : "", A = cid ? [cid] : [];
    const one = (sql, ...a) => { try { return db.prepare(sql).get(...a).n || 0; } catch (e) { return 0; } };
    const by = {}; try { db.prepare(`SELECT status, COUNT(*) n FROM twizz_tri WHERE (until IS NULL OR until > ? OR status = 'payeur') ${W} GROUP BY status`).all(now(), ...A).forEach(r => { by[r.status] = r.n; }); } catch (e) {}
    return { today: { tested: one(`SELECT COUNT(DISTINCT fan_id) n FROM twizz_tri_test WHERE at > ? ${W}`, d0, ...A), found: one(`SELECT COUNT(*) n FROM twizz_tri_handoff WHERE at > ? AND tx_id IS NOT NULL AND tx_id <> '' ${W}`, d0, ...A), taken: one(`SELECT COUNT(*) n FROM twizz_tri_handoff WHERE taken_at > ? ${W}`, d0, ...A) },
      waiting: one(`SELECT COUNT(*) n FROM twizz_tri_handoff WHERE taken_at IS NULL AND at > ? ${W}`, now() - 7 * DAY, ...A), payeur: by.payeur || 0, waster: by.waster || 0, retest: by.retest || 0, rules: R }; }
  // pourquoi ce fan a ce statut (pour la messagerie et les vérifications)
  app.get("/api/tri/fan/:cid/:fan", auth, (req, res) => { const cid = str(req.params.cid), fan = str(req.params.fan); if (!canOpen(req.user, cid)) return res.status(404).json({ error: "Introuvable" });
    res.json({ ...status(cid, fan), tests: db.prepare("SELECT price, at, seen, outcome FROM twizz_tri_test WHERE creator_id = ? AND fan_id = ? ORDER BY at DESC LIMIT 20").all(cid, fan), said: db.prepare("SELECT day, kind, text FROM twizz_tri_said WHERE creator_id = ? AND fan_id = ? ORDER BY at DESC LIMIT 10").all(cid, fan) }); });

  // toutes les 20 s : un chatter a écrit à un payeur de la liste → il est à lui, l'IA est coupée pour ce fan (elle le voit avant sa prochaine réponse)
  setInterval(() => sync(), 20e3).unref();
  setInterval(() => { try { const t = now() - 60 * DAY; db.prepare("DELETE FROM twizz_tri_test WHERE at < ?").run(t); db.prepare("DELETE FROM twizz_tri_said WHERE at < ?").run(t); db.prepare("DELETE FROM twizz_tri_handoff WHERE at < ?").run(t); } catch (e) {} }, 6 * 3600e3).unref();
  const api = { observe, classify, status, sold, sync, stats, add, R };
  app.locals.tri = api; return api;
};
