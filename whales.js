// Surveillance des gros clients (page « Gros clients ») :
// - « Attend » : un gros client a écrit et personne ne lui a répondu depuis 15 min → son chatter attitré est prévenu ; les managers 30 min plus tard s'il attend toujours
// - « Refroidit » : il n'achète plus à son rythme habituel (calculé sur ses achats Twizz)
// - « À surveiller » : la relecture quotidienne de Grok a repéré un problème dans sa conversation (promesse pas tenue, contradiction, demande sans suite, plainte)
// La relecture Grok écrit aussi un résumé court de chaque gros client (ce qu'il aime, ce qu'il a demandé, ce qu'on lui a promis, un point d'attention).
module.exports = function mount(app, db, auth, admin, { inbox, notify }) {
  db.exec(`CREATE TABLE IF NOT EXISTS twizz_vip_wait (creator_id TEXT NOT NULL, fan_id TEXT NOT NULL, conv_id TEXT, msg_id TEXT, since INTEGER, user_sent INTEGER, mgr_sent INTEGER, PRIMARY KEY (creator_id, fan_id));
    CREATE TABLE IF NOT EXISTS twizz_vip_brief (creator_id TEXT NOT NULL, fan_id TEXT NOT NULL, data TEXT, at INTEGER, PRIMARY KEY (creator_id, fan_id));`);
  const now = () => Date.now(), str = v => String(v == null ? "" : v), J = (v, d) => { try { const x = JSON.parse(v); return x == null ? d : x; } catch (e) { return d; } };
  const S = { get: (k, d) => { try { const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(k); return r ? JSON.parse(r.value) : d; } catch (e) { return d; } },
    set: (k, v) => { try { db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, JSON.stringify(v)); } catch (e) {} } };
  const WAIT = 15 * 60e3, ESC = 30 * 60e3, TOP = 15;
  const managers = () => db.prepare("SELECT id FROM users WHERE active = 1 AND deleted_at IS NULL AND role = 'admin' AND COALESCE(grade, '') <> 'assistant'").all().map(r => r.id);
  const crName = cid => { try { const c = db.prepare("SELECT c.label, m.name model FROM twizz_creators c LEFT JOIN models m ON m.id = c.model_id WHERE c.twizz_id = ?").get(cid); return (c && (c.model || c.label)) || "sa créatrice"; } catch (e) { return "sa créatrice"; } };

  // les gros clients : les 15 plus gros acheteurs du mois de chaque créatrice (hors abonnements), plus ceux qui ont un chatter attitré
  function whales() { const d = new Date(now() + 3600e3), m0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 3600e3;
    const R = db.prepare("SELECT creator_id, fan_id, MAX(fan_name) name, SUM(CASE WHEN at >= ? THEN net ELSE 0 END) month, SUM(net) total, COUNT(*) n, MAX(at) last FROM twizz_tx WHERE refund = 0 AND net > 0 AND fan_id IS NOT NULL AND fan_id <> '' AND type NOT LIKE '%subscri%' GROUP BY creator_id, fan_id").all(m0);
    const by = {}; R.forEach(r => (by[r.creator_id] = by[r.creator_id] || []).push(r)); const out = new Map();
    Object.values(by).forEach(L => L.sort((a, b) => b.month - a.month || b.total - a.total).slice(0, TOP).forEach(r => out.set(r.creator_id + "|" + r.fan_id, r)));
    db.prepare("SELECT creator_id, fan_id FROM twizz_vip WHERE user_id IS NOT NULL").all().forEach(v => { const k = v.creator_id + "|" + v.fan_id; if (!out.has(k)) { const r = R.find(x => x.creator_id === v.creator_id && x.fan_id === v.fan_id); if (r) out.set(k, r); } });
    return out; }
  const convOf = (cid, fan) => { try { const r = db.prepare("SELECT conv_id FROM twizz_tx WHERE creator_id = ? AND fan_id = ? AND conv_id IS NOT NULL AND conv_id <> '' ORDER BY at DESC LIMIT 1").get(cid, fan); if (r) return r.conv_id;
      const s = db.prepare("SELECT conv_id FROM twizz_conv_snap WHERE creator_id = ? AND fan_id = ? ORDER BY at DESC LIMIT 1").get(cid, fan); return s ? s.conv_id : ""; } catch (e) { return ""; } };

  // ---- Refroidit : pas d'achat depuis plus de deux fois son écart habituel entre deux achats (au moins 4 jours), s'il a au moins 3 achats ----
  function cooling(cid, fan) { try { const T = db.prepare("SELECT at FROM twizz_tx WHERE creator_id = ? AND fan_id = ? AND refund = 0 AND net > 0 AND type NOT LIKE '%subscri%' ORDER BY at").all(cid, fan).map(r => r.at);
      if (T.length < 3) return null; const days = []; for (let i = 1; i < T.length; i++) { const g = (T[i] - T[i - 1]) / 864e5; if (g > 0.5) days.push(g); } if (days.length < 2) return null;
      days.sort((a, b) => a - b); const usual = Math.max(1, days[Math.floor(days.length / 2)]), since = (now() - T[T.length - 1]) / 864e5;
      return since >= Math.max(4, usual * 2) && since <= 30 ? { since: Math.round(since), usual: Math.round(usual) } : null; } catch (e) { return null; } }

  // ---- Attend : lu dans la 1re page des conversations de chaque créatrice, toutes les 2 min (une requête par créatrice, la même que la messagerie) ----
  let busy = false;
  async function poll() { if (busy || !inbox || !inbox.G) return; busy = true;
    try { const W = whales(); if (!W.size) return; const cids = [...new Set([...W.values()].map(r => r.creator_id))];
      for (const cid of cids) { let L = []; try { const j = await inbox.G(`/conversations/user/${encodeURIComponent(cid)}?page=1&type=GENERAL&creatorId=${encodeURIComponent(cid)}`, 60e3); L = inbox.arr(j).map(c => inbox.conv(c, cid)); } catch (e) { continue; }
        L.forEach(c => { const w = c.fan && W.get(cid + "|" + c.fan.id); if (!w) return; const row = db.prepare("SELECT * FROM twizz_vip_wait WHERE creator_id = ? AND fan_id = ?").get(cid, c.fan.id);
          if (!c.last.fromFan) { if (row) db.prepare("DELETE FROM twizz_vip_wait WHERE creator_id = ? AND fan_id = ?").run(cid, c.fan.id); return; }   // l'équipe a répondu
          const at = Date.parse(c.last.at) || now(); if (now() - at > 48 * 3600e3) return;   // un message vieux de plus de 2 jours n'est plus une attente à signaler
          if (!row || row.msg_id !== c.last.id) db.prepare("INSERT INTO twizz_vip_wait (creator_id, fan_id, conv_id, msg_id, since, user_sent, mgr_sent) VALUES (?,?,?,?,?,0,0) ON CONFLICT(creator_id, fan_id) DO UPDATE SET conv_id = excluded.conv_id, msg_id = excluded.msg_id, since = CASE WHEN twizz_vip_wait.since IS NULL THEN excluded.since ELSE twizz_vip_wait.since END")
            .run(cid, c.fan.id, c.id, c.last.id, at); });
        await new Promise(r => setTimeout(r, 1500)); }
      // alertes : le chatter attitré à 15 min, les managers 30 min plus tard
      db.prepare("SELECT * FROM twizz_vip_wait").all().forEach(x => { const w = W.get(x.creator_id + "|" + x.fan_id); if (!w) return; const age = now() - x.since, name = str(w.name).replace(/\s+/g, " ").trim() || "Un gros client", cr = crName(x.creator_id);
        const q = new URLSearchParams({ cr: x.creator_id, fan: x.fan_id, name, conv: x.conv_id || "" }), url = "/messagerie?" + q, mn = Math.round(age / 60e3);
        const v = db.prepare("SELECT user_id FROM twizz_vip WHERE creator_id = ? AND fan_id = ?").get(x.creator_id, x.fan_id);
        if (age >= WAIT && !x.user_sent) { db.prepare("UPDATE twizz_vip_wait SET user_sent = 1 WHERE creator_id = ? AND fan_id = ?").run(x.creator_id, x.fan_id);
          if (v && v.user_id && notify) notify.push(v.user_id, "paid", { title: `💬 ${name} t'attend`, body: `${cr} · gros client sans réponse depuis ${mn} min`, url, tag: "vip-" + x.fan_id, inapp: false }).catch(() => {}); }
        if (age >= WAIT + ESC && !x.mgr_sent) { db.prepare("UPDATE twizz_vip_wait SET mgr_sent = 1 WHERE creator_id = ? AND fan_id = ?").run(x.creator_id, x.fan_id);
          if (notify) notify.pushMany(managers(), null, { title: `💬 ${name} attend toujours une réponse`, body: `${cr} · gros client sans réponse depuis ${mn} min`, url, tag: "vipm-" + x.fan_id }); } });
    } catch (e) { console.error("Gros clients, surveillance", e.message); } finally { busy = false; } }
  setInterval(poll, 120e3).unref(); setTimeout(poll, 20e3);

  // ---- Relecture quotidienne par Grok (vers 9 h, heure de Paris) ----
  const XKEY = () => str(process.env.XAI_API_KEY).trim(), XBASE = () => str(process.env.XAI_BASE || "https://api.x.ai/v1").replace(/\/+$/, "");
  const SYS = "Tu relis la conversation entre une créatrice de contenus pour adultes (son équipe écrit à sa place) et un de ses meilleurs clients, pour aider le manager. Tu ne juges ni le sujet ni la crudité. Réponds seulement par un JSON : {\"aime\": ce qu'il aime ou ce qui le fait acheter, en 8 mots au plus ; \"demande\": ce qu'il a demandé récemment et qui n'est pas encore fait, en 10 mots au plus, ou \"\" ; \"promis\": ce que l'équipe lui a promis et qui n'est pas encore fait, en 10 mots au plus, ou \"\" ; \"attention\": le problème le plus grave s'il y en a un (promesse pas tenue, deux personnes de l'équipe qui se contredisent, demande laissée sans suite, plainte, fan qui menace de partir), en 14 mots au plus, ou \"\"}. Écris en français, sans guillemets dans les valeurs, sans rien inventer.";
  async function brief(cid, fan, conv) {
    let L = []; for (let pg = 1; pg <= 2; pg++) { try { const j = await inbox.G(`/messages/find-all-messages?conversationId=${encodeURIComponent(conv)}&creatorId=${encodeURIComponent(cid)}&page=${pg}`, 0); const d = (j && j.data) || {}; L = L.concat((d.data || []).map(m => inbox.msg(m, fan))); if (!d.totalPages || pg >= d.totalPages) break; } catch (e) { break; } await new Promise(r => setTimeout(r, 1500)); }
    L = L.filter(m => m.at).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-60); if (L.length < 3) return null;
    const txt = L.map(m => new Date(Date.parse(m.at) + 3600e3).toISOString().slice(5, 16).replace("T", " ") + " " + (m.fromFan ? "LUI" : "ÉQUIPE") + (m.type === "FILE" ? (m.price > 0 ? ` [média à ${m.price} € ${m.status === "accepted" ? "acheté" : "pas acheté"}]` : " [média offert]") : "") + " : " + str(m.text).replace(/\s+/g, " ").slice(0, 220)).join("\n");
    const r = await fetch(XBASE() + "/chat/completions", { method: "POST", headers: { Authorization: "Bearer " + XKEY(), "Content-Type": "application/json" },
      body: JSON.stringify({ model: "grok-4-1-fast-non-reasoning", temperature: 0.2, max_tokens: 220, messages: [{ role: "system", content: SYS }, { role: "user", content: txt }] }) });
    if (!r.ok) throw new Error("Grok " + r.status); const j = await r.json(), c = str(j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content), m = c.match(/\{[\s\S]*\}/), o = m ? J(m[0], null) : null;
    if (!o) return null; const t = k => str(o[k]).replace(/["«»]/g, "").trim().slice(0, 140);
    const data = { aime: t("aime"), demande: t("demande"), promis: t("promis"), attention: t("attention") };
    db.prepare("INSERT INTO twizz_vip_brief (creator_id, fan_id, data, at) VALUES (?,?,?,?) ON CONFLICT(creator_id, fan_id) DO UPDATE SET data = excluded.data, at = excluded.at").run(cid, fan, JSON.stringify(data), now()); return data; }
  let reading = false;
  async function readAll(force) { if (reading || !XKEY() || !inbox || !inbox.G) return 0; reading = true; let n = 0;
    try { for (const w of whales().values()) { const b = db.prepare("SELECT at FROM twizz_vip_brief WHERE creator_id = ? AND fan_id = ?").get(w.creator_id, w.fan_id); if (!force && b && now() - b.at < 20 * 3600e3) continue;
        const conv = convOf(w.creator_id, w.fan_id); if (!conv) continue; try { if (await brief(w.creator_id, w.fan_id, conv)) n++; } catch (e) { if (/40[23]/.test(e.message)) break; } await new Promise(r => setTimeout(r, 1500)); }
      S.set("twizz_vip_read", now()); } catch (e) { console.error("Gros clients, relecture", e.message); } finally { reading = false; } return n; }
  setInterval(() => { const h = +new Date(now()).toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/Paris" }), last = +S.get("twizz_vip_read", 0) || 0;
    if (h >= 9 && now() - last > 20 * 3600e3) readAll(false); }, 10 * 60e3).unref();

  // ---- ce que la page affiche : l'état de chaque gros client, son résumé, et la bande « À traiter maintenant » ----
  app.get("/api/admin/clients/watch", auth, admin, (req, res) => { const W = whales(), out = {}, todo = [];
    const waits = {}; db.prepare("SELECT * FROM twizz_vip_wait").all().forEach(x => waits[x.creator_id + "|" + x.fan_id] = x);
    const briefs = {}; db.prepare("SELECT * FROM twizz_vip_brief").all().forEach(x => briefs[x.creator_id + "|" + x.fan_id] = { ...J(x.data, {}), at: x.at });
    const users = {}; db.prepare("SELECT v.creator_id, v.fan_id, u.username FROM twizz_vip v JOIN users u ON u.id = v.user_id").all().forEach(x => users[x.creator_id + "|" + x.fan_id] = x.username);
    W.forEach((w, k) => { const x = waits[k], b = briefs[k] || null, cool = cooling(w.creator_id, w.fan_id), name = str(w.name).replace(/\s+/g, " ").trim() || "Fan", cr = crName(w.creator_id);
      const waitMin = x && now() - x.since >= WAIT ? Math.round((now() - x.since) / 60e3) : 0;
      const state = waitMin ? "attend" : b && b.attention ? "surveiller" : cool ? "refroidit" : "ok";
      out[k] = { state, waitMin, cool, brief: b };
      const base = { creator: w.creator_id, cr, fan: w.fan_id, name, conv: (x && x.conv_id) || convOf(w.creator_id, w.fan_id), month: w.month };
      if (waitMin) todo.push({ ...base, kind: "attend", rank: 0 - waitMin, title: `${name} attend une réponse`, sub: `${cr} · depuis ${waitMin >= 60 ? Math.floor(waitMin / 60) + " h " + String(waitMin % 60).padStart(2, "0") : waitMin + " min"}${users[k] ? " · " + users[k] + " prévenu" : " · aucun chatter attitré"}` });
      if (b && b.attention) todo.push({ ...base, kind: "surveiller", rank: 1000 - w.month, title: b.attention, sub: `${name} · ${cr} · vu par Grok` });
      else if (cool) todo.push({ ...base, kind: "refroidit", rank: 2000 - w.month, title: `${name} refroidit`, sub: `${cr} · ${cool.since} j sans achat, d'habitude ${cool.usual} j` }); });
    todo.sort((a, b) => a.rank - b.rank);
    res.json({ fans: out, todo: todo.slice(0, 5), more: Math.max(0, todo.length - 5), lastRead: +S.get("twizz_vip_read", 0) || null, reading }); });
  // relancer la relecture tout de suite (manager)
  app.post("/api/admin/clients/read", auth, admin, (req, res) => { if (reading) return res.json({ ok: true, reading: true }); readAll(true).catch(() => {}); res.json({ ok: true, reading: true }); });
  return { poll, readAll };
};
