// Compte Twizz de chaque créatrice : publications sur son feed (file automatique) et vidéos de présentation.
// Connexion avec son pseudo Twizz et un mot de passe rangé dans Railway (variable TWIZZ_PW_<PSEUDO>), jamais dans la base.
// Discrétion : une requête à la fois, espacées, comme quelqu'un qui navigue ; rien n'est publié sans action d'un manager
// ou sans l'interrupteur « Publication automatique » du fondateur.
const fs = require("fs"), path = require("path"), crypto = require("crypto");
module.exports = function mount(app, db, auth, admin, { gest, notify, dataDir }) {
  const BASE = process.env.TWIZZ_BASE || "https://api.twizz.com";
  const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  const TZ = "Europe/Paris", CHUNK = 5242880;   // morceaux de 5 Mo, comme l'appli Twizz
  const now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms));
  const str = v => (v == null ? "" : String(v));
  const log = (...a) => { try { gest.log(...a); } catch (e) {} };
  const fail = msg => { const e = new Error(msg); e.twizz = true; return e; };
  const PRES_DIR = path.join(dataDir, "presentation"); fs.mkdirSync(PRES_DIR, { recursive: true });

  const S = {
    get(k, d) { const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(k); if (!r) return d; try { return JSON.parse(r.value); } catch (e) { return r.value; } },
    set(k, v) { db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, JSON.stringify(v)); }
  };
  db.exec(`CREATE TABLE IF NOT EXISTS twizz_posts (id INTEGER PRIMARY KEY, creator_id TEXT NOT NULL, file TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', blurred INTEGER NOT NULL DEFAULT 1,
      pos REAL NOT NULL, status TEXT NOT NULL DEFAULT 'queued', idem TEXT NOT NULL, feed_id TEXT, error TEXT, via TEXT, created_by INTEGER, created_at INTEGER NOT NULL, published_at INTEGER, published_by INTEGER);
    CREATE INDEX IF NOT EXISTS twizz_posts_q ON twizz_posts(creator_id, status, pos);
    CREATE TABLE IF NOT EXISTS twizz_pub_slots (creator_id TEXT NOT NULL, slot TEXT NOT NULL, post_id INTEGER, at INTEGER, PRIMARY KEY (creator_id, slot));
    CREATE TABLE IF NOT EXISTS twizz_pres (id INTEGER PRIMARY KEY, creator_id TEXT NOT NULL, name TEXT, type TEXT, size INTEGER, pos REAL NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
      discover_id TEXT, error TEXT, via TEXT, created_by INTEGER, created_at INTEGER NOT NULL, sent_at INTEGER, sent_by INTEGER);`);
  if (!db.prepare("PRAGMA table_info(twizz_posts)").all().some(x => x.name === "cycles")) db.exec("ALTER TABLE twizz_posts ADD COLUMN cycles INTEGER NOT NULL DEFAULT 0");

  /* ---------- créatrices et mots de passe (variables Railway) ---------- */
  const varName = u => "TWIZZ_PW_" + str(u).toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  const creators = () => db.prepare("SELECT c.twizz_id id, c.label, c.username, c.model_id, m.name model FROM twizz_creators c LEFT JOIN models m ON m.id = c.model_id ORDER BY c.label").all();
  const creatorOf = cid => db.prepare("SELECT twizz_id id, label, username FROM twizz_creators WHERE twizz_id = ?").get(str(cid));
  const passOf = c => (c && c.username && process.env[varName(c.username)]) || "";

  /* ---------- session de chaque créatrice ---------- */
  const SESS = S.get("twizz_csess", {}) || {};
  const saveSess = () => S.set("twizz_csess", SESS);
  const STAT = S.get("twizz_cstat", {}) || {};   // dernier test / dernière erreur par créatrice (sans aucun secret)
  const setStat = (cid, o) => { STAT[cid] = { ...(STAT[cid] || {}), ...o, at: now() }; S.set("twizz_cstat", STAT); };
  let chain = Promise.resolve(), lastAt = 0;
  const queued = fn => { const p = chain.then(async () => { const w = lastAt + 1500 + Math.random() * 1200 - now(); if (w > 0) await sleep(w); try { return await fn(); } finally { lastAt = now(); } }); chain = p.catch(() => {}); return p; };
  const isBlocked = r => !r.json && (r.status === 403 || r.status === 503) && /cloudflare|just a moment|attention required|cf-ray|challenge/i.test(r.text);
  async function raw(cid, method, p, body, extra = {}) {
    const s = SESS[cid] || {};
    const headers = { Accept: "application/json, text/plain, */*", "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8", "User-Agent": UA, Origin: "https://www.twizz.com", Referer: "https://www.twizz.com/", ...extra };
    if (s.token) headers.Authorization = s.token;
    if (s.deviceId) headers["X-Device-Id"] = s.deviceId;
    if (s.cookies && Object.keys(s.cookies).length) headers.Cookie = Object.entries(s.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
    const form = typeof FormData !== "undefined" && body instanceof FormData;
    if (body && !form) headers["Content-Type"] = "application/json";
    let r; try { r = await fetch(BASE + p, { method, headers, body: body ? (form ? body : JSON.stringify(body)) : undefined, signal: AbortSignal.timeout(form ? 120000 : 25000) }); }
    catch (e) { throw fail("Twizz ne répond pas (" + (e.name === "TimeoutError" ? "délai dépassé" : e.message) + ")"); }
    const sc = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [];
    if (sc.length) { s.cookies = s.cookies || {}; sc.forEach(c => { const kv = c.split(";")[0], i = kv.indexOf("="); if (i > 0) s.cookies[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); }); SESS[cid] = s; }
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) {}
    return { status: r.status, json, text };
  }
  async function login(cid) {
    const c = creatorOf(cid); if (!c) throw fail("Créatrice inconnue");
    if (!c.username) throw fail("Pseudo Twizz de la créatrice inconnu : teste d'abord la connexion Twizz dans Réglages fondateur");
    const pw = passOf(c); if (!pw) throw fail(`Mot de passe absent : ajoute la variable ${varName(c.username)} dans Railway`);
    SESS[cid] = { cookies: {}, deviceId: (SESS[cid] && SESS[cid].deviceId) || crypto.randomUUID() };
    const r = await raw(cid, "POST", "/auth/login", { usernameOrEmail: c.username, password: pw, remember: true, device: { userAgent: UA, platform: "MacIntel", language: "fr-FR", browser: "Chrome", os: "MacOS" } });
    if (isBlocked(r)) throw fail("Twizz bloque les requêtes du serveur (protection Cloudflare)");
    const d = (r.json && (r.json.data || r.json)) || {}, tok = d.token || (SESS[cid].cookies && SESS[cid].cookies.token);
    if (!tok) throw fail(r.json && r.json.message ? "Connexion refusée par Twizz : " + r.json.message : `Connexion refusée par Twizz (code ${r.status})`);
    Object.assign(SESS[cid], { token: tok, refreshToken: d.refreshToken || null, deviceId: d.deviceId || SESS[cid].deviceId, at: now() }); saveSess();
  }
  async function refresh(cid) {
    const s = SESS[cid]; if (!s || !s.refreshToken) return false;
    const r = await raw(cid, "POST", "/auth/refresh", { refreshToken: s.refreshToken, deviceId: s.deviceId });
    const d = r.json && (r.json.data || r.json); if (!d || !d.token) return false;
    s.token = d.token; if (d.refreshToken) s.refreshToken = d.refreshToken; saveSess(); return true;
  }
  const authP = {};
  const reauth = (cid, fresh) => authP[cid] || (authP[cid] = (async () => { const ok = !fresh && await refresh(cid).catch(() => false); if (!ok) await login(cid); })().finally(() => { delete authP[cid]; }));
  function call(cid, method, p, body, extra) {
    return queued(async () => {
      if (!SESS[cid] || !SESS[cid].token) { await reauth(cid, true); await sleep(600 + Math.random() * 700); }
      let r = await raw(cid, method, p, body, extra);
      if (isBlocked(r)) throw fail("Twizz bloque les requêtes du serveur (protection Cloudflare)");
      if (r.status === 401 || r.status === 403) { await reauth(cid); await sleep(600 + Math.random() * 700); r = await raw(cid, method, p, body, extra); }
      if (r.status === 429) throw fail("Twizz demande de ralentir (trop de requêtes)");
      if (r.status >= 400 || !r.json) throw fail(`Twizz a répondu une erreur (code ${r.status})${r.json && r.json.message ? " : " + r.json.message : ""}`);
      if (r.json && r.json.status && r.json.status !== 200 && r.json.message && !r.json.data) throw fail("Twizz a refusé : " + r.json.message);
      return r.json;
    });
  }
  const dataOf = j => (j && (j.data !== undefined ? j.data : j));

  // envoi d'un fichier sur le stockage Twizz (même méthode que l'appli : début, morceaux de 5 Mo, fin)
  async function upload(cid, file, folder) {
    const size = fs.statSync(file.path).size, parts = Math.max(1, Math.ceil(size / CHUNK));
    const init = dataOf(await call(cid, "POST", "/storage/init-upload", { filename: file.name, contentType: file.type, partNumbers: parts, totalSize: size, folder }));
    const urls = (init && (init.signedUrls || (init.data && init.data.signedUrls))) || [], uploadId = init && init.uploadId, fname = (init && init.filename) || file.name;
    if (!uploadId || urls.length < parts) throw fail("Twizz n'a pas préparé l'envoi du fichier");
    const fd = fs.openSync(file.path, "r"), done = [];
    try {
      for (let i = 0; i < parts; i++) {
        const len = Math.min(CHUNK, size - i * CHUNK), buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, i * CHUNK);
        const u = typeof urls[i] === "string" ? urls[i] : (urls[i] && (urls[i].url || urls[i].signedUrl));
        let r; try { r = await fetch(u, { method: "PUT", headers: { "Content-Type": file.type }, body: buf, signal: AbortSignal.timeout(120000) }); } catch (e) { throw fail("Envoi du fichier interrompu : " + e.message); }
        const etag = r.headers.get("etag"); if (!r.ok || !etag) throw fail(`Envoi du fichier refusé (morceau ${i + 1}, code ${r.status})`);
        done.push({ ETag: etag, PartNumber: i + 1 });
      }
    } finally { fs.closeSync(fd); }
    const fin = await call(cid, "POST", "/storage/finalize-upload", { uploadId, parts: done, filename: fname });
    const m = fin && (fin.message || (fin.data && fin.data.message) || fin.data);
    if (!m || !m.Location) throw fail("Twizz n'a pas confirmé l'envoi du fichier");
    return { Location: m.Location, Key: m.Key, ETag: m.ETag, Bucket: m.Bucket, filename: file.name, size };
  }

  /* ---------- droits ---------- */
  const mgr = (req, res, next) => req.user.role === "admin" && req.user.rk !== "assistant" && !req.viewAs ? next() : res.status(403).json({ error: "Réservé aux managers" });
  const founder = (req, res, next) => req.user.rk === "founder" && !req.viewAs ? next() : res.status(403).json({ error: "Réservé au fondateur" });
  const wrap = fn => async (req, res) => { try { res.json(await fn(req, res)); } catch (e) { if (!e.twizz) console.error("Publications", e); res.status(e.code || 400).json({ error: e.message || "Erreur" }); } };
  const okC = cid => { const c = creatorOf(cid); if (!c) throw fail("Créatrice inconnue"); return c; };
  const autoOn = () => !!S.get("twizz_pub_auto", false);
  const ruleOf = cid => ({ on: false, times: ["19:00"], recycle: false, ...(S.get("twizz_pub_rule:" + cid, {}) || {}) });
  const presRuleOf = cid => ({ on: false, days: 7, ...(S.get("twizz_pres_rule:" + cid, {}) || {}) });

  /* ---------- heures de Paris ---------- */
  const parisParts = ms => { const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms)).reduce((o, x) => (o[x.type] = x.value, o), {}); return p; };
  const parisMs = (date, hm) => { const guess = Date.parse(`${date}T${hm}:00Z`), p = parisParts(guess), asParis = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`); return guess - (asParis - guess); };
  const dayOf = ms => { const p = parisParts(ms); return `${p.year}-${p.month}-${p.day}`; };
  const addDay = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const cleanTimes = L => [...new Set((Array.isArray(L) ? L : []).map(str).filter(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)))].sort().slice(0, 6);
  function nextSlot(cid) {
    const R = ruleOf(cid); if (!R.on || !R.times.length) return null;
    const t = now(), d0 = dayOf(t);
    for (let k = 0; k < 3; k++) for (const hm of R.times) { const at = parisMs(addDay(d0, k), hm); if (at > t && !db.prepare("SELECT 1 FROM twizz_pub_slots WHERE creator_id = ? AND slot = ?").get(cid, addDay(d0, k) + " " + hm)) return at; }
    return null;
  }

  /* ---------- publier ---------- */
  const postRow = r => r && ({ ...r, file: (() => { try { return JSON.parse(r.file); } catch (e) { return {}; } })(), blurred: !!r.blurred });
  const busy = new Set();
  async function publish(id, by, via) {
    const p = postRow(db.prepare("SELECT * FROM twizz_posts WHERE id = ?").get(id)); if (!p) throw fail("Publication introuvable");
    if (p.status === "published") throw fail("Déjà publiée");
    if (busy.has(id) || p.status === "publishing") throw fail("Publication déjà en cours");
    busy.add(id); db.prepare("UPDATE twizz_posts SET status = 'publishing', error = NULL WHERE id = ?").run(id);
    try {
      const f = new FormData(); f.set("isPrivate", p.blurred ? "true" : "false"); f.set("type", p.file.kind === "video" ? "video" : "photo"); f.set("text", p.text || ""); f.set("quickFiles", str(p.file.id));
      // même clé à chaque nouvel essai : Twizz ne crée pas deux fois la même publication
      const j = await call(p.creator_id, "POST", "/feeds/creators", f, { "x-idempotency-key": p.idem });
      const d = dataOf(j) || {}; let fid = str(d._id || d.id || (d.feed && d.feed._id) || (d.newFeed && d.newFeed._id) || "");
      if (!fid) try { const L = dataOf(await call(p.creator_id, "GET", "/feeds/creators?page=1")); const A = Array.isArray(L) ? L : (L && (L.feeds || L.data || L.items)) || []; const top = A.slice().sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))[0]; if (top && Date.now() - Date.parse(top.createdAt || 0) < 10 * 60e3) fid = str(top._id || top.id || ""); } catch (e) {}
      db.prepare("UPDATE twizz_posts SET status = 'published', feed_id = ?, published_at = ?, published_by = ?, via = ?, error = NULL WHERE id = ?").run(fid || null, now(), by || null, via, id);
      setStat(p.creator_id, { ok: true, error: null });
      log(by || 0, "a", `Publication sur le feed de **${(creatorOf(p.creator_id) || {}).label || "?"}**${via === "auto" ? " (automatique)" : ""}`, (p.text || "").slice(0, 80));
      return { ok: true, feedId: fid };
    } catch (e) {
      db.prepare("UPDATE twizz_posts SET status = 'failed', error = ? WHERE id = ?").run(str(e.message).slice(0, 300), id);
      setStat(p.creator_id, { ok: false, error: str(e.message).slice(0, 300) }); throw e;
    } finally { busy.delete(id); }
  }

  // banque qui tourne : la plus ancienne publication est retirée de Twizz puis republiée (même média, même description)
  async function recycle(id, by, via) {
    const p = db.prepare("SELECT * FROM twizz_posts WHERE id = ?").get(id); if (!p) throw fail("Publication introuvable");
    if (p.status !== "published") throw fail("Seule une publication déjà publiée peut être republiée");
    if (p.feed_id) { try { await call(p.creator_id, "DELETE", `/feeds/creators/${encodeURIComponent(p.feed_id)}`); }
      catch (e) { if (!/code 404|not found|introuvable/i.test(e.message)) { db.prepare("UPDATE twizz_posts SET error = ? WHERE id = ?").run(("Retrait de l'ancienne publication impossible : " + e.message).slice(0, 300), id); throw e; } } }
    db.prepare("UPDATE twizz_posts SET status = 'queued', feed_id = NULL, idem = ?, cycles = cycles + 1 WHERE id = ?").run(crypto.randomUUID(), id);
    return publish(id, by, via);
  }

  /* ---------- vidéos de présentation ---------- */
  const presFile = r => path.join(PRES_DIR, `${r.id}${path.extname(r.name || "") || ".mp4"}`);
  async function sendPres(id, by, via) {
    const v = db.prepare("SELECT * FROM twizz_pres WHERE id = ?").get(id); if (!v) throw fail("Vidéo introuvable");
    if (v.status === "sent") throw fail("Déjà mise en ligne");
    if (busy.has("p" + id) || v.status === "sending") throw fail("Envoi déjà en cours");
    const fp = presFile(v); if (!fs.existsSync(fp)) throw fail("Fichier de la vidéo introuvable sur le serveur : renvoie-la");
    busy.add("p" + id); db.prepare("UPDATE twizz_pres SET status = 'sending', error = NULL WHERE id = ?").run(id);
    try {
      const up = await upload(v.creator_id, { path: fp, name: v.name || "presentation.mp4", type: v.type || "video/mp4" }, "discover");
      const j = await call(v.creator_id, "POST", "/discover", { videoFiles: [up] }, { "x-idempotency-key": "pres-" + v.id });
      const d = dataOf(j) || {}, did = str(d._id || d.id || (Array.isArray(d) && d[0] && d[0]._id) || "");
      db.prepare("UPDATE twizz_pres SET status = 'sent', discover_id = ?, sent_at = ?, sent_by = ?, via = ?, error = NULL WHERE id = ?").run(did || null, now(), by || null, via, id);
      try { fs.unlinkSync(fp); } catch (e) {}
      PSTATS.delete(v.creator_id); setStat(v.creator_id, { ok: true, error: null });
      log(by || 0, "a", `Nouvelle vidéo de présentation pour **${(creatorOf(v.creator_id) || {}).label || "?"}**${via === "auto" ? " (automatique)" : ""}`, "");
      return { ok: true };
    } catch (e) {
      db.prepare("UPDATE twizz_pres SET status = 'failed', error = ? WHERE id = ?").run(str(e.message).slice(0, 300), id);
      setStat(v.creator_id, { ok: false, error: str(e.message).slice(0, 300) }); throw e;
    } finally { busy.delete("p" + id); }
  }
  // statistiques Twizz des vidéos (vues, clics, statut) : gardées 30 min pour ne pas redemander
  const PSTATS = new Map();
  async function presStats(cid, fresh) {
    const c = PSTATS.get(cid); if (c && !fresh && now() - c.at < 30 * 60e3) return c.list;
    const d = dataOf(await call(cid, "GET", "/discover/creator"));
    const L = Array.isArray(d) ? d : (d && (d.discovers || d.items || d.data || d.list)) || [];
    const thumb = f => { const t = (f && f.thumbnails) || []; const x = t.find(y => y.type === "CLEAR") || t[0]; return str((x && (x.absolutePath || x.url)) || (f && f.url) || ""); };
    const list = L.map(x => { const st = x.stats || {}, views = +st.views || 0, clicks = +st.clicks || 0;
      return { id: str(x._id || x.id), status: str(x.status || "ACTIVE").toUpperCase(), from: x.createdAt || null, to: x.updatedAt || null, views, clicks, conv: views ? Math.round(clicks / views * 1000) / 10 : 0, thumb: thumb(x.file), url: str(x.file && x.file.url) }; })
      .sort((a, b) => Date.parse(b.from || 0) - Date.parse(a.from || 0));
    PSTATS.set(cid, { at: now(), list }); return list;
  }

  /* ---------- automatique (fondateur) : chaque minute ---------- */
  async function tick() {
    if (!autoOn()) return;
    const t = now();
    for (const c of creators()) {
      const R = ruleOf(c.id);
      if (R.on && R.times.length) for (const hm of R.times) {
        const d = dayOf(t), at = parisMs(d, hm), slot = d + " " + hm;
        if (t < at || t - at > 2 * 3600e3) continue;   // créneau passé depuis plus de 2 h (serveur arrêté) : on ne rattrape pas
        if (db.prepare("SELECT 1 FROM twizz_pub_slots WHERE creator_id = ? AND slot = ?").get(c.id, slot)) continue;
        const next = db.prepare("SELECT id FROM twizz_posts WHERE creator_id = ? AND status = 'queued' ORDER BY pos LIMIT 1").get(c.id);
        const old = !next && R.recycle ? db.prepare("SELECT id FROM twizz_posts WHERE creator_id = ? AND status = 'published' ORDER BY published_at LIMIT 1").get(c.id) : null;
        db.prepare("INSERT OR IGNORE INTO twizz_pub_slots (creator_id, slot, post_id, at) VALUES (?,?,?,?)").run(c.id, slot, next ? next.id : old ? old.id : null, t);
        if (next) await publish(next.id, null, "auto").catch(e => console.error("Publication automatique", c.label, e.message));
        else if (old) await recycle(old.id, null, "auto").catch(e => console.error("Republication automatique", c.label, e.message));
        else log(0, "a", `File de publications vide pour **${c.label}** : rien n'a été publié à ${hm}`, "");
      }
      const P = presRuleOf(c.id);
      if (P.on && P.days > 0) {
        const last = db.prepare("SELECT MAX(sent_at) t FROM twizz_pres WHERE creator_id = ? AND status = 'sent'").get(c.id).t || 0;
        if (t - last >= P.days * 864e5) {
          const v = db.prepare("SELECT id FROM twizz_pres WHERE creator_id = ? AND status = 'queued' ORDER BY pos LIMIT 1").get(c.id);
          const key = "twizz_pres_try:" + c.id; if (v && t - (+S.get(key, 0) || 0) > 6 * 3600e3) { S.set(key, t); await sendPres(v.id, null, "auto").catch(e => console.error("Vidéo de présentation automatique", c.label, e.message)); }
        }
      }
    }
  }
  setInterval(() => { tick().catch(e => console.error("Publications automatiques", e.message)); }, 60e3);

  /* ---------- API ---------- */
  const summary = c => {
    const q = db.prepare("SELECT COUNT(*) n FROM twizz_posts WHERE creator_id = ? AND status = 'queued'").get(c.id).n;
    const pq = db.prepare("SELECT COUNT(*) n FROM twizz_pres WHERE creator_id = ? AND status = 'queued'").get(c.id).n;
    const last = db.prepare("SELECT MAX(published_at) t FROM twizz_posts WHERE creator_id = ? AND status = 'published'").get(c.id).t;
    return { id: c.id, label: c.label, username: c.username || null, model: c.model || null, varName: c.username ? varName(c.username) : null, hasPassword: !!passOf(c),
      connected: !!(SESS[c.id] && SESS[c.id].token), stat: STAT[c.id] || null, queue: q, presQueue: pq, lastPublished: last || null, next: autoOn() ? nextSlot(c.id) : null, rule: ruleOf(c.id), presRule: presRuleOf(c.id) };
  };
  app.get("/api/pub", auth, mgr, wrap(async req => ({ auto: autoOn(), founder: req.user.rk === "founder", creators: creators().map(summary) })));
  app.post("/api/pub/auto", auth, founder, wrap(async req => { const on = !!(req.body && req.body.on); S.set("twizz_pub_auto", on);
    log(req.user.id, "a", `**${req.user.username}** a ${on ? "activé" : "coupé"} la publication automatique Twizz`, ""); return { auto: on }; }));
  // test de connexion : on se connecte au compte de la créatrice et on lit son profil (aucune écriture)
  app.post("/api/pub/:cid/test", auth, mgr, wrap(async req => {
    const c = okC(req.params.cid);
    try { await reauth(c.id, true); const me = dataOf(await call(c.id, "GET", "/users/me")) || {};
      setStat(c.id, { ok: true, error: null, tested: now() }); return { ok: true, name: str(me.name || me.username || c.username), username: str(me.username || c.username) }; }
    catch (e) { setStat(c.id, { ok: false, error: str(e.message).slice(0, 300), tested: now() }); throw e; }
  }));
  app.post("/api/pub/:cid/rule", auth, mgr, wrap(async req => { const c = okC(req.params.cid), b = req.body || {}, R = ruleOf(c.id);
    const n = { on: typeof b.on === "boolean" ? b.on : R.on, times: b.times ? cleanTimes(b.times) : R.times, recycle: typeof b.recycle === "boolean" ? b.recycle : !!R.recycle }; S.set("twizz_pub_rule:" + c.id, n); return summary({ ...c, ...creators().find(x => x.id === c.id) }); }));
  app.post("/api/pub/:cid/pres-rule", auth, mgr, wrap(async req => { const c = okC(req.params.cid), b = req.body || {}, R = presRuleOf(c.id);
    const days = b.days != null ? Math.max(1, Math.min(60, parseInt(b.days, 10) || 7)) : R.days; S.set("twizz_pres_rule:" + c.id, { on: typeof b.on === "boolean" ? b.on : R.on, days }); return summary({ ...c, ...creators().find(x => x.id === c.id) }); }));

  // file de publications
  app.get("/api/pub/:cid/posts", auth, mgr, wrap(async req => { const c = okC(req.params.cid);
    const q = db.prepare("SELECT p.*, u.username by_name FROM twizz_posts p LEFT JOIN users u ON u.id = p.created_by WHERE p.creator_id = ? AND p.status IN ('queued','publishing','failed') ORDER BY CASE p.status WHEN 'failed' THEN 0 ELSE 1 END, p.pos").all(c.id).map(postRow);
    const done = db.prepare("SELECT p.*, u.username by_name FROM twizz_posts p LEFT JOIN users u ON u.id = COALESCE(p.published_by, p.created_by) WHERE p.creator_id = ? AND p.status = 'published' ORDER BY p.published_at DESC LIMIT 100").all(c.id).map(postRow);
    return { queue: q, history: done, summary: summary({ ...c, ...creators().find(x => x.id === c.id) }) }; }));
  app.post("/api/pub/:cid/posts", auth, mgr, wrap(async req => { const c = okC(req.params.cid), L = Array.isArray(req.body && req.body.files) ? req.body.files.slice(0, 50) : [];
    if (!L.length) throw fail("Choisis au moins un média du coffre");
    let pos = (db.prepare("SELECT MAX(pos) p FROM twizz_posts WHERE creator_id = ?").get(c.id).p || 0);
    const ins = db.prepare("INSERT INTO twizz_posts (creator_id, file, text, blurred, pos, idem, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)");
    L.forEach(f => { if (!f || !f.id || !["image", "video"].includes(f.kind)) return; pos += 1;
      ins.run(c.id, JSON.stringify({ id: str(f.id), kind: f.kind, thumb: str(f.thumb).slice(0, 1500), name: str(f.name).slice(0, 120), album: str(f.album).slice(0, 80) }), str(req.body.text).slice(0, 2000), req.body.blurred === false ? 0 : 1, pos, crypto.randomUUID(), req.user.id, now()); });
    return { ok: true }; }));
  app.post("/api/pub/posts/:id", auth, mgr, wrap(async req => { const id = parseInt(req.params.id, 10), p = db.prepare("SELECT * FROM twizz_posts WHERE id = ?").get(id), b = req.body || {};
    if (!p) throw fail("Publication introuvable"); if (p.status === "published" || p.status === "publishing") throw fail("Cette publication est déjà partie");
    if (b.remove) { db.prepare("DELETE FROM twizz_posts WHERE id = ?").run(id); return { ok: true }; }
    if (typeof b.text === "string") db.prepare("UPDATE twizz_posts SET text = ? WHERE id = ?").run(b.text.slice(0, 2000), id);
    if (typeof b.blurred === "boolean") db.prepare("UPDATE twizz_posts SET blurred = ? WHERE id = ?").run(b.blurred ? 1 : 0, id);
    if (b.retry && p.status === "failed") db.prepare("UPDATE twizz_posts SET status = 'queued', error = NULL WHERE id = ?").run(id);
    if (b.move) { const L = db.prepare("SELECT id, pos FROM twizz_posts WHERE creator_id = ? AND status = 'queued' ORDER BY pos").all(p.creator_id), i = L.findIndex(x => x.id === id);
      if (i >= 0) { if (b.move === "top" && i > 0) db.prepare("UPDATE twizz_posts SET pos = ? WHERE id = ?").run(L[0].pos - 1, id);
        else if (b.move === "up" && i > 0) { db.prepare("UPDATE twizz_posts SET pos = ? WHERE id = ?").run(L[i - 1].pos, id); db.prepare("UPDATE twizz_posts SET pos = ? WHERE id = ?").run(L[i].pos, L[i - 1].id); }
        else if (b.move === "down" && i < L.length - 1) { db.prepare("UPDATE twizz_posts SET pos = ? WHERE id = ?").run(L[i + 1].pos, id); db.prepare("UPDATE twizz_posts SET pos = ? WHERE id = ?").run(L[i].pos, L[i + 1].id); } } }
    return { ok: true }; }));
  app.post("/api/pub/posts/:id/publish", auth, mgr, wrap(async req => publish(parseInt(req.params.id, 10), req.user.id, "manual")));
  app.post("/api/pub/posts/:id/recycle", auth, mgr, wrap(async req => recycle(parseInt(req.params.id, 10), req.user.id, "manual")));

  // vidéos de présentation : envoi du fichier depuis le téléphone ou l'ordinateur (gardé sur le serveur jusqu'à sa mise en ligne)
  app.post("/api/pub/:cid/pres/upload", auth, mgr, async (req, res) => {
    try {
      const c = okC(req.params.cid), type = str(req.headers["content-type"]).split(";")[0], name = decodeURIComponent(str(req.headers["x-file-name"] || "presentation.mp4")).replace(/[\\/]/g, "_").slice(0, 120);
      if (!/^video\//.test(type)) return res.status(400).json({ error: "Envoie une vidéo" });
      const max = 300 * 1024 * 1024, len = parseInt(req.headers["content-length"] || "0", 10); if (len > max) return res.status(400).json({ error: "Vidéo trop lourde (300 Mo au plus)" });
      const pos = (db.prepare("SELECT MAX(pos) p FROM twizz_pres WHERE creator_id = ?").get(c.id).p || 0) + 1;
      const id = db.prepare("INSERT INTO twizz_pres (creator_id, name, type, size, pos, status, created_by, created_at) VALUES (?,?,?,?,?,'uploading',?,?)").run(c.id, name, type, len || 0, pos, req.user.id, now()).lastInsertRowid;
      const fp = presFile({ id, name }), out = fs.createWriteStream(fp); let n = 0, aborted = false;
      req.on("data", ch => { n += ch.length; if (n > max && !aborted) { aborted = true; req.unpipe(out); out.destroy(); } });
      req.pipe(out);
      out.on("finish", () => { if (aborted) return; db.prepare("UPDATE twizz_pres SET status = 'queued', size = ? WHERE id = ?").run(n, id); res.json({ ok: true, id }); });
      const bad = msg => { try { fs.unlinkSync(fp); } catch (e) {} db.prepare("DELETE FROM twizz_pres WHERE id = ?").run(id); if (!res.headersSent) res.status(400).json({ error: msg }); };
      out.on("close", () => { if (aborted) bad("Vidéo trop lourde (300 Mo au plus)"); });
      req.on("aborted", () => bad("Envoi interrompu"));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.get("/api/pub/pres/:id/file", auth, mgr, (req, res) => { const v = db.prepare("SELECT * FROM twizz_pres WHERE id = ?").get(parseInt(req.params.id, 10));
    if (!v || !fs.existsSync(presFile(v))) return res.status(404).end(); res.type(v.type || "video/mp4"); res.sendFile(presFile(v)); });
  app.get("/api/pub/:cid/pres", auth, mgr, wrap(async req => { const c = okC(req.params.cid);
    const queue = db.prepare("SELECT v.*, u.username by_name FROM twizz_pres v LEFT JOIN users u ON u.id = v.created_by WHERE v.creator_id = ? AND v.status IN ('queued','sending','failed','uploading') ORDER BY CASE v.status WHEN 'failed' THEN 0 ELSE 1 END, v.pos").all(c.id);
    const sent = db.prepare("SELECT v.*, u.username by_name FROM twizz_pres v LEFT JOIN users u ON u.id = COALESCE(v.sent_by, v.created_by) WHERE v.creator_id = ? AND v.status = 'sent' ORDER BY v.sent_at DESC LIMIT 20").all(c.id);
    let stats = null, statsError = null;
    if (req.query.stats) { try { stats = await presStats(c.id, req.query.stats === "fresh"); } catch (e) { statsError = e.message; } }
    return { queue, sent, stats, statsError, summary: summary({ ...c, ...creators().find(x => x.id === c.id) }) }; }));
  app.post("/api/pub/pres/:id", auth, mgr, wrap(async req => { const id = parseInt(req.params.id, 10), v = db.prepare("SELECT * FROM twizz_pres WHERE id = ?").get(id), b = req.body || {};
    if (!v) throw fail("Vidéo introuvable"); if (v.status === "sent" || v.status === "sending") throw fail("Cette vidéo est déjà partie");
    if (b.remove) { try { fs.unlinkSync(presFile(v)); } catch (e) {} db.prepare("DELETE FROM twizz_pres WHERE id = ?").run(id); return { ok: true }; }
    if (b.retry && v.status === "failed") db.prepare("UPDATE twizz_pres SET status = 'queued', error = NULL WHERE id = ?").run(id);
    return { ok: true }; }));
  app.post("/api/pub/pres/:id/send", auth, mgr, wrap(async req => sendPres(parseInt(req.params.id, 10), req.user.id, "manual")));

  return { tick, call, upload, varName };
};
