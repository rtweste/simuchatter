// Connexion au CRM Twizz Business (l'API du site business.twizz.com, non officielle) — LECTURE SEULE.
// Le serveur se connecte avec le compte agence (variables TWIZZ_EMAIL et TWIZZ_PASSWORD sur Railway),
// renouvelle son badge tout seul, et importe les ventes de chaque créatrice toutes les quelques minutes.
// Discrétion : une seule requête à la fois, espacées d'au moins 1,5 s, peu de pages, en-têtes d'un vrai navigateur.
module.exports = function mount(app, db, auth, admin, { gest }) {
  const BASE = process.env.TWIZZ_BASE || "https://api.twizz.com";
  const EMAIL = () => process.env.TWIZZ_EMAIL || "", PASS = () => process.env.TWIZZ_PASSWORD || "";
  const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  const SYNC_MIN = Math.max(2, +(process.env.TWIZZ_SYNC_MIN || 3));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const now = () => Date.now();
  const r2 = x => Math.round(x * 100) / 100;
  const log = (...a) => { try { gest.log(...a); } catch (e) {} };
  const founder = (req, res, next) => req.user.rk === "founder" ? next() : res.status(403).json({ error: "Réservé au fondateur" });

  /* ---------- réglages et tables ---------- */
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS twizz_creators (twizz_id TEXT PRIMARY KEY, label TEXT, model_id INTEGER, seen_at INTEGER);
    CREATE TABLE IF NOT EXISTS twizz_tx (id TEXT PRIMARY KEY, tx_id TEXT, creator_id TEXT, model_id INTEGER, type TEXT, net REAL, at INTEGER,
      refund INTEGER NOT NULL DEFAULT 0, validated INTEGER NOT NULL DEFAULT 0, fan_id TEXT, fan_name TEXT, conv_id TEXT,
      state TEXT, sale_id INTEGER, user_id INTEGER, seen_at INTEGER);
    CREATE INDEX IF NOT EXISTS twizz_tx_at ON twizz_tx(at);
    CREATE INDEX IF NOT EXISTS twizz_tx_state ON twizz_tx(state, at);
    CREATE TABLE IF NOT EXISTS twizz_sent (id INTEGER PRIMARY KEY, msg_id TEXT, conv_id TEXT, fan_id TEXT, creator_id TEXT, user_id INTEGER, price REAL, at INTEGER);
    CREATE INDEX IF NOT EXISTS twizz_sent_conv ON twizz_sent(conv_id, at);`);
  if (!db.prepare("PRAGMA table_info(twizz_creators)").all().some(x => x.name === "note")) db.exec("ALTER TABLE twizz_creators ADD COLUMN note TEXT");
  for (const [c, t] of [["source", "TEXT"], ["twizz_id", "TEXT"]])
    if (!db.prepare("PRAGMA table_info(sales)").all().some(x => x.name === c)) db.exec(`ALTER TABLE sales ADD COLUMN ${c} ${t}`);
  const S = {
    get(k, d) { const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(k); if (!r) return d; try { return JSON.parse(r.value); } catch (e) { return r.value; } },
    set(k, v) { db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, JSON.stringify(v)); }
  };
  const TYPES = { privatemedia: "Média privé", mediapush: "Média push", collection: "Collection", monthly_subscription: "Abonnement" };
  const cfg = () => ({ on: !!S.get("twizz_on", false), since: S.get("twizz_since", null), types: S.get("twizz_types", ["privatemedia"]) });
  const configured = () => !!(EMAIL() && PASS());

  /* ---------- session (badge + renouvellement) ---------- */
  let sess = S.get("twizz_session", null) || { cookies: {}, deviceId: null };
  const saveSess = () => S.set("twizz_session", { ...sess, at: now() });
  const status = S.get("twizz_status", { ok: null, error: null, at: null, lastSync: null, pausedUntil: null, fails: 0 });
  const saveStatus = () => S.set("twizz_status", status);
  const fail = msg => { const e = new Error(msg); e.twizz = true; return e; };

  // une requête à la fois, espacées (on se comporte comme quelqu'un qui navigue)
  let chain = Promise.resolve(), lastAt = 0;
  // fast : action dans la messagerie. Un navigateur envoie plusieurs requêtes en même temps quand on ouvre
  // une conversation : on fait pareil (3 au plus), sans attente. La synchro des ventes reste en file, espacée.
  let busyFast = 0; const waitFast = [];
  async function fastRun(fn) { while (busyFast >= 3) await new Promise(r => waitFast.push(r)); busyFast++; try { return await fn(); } finally { busyFast--; const n = waitFast.shift(); if (n) n(); } }
  function queued(fn, fast) {
    if (fast) return fastRun(fn);
    const p = chain.then(async () => { const w = lastAt + (fast ? 350 + Math.random() * 450 : 1500 + Math.random() * 1200) - now(); if (w > 0) await sleep(w); try { return await fn(); } finally { lastAt = now(); } });
    chain = p.catch(() => {}); return p;
  }
  const cookieHeader = () => Object.entries(sess.cookies || {}).map(([k, v]) => `${k}=${v}`).join("; ");
  function absorb(res) {
    let list = []; try { list = res.headers.getSetCookie ? res.headers.getSetCookie() : []; } catch (e) {}
    list.forEach(c => { const kv = c.split(";")[0], i = kv.indexOf("="); if (i < 1) return; const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
      if (!v || /max-age=0|expires=thu, 01 jan 1970/i.test(c)) delete sess.cookies[k]; else sess.cookies[k] = v; });
  }
  async function raw(method, path, body) {
    const headers = { Accept: "application/json, text/plain, */*", "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8", "User-Agent": UA,
      Origin: "https://business.twizz.com", Referer: "https://business.twizz.com/" };
    if (sess.deviceId) headers["X-Device-Id"] = sess.deviceId;
    const ck = cookieHeader(); if (ck) headers.Cookie = ck;
    if (sess.bearer && sess.cookies.token) headers.Authorization = "Bearer " + sess.cookies.token;
    const form = typeof FormData !== "undefined" && body instanceof FormData;
    if (body && !form) headers["Content-Type"] = "application/json";
    let r; try { r = await fetch(BASE + path, { method, headers, body: body ? (form ? body : JSON.stringify(body)) : undefined, signal: AbortSignal.timeout(form ? 60000 : 25000) }); }
    catch (e) { throw fail("Twizz ne répond pas (" + (e.name === "TimeoutError" ? "délai dépassé" : e.message) + ")"); }
    absorb(r);
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) {}
    return { status: r.status, json, text };
  }
  const isBlocked = r => !r.json && (r.status === 403 || r.status === 503) && /cloudflare|just a moment|attention required|cf-ray|challenge/i.test(r.text);
  async function login() {
    if (!configured()) throw fail("Identifiants Twizz absents : ajoute TWIZZ_EMAIL et TWIZZ_PASSWORD dans les variables Railway");
    sess = { cookies: {}, deviceId: sess.deviceId || null, bearer: false };
    const r = await raw("POST", "/auth/login", { usernameOrEmail: EMAIL(), password: PASS(),
      device: { userAgent: UA, platform: "MacIntel", language: "fr-FR", browser: "Chrome", os: "MacOS" }, isBusiness: true });
    if (isBlocked(r)) throw fail("Twizz bloque les requêtes du serveur (protection Cloudflare)");
    const d = r.json && r.json.data, tok = d && d.token;
    if (!tok) throw fail(r.json && r.json.message ? "Connexion refusée par Twizz : " + r.json.message : `Connexion refusée par Twizz (code ${r.status})`);
    if (!sess.cookies.token) sess.cookies.token = tok;
    if (d.deviceId) sess.deviceId = d.deviceId;
    saveSess(); console.log("Twizz : connecté");
  }
  async function refresh() {
    if (!sess.deviceId || !sess.cookies.refreshToken) return false;
    const r = await raw("POST", "/auth/refresh", { deviceId: sess.deviceId });
    const tok = r.json && ((r.json.data && r.json.data.token) || r.json.token); if (!tok) return false;
    sess.cookies.token = tok; saveSess(); return true;
  }
  // une seule (re)connexion à la fois, même si plusieurs requêtes trouvent le badge expiré en même temps
  let authP = null;
  function reauth(fresh) { if (!authP) authP = (async () => { const ok = !fresh && await refresh().catch(() => false); if (!ok) await login(); })().finally(() => { authP = null; }); return authP; }
  // la synchro des ventes ne fait que des GET ; les envois passent par call() depuis la messagerie (fondateur)
  const get = (path, fast) => call("GET", path, null, fast);
  function call(method, path, body, fast) {
    return queued(async () => {
      const pause = () => sleep(600 + Math.random() * 900);   // comme un navigateur : pas deux appels collés
      if (!sess.cookies.token) { await reauth(true); if (!fast) await pause(); }
      let r = await raw(method, path, body);
      if (isBlocked(r)) throw fail("Twizz bloque les requêtes du serveur (protection Cloudflare)");
      if (r.status === 401 || r.status === 403) {
        await reauth(); if (!fast) await pause(); r = await raw(method, path, body);
        // dernier recours : certains serveurs attendent le badge dans l'en-tête plutôt qu'en cookie
        if ((r.status === 401 || r.status === 403) && !sess.bearer) { sess.bearer = true; saveSess(); await pause(); r = await raw(method, path, body); }
      }
      if (isBlocked(r)) throw fail("Twizz bloque les requêtes du serveur (protection Cloudflare)");
      if (r.status === 429) throw fail("Twizz demande de ralentir (trop de requêtes)");
      if (r.status >= 400 || !r.json) throw fail(`Twizz a répondu une erreur (code ${r.status})${r.json && r.json.message ? " : " + r.json.message : ""}`);
      return r.json;
    }, fast);
  }

  /* ---------- créatrices ---------- */
  // format Twizz : { creatorId, creatorDetails: { name, firstName, lastName, username, … }, chatters: [...] }
  const creatorOf = c => {
    const d = c.creatorDetails || c.creator || {}, o = { ...c, ...d };
    const id = String(c.creatorId || d._id || c._id || c.id || "");
    const full = [o.firstName || o.creatorFirstName, o.lastName || o.creatorLastName].filter(Boolean).join(" ").trim();
    const label = String(d.name || c.name || full || o.username || id).trim();
    return { id, label, note: String(d.note || c.note || "").slice(0, 2000), alts: [d.name, d.firstName, d.username, full].filter(Boolean).map(String) };
  };
  async function loadCreators() {
    const j = await get("/business/creators");
    const list = (j.creators || (j.data && (j.data.creators || j.data)) || []).map(creatorOf).filter(c => c.id);
    const models = db.prepare("SELECT id, name FROM models").all(), norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
    // association automatique si le nom (ou le prénom, ou le pseudo) correspond à une créatrice du site
    const guess = c => { for (const a of c.alts) { const A = norm(a); if (!A) continue; const m = models.find(x => norm(x.name) && (A === norm(x.name) || A.startsWith(norm(x.name)) || norm(x.name).startsWith(A))); if (m) return m.id; } return null; };
    list.forEach(c => {
      const ex = db.prepare("SELECT * FROM twizz_creators WHERE twizz_id = ?").get(c.id);
      if (ex) return db.prepare("UPDATE twizz_creators SET label = ?, note = ?, model_id = COALESCE(model_id, ?), seen_at = ? WHERE twizz_id = ?").run(c.label, c.note, guess(c), now(), c.id);
      db.prepare("INSERT INTO twizz_creators (twizz_id, label, note, model_id, seen_at) VALUES (?,?,?,?,?)").run(c.id, c.label, c.note, guess(c), now());
    });
    return list;
  }

  /* ---------- ventes ---------- */
  const keep = () => { const f = Number(S.get("platform_fee", 25)); return f < 100 ? 1 - f / 100 : 1; };
  // qui était sur cette créatrice à ce moment-là (shift principal d'abord ; 10 min de tolérance après la fin)
  function whoSold(modelId, at) {
    const L = db.prepare(`SELECT c.user_id, c.reinforce, c.start_at FROM clocks c JOIN users u ON u.id = c.user_id
      WHERE c.model_id = ? AND c.start_at <= ? AND COALESCE(c.end_at, ?) + 600000 >= ? ORDER BY c.reinforce, c.start_at DESC`).all(modelId, at, now(), at);
    return L.length ? L[0].user_id : null;
  }
  function makeSale(t, userId) {
    const amount = r2(t.net / keep());   // montant ramené en brut : la compta retrouve exactement le net Twizz
    const info = db.prepare(`INSERT INTO sales (user_id, model_id, amount, declared_amount, sold_at, note, status, reviewed_at, created_at, source, twizz_id)
      VALUES (?,?,?,?,?,?, 'validated', ?, ?, 'twizz', ?)`).run(userId, t.model_id, amount, amount, t.at, `Twizz · ${TYPES[t.type] || t.type} · ${String(r2(t.net).toFixed(2)).replace(".", ",")} € net`, now(), now(), t.id);
    db.prepare("UPDATE twizz_tx SET state = 'imported', sale_id = ?, user_id = ? WHERE id = ?").run(info.lastInsertRowid, userId, t.id);
    return info.lastInsertRowid;
  }
  function ingest(it, creatorId, modelId) {
    const id = String(it._id || it.transactionId || ""); if (!id) return 0;
    const at = Date.parse(it.createdAt) || now(), net = Number(it.netPrice) || 0, refund = it.isRefund ? 1 : 0, validated = it.isValidate ? 1 : 0;
    const ex = db.prepare("SELECT * FROM twizz_tx WHERE id = ?").get(id);
    if (ex) {
      if (refund && !ex.refund) {   // remboursement après coup : la vente sort du CA et de la commission
        db.prepare("UPDATE twizz_tx SET refund = 1, validated = ? WHERE id = ?").run(validated, id);
        if (ex.sale_id) { db.prepare("UPDATE sales SET status = 'refused', reason = 'Remboursée sur Twizz', reviewed_at = ? WHERE id = ?").run(now(), ex.sale_id);
          log(ex.user_id || 0, "a", `Vente Twizz remboursée (${r2(ex.net)} € net) : retirée des commissions`, ""); }
      } else if (validated !== ex.validated) db.prepare("UPDATE twizz_tx SET validated = ? WHERE id = ?").run(validated, id);
      return 0;
    }
    const fan = it.fan || {};
    const t = { id, tx_id: String(it.transactionId || ""), creator_id: creatorId, model_id: modelId, type: String(it.type || ""), net, at, refund, validated,
      fan_id: String(fan._id || ""), fan_name: String(fan.name || fan.username || ""), conv_id: String(it.conversationId || "") };
    const C = cfg();
    let state = "ca_only";
    if (refund || net <= 0) state = refund ? "refund" : "free";
    else if (!C.on || !C.since || at < C.since) state = "before_auto";
    else if (C.types.includes(t.type)) state = "pending";
    db.prepare(`INSERT INTO twizz_tx (id, tx_id, creator_id, model_id, type, net, at, refund, validated, fan_id, fan_name, conv_id, state, seen_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(t.id, t.tx_id, t.creator_id, t.model_id, t.type, t.net, t.at, t.refund, t.validated, t.fan_id, t.fan_name, t.conv_id, state, now());
    if (state === "pending") {
      let uid = null;
      if (t.conv_id) { const s = (db.prepare("SELECT user_id FROM twizz_sent WHERE conv_id = ? AND price IS NOT NULL AND at <= ? AND at > ? ORDER BY at DESC LIMIT 1").get(t.conv_id, at + 60e3, at - 7 * 864e5) || db.prepare("SELECT user_id FROM twizz_sent WHERE conv_id = ? AND at <= ? AND at > ? ORDER BY at DESC LIMIT 1").get(t.conv_id, at + 60e3, at - 7 * 864e5)); if (s) uid = s.user_id; }
      if (!uid && modelId) uid = whoSold(modelId, at);
      if (uid) makeSale(t, uid); else db.prepare("UPDATE twizz_tx SET state = 'ca_only' WHERE id = ?").run(id);   // personne à qui la relier : CA de l'agence, sans commission
    }
    return 1;
  }
  const ymd = ms => new Date(ms).toISOString().slice(0, 10);
  // les synchros passent l'une après l'autre (jamais deux en même temps)
  let running = Promise.resolve();
  function sync(reason) { const p = running.then(() => doSync(reason), () => doSync(reason)); running = p.catch(() => {}); return p; }
  async function doSync(reason) {
    let added = 0;
    try {
      if (!db.prepare("SELECT 1 FROM twizz_creators").get()) await loadCreators();
      const mapped = db.prepare("SELECT * FROM twizz_creators WHERE model_id IS NOT NULL").all();
      const from = ymd(Math.min(now() - 864e5, status.lastSync ? status.lastSync - 864e5 : now())), to = ymd(now() + 864e5);
      for (const c of mapped) {
        for (let page = 0; page < 6; page++) {
          const q = new URLSearchParams({ creatorId: c.twizz_id, includeStats: "true", fromDate: from, toDate: to, type: "month", offset: String(page * 15), limit: "15" });
          const j = await get("/earning/twizz/stats?" + q);
          const L = (j.data && j.data.detailPaymentReport) || [];
          let fresh = 0; L.forEach(it => fresh += ingest(it, c.twizz_id, c.model_id)); added += fresh;
          if (L.length < 15 || !fresh) break;   // plus rien de nouveau : on s'arrête là
        }
      }
      Object.assign(status, { ok: true, error: null, at: now(), lastSync: now(), fails: 0, pausedUntil: null }); saveStatus();
      if (added) console.log(`Twizz : ${added} transaction(s) importée(s)${reason ? " (" + reason + ")" : ""}`);
      return { added };
    } catch (e) {
      status.ok = false; status.error = e.message; status.at = now(); status.fails = (status.fails || 0) + 1;
      // plusieurs échecs d'affilée : on se met en pause 30 min pour ne pas insister
      if (status.fails >= 4) { status.pausedUntil = now() + 30 * 60e3; status.fails = 0; }
      saveStatus(); console.error("Twizz :", e.message); throw e;
    }
  }
  // reprend toutes les ventes depuis une date (une fois, à l'activation) : pages espacées, 40 au plus par créatrice
  async function backfill(fromMs, reason) {
    let added = 0; const mapped = db.prepare("SELECT * FROM twizz_creators WHERE model_id IS NOT NULL").all(), from = ymd(fromMs), to = ymd(now() + 864e5);
    for (const c of mapped) for (let page = 0; page < 40; page++) {
      const q = new URLSearchParams({ creatorId: c.twizz_id, includeStats: "true", fromDate: from, toDate: to, type: "month", offset: String(page * 15), limit: "15" });
      const j = await get("/earning/twizz/stats?" + q), L = (j.data && j.data.detailPaymentReport) || [];
      L.forEach(it => added += ingest(it, c.twizz_id, c.model_id)); if (L.length < 15) break;
    }
    S.set("twizz_backfill", { from: fromMs, at: now(), added, reason: reason || "" }); if (added) console.log(`Twizz : reprise de ${added} transaction(s) depuis le ${from}`);
    return { added };
  }
  const monthStart = () => { const p = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }).slice(0, 7); return Date.parse(p + "-01T00:00:00+01:00"); };
  setInterval(() => {
    if (!cfg().on || !configured()) return;
    if (status.pausedUntil && now() < status.pausedUntil) return;
    sync("auto").catch(() => {});
  }, SYNC_MIN * 60e3).unref?.();

  /* ---------- réglages (fondateur) ---------- */
  function overview() {
    const C = cfg(), d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const models = db.prepare("SELECT id, name FROM models ORDER BY name").all();
    const creators = db.prepare("SELECT t.*, m.name model FROM twizz_creators t LEFT JOIN models m ON m.id = t.model_id ORDER BY t.label").all();
    const tx = db.prepare(`SELECT t.*, u.username, m.name model FROM twizz_tx t LEFT JOIN users u ON u.id = t.user_id LEFT JOIN models m ON m.id = t.model_id ORDER BY t.at DESC LIMIT 25`).all();
    const today = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(net), 0) net FROM twizz_tx WHERE at >= ? AND refund = 0 AND net > 0").get(d0.getTime());
    const noChatter = db.prepare(`SELECT t.*, m.name model FROM twizz_tx t LEFT JOIN models m ON m.id = t.model_id WHERE t.state = 'no_chatter' ORDER BY t.at DESC LIMIT 50`).all();
    return { configured: configured(), ...C, status, syncMin: SYNC_MIN, types: C.types, typeLabels: TYPES, models, creators, tx, today, noChatter,
      chatters: db.prepare("SELECT id, username FROM users WHERE active = 1 AND (role = 'chatter' OR (role = 'admin' AND sells = 1)) ORDER BY username COLLATE NOCASE").all() };
  }
  app.get("/api/admin/twizz", auth, admin, (req, res) => res.json(overview()));
  // tester la connexion : se connecte et lit le compte + la liste des créatrices (2 requêtes)
  app.post("/api/admin/twizz/test", auth, admin, founder, async (req, res) => {
    try {
      const me = await get("/users/me"), list = await loadCreators();
      const u = (me && (me.data || me.user)) || me || {};
      Object.assign(status, { ok: true, error: null, at: now() }); saveStatus();
      res.json({ ok: true, account: u.username || u.email || [u.firstName, u.lastName].filter(Boolean).join(" ") || "compte agence", creators: list.length, ...overview() });
    } catch (e) { status.ok = false; status.error = e.message; status.at = now(); saveStatus(); res.status(e.twizz ? 502 : 500).json({ error: e.message }); }
  });
  app.post("/api/admin/twizz/map", auth, admin, founder, (req, res) => {
    const id = String(req.body?.twizz_id || ""), mid = req.body?.model_id ? +req.body.model_id : null;
    if (!db.prepare("SELECT 1 FROM twizz_creators WHERE twizz_id = ?").get(id)) return res.status(404).json({ error: "Créatrice Twizz inconnue" });
    if (mid && !db.prepare("SELECT 1 FROM models WHERE id = ?").get(mid)) return res.status(400).json({ error: "Créatrice du site inconnue" });
    db.prepare("UPDATE twizz_creators SET model_id = ? WHERE twizz_id = ?").run(mid, id);
    db.prepare("UPDATE twizz_tx SET model_id = ? WHERE creator_id = ? AND sale_id IS NULL").run(mid, id);
    res.json(overview());
  });
  app.post("/api/admin/twizz/config", auth, admin, founder, (req, res) => {
    const b = req.body || {};
    if (Array.isArray(b.types)) S.set("twizz_types", b.types.filter(t => TYPES[t]));
    if (typeof b.on === "boolean") {
      const was = cfg().on; S.set("twizz_on", b.on);
      // les ventes automatiques commencent maintenant (pas de doublon avec les ventes déjà déclarées)
      if (b.on && !was) { S.set("twizz_since", now()); log(req.user.id, "a", `**${req.user.username}** a activé les ventes automatiques Twizz`, "");
        // le CA du mois se calcule depuis Twizz : on reprend le mois en cours depuis le 1er, puis la synchro normale continue
        running = running.then(() => backfill(monthStart(), "activation")).catch(e => console.error("Twizz reprise :", e.message)).then(() => doSync("activation")).catch(() => {}); }
      if (!b.on && was) log(req.user.id, "a", `**${req.user.username}** a coupé les ventes automatiques Twizz`, "");
    }
    res.json(overview());
  });
  app.post("/api/admin/twizz/sync", auth, admin, founder, async (req, res) => {
    try { const r = await sync("manuel"); res.json({ ...r, ...overview() }); } catch (e) { res.status(502).json({ error: e.message }); }
  });
  // vente Twizz sans chatter pointé : un manager la donne à quelqu'un (ou la laisse au CA de l'agence)
  app.post("/api/admin/twizz/tx/:id/assign", auth, admin, (req, res) => {
    const t = db.prepare("SELECT * FROM twizz_tx WHERE id = ?").get(String(req.params.id));
    if (!t || t.state !== "no_chatter") return res.status(404).json({ error: "Vente introuvable ou déjà traitée" });
    if (req.body?.none) { db.prepare("UPDATE twizz_tx SET state = 'ca_only' WHERE id = ?").run(t.id); return res.json(overview()); }
    const uid = +req.body?.user_id; if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(uid)) return res.status(400).json({ error: "Chatter introuvable" });
    if (!t.model_id) return res.status(400).json({ error: "Associe d'abord la créatrice Twizz à une créatrice du site" });
    makeSale(t, uid); log(req.user.id, "a", `**${req.user.username}** a attribué une vente Twizz (${r2(t.net)} € net)`, ""); res.json(overview());
  });
  // pour la page Ventes : les déclarations sont remplacées par l'import automatique
  app.get("/api/twizz/mode", auth, (req, res) => res.json({ auto: cfg().on, since: cfg().since }));

  // pour le temps réel (socket Twizz) : badge courant et identifiant du compte (champ sourceId du badge)
  const token = () => sess.cookies.token || null;
  const accountId = () => { try { return JSON.parse(Buffer.from(String(token()).split(".")[1], "base64url").toString()).sourceId || ""; } catch (e) { return ""; } };
  async function ensureAuth() { if (!token()) await reauth(true); return token(); }
  return { auto: () => cfg().on, since: () => cfg().since, backfill, sync, status: () => status, call, get, S, configured, fail, token, accountId, ensureAuth, reauth };
};
