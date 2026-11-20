// Contrôle des ventes automatiques (Twizz) : la liste « À vérifier » des managers.
// Rien n'est bloqué ni modifié tout seul : on signale, le manager garde la vente ou baisse la commission.
module.exports = function mount(app, db, auth, admin) {
  db.exec("CREATE TABLE IF NOT EXISTS ctrl_flags (key TEXT PRIMARY KEY, status TEXT, by_id INTEGER, at INTEGER)");
  const has = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const S = { get: (k, d) => { const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(k); return r ? r.value : d; },
    set: (k, v) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, String(v)) };
  const cfg = () => ({ min: Math.max(0, +S.get("ctrl_min", 10) || 0), disc: Math.max(1, +S.get("ctrl_disc", 30) || 30), free: Math.max(1, +S.get("ctrl_free", 3) || 3) });
  const PPV = ["privatemedia", "mediapush"], LABEL = { privatemedia: "Média privé", mediapush: "Média push", collection: "Collection", monthly_subscription: "Abonnement" };
  const day = ms => new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const eur = n => (Math.round(n * 100) / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " €";

  function items() {
    const C = cfg(), since = Date.now() - 30 * 864e5, out = [];
    const done = new Map(db.prepare("SELECT key, status FROM ctrl_flags").all().map(r => [r.key, r.status]));
    if (has("twizz_tx")) {
      const rows = db.prepare(`SELECT s.id, s.user_id, s.amount, s.com_amount, s.sold_at, u.username, m.name model, t.type, t.net, t.fan_id, t.fan_name, t.conv_id, t.creator_id, t.at
        FROM sales s JOIN twizz_tx t ON t.sale_id = s.id JOIN users u ON u.id = s.user_id LEFT JOIN models m ON m.id = s.model_id
        WHERE s.source = 'twizz' AND s.status = 'validated' AND s.sold_at > ? ORDER BY s.sold_at DESC LIMIT 400`).all(since);
      const fanAvg = db.prepare(`SELECT AVG(net) a, COUNT(*) n FROM twizz_tx WHERE fan_id = ? AND type IN ('privatemedia','mediapush') AND net > 0 AND refund = 0 AND at < ?`);
      const sent = has("twizz_sent") ? db.prepare("SELECT s.msg_id, s.price, s.promo, s.at, u.username FROM twizz_sent s LEFT JOIN users u ON u.id = s.user_id WHERE s.conv_id = ? AND s.price > 0 AND s.at <= ? AND s.at > ? ORDER BY s.at DESC LIMIT 1") : null;
      rows.forEach(r => {
        const key = "sale:" + r.id; if (done.has(key) || r.com_amount != null) return;
        const why = [];
        if (PPV.includes(r.type) && C.min > 0 && r.amount < C.min) why.push({ k: "low", t: `Vendu ${eur(r.amount)} : sous le minimum de ${eur(C.min)}` });
        if (PPV.includes(r.type) && r.fan_id) { const f = fanAvg.get(r.fan_id, r.at); if (f && f.n >= 3 && f.a >= 10 && r.net < f.a * .4) why.push({ k: "fan", t: `${r.fan_name || "Ce fan"} paie d'habitude ${eur(f.a / (r.net / r.amount))} en moyenne (${f.n} achats)` }); }
        let x = null; if (sent && r.conv_id) { x = sent.get(r.conv_id, r.at + 60e3, r.at - 7 * 864e5); let p = null; try { p = x && x.promo && JSON.parse(x.promo); } catch (e) {}
          if (p && +p.value > 0) { const pct = p.type === "pct" ? +p.value : Math.round(+p.value / (+x.price + +p.value) * 100);
            if (pct > C.disc) why.push({ k: "promo", t: `Promo de ${p.type === "pct" ? p.value + " %" : "−" + eur(+p.value) + " (" + pct + " %)"} : plus que les ${C.disc} % permis` }); } }
        // de quoi aller voir la vente dans la conversation : le PPV envoyé depuis la messagerie s'il existe
        let px = null; try { px = x && x.promo && JSON.parse(x.promo); } catch (e) {}
        const src = x ? { site: true, by: x.username || "", msg: x.msg_id || "", price: x.price, promo: px && +px.value > 0 ? (px.type === "pct" ? `−${px.value} %` : `−${eur(+px.value)}`) : "" } : { site: false };
        if (why.length) out.push({ key, kind: "sale", at: r.sold_at, why, src, sale: { id: r.id, amount: r.amount, net: r.net, model: r.model || "", user: r.username, user_id: r.user_id, fan: r.fan_name || "", type: LABEL[r.type] || r.type, conv: r.conv_id || "", fan_id: r.fan_id || "", cr: r.creator_id || "", at: r.at } });
      });
    }
    // médias offerts depuis la messagerie (hors scripts) : signalés à partir d'un certain nombre par chatter et par jour
    if (has("twizz_sent")) {
      const cols = db.prepare("PRAGMA table_info(twizz_sent)").all().map(c => c.name), via = cols.includes("via") ? "AND COALESCE(s.via, '') <> 'script'" : "";
      const L = db.prepare(`SELECT s.user_id, s.at, u.username FROM twizz_sent s JOIN users u ON u.id = s.user_id WHERE s.price = 0 AND s.files IS NOT NULL AND s.at > ? ${via}`).all(since);
      const by = new Map(); L.forEach(r => { const k = r.user_id + ":" + day(r.at), o = by.get(k) || { user: r.username, user_id: r.user_id, day: day(r.at), n: 0, at: 0 }; o.n++; o.at = Math.max(o.at, r.at); by.set(k, o); });
      by.forEach((o, k) => { const key = "free:" + k; if (o.n < C.free || done.has(key)) return;
        out.push({ key, kind: "free", at: o.at, why: [{ k: "free", t: `${o.n} médias offerts dans la journée, hors scripts (signalé à partir de ${C.free})` }], free: o }); });
    }
    return out.sort((a, b) => b.at - a.at);
  }

  app.get("/api/admin/controle", auth, admin, (req, res) => { const L = items(); res.json({ items: L, count: L.length, cfg: cfg() }); });
  app.get("/api/admin/controle/count", auth, admin, (req, res) => res.json({ count: items().length }));
  app.post("/api/admin/controle/settings", auth, admin, (req, res) => { const b = req.body || {};
    if (b.min !== undefined) S.set("ctrl_min", Math.max(0, Math.min(500, Math.round(+b.min || 0))));
    if (b.disc !== undefined) S.set("ctrl_disc", Math.max(1, Math.min(99, Math.round(+b.disc || 30))));
    if (b.free !== undefined) S.set("ctrl_free", Math.max(1, Math.min(50, Math.round(+b.free || 3))));
    const L = items(); res.json({ items: L, count: L.length, cfg: cfg() }); });
  // « C'est bon » ou commission déjà baissée : l'élément sort de la liste
  app.post("/api/admin/controle/done", auth, admin, (req, res) => { const key = String(req.body?.key || "").slice(0, 80); if (!/^(sale|free):/.test(key)) return res.status(400).json({ error: "Élément inconnu" });
    db.prepare("INSERT INTO ctrl_flags (key, status, by_id, at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET status = excluded.status, by_id = excluded.by_id, at = excluded.at")
      .run(key, req.body?.status === "adjusted" ? "adjusted" : "ok", req.user.id, Date.now());
    const L = items(); res.json({ items: L, count: L.length, cfg: cfg() }); });
};
