// Achats des fans : le chatter est prévenu dès qu'un fan paie
// - un média qu'il a envoyé dans une conversation (« média privé ») → celui qui l'a envoyé
// - un média push payant → les chatters en shift sur cette créatrice au moment de l'achat
// - un média vendu par l'IA → les chatters en shift : le fan est un payeur, à reprendre (tri.js tient la liste)
// Chaque notification porte le nom du fan et un lien direct vers sa conversation dans la messagerie.
// Tout est lu dans les ventes Twizz déjà synchronisées : aucune requête en plus vers Twizz.
module.exports = function mount(app, db, auth, { notify, inbox, perms }) {
  db.exec(`CREATE TABLE IF NOT EXISTS paid_notifs (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, tx_id TEXT NOT NULL, kind TEXT NOT NULL, creator_id TEXT, model_id INTEGER,
      fan_id TEXT, fan_name TEXT, conv_id TEXT, msg_id TEXT, amount REAL, at INTEGER NOT NULL, created_at INTEGER NOT NULL, seen_at INTEGER, UNIQUE(user_id, tx_id));
    CREATE INDEX IF NOT EXISTS paid_notifs_user ON paid_notifs(user_id, seen_at, id);`);
  const now = () => Date.now(), r2 = x => Math.round(x * 100) / 100, str = v => String(v == null ? "" : v);
  const has = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const eur = n => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(".", ",")) + " €";
  // part que Twizz reverse sur le prix payé par le fan (même réglage que les ventes automatiques) : sert à afficher le prix payé
  const keep = () => { let s = null; try { s = JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'twizz_keep'").get() || {}).value); } catch (e) {} const k = Number(process.env.TWIZZ_KEEP || s || 0.752); return k > 0.3 && k <= 1 ? k : 0.752; };
  const MAX_AGE = 2 * 3600e3;   // un achat retrouvé plus de 2 h après (longue coupure, rattrapage) ne prévient plus personne
  const activeUser = uid => db.prepare("SELECT * FROM users WHERE id = ? AND active = 1 AND deleted_at IS NULL").get(uid);
  // qui était en shift sur cette créatrice au moment de l'achat (renforts compris ; 10 min de tolérance après la fin du shift)
  const onShift = (modelId, at) => !modelId ? [] : db.prepare(`SELECT DISTINCT user_id FROM clocks WHERE model_id = ? AND start_at <= ? AND COALESCE(end_at, ?) + 600000 >= ?`).all(modelId, at, now(), at).map(r => r.user_id);
  // la conversation d'un fan quand la vente ne la donne pas (média push) : on la retrouve dans ce que le site connaît déjà
  function convOf(cid, fan) {
    if (!cid || !fan) return "";
    const one = (sql, ...a) => { try { const r = db.prepare(sql).get(...a); return r && r.conv_id ? str(r.conv_id) : ""; } catch (e) { return ""; } };
    return (has("twizz_conv_snap") && one("SELECT conv_id FROM twizz_conv_snap WHERE creator_id = ? AND fan_id = ? ORDER BY at DESC LIMIT 1", cid, fan))
      || one("SELECT conv_id FROM twizz_sent WHERE creator_id = ? AND fan_id = ? AND conv_id <> '' ORDER BY at DESC LIMIT 1", cid, fan)
      || one("SELECT conv_id FROM twizz_tx WHERE creator_id = ? AND fan_id = ? AND conv_id <> '' ORDER BY at DESC LIMIT 1", cid, fan);
  }
  const labelOf = t => { let r = null; try { r = db.prepare("SELECT m.name model, c.label FROM twizz_creators c LEFT JOIN models m ON m.id = c.model_id WHERE c.twizz_id = ?").get(t.creator_id); } catch (e) {} return (r && (r.model || r.label)) || "ta créatrice"; };
  const canOpen = (user, cid) => { try { return !!(user && cid && inbox && inbox.canOpen && inbox.canOpen({ ...user, rk: perms.rk(user) }, cid)); } catch (e) { return false; } };
  const TITLE = { "ask-snap": n => `${n} demande un snap : à toi`, "ask-cam": n => `${n} demande une cam : à toi`, "ask-custom": n => `${n} demande une vidéo perso : à toi`, handoff: n => `${n} vient d'acheter avec l'IA : à toi de le reprendre`, mine: n => `${n} a acheté ton média`, shift: n => `${n} a acheté un média`, push: n => `${n} a payé un média push` };
  // ce que voit le chatter : le titre avec le nom du fan, la créatrice et le prix payé, et le lien vers la conversation
  function pub(r, user) {
    const name = r.fan_name || "Un fan", can = !!r.fan_id && canOpen(user, r.creator_id);
    const open = can ? { cr: r.creator_id, conv: r.conv_id || "", fan: r.fan_id, name, msg: r.msg_id || "", amt: r.kind === "push" ? 0 : r.amount || 0, at: r.at } : null;
    const q = new URLSearchParams(); if (open) Object.keys(open).forEach(k => { if (open[k]) q.set(k, String(open[k])); });
    return { id: r.id, kind: r.kind, title: (TITLE[r.kind] || TITLE.shift)(name), sub: `${labelOf(r)}${r.amount ? " · " + eur(r.amount) : ""}`, fan: name, at: r.at,
      url: open ? "/messagerie?" + q : "/ventes", open, btn: open ? "Voir la conversation" : "Voir mes ventes" };
  }
  // une vente Twizz vient d'être importée : on prévient les bonnes personnes (une seule fois par vente et par personne)
  function onTx(id) {
    const t = db.prepare("SELECT * FROM twizz_tx WHERE id = ?").get(str(id));
    if (!t || t.refund || !(t.net > 0) || !["privatemedia", "mediapush"].includes(t.type) || now() - t.at > MAX_AGE) return 0;
    let ids = [], kind = "shift", conv = str(t.conv_id), msg = "";
    if (t.type === "privatemedia") {
      // le dernier média payant de la conversation avant l'achat : envoyé par un chatter depuis le site, ou par l'IA
      let s = null; try { if (conv) s = db.prepare("SELECT user_id, via, msg_id FROM twizz_sent WHERE conv_id = ? AND price > 0 AND at <= ? AND at > ? ORDER BY at DESC LIMIT 1").get(conv, t.at + 60e3, t.at - 7 * 864e5); } catch (e) {}
      // vendu par l'IA : le fan vient de prouver qu'il paie → il passe aux chatters en shift sur la créatrice (liste « à reprendre » + notification)
      if (t.ai || (s && s.via === "ia")) { kind = "handoff"; ids = onShift(t.model_id, t.at); msg = s ? str(s.msg_id) : ""; }
      else if (s && s.user_id) { ids = [s.user_id]; kind = "mine"; msg = str(s.msg_id); }
      else if (t.user_id) ids = [t.user_id];          // média envoyé hors du site : la personne à qui la vente est rattachée
      else ids = onShift(t.model_id, t.at);           // sinon les chatters en shift sur la créatrice
    } else { kind = "push"; ids = onShift(t.model_id, t.at); conv = convOf(t.creator_id, t.fan_id); }
    let amount = r2(t.net / keep()), n = 0; if (Math.abs(amount - Math.round(amount)) <= 0.03) amount = Math.round(amount);   // 9,02 € net → 12 € payés (et non 11,99)
    if (kind === "handoff") { try { if (app.locals.tri) app.locals.tri.sold(t, amount); } catch (e) {} }
    [...new Set(ids)].forEach(uid => { const u = activeUser(uid); if (!u) return;
      const info = db.prepare(`INSERT OR IGNORE INTO paid_notifs (user_id, tx_id, kind, creator_id, model_id, fan_id, fan_name, conv_id, msg_id, amount, at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(uid, t.id, kind, t.creator_id, t.model_id, str(t.fan_id), str(t.fan_name).slice(0, 80), conv, msg, amount, t.at, now());
      if (!info.changes) return; n++;
      const p = pub(db.prepare("SELECT * FROM paid_notifs WHERE id = ?").get(info.lastInsertRowid), u);
      // sur le téléphone ou l'ordinateur : toucher la notification ouvre la conversation ; si le site est ouvert devant lui, c'est la carte du site qui s'affiche
      try { notify.push(uid, "paid", { title: (kind === "handoff" ? "🔥 " : "💰 ") + p.title, body: `${p.sub} · touche pour ${p.open ? "ouvrir la conversation" : "voir tes ventes"}`, url: p.url, tag: "paid-" + t.id, inapp: true, ttl: 6 * 3600 }).catch(() => {}); } catch (e) {}
    });
    return n;
  }
  // un fan demande un snap, une cam ou une vidéo perso à l'IA : les chatters en shift sur la créatrice sont prévenus (tri.js décide quand)
  function ask(h) { let mid = null; try { mid = (db.prepare("SELECT model_id FROM twizz_creators WHERE twizz_id = ?").get(h.creator_id) || {}).model_id; } catch (e) {}
    const at = now(), kind = "ask-" + h.kind, key = `ask:${h.creator_id}:${h.fan_id}:${h.kind}:${new Date(at).toISOString().slice(0, 10)}`; let n = 0;
    onShift(mid, at).forEach(uid => { const u = activeUser(uid); if (!u) return;
      const info = db.prepare(`INSERT OR IGNORE INTO paid_notifs (user_id, tx_id, kind, creator_id, model_id, fan_id, fan_name, conv_id, msg_id, amount, at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(uid, key, kind, h.creator_id, mid, str(h.fan_id), str(h.fan_name).slice(0, 80), str(h.conv_id), "", 0, at, at);
      if (!info.changes) return; n++; const p = pub(db.prepare("SELECT * FROM paid_notifs WHERE id = ?").get(info.lastInsertRowid), u);
      try { notify.push(uid, "paid", { title: "🔥 " + p.title, body: `${p.sub} · touche pour ouvrir la conversation`, url: p.url, tag: "paid-" + key, inapp: true, ttl: 6 * 3600 }).catch(() => {}); } catch (e) {} });
    return n; }
  app.locals.paidAsk = h => { try { return ask(h); } catch (e) { console.error("Demande spéciale", e.message); return 0; } };
  app.locals.paidNotif = id => { try { return onTx(id); } catch (e) { console.error("Achats des fans", e.message); return 0; } };

  // les achats pas encore montrés à cette personne (12 h au plus) ; rien dans la vue « en tant que »
  app.get("/api/paid/new", auth, (req, res) => {
    if (req.viewAs) return res.json({ items: [] });
    const R = db.prepare("SELECT * FROM paid_notifs WHERE user_id = ? AND seen_at IS NULL AND created_at > ? ORDER BY id DESC LIMIT 20").all(req.user.id, now() - 12 * 3600e3);
    res.json({ items: R.map(r => pub(r, req.user)) });
  });
  app.post("/api/paid/seen", auth, (req, res) => {
    if (req.viewAs) return res.json({ ok: true });
    const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger).slice(0, 50);
    const st = db.prepare("UPDATE paid_notifs SET seen_at = ? WHERE id = ? AND user_id = ? AND seen_at IS NULL"); ids.forEach(i => st.run(now(), i, req.user.id));
    res.json({ ok: true });
  });
  // ménage : on ne garde pas plus de 30 jours
  setInterval(() => { try { db.prepare("DELETE FROM paid_notifs WHERE created_at < ?").run(now() - 30 * 864e5); } catch (e) {} }, 6 * 3600e3).unref();
  return { onTx };
};
