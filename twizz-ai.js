// IA de secours : quand un chatter manque, un manager la lance sur une créatrice et elle répond aux fans à sa place.
// Elle écrit avec Grok (xAI, variable XAI_API_KEY), jamais avec la clé Anthropic du site, d'après la fiche de la créatrice.
// Le fan est toujours prévenu : par le premier message « c'est l'IA de … », par un 🤖 à la fin de chaque message, ou les deux (au moins un des deux, réglé par le fondateur).
// Sur le site, les bulles écrites par l'IA portent un 🤖 pour l'équipe.
// Elle s'arrête toute seule dès qu'un chatter pointe sur cette créatrice ou ouvre sa messagerie. Interrupteur général : le fondateur.
module.exports = function mount(app, db, auth, admin, { twizz, inbox, notify, gest, dataDir }) {
  const { call, S } = twizz;
  const { conv, msg, arr, file, hereOf, G, drop, mapped, sendOn, unreadConvs } = inbox;
  const str = v => (v == null ? "" : String(v)), now = () => Date.now(), enc = encodeURIComponent;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = (...a) => { try { gest.log(...a); } catch (e) {} };
  const fail = (m, code) => { const e = new Error(m); e.code = code || 400; return e; };
  const J = (v, d) => { try { const x = JSON.parse(v); return x == null ? d : x; } catch (e) { return d; } };
  const fs = require("fs"), path = require("path");
  let sharp = null; try { sharp = require("sharp"); } catch (e) {}
  // Grok n'accepte que le JPG et le PNG ; les vignettes Twizz sont en WebP : on les convertit en JPG (envoyé en base64)
  async function toImage(url) {
    if (/^data:image\/(jpeg|png);/i.test(url)) return url;
    let r; try { r = await fetch(url, { signal: AbortSignal.timeout(20000) }); } catch (e) { throw fail("Image injoignable : " + e.message); }
    if (!r.ok) throw fail(`Image injoignable (code ${r.status})`);
    const buf = Buffer.from(await r.arrayBuffer()), ct = str(r.headers.get("content-type")).split(";")[0];
    if (/^image\/(jpeg|png)$/i.test(ct) && buf.length < 8e6) return `data:${ct};base64,${buf.toString("base64")}`;
    if (!sharp) throw fail("Conversion d'image impossible : module sharp absent");
    const out = await sharp(buf).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    return "data:image/jpeg;base64," + out.toString("base64");
  }

  db.exec(`CREATE TABLE IF NOT EXISTS twizz_ai_runs (id INTEGER PRIMARY KEY, creator_id TEXT NOT NULL, model_id INTEGER, started_by INTEGER, started_at INTEGER NOT NULL, reason TEXT,
      ended_at INTEGER, ended_by INTEGER, end_reason TEXT, replies INTEGER NOT NULL DEFAULT 0, medias INTEGER NOT NULL DEFAULT 0, last_error TEXT, last_at INTEGER);
    CREATE TABLE IF NOT EXISTS twizz_ai_convs (run_id INTEGER NOT NULL, conv_id TEXT NOT NULL, fan_id TEXT, fan_name TEXT, notified INTEGER NOT NULL DEFAULT 0, replies INTEGER NOT NULL DEFAULT 0,
      last_fan_msg TEXT, blocked TEXT, at INTEGER, PRIMARY KEY (run_id, conv_id));
    CREATE TABLE IF NOT EXISTS twizz_ai_told (creator_id TEXT NOT NULL, fan_id TEXT NOT NULL, at INTEGER, PRIMARY KEY (creator_id, fan_id));
    CREATE TABLE IF NOT EXISTS twizz_ai_media (creator_id TEXT NOT NULL, file_id TEXT NOT NULL, album_id TEXT, kind TEXT, descr TEXT, err TEXT, at INTEGER, PRIMARY KEY (creator_id, file_id));`);
  // teasing : l'IA a annoncé un média sans l'envoyer ; elle ne peut l'envoyer qu'après une réponse du fan
  db.exec("CREATE TABLE IF NOT EXISTS twizz_ai_sentwhat (msg_id TEXT PRIMARY KEY, what TEXT NOT NULL, at INTEGER NOT NULL)");
  // ce que contient chaque média envoyé par l'IA (album, description de l'équipe, analyse du coffre) : Grok le revoit dans l'historique et sait le décrire au fan
  const whatOf = L => { const ids = L.filter(m => !m.fromFan && m.type === "FILE" && m.id).map(m => str(m.id)); if (!ids.length) return;
    const W = new Map(db.prepare(`SELECT msg_id, what FROM twizz_ai_sentwhat WHERE msg_id IN (${ids.map(() => "?").join(",")})`).all(...ids).map(r => [r.msg_id, r.what]));
    L.forEach(m => { if (W.has(str(m.id))) m.what = W.get(str(m.id)); }); };
  db.exec("CREATE TABLE IF NOT EXISTS twizz_ai_tease (creator_id TEXT NOT NULL, conv_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (creator_id, conv_id))");
  // tickets (Snap, cam, vidéo custom) : un média payant du coffre avec « Ticket … » en texte ; une fois payé, la demande part au Studio
  db.exec("CREATE TABLE IF NOT EXISTS twizz_ai_ticket (creator_id TEXT NOT NULL, fan_id TEXT NOT NULL, conv_id TEXT, kind TEXT, minutes INTEGER, price REAL, msg_id TEXT, state TEXT, at INTEGER, paid_at INTEGER, custom_id INTEGER, PRIMARY KEY (creator_id, fan_id))");
  db.exec("CREATE TABLE IF NOT EXISTS twizz_ai_delivery (custom_id INTEGER PRIMARY KEY, creator_id TEXT, fan_id TEXT, conv_id TEXT, at INTEGER, ok INTEGER, error TEXT)");   // vidéos custom envoyées au fan par le site
  // médias payants envoyés par l'IA (étape de script, prix plancher, coffre, ticket) et leur achat vu dans la conversation : pour « Ce qui vend »
  db.exec("CREATE TABLE IF NOT EXISTS twizz_ai_sold (msg_id TEXT PRIMARY KEY, creator_id TEXT, fan_id TEXT, conv_id TEXT, kind TEXT, script_id INTEGER, step INTEGER, tk_kind TEXT, price REAL, at INTEGER, paid_at INTEGER)");
  db.exec("CREATE INDEX IF NOT EXISTS twizz_ai_sold_cr ON twizz_ai_sold(creator_id, at)");
  db.exec("CREATE TABLE IF NOT EXISTS twizz_ai_fanoff (creator_id TEXT NOT NULL, fan_id TEXT NOT NULL, user_id INTEGER, at INTEGER, PRIMARY KEY (creator_id, fan_id))");
  for (const [k, t] of [["relances", "INTEGER NOT NULL DEFAULT 0"], ["relance_at", "INTEGER"], ["mem_at", "INTEGER"], ["busy", "INTEGER NOT NULL DEFAULT 0"], ["fan_at", "INTEGER"], ["vip", "INTEGER NOT NULL DEFAULT 0"]])
    if (!db.prepare("PRAGMA table_info(twizz_ai_convs)").all().some(x => x.name === k)) db.exec(`ALTER TABLE twizz_ai_convs ADD COLUMN ${k} ${t}`);

  /* ---------- réglages ---------- */
  const MODELS = { fast: ["grok-4-1-fast-non-reasoning", "Rapide"], smart: ["grok-4-1-fast-reasoning", "Plus réfléchi (un peu plus lent)"] };
  const G_DEF = { notice: true, mark: false, base: "", locked: "", noticeText: "Petite précision : c'est l'IA de {creatrice} qui te répond en ce moment 😊", noticeFreq: "run", noticeDays: 30,
    waitMin: 35, waitMax: 80, teamPause: 15, fanWindow: 12, perFan: 40, maxHours: 12, model: "fast",
    relance: true, relanceAfter: 45, relanceMax: 1, quietFrom: 1, quietTo: 9, memory: true, vipAlert: 300 };
  const M_DEF = { ok: false, sell: true, maxPrice: 100, gap: 20, pile: true, albums: [], albumNotes: {}, skipTags: [], extra: "", profile: "", scripts: true, promo: true, maxDiscount: 30, promoHours: 24, vision: true,
    minMsgs: 8, tease: true, teaseWindow: 90, askSkip: false, cooldownH: 6, coolFull: false, sexDays: 1, details: {},
    tk: true, snapMin: 50, snapMax: 100, camMin: 130, camMax: 200, camHour: 300, customPrice: 150, tkAlbum: "", camDispo: "" };
  const gcfg = () => { const o = { ...G_DEF, ...(S.get("twizz_ai_cfg", {}) || {}) }; if (!o.notice && !o.mark) o.mark = true; return o; };   // jamais les deux coupés
  const mcfg = cid => ({ ...M_DEF, ...(S.get("twizz_ai_m:" + cid, {}) || {}) });
  const int = (v, a, b, name) => { const n = parseInt(v, 10); if (!Number.isFinite(n) || n < a || n > b) throw fail(`${name} : entre ${a} et ${b}`); return n; };
  function setG(b, founder) {
    const c = gcfg(), o = { ...c };
    if (typeof b.notice === "boolean" && b.notice !== c.notice) { if (!founder) throw fail("Seul le fondateur peut allumer ou couper le message IA"); o.notice = b.notice; }
    if (typeof b.mark === "boolean" && b.mark !== c.mark) { if (!founder) throw fail("Seul le fondateur peut régler le 🤖 dans les messages"); o.mark = b.mark; }
    if (!o.notice && !o.mark) throw fail("Garde au moins un des deux : le message « c'est l'IA » ou le 🤖 à la fin des messages. Sinon le fan ne saurait jamais que c'est une IA.");
    if (b.noticeText != null) { const t = str(b.noticeText).trim().slice(0, 240); if (t.length < 0) throw fail("Message IA trop court"); o.noticeText = t; }
    if (b.noticeFreq != null) { if (!["run", "fan"].includes(b.noticeFreq)) throw fail("Fréquence inconnue"); o.noticeFreq = b.noticeFreq; }
    if (b.noticeDays != null) o.noticeDays = int(b.noticeDays, 1, 365, "Jours avant de redire que c'est une IA");
    if (b.waitMin != null) o.waitMin = int(b.waitMin, 5, 600, "Délai minimum");
    if (b.waitMax != null) o.waitMax = int(b.waitMax, 5, 900, "Délai maximum");
    if (o.waitMax < o.waitMin) throw fail("Le délai maximum doit être plus grand que le délai minimum");
    if (b.teamPause != null) o.teamPause = int(b.teamPause, 0, 240, "Pause après un message de l'équipe");
    if (b.fanWindow != null) o.fanWindow = int(b.fanWindow, 1, 72, "Âge maximum du message du fan");
    if (b.perFan != null) o.perFan = int(b.perFan, 1, 300, "Réponses maximum par fan");
    if (b.maxHours != null) o.maxHours = int(b.maxHours, 1, 24, "Durée maximum d'une séance");
    if (b.model != null) { if (!MODELS[b.model]) throw fail("Modèle Grok inconnu"); o.model = b.model; }
    if (typeof b.relance === "boolean") o.relance = b.relance;
    if (typeof b.memory === "boolean") o.memory = b.memory;
    if (b.relanceAfter != null) o.relanceAfter = int(b.relanceAfter, 10, 720, "Relance après");
    if (b.relanceMax != null) o.relanceMax = int(b.relanceMax, 1, 5, "Relances maximum par fan");
    if (b.quietFrom != null) o.quietFrom = int(b.quietFrom, 0, 23, "Début des heures calmes");
    if (b.quietTo != null) o.quietTo = int(b.quietTo, 0, 23, "Fin des heures calmes");
    if (b.vipAlert != null) o.vipAlert = int(b.vipAlert, 0, 100000, "Alerte gros payeur");
    if (b.base != null) { const t = str(b.base).trim().slice(0, 8000); o.base = t && t !== BASE_DEF ? t : ""; }   // vide : instructions par défaut
        if (b.locked != null) { const t = str(b.locked).trim().slice(0, 4000); o.locked = t && t !== LOCKED_DEF ? t : ""; }
    S.set("twizz_ai_cfg", o); return o;
  }
  function setM(cid, b) {
    const o = { ...mcfg(cid) };
    if (typeof b.ok === "boolean") o.ok = b.ok;
    if (typeof b.sell === "boolean") o.sell = b.sell;
    if (typeof b.pile === "boolean") o.pile = b.pile;
    if (typeof b.scripts === "boolean") o.scripts = b.scripts;
    if (typeof b.promo === "boolean") o.promo = b.promo;
    if (typeof b.vision === "boolean") o.vision = b.vision;
    if (typeof b.tease === "boolean") o.tease = b.tease;
    if (typeof b.askSkip === "boolean") o.askSkip = b.askSkip;
    if (b.minMsgs != null) o.minMsgs = int(b.minMsgs, 0, 40, "Messages avant un média");
    if (b.cooldownH != null) o.cooldownH = int(b.cooldownH, 0, 48, "Pause après un script");
    if (typeof b.coolFull === "boolean") o.coolFull = b.coolFull;
    if (b.sexDays != null) o.sexDays = int(b.sexDays, 0, 5, "Pause sans sexualisation");
    if (b.details && typeof b.details === "object") o.details = Object.fromEntries(DETAILS.map(([k]) => [k, str(b.details[k]).trim().slice(0, k === "hobbies" || k === "traits" || k === "signes" ? 600 : 120)]).filter(([, v]) => v));
    if (b.teaseWindow != null) o.teaseWindow = int(b.teaseWindow, 10, 720, "Délai pour envoyer après le teasing");
    if (b.maxDiscount != null) o.maxDiscount = int(b.maxDiscount, 5, 90, "Remise maximum");
    if (b.promoHours != null) { const h = parseInt(b.promoHours, 10); if (![6, 12, 24, 48].includes(h)) throw fail("Durée de promo : 6, 12, 24 ou 48 h"); o.promoHours = h; }
    if (b.albumNotes && typeof b.albumNotes === "object") o.albumNotes = Object.fromEntries(Object.entries(b.albumNotes).slice(0, 80).map(([k, v]) => [str(k).slice(0, 60), str(v).trim().slice(0, 240)]).filter(([k, v]) => k && v));
    if (b.maxPrice != null) o.maxPrice = int(b.maxPrice, 3, 500, "Prix maximum");
    if (b.gap != null) o.gap = int(b.gap, 0, 1440, "Délai entre deux médias payants");
    if (Array.isArray(b.albums)) o.albums = b.albums.map(str).filter(Boolean).slice(0, 60);
    if (Array.isArray(b.skipTags)) o.skipTags = b.skipTags.map(x => parseInt(x, 10)).filter(Number.isFinite).slice(0, 40);
    if (b.extra != null) o.extra = str(b.extra).slice(0, 6000);
    if (b.profile != null) o.profile = str(b.profile).trim().slice(0, 10000);   // vide : texte tiré de la fiche
    if (typeof b.tk === "boolean") o.tk = b.tk;
    for (const [k, l] of [["snapMin", "Snap : prix minimum"], ["snapMax", "Snap : prix maximum"], ["camMin", "Cam 20 à 30 min : prix minimum"], ["camMax", "Cam 20 à 30 min : prix maximum"], ["camHour", "Cam d'une heure : prix"], ["customPrice", "Vidéo custom : prix"]])
      if (b[k] != null) o[k] = int(b[k], 5, 2000, l);
    if (o.snapMin > o.snapMax) throw fail("Snap : le prix minimum dépasse le maximum");
    if (o.camMin > o.camMax) throw fail("Cam 20 à 30 min : le prix minimum dépasse le maximum");
    if (b.tkAlbum != null) o.tkAlbum = str(b.tkAlbum).slice(0, 60);
    if (b.camDispo != null) o.camDispo = str(b.camDispo).trim().slice(0, 300);
    S.set("twizz_ai_m:" + cid, o); return o;
  }
  const aiOn = () => !!S.get("twizz_ai_on", false);
  const XAI = () => str(process.env.XAI_API_KEY).trim();
  const XBASE = () => str(process.env.XAI_BASE || "https://api.x.ai/v1").replace(/\/+$/, "");
  const XMODEL = () => str(process.env.XAI_MODEL || (MODELS[gcfg().model] || MODELS.fast)[0]);
  const managers = () => db.prepare("SELECT id FROM users WHERE active = 1 AND deleted_at IS NULL AND role = 'admin' AND COALESCE(grade, '') <> 'assistant'").all().map(r => r.id);
  const ping = (title, body, tag) => { try { notify.pushMany(managers(), null, { title, body, url: "/ia", tag }); } catch (e) {} };
  const crOf = cid => mapped().find(c => c.id === cid) || null;
  const active = () => db.prepare("SELECT * FROM twizz_ai_runs WHERE ended_at IS NULL ORDER BY started_at").all();
  const runOf = cid => db.prepare("SELECT * FROM twizz_ai_runs WHERE creator_id = ? AND ended_at IS NULL").get(cid) || null;
  const uname = id => (id && (db.prepare("SELECT username FROM users WHERE id = ?").get(id) || {}).username) || null;

  /* ---------- lancer, arrêter ---------- */
  function start(cid, by, reason) {
    const c = crOf(cid); if (!c) throw fail("Créatrice inconnue");
    if (!aiOn()) throw fail("L'IA de secours est coupée par le fondateur");
    if (!XAI()) throw fail("Clé Grok manquante : ajoute la variable XAI_API_KEY dans Railway");
    if (!sendOn()) throw fail("L'envoi vers les fans est coupé : l'IA ne pourrait rien envoyer");
    if (!mcfg(cid).ok) throw fail(`Coche d'abord l'accord de ${c.label} dans les réglages de l'IA`);
    if (runOf(cid)) throw fail(`L'IA tourne déjà sur ${c.label}`);
    const id = db.prepare("INSERT INTO twizz_ai_runs (creator_id, model_id, started_by, started_at, reason) VALUES (?,?,?,?,?)").run(cid, c.model_id || null, by || null, now(), str(reason).slice(0, 120) || null).lastInsertRowid;
    log(by || 0, "a", `**${uname(by) || "?"}** a lancé l'IA de secours sur **${c.label}**`, reason ? str(reason).slice(0, 120) : "");
    ping(`🤖 IA de secours lancée sur ${c.label}`, `Par ${uname(by) || "un manager"}. Elle s'arrête dès qu'un chatter reprend.`, "ai-" + cid);
    return id;
  }
  function end(r, by, why) {
    if (!r || r.ended_at) return false;
    const ok = db.prepare("UPDATE twizz_ai_runs SET ended_at = ?, ended_by = ?, end_reason = ? WHERE id = ? AND ended_at IS NULL").run(now(), by || null, str(why).slice(0, 160), r.id).changes;
    if (!ok) return false;
    const c = crOf(r.creator_id) || { label: "?" };
    let sold = null; try { sold = sales(r); } catch (e) {}
    const recap = `${r.replies} réponse${r.replies > 1 ? "s" : ""} · ${r.medias} média${r.medias > 1 ? "s" : ""} envoyé${r.medias > 1 ? "s" : ""}${sold && sold.net ? ` · ${String((+sold.net).toFixed(2)).replace(".", ",")} € vendus` : ""}`;
    log(by || 0, "a", `IA de secours arrêtée sur **${c.label}**`, `${why} · ${recap}`);
    ping(`IA de secours arrêtée sur ${c.label}`, `${why} · ${recap}`, "ai-" + r.creator_id);
    return true;
  }
  // un chatter en shift sur cette créatrice ouvre sa messagerie : il reprend la main (appelé par la messagerie).
  // Hors de son shift (il passe parler à un fan perso), l'IA continue : elle laisse les conversations qu'il ouvre ou où il vient d'écrire.
  app.locals.aiHuman = (cid, user) => {
    if (!user || !["chatter", "tl"].includes(user.rk)) return false;
    const r = runOf(cid); if (!r) return false;
    const c = crOf(cid), on = c && c.model_id && db.prepare("SELECT 1 FROM clocks WHERE user_id = ? AND model_id = ? AND end_at IS NULL").get(user.id, c.model_id);
    return on ? end(r, user.id, `${user.username} a ouvert la messagerie`) : false;
  };
  // un chatter a pointé sur la créatrice depuis le lancement
  const backOf = r => r.model_id ? db.prepare(`SELECT u.id, u.username FROM clocks c JOIN users u ON u.id = c.user_id
    WHERE c.model_id = ? AND c.end_at IS NULL AND c.start_at > ? AND u.role <> 'admin' ORDER BY c.start_at LIMIT 1`).get(r.model_id, r.started_at) : null;

  /* ---------- Grok ---------- */
  const TOOL = { type: "function", function: { name: "repondre", description: "Ta réponse au fan, envoyée telle quelle.", parameters: { type: "object", properties: {
    bulles: { type: "array", items: { type: "string" }, maxItems: 3, description: "Ta réponse en 1 à 3 bulles courtes envoyées à la suite, comme quelqu'un qui tape vite (le plus souvent 1 ou 2). Le média éventuel part avec la dernière bulle." },
    message: { type: "string", description: "Ta réponse en une seule bulle, si tu ne remplis pas bulles." },
    album: { type: "string", description: "Facultatif : identifiant d'un album du coffre (liste fournie) pour joindre un média payant à ton message." },
    media: { type: "string", description: "Facultatif : identifiant précis du média choisi dans la liste de l'album (m:…), si l'album en liste." },
    teaser: { type: "boolean", description: "Mets true quand ton message fait envie d'un média précis sans l'envoyer (tu l'annonces, tu le décris, tu le fais désirer). Obligatoire avant de pouvoir envoyer un média. C'est un champ technique : n'écris jamais « teaser » dans le texte de tes messages." },
    remise: { type: "integer", description: "Facultatif : remise en % sur ce média, seulement dans les cas permis par les consignes." },
    prix: { type: "number", description: "Prix du média en euros, centimes possibles (ex. 9.99) (obligatoire si album est rempli)." },
    laisser: { type: "string", description: "Facultatif : remplis-le seulement si l'équipe doit reprendre ce fan elle-même (raison courte). Rien n'est alors envoyé au fan." },
    lancer: { type: "integer", description: "Facultatif : numéro du script à lancer maintenant (seulement parmi les scripts disponibles listés dans les consignes)." },
    etape: { type: "boolean", description: "Mets true pour envoyer maintenant l'étape suivante du script en cours, quand les consignes disent que tu peux." },
    plancher: { type: "boolean", description: "Mets true pour lui proposer le prix plancher du média pas encore acheté, une seule fois, quand les consignes le permettent." },
    ticket: { type: "string", enum: ["snap", "cam", "custom"], description: "Facultatif : le ticket à lui envoyer maintenant (Snap, cam ou vidéo custom), seulement quand les consignes « DEMANDES SPÉCIALES » le permettent. Remplis aussi prix (et duree pour une cam)." },
    duree: { type: "integer", description: "Pour un ticket cam : durée en minutes (20 à 30, ou 60 pour une heure)." },
    snap: { type: "string", description: "Quand il a payé le ticket Snap et te donne son pseudo Snap : ce pseudo, tel quel." },
    demande: { type: "string", description: "Quand il a payé un ticket cam ou vidéo custom et t'a dit ce qu'il veut : sa demande, avec tous les détails (et ses dispos pour une cam)." }
  } } } };
  async function grok(messages, o = {}) {
    const tool = o.tool === undefined ? TOOL : o.tool, body = { model: o.model || XMODEL(), messages, temperature: o.temp ?? (tool === TOOL ? 0.75 : 0.9), max_tokens: o.max || (tool === TOOL ? 500 : 900) };
    if (tool) { body.tools = [tool]; body.tool_choice = { type: "function", function: { name: tool.function.name } }; }
    let r; try { r = await fetch(XBASE() + "/chat/completions", { method: "POST", headers: { Authorization: "Bearer " + XAI(), "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(60000) }); }
    catch (e) { throw fail("Grok ne répond pas : " + e.message); }
    const j = await r.json().catch(() => null);
    if (!r.ok) { const e = fail(`Grok a refusé la demande (code ${r.status})${j && j.error ? " : " + str(j.error.message || j.error).slice(0, 160) : ""}`); e.status = r.status; throw e; }
    const m = j && j.choices && j.choices[0] && j.choices[0].message; if (!m) throw fail("Réponse de Grok vide");
    if (!tool) return { text: str(m.content).trim() };
    const tc = (m.tool_calls || []).find(x => x && x.function && x.function.name === tool.function.name);
    if (tc) { try { return JSON.parse(tc.function.arguments || "{}"); } catch (e) { throw fail("Réponse de Grok illisible"); } }
    return { message: str(m.content) };
  }
  // la fiche de la créatrice (page Créatrices → Fiches) : qui elle est, sa façon d'écrire, ce qu'elle fait ou pas, son catalogue
  const lvl = (v, a, b) => v <= 20 ? `très ${a}` : v <= 40 ? a : v < 60 ? `entre ${a} et ${b}` : v < 80 ? b : `très ${b}`;
  function ficheOf(c) {
    const m = c.model_id ? db.prepare("SELECT name, style, prices, profile FROM models WHERE id = ?").get(c.model_id) : null; if (!m) return { text: "", prices: "" };
    const p = J(m.profile, {}) || {}, L = k => (Array.isArray(p[k]) ? p[k] : []).map(str).filter(Boolean), sl = p.sliders || {};
    const who = [p.tagline, p.age && `${p.age} ans`, p.city, p.sign && `signe ${p.sign}`].filter(Boolean).join(", ");
    const style = [sl.douceur != null && lvl(+sl.douceur, "douce", "piquante"), sl.familiarite != null && lvl(+sl.familiarite, "distante", "familière"),
      sl.emojis != null && (+sl.emojis <= 30 ? "peu d'emojis" : +sl.emojis >= 70 ? "beaucoup d'emojis" : "quelques emojis"), sl.rythme != null && (+sl.rythme <= 35 ? "messages courts" : +sl.rythme >= 65 ? "messages plus longs" : "messages moyens")].filter(Boolean).join(", ");
    const cat = L("catalogue");
    const parts = [who && `Qui elle est : ${who}.`, p.story && `Son histoire : ${str(p.story).slice(0, 1200)}`, L("traits").length && `Sa personnalité : ${L("traits").join(", ")}.`,
      (p.voice || m.style) && `Sa façon d'écrire : ${str(p.voice || m.style).slice(0, 1200)}`, style && `Son ton : ${style}.`, p.emojis && `Ses emojis préférés : ${p.emojis}`,
      L("likes").length && `Ce qu'elle aime : ${L("likes").join(", ")}.`, L("avoid").length && `Sujets à éviter : ${L("avoid").join(", ")}.`,
      L("does").length && `Ce qu'elle fait : ${L("does").join(", ")}.`, L("doesnt").length && `Ce qu'elle ne fait JAMAIS (ne le propose pas, ne l'accepte pas) : ${L("doesnt").join(", ")}.`,
      p.fanTips && `Conseils de l'équipe pour lui parler : ${str(p.fanTips).slice(0, 1000)}`,
      L("samples").length && `Exemples de ses vrais messages (imite ce style) :\n${L("samples").map(x => "« " + x + " »").join("\n")}`].filter(Boolean);
    return { text: parts.join("\n"), prices: cat.length ? cat.join(" · ") : str(m.prices) };
  }
  // consignes envoyées à Grok : instructions de base (modifiables, pour toutes), puis ce qui vient de la fiche et du coffre, puis les règles fixes
  const BASE_DEF = [`Tu es l'IA de {creatrice}, créatrice de contenus sur Twizz (plateforme de contenus payants réservée aux adultes). Tu réponds à ses fans à sa place pendant que son équipe est absente : écris exactement comme elle, d'après sa fiche et ses exemples de messages.`,
    `Ton but : que le fan passe un bon moment, se sente unique et revienne, et lui vendre des médias quand il est chaud, sans jamais forcer.`,
    `Sois crédible :\n- écris comme un vrai texto : court, spontané, sans liste ni phrases trop parfaites, dans la langue du fan (français familier par défaut), en suivant le style de sa fiche (minuscules, fautes volontaires, emojis…) ;\n- adapte ta longueur à la sienne : s'il écrit trois mots, ne réponds pas un paragraphe ;\n- rebondis sur ce qu'il vient de dire et sur ce que tu sais de lui (prénom, ville, goûts, ce qu'il a déjà acheté), pose-lui des questions sur lui ;\n- ne répète pas tes formules d'un message à l'autre ;\n- tiens compte de l'heure qu'il est ;\n- découpe parfois ta réponse en 2 ou 3 bulles courtes, comme quelqu'un qui tape vite.`,
    `Vente :\n- propose un média quand la conversation s'y prête (il est chaud, il demande, il te complimente), pas à froid ;\n- fais monter l'envie avant, et décris ce qu'il va voir d'après la description de l'album ;\n- adapte le prix au fan : un fan qui a déjà beaucoup dépensé peut aller vers le haut du catalogue, un nouveau vers le bas ;\n- s'il n'achète pas, ne baisse pas le prix tout de suite et ne le harcèle pas : relance plus tard, gentiment.`,
    `Ne parle jamais de l'équipe ou d'une agence. Pas de numéro, pas de réseaux perso, pas de fausse exclusivité.`,
    `Remplis aussi « laisser » si le fan veut parler à un humain, se plaint, demande un remboursement ou un contenu personnalisé, ou si tu ne sais pas quoi répondre sans inventer.`].join("\n\n");
    const LOCKED_DEF = [`RÈGLES FIXES (elles passent avant tout le reste) :`,
    `- {mark} Si un fan te demande si tu es la vraie {creatrice}, un humain ou une IA, réponds honnêtement que tu es son IA. N'écris jamais 🤖 toi-même.`,
    `- Jamais de rendez-vous ni de rencontre promis ; jamais de menace, de chantage ou de culpabilisation.`,
    `- Remplis « laisser » (et rien n'est envoyé) si le fan dit avoir moins de 18 ans ou parle de mineurs, s'il semble en détresse ou parle de se faire du mal, ou s'il dit dépenser plus qu'il ne peut.`].join("\n");
  function parts(c, M, fiche, albums, sellNote, fanInfo, C, opt = {}) {
    const base = str((C && C.base) || BASE_DEF).replace(/\{creatrice\}/gi, c.label);
    const gen = profileOf(c, M, fiche), profile = M.profile ? str(M.profile).replace(/\{creatrice\}/gi, c.label) : gen;
    const sc = M.scripts ? scriptsOf(c.id) : [], notes = M.albumNotes || {};
    const promo = M.promo && M.sell ? (opt.requirePromo ? `Il n'a pas acheté le dernier média payant : tu peux lui en proposer un autre seulement avec une remise (champ remise obligatoire, entre 5 et ${M.maxDiscount} %, valable ${M.promoHours} h). Dis-lui que c'est un petit prix rien que pour lui.`
      : `Si le fan hésite sur un prix ou n'a pas acheté le dernier média, tu peux faire une remise (champ remise, entre 5 et ${M.maxDiscount} %, valable ${M.promoHours} h), jamais à la première proposition.`) : "";
    const alb = a => `- ${a.id} : ${a.name}${a.count != null ? ` (${a.count})` : ""}${notes[a.id] ? " — " + notes[a.id] : ""}${(a.items || []).length ? "\n" + a.items.map(x => `    · m:${x.id} — ${x.descr}`).join("\n") : ""}`;
    const live = [`Il est ${new Date().toLocaleString("fr-FR", { weekday: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })} à Paris.`,
      fanInfo ? `Ce qu'on sait du fan : ${fanInfo}` : "",
      sc.length ? `Messages de l'agence qui marchent bien (inspire-toi de l'idée et du ton, ne les recopie pas mot pour mot) :\n${sc.join("\n")}` : "",
      opt.rules || "",
      opt.script || "",
      albums.length ? `Albums du coffre que tu peux proposer (identifiant : nom, nombre de médias — description ; sous l'album, des médias qu'il n'a pas encore reçus) :\n${albums.map(alb).join("\n")}\nPour joindre un média, remplis album et prix (entre 3 et ${M.maxPrice} €, nombre rond, d'après son catalogue). Si l'album liste des médias, remplis aussi media avec celui qui colle le mieux à la conversation, et donne envie d'après sa description. Sinon le site choisit dans l'album un média qu'il n'a pas encore reçu. Ne promets jamais un contenu précis qui ne serait pas dans ces albums.${promo ? "\n" + promo : ""}`
        : opt.script ? "" : `Pas de média à proposer maintenant${sellNote ? " : " + sellNote : ""}. Discute seulement.`,
      opt.relance ? `RELANCE : le fan ne répond plus depuis ${opt.relance.since}${opt.relance.unbought ? ` et n'a pas acheté le média à ${opt.relance.unbought} €` : ""}. Écris une relance courte et naturelle, comme si tu pensais à lui, sans reproche. Si une relance n'a pas de sens ici, laisse bulles et message vides.` : ""].filter(Boolean).join("\n\n");
    const auto = [profile, live].filter(Boolean).join("\n\n");
        const markText = (C && C.mark) ? "Chacun de tes messages est signé 🤖 par le site." : "Le site prévient le fan que c'est ton IA qui répond.";
    const lockedRaw = str((C && C.locked) || "").trim();
    const locked = (lockedRaw || LOCKED_DEF).replace(/\{creatrice\}/gi, c.label).replace(/\{mark\}/g, markText);
    return { base, auto, locked, profile, gen, live };
  }
  // scripts de la bibliothèque (épinglés et les plus utilisés d'abord) : des exemples de messages qui marchent
  const scriptsOf = cid => { try { return db.prepare("SELECT title, body, steps FROM twizz_scripts WHERE (creator_id IS NULL OR creator_id = '' OR creator_id = ?) AND COALESCE(ai, 0) = 0 ORDER BY COALESCE(pinned, 0) DESC, COALESCE(uses, 0) DESC LIMIT 12").all(cid)
    .map(x => { const st = J(x.steps, []), t = str(x.body || (Array.isArray(st) && st[0] && (st[0].text || st[0].body)) || "").replace(/\{prenom\}/gi, "[son prénom]").replace(/\{creatrice\}/gi, "[elle]").replace(/\s+/g, " ").trim();
      return t ? `- ${x.title ? x.title + " : " : ""}${t.slice(0, 220)}` : ""; }).filter(Boolean).slice(0, 8); } catch (e) { return []; } };
  // ce que le site sait du fan : prénom, infos perso, dépenses, tags, résumé et conseil de l'équipe, note
  async function fanCtx(cr, c) {
    const out = [], P = {}, PL = { anniv: "anniversaire", ville: "ville", metier: "métier", gouts: "ce qu'il aime" };
    db.prepare("SELECT field, value FROM twizz_fan_profile WHERE creator_id = ? AND fan_id = ?").all(cr.id, c.fan.id).forEach(r => P[r.field] = r.value);
    const B = J((db.prepare("SELECT data FROM twizz_fan_brief WHERE creator_id = ? AND fan_id = ?").get(cr.id, c.fan.id) || {}).data, null) || {};
    if (c.fan.name && c.fan.name !== "Fan") out.push("pseudo : " + c.fan.name); if (B.prenom) out.push("prénom : " + B.prenom);
    for (const k in PL) if (P[k]) out.push(`${PL[k]} : ${P[k]}`);
    const f = { ...(db.prepare("SELECT spend, buys FROM twizz_fan_facts WHERE creator_id = ? AND fan_id = ?").get(cr.id, c.fan.id) || {}) };
    if (f.spend == null) try { const sj = await G(`/business/get-fan-purchase-stats/${enc(c.fan.id)}?creatorId=${enc(cr.id)}`, 600e3), d = (sj && (sj.data ?? sj)) || {};
      const tk = Object.keys(d).find(x => /totalSpent|spent/i.test(x)), nk = Object.keys(d).find(x => /totalPurchases|purchases$/i.test(x)); if (tk) f.spend = +d[tk] || 0; if (nk) f.buys = +d[nk] || 0; } catch (e) {}
    if (f.spend > 0) out.push(`a déjà dépensé ${Math.round(f.spend)} € avec elle${f.buys ? ` en ${f.buys} achat${f.buys > 1 ? "s" : ""}` : ""}`); else if (f.spend === 0) out.push("n'a encore jamais rien acheté");
    const tags = db.prepare("SELECT t.name FROM twizz_fan_tags ft JOIN twizz_tags t ON t.id = ft.tag_id WHERE ft.creator_id = ? AND ft.fan_id = ?").all(cr.id, c.fan.id).map(r => r.name);
    if (tags.length) out.push("tags de l'équipe : " + tags.join(", "));
    if (B.brief) out.push("résumé de l'équipe : " + str(B.brief).slice(0, 300)); if (B.action) out.push("conseil de l'équipe : " + str(B.action).slice(0, 200));
    const note = db.prepare("SELECT text FROM twizz_fan_notes WHERE creator_id = ? AND fan_id = ?").get(cr.id, c.fan.id); if (note && note.text) out.push("note de l'équipe : " + str(note.text).slice(0, 300));
    return out.join(" ; ");
  }
  // ce qui vient de la fiche, des consignes Twizz et du manager (remplaçable par un texte écrit à la main pour cette créatrice)
  function profileOf(c, M, fiche) {
    return [fiche.text ? `FICHE DE ${c.label.toUpperCase()}\n${fiche.text}` : "", c.note ? `Ses consignes sur Twizz, à respecter absolument : ${c.note}` : "",
      M.extra ? `Consignes du manager pour ${c.label}, à respecter absolument : ${M.extra}` : "", fiche.prices ? `Son catalogue et ses prix : ${fiche.prices}` : ""].filter(Boolean).join("\n\n");
  }
  const system = (...a) => { const p = parts(...a); return [p.base, p.auto, p.locked].filter(Boolean).join("\n\n"); };
  const lineOf = m => m.type === "FILE" && !m.fromFan ? `[média envoyé${m.price > 0 ? ` à ${m.price} € — ${m.status === "accepted" ? "acheté" : "pas encore acheté"}` : " gratuit"}${m.what ? ` — contenu : ${m.what}` : ""}]${m.text ? " " + m.text : ""}`
    : m.text || (m.medias.length ? (m.fromFan ? "[le fan envoie un média]" : "[média]") : "");

  /* ---------- coffre ---------- */
  // albums photo et vidéo du coffre ; un album dont Twizz ne donne pas le nombre de médias est gardé (il sera lu pour de vrai)
  async function albumsOf(cid, strict) {
    const j = await G(`/quick-files/albums?creatorId=${enc(cid)}`, 300e3).catch(e => { if (strict) throw fail("Lecture du coffre impossible : " + e.message); return null; });
    const n = a => { const v = a.filesCount ?? a.count ?? a.totalFiles ?? a.nbFiles ?? (Array.isArray(a.files) ? a.files.length : null); return v == null || v === "" ? null : +v || 0; };
    return arr(j).map(a => ({ id: str(a._id || a.id), name: str(a.name || a.title || "Album").slice(0, 60), count: n(a),
      audio: /^audios?$|vocal/i.test(str(a.type)) || (!a.type && /vocal|audio|voix/i.test(str(a.name))) })).filter(a => a.id && !a.audio && a.count !== 0).slice(0, 40);
  }
  // un média de l'album que ce fan n'a pas encore reçu (médias vus dans la conversation, historique gardé sur le site, envois du site)
  const filesOf = async (cid, albumId) => { const j = await G(`/quick-files/album/${enc(albumId)}?creatorId=${enc(cid)}`, 300e3);
    const d = j && (j.data ?? j); return (Array.isArray(d) ? d : (d && (d.files || d.quickFiles || d.items)) || []).map(file).filter(f => f.id && f.kind !== "audio"); };
  async function unsent(cid, albumId, convId, L) {
    const F = await filesOf(cid, albumId), sent = new Set(L.flatMap(m => m.medias.flatMap(x => x.keys))); if (!convId) return F;
    try { db.prepare("SELECT keys FROM twizz_media_hist WHERE conv_id = ?").all(convId).forEach(r => J(r.keys, []).forEach(k => sent.add(k))); } catch (e) {}
    try { db.prepare("SELECT files FROM twizz_sent WHERE conv_id = ? AND files IS NOT NULL").all(convId).forEach(r => J(r.files, []).forEach(k => sent.add(str(k)))); } catch (e) {}
    return F.filter(f => !f.keys.some(k => sent.has(k)) && !sent.has(f.id));
  }
  async function pickMedia(cid, albumId, convId, L, wanted) {
    const left = await unsent(cid, albumId, convId, L), w = wanted && left.find(f => f.id === wanted);
    return w || (left.length ? left[Math.floor(Math.random() * left.length)] : null);
  }
  const descrOf = (cid, ids) => { const m = new Map(); if (!ids.length) return m;
    db.prepare(`SELECT file_id, descr FROM twizz_ai_media WHERE creator_id = ? AND descr IS NOT NULL AND file_id IN (${ids.map(() => "?").join(",")})`).all(cid, ...ids).forEach(r => m.set(r.file_id, r.descr)); return m; };
  // ce que l'IA peut vendre à ce fan maintenant (réglages de la créatrice + ce qu'il a déjà reçu)
  // le fan réclame lui-même un média (seulement si le réglage le permet)
  const asks = t => /\b(envoie|envoi|montre|fais (moi )?voir|je (veux|voudrais) (voir|une?)|t'as (une?|des)|tu as (une?|des)|photo|vid[ée]o|pic|nude)\b/i.test(str(t));
  // où en est le teasing de cette conversation : annoncé quand, et le fan a-t-il répondu depuis ?
  function teaseOf(cr, convId, L) {
    const t = convId ? db.prepare("SELECT at FROM twizz_ai_tease WHERE creator_id = ? AND conv_id = ?").get(cr.id, convId) : null; if (!t) return null;
    // live : il répond à ce teasing et elle n'a rien écrit depuis sa réponse → elle envoie, même si sa réponse arrive après le délai
    const i = L.findIndex(m => m.fromFan && (Date.parse(m.at) || 0) > t.at), live = i >= 0 && !L.slice(i).some(m => !m.fromFan);
    return { at: t.at, answered: i >= 0, live };
  }
  const teaseOk = (tz, M) => !!tz && (tz.live || now() - tz.at < M.teaseWindow * 60e3);
  // il vient de dire oui au teasing (« oh ouais vas-y », « montre ») : le média part dans cette réponse, sans le faire attendre
  const YES = /\b(oui|ouii+|ouais|ouai|wesh|vas[- ]?y|vasy|go|grave|carr[ée]ment|[ée]videmment|bien s[uû]r|ok|okay|d'?acc|envoie|envoi|montre|fais voir|je veux|j'?veux|stp|please|avec plaisir|trop)\b/i, NOPE = /\b(non|nan|pas maintenant|plus tard|pas ce soir|j'?ai pas (de )?(thunes|sous|argent)|pas d'?argent)\b/i;
  const saidYes = (tz, last) => !!tz && tz.live && !!last && !NOPE.test(str(last.text)) && (YES.test(str(last.text)) || asks(last.text));
  const YES_NOW = "IL VIENT DE DIRE OUI À TON TEASING : envoie le média MAINTENANT, dans cette réponse. Remplis album et prix (et media si tu en vois un qui colle), avec une seule phrase courte qui donne envie (« tiens, regarde 😏 »). Ne le fais pas attendre, ne le taquine pas encore, ne décris pas ce qu'il va voir.";
  // style : ses derniers messages finissent tous par une question, ou portent tous le même emoji → on le lui dit pour cette réponse
  const EMO = /\p{Extended_Pictographic}/gu;
  // garanti par le site, quoi que Grok écrive : une bulle la plupart du temps, et jamais l'emoji de ses deux derniers messages (un seul emoji au plus par réponse)
  const EMOJI = /\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*/gu;
  function shape(B, L) {
    if (!B.length) return B; let R = B.slice();
    if (R.length > 1) { const x = Math.random(), n = x < .55 ? 1 : x < .9 ? 2 : 3; while (R.length > n && (R[R.length - 2] + R[R.length - 1]).length < 130) { const t = R.pop(); R[R.length - 1] = R[R.length - 1].replace(/[\s.]+$/, "") + " " + t; } }
    const used = new Set(L.filter(m => !m.fromFan && str(m.text).trim()).slice(-2).map(m => str(m.text)).join(" ").match(EMOJI) || []); let kept = 0;
    R = R.map(t => t.replace(EMOJI, e => { if (used.has(e) || kept) return ""; kept++; return e; }).replace(/\s{2,}/g, " ").trim()).filter(t => /[\p{L}\p{N}]/u.test(t));
    return R.length ? R : B.slice(0, 1);
  }
  function variety(L) {
    const R = L.filter(m => !m.fromFan && str(m.text).trim()).slice(-4).map(m => untag(str(m.text)).trim()); if (R.length < 3) return "";
    const out = [], q = R.filter(t => /\?\s*(\p{Extended_Pictographic}|\s)*$/u.test(t)).length, cnt = {};
    R.forEach(t => new Set(t.match(EMO) || []).forEach(e => cnt[e] = (cnt[e] || 0) + 1));
    if (q >= 3) out.push("tes derniers messages finissent presque tous par une question : cette fois, pas de question, affirme, raconte ou taquine");
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]; if (top && top[1] >= 3) out.push(`tu as mis ${top[0]} dans presque tous tes derniers messages : pas de ${top[0]} cette fois`);
    return out.length ? "VARIE : " + out.join(" ; ") + "." : "";
  }
  async function sellable(cr, M, L, convId, tz) {
    if (!M.sell) return { albums: [], note: "la vente de médias est coupée pour cette créatrice" };
    // 1. échauffement : pas de média tant que la conversation n'a pas assez de messages
    const n = L.filter(m => m.text || m.medias.length).length;
    const peek = async () => { let A = []; try { A = await albumsOf(cr.id); } catch (e) {} if (M.albums.length) A = A.filter(a => M.albums.includes(a.id)); const N = M.albumNotes || {};
      return A.slice(0, 8).map(a => a.name + (N[a.id] ? ` (${N[a.id]})` : "")).join(", "); };
    if (M.minMsgs && n < M.minMsgs) return { albums: [], note: `la conversation vient de commencer (${n} message${n > 1 ? "s" : ""} sur les ${M.minMsgs} nécessaires avant tout média) : apprends à le connaître, crée du lien, fais-le parler de lui. Ne propose aucun média, n'en parle même pas encore` };
    // 2. teasing obligatoire : annoncer et faire désirer d'abord, envoyer seulement après sa réponse
    const lastFan = [...L].reverse().find(m => m.fromFan), tease = tz !== undefined ? tz : teaseOf(cr, convId, L);
    const skip = M.askSkip && lastFan && asks(lastFan.text);
    if (M.tease && !skip && !(tease && tease.answered && teaseOk(tease, M))) {
      const what = await peek();
      return { albums: [], teaseNow: true, note: tease && !tease.answered ? "tu viens de lui teaser un média : attends sa réponse, continue de le chauffer sans rien envoyer"
        : `avant tout média, tu dois d'abord le teaser : fais-lui envie de ce que tu pourrais lui montrer (sans l'envoyer, sans prix), fais monter la tension. Un seul teasing, court, comme un vrai message. Coche le champ teaser de l'outil (ne l'écris jamais dans ton message). Tu pourras l'envoyer seulement après sa réponse${what ? `. Ce que tu peux teaser : ${what}` : ""}` }; }
    const gone = new Set(convId ? db.prepare("SELECT msg_id FROM twizz_ai_ticket WHERE conv_id = ? AND state = 'expired'").all(convId).map(x => x.msg_id) : []);   // ticket expiré : il ne bloque plus le coffre
    const paid = L.filter(m => !m.fromFan && m.type === "FILE" && m.price > 0 && !gone.has(m.id)), last = paid[paid.length - 1], open = last && last.status !== "accepted";
    let requirePromo = false;
    if (M.pile && open) { if (M.promo && !last.promo) requirePromo = true;   // une deuxième chance, seulement avec une remise
      else return { albums: [], note: "il n'a pas encore acheté le dernier média payant ; tu peux lui en reparler gentiment, sans en envoyer un autre", open: last }; }
    if (M.gap && last && now() - (Date.parse(last.at) || 0) < M.gap * 60e3) return { albums: [], note: "un média payant vient de lui être proposé", open: open ? last : null };
    let A = await albumsOf(cr.id); if (M.albums.length) A = A.filter(a => M.albums.includes(a.id));
    if (M.vision) for (const a of A) { try { const left = await unsent(cr.id, a.id, convId, L), D = descrOf(cr.id, left.map(f => f.id));
      a.items = left.filter(f => D.has(f.id)).sort(() => Math.random() - .5).slice(0, 6).map(f => ({ id: f.id, descr: D.get(f.id) })); } catch (e) { a.items = []; } }
    return { albums: A, note: A.length ? "" : "aucun album autorisé dans le coffre", requirePromo, open: open ? last : null };
  }
  const teaseSet = (cr, c) => db.prepare("INSERT INTO twizz_ai_tease (creator_id, conv_id, at) VALUES (?,?,?) ON CONFLICT(creator_id, conv_id) DO UPDATE SET at = excluded.at").run(cr.id, c.id, now());
  const teaseClear = (cr, c) => db.prepare("DELETE FROM twizz_ai_tease WHERE creator_id = ? AND conv_id = ?").run(cr.id, c.id);

  /* ---------- vente par scripts (comme OnlyChat) ---------- */
  // L'équipe prépare des scripts « IA » dans l'onglet Scripts : chaque étape a son message, ses médias et son prix, envoyés tels quels.
  // L'IA choisit seulement quand lancer un script et discute entre les étapes ; le site décide du reste : un script à la fois,
  // pas d'étape suivante tant que le média payant n'est pas pris, une seule baisse au prix plancher, sortie après X h sans réponse,
  // pause après un script, et un script déjà reçu n'est jamais renvoyé. Sans script IA disponible, elle vend avec le coffre comme avant.
  db.exec(`CREATE TABLE IF NOT EXISTS twizz_ai_script (creator_id TEXT NOT NULL, fan_id TEXT NOT NULL, conv_id TEXT, script_id INTEGER, step INTEGER, sent_at INTEGER,
    lock_msg TEXT, lock_price REAL, floor_used INTEGER NOT NULL DEFAULT 0, relanced INTEGER NOT NULL DEFAULT 0, state TEXT, started_at INTEGER, ended_at INTEGER, end_reason TEXT,
    full INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (creator_id, fan_id))`);
  // les règles de vente, modifiables pour toutes les créatrices (vide : texte par défaut)
  const STRAT_DEF = {
    launch: `Lance un script seulement si les deux sont vrais :\n1) tu connais déjà un peu le fan : son prénom, sa ville ou son taf, et un détail perso ;\n2) il demande à voir quelque chose (photo, vidéo, « montre », « t'as quoi ») ou il chauffe clairement.\nNe lance pas s'il est juste poli, occupé ou sur le départ, triste, pas intéressé, s'il t'insulte pour de vrai, ou s'il parle d'amour ou de rencontre sans demander à te voir. Ne propose jamais la première d'enlever quelque chose : c'est lui qui demande.`,
    nego: `Le média payant est dans la conversation et il ne l'a pas encore pris :\n- une seule ligne courte sur ce média, pas de nouveau média, pas de grand discours ;\n- ne dis jamais que tu vas l'envoyer, que tu l'as déjà envoyé, ni que c'est bloqué ou bugué ;\n- s'il dit qu'il ne le voit pas ou veut l'avoir gratuit : il s'ouvre quand il le prend, les offerts restent offerts ;\n- s'il négocie : ton prix plancher une seule fois si tu en as un, jamais en dessous, jamais un troisième prix ;\n- ne pars pas sur autre chose et ne promets rien pour plus tard (« ce soir », « je te prépare », « tu vas voir »).`,
    after: `Le script est terminé : 2 ou 3 messages doux et naturels (merci s'il a tout pris, aucun reproche sinon), puis plus aucune vente tant qu'il ne redemande pas lui-même.`,
    style: `Écris comme un vrai texto :\n- bulles courtes, une idée par bulle ;\n- dans la langue du fan, français familier par défaut, jamais de phrases de service client (« n'hésite pas », « j'espère que tu as passé une bonne soirée ») ;\n- une seule question par message, et pas à chaque message ;\n- un emoji de temps en temps, souvent aucun ;\n- jamais d'actions entre étoiles (*rougit*) ;\n- ne répète pas la même phrase ni la même tournure deux fois de suite ;\n- il t'a manqué en proportion de son absence (content qu'il revienne après un jour, vraiment manqué après une semaine), jamais de reproche.`,
    sex: `Reste douce et un peu timide au début : flirt léger seulement, rien d'explicite tant qu'il n'ouvre pas la porte lui-même. Pendant un script, monte avec lui palier par palier et fais monter l'envie seulement vers l'étape suivante qui existe : n'invente jamais une autre scène ni un contenu sur mesure. Si le média n'est pas acheté, pas de sexting : une ligne sur ce média, c'est tout.`,
    relance: `Relance seulement un fan qui a vraiment disparu, jamais un fan qui a dit qu'il était occupé.\n- hors script : courte, un peu timide, une seule idée (« t'es parti ? »), jamais de reproche, ne tease pas un média qui n'est pas déjà dans la conversation ;\n- pendant un script : relance seulement le média pas encore pris, sans en inventer un autre ni promettre pour plus tard ;\n- change de formulation à chaque fois.`,
    kyc: `Apprends à le connaître au fil de la conversation, sans interrogatoire : son prénom, son âge, sa ville, son métier, s'il est en couple, ses passions. Une question à la fois, glissée naturellement, et réutilise ce qu'il t'a déjà dit.`,
    kycMax: 20, kycHours: 6, points: [180, 480, 1080, 1380] };
  const strat = () => ({ ...STRAT_DEF, ...(S.get("twizz_ai_strat", {}) || {}) });
  function setStrat(b) { const o = { ...(S.get("twizz_ai_strat", {}) || {}) };
    for (const k of Object.keys(STRAT_DEF)) if (typeof STRAT_DEF[k] === "string" && b[k] != null) { const t = str(b[k]).trim().slice(0, 3000); if (t && t !== STRAT_DEF[k]) o[k] = t; else delete o[k]; }
    if (b.kycMax != null) o.kycMax = int(b.kycMax, 4, 30, "Découverte : messages maximum");
    if (b.kycHours != null) o.kycHours = int(b.kycHours, 1, 48, "Découverte : durée maximum");
    if (Array.isArray(b.points)) { const P = [...new Set(b.points.map(x => parseInt(x, 10)).filter(x => x >= 10 && x <= 1430))].sort((x, y) => x - y).slice(0, 4);
      if (!P.length) throw fail("Garde au moins un point de relance (entre 10 min et 23 h 50)"); o.points = P; }
    S.set("twizz_ai_strat", o); return strat(); }
  // les faits sur la créatrice (page IA, « Détails ») : donnés au fan comme des faits
  const DETAILS = [["prenom", "prénom"], ["age", "âge"], ["naissance", "date de naissance"], ["genre", "genre"], ["origine", "origine"], ["ville", "ville"], ["fuseau", "heure de"], ["cheveux", "cheveux"], ["yeux", "yeux"],
    ["taille", "taille"], ["poids", "poids"], ["pointure", "pointure"], ["poitrine", "tour de poitrine"], ["langues", "langues parlées"], ["hobbies", "passions"], ["traits", "personnalité"], ["signes", "signes distinctifs"]];
  const factsOf = M => { const D = M.details || {}, L = DETAILS.filter(([k]) => str(D[k]).trim()).map(([k, l]) => `${l} : ${str(D[k]).trim()}`);
    return L.length ? `FAITS SUR ELLE (donne-les comme des faits, ne te contredis jamais) : ${L.join(" ; ")}.` : ""; };
  // fan occupé ou sur le départ ; petite réponse sans suite ; message qui chauffe (pour la pause sans sexualisation)
  const BUSY = /(?:^|[^a-zà-ÿ])(?:je (?:dois|vais|v) (?:y aller|bosser|travailler|dormir|me coucher|manger|partir|filer)|j'?(?:y )?vais (?:au taf|au boulot|bosser|travailler|dormir|me coucher|manger)|jvais (?:au taf|au boulot|bosser|dormir|manger)|(?:au|je suis au|chui au|jsuis au) (?:taf|boulot|travail)|je (?:bosse|travaille|conduis|mange)\b|en (?:voiture|route|réunion|reunion|cours)\b|[àa] (?:plus|toute|tout [àa] l'?heure|demain)\b|a\+|bonne nuit|dodo\b|je file|je te laisse|occup[ée]e?\b|pas le temps)/i;
  const ACK = /^\s*(?:ok+|oki|okay|d'?acc?(?:ord)?|dac|ouais|oui|oklm|[çc]a marche|top|cool|👍|👌)\s*[.!]*\s*$/i;
  const SEXY = /\b(?:nue?s?|[àa] poil|band(?:e|er)|chaud(?:e)?|excit|sexe|sexy|seins?|cul|fesses|nichons|branl|jouir|mouill|suc(?:e|er)|baiser|coquin|hot|nudes?|lingerie|string)\b/i;
  // la conversation chauffe vraiment : plusieurs messages coquins récents, dont au moins un du fan (pour qu'elle prenne l'initiative de proposer un média)
  const HOTW = /(?:^|[^a-zà-ÿ])(?:nue?s?\b|[àa] poil|band|chaud|excit|sexe|sexy|seins?\b|cul\b|fesses|nichon|branl|jouir|joui|mouill|suc[eé]|baise|coquin|hot\b|nudes?\b|lingerie|string|doigt|bites?\b|queue\b|durci|caress|g[eé]mi|envie de toi|t'?es bonne)/i;
  const hotOf = L => { const R = L.slice(-6), fan = R.filter(m => m.fromFan && HOTW.test(str(m.text))).length, all = R.filter(m => HOTW.test(str(m.text))).length; return fan >= 2 || (fan >= 1 && all >= 3); };
  // ils se chauffent depuis plusieurs messages et rien n'a été proposé (ni média, ni teasing) : c'est le moment de proposer
  // elle tourne en rond : au moins 6 messages d'elle depuis le dernier média ou teasing, et ça reste coquin → c'est le moment de proposer, même si le fan n'écrit plus de mots chauds
  const loopOf = L => { let i = -1; L.forEach((m, k) => { if (!m.fromFan && (m.type === "FILE" || m.price > 0 || m.teaser)) i = k; }); const R = L.slice(i + 1);
    return R.filter(m => !m.fromFan && str(m.text).trim()).length >= 6 && R.filter(m => HOTW.test(str(m.text))).length >= 3; };
  const PUSH_NOW = "Tu tournes en rond depuis plusieurs messages : dans cette réponse, propose-lui de voir quelque chose, en une phrase courte qui donne envie (« tu veux que je te montre ? 😏 »). Coche teaser (ou lance le script qui colle). Ne décris plus ce que tu fais.";
  const pushOf = L => { const R = L.slice(-12); if (R.some(m => !m.fromFan && (m.type === "FILE" || m.price > 0 || m.teaser))) return false; return R.filter(m => HOTW.test(str(m.text))).length >= 6; };
  // une bulle qui annonce un prix (« 5 € », « 20 euros ») : jamais, le prix s'affiche sur le média
  const PRICED = t => /\d+(?:[.,]\d+)?\s*(?:€|eur\b|euros?\b|balles\b)/i.test(str(t));
  const NOPRICE = "Ta réponse annonçait un prix : c'est interdit, le prix s'affiche tout seul sur le média. Réécris-la sans aucun prix ni montant (fais envie, demande-lui s'il veut voir).";

  const PACE = { few: [1, 3], normal: [3, 5], many: [5, 9] };   // messages du fan avant l'étape suivante : à partir de, au plus tard
  const aiScripts = cid => db.prepare("SELECT id, title, ai_desc, ai_first, ai_timeout, steps FROM twizz_scripts WHERE COALESCE(ai, 0) = 1 AND creator_id = ? ORDER BY COALESCE(ai_first, 0) DESC, id").all(cid)
    .map(r => ({ id: r.id, title: str(r.title).trim() || "Script", desc: str(r.ai_desc).trim(), first: !!r.ai_first, timeout: r.ai_timeout == null ? 1.5 : +r.ai_timeout,
      steps: (J(r.steps, []) || []).filter(x => x && (str(x.text).trim() || (x.media || []).length)) })).filter(x => x.steps.length);
  const burnedOf = (cid, fan) => new Set(db.prepare("SELECT DISTINCT script_id FROM twizz_script_sent WHERE creator_id = ? AND fan_id = ?").all(cid, fan).map(r => r.script_id));
  const scGet = (cid, fan) => db.prepare("SELECT * FROM twizz_ai_script WHERE creator_id = ? AND fan_id = ?").get(cid, fan) || null;
  const scEnd = (cid, fan, why, full, at) => db.prepare("UPDATE twizz_ai_script SET state = ?, ended_at = ?, end_reason = ?, full = ? WHERE creator_id = ? AND fan_id = ? AND state = 'open'")
    .run(full ? "done" : "quit", Math.round(at || now()), str(why).slice(0, 120), full ? 1 : 0, cid, fan);
  const eurs = v => String(Math.round(v * 100) / 100).replace(".", ",") + " €", clip = (t, n = 220) => (t = str(t).replace(/\s+/g, " ").trim()).length > n ? t.slice(0, n - 1) + "…" : t;
  // le message tel qu'il est écrit : seuls {prenom} et {creatrice} sont remplacés (sans prénom connu, {prenom} disparaît avec son espace)
  const fillStep = (t, cr, who) => (who ? str(t).replace(/\{pr[ée]nom\}/gi, who) : str(t).replace(/ ?\{pr[ée]nom\}/gi, "")).replace(/\{cr[ée]atrice\}/gi, cr.label).trim();
  const prenomOf = (cr, c) => { const B = J((db.prepare("SELECT data FROM twizz_fan_brief WHERE creator_id = ? AND fan_id = ?").get(cr.id, c.fan.id) || {}).data, null) || {};
    return str(B.prenom).trim() || (c.fan.name && c.fan.name !== "Fan" ? str(c.fan.name).trim().split(/\s+/)[0] : ""); };
  const stepSum = st => (st.media || []).length ? (st.price > 0 ? `média payant à ${eurs(st.price)}` : "média offert") : "message seul";
  const ladder = sc => { const P = sc.steps.filter(x => (x.media || []).length && x.price > 0).map(x => eurs(x.price)), F = sc.steps.filter(x => (x.media || []).length && !(x.price > 0)).length;
    return `${sc.steps.length} étape${sc.steps.length > 1 ? "s" : ""}${F ? `, ${F} média${F > 1 ? "s" : ""} offert${F > 1 ? "s" : ""}` : ""}${P.length ? `, puis ${P.join(", ")}` : ""}`; };
  // une étape de script pour la page IA : nombre de photos / vidéos, prix, plancher, teasing, délai de relance
  const stepPath = st => { const M = (st.media || []).filter(f => !/audio/i.test(str(f.type))), v = M.filter(f => /video/i.test(str(f.type)) || /\.(mp4|mov|webm|m3u8)(\?|$)/i.test(str(f.url))).length, paid = M.length && st.price > 0;
    return { n: M.length, v, p: M.length - v, price: paid ? st.price : 0, floor: paid && st.floor ? st.floor : null, tease: !!(M.length && str(st.tease).trim()), relanceMin: paid && st.relanceMin ? st.relanceMin : null }; };
  // où en est la vente par scripts avec ce fan, et ce que l'IA a le droit de faire maintenant (o.S et o.burned : pour l'essai)
  function planOf(cr, M, L, fanId, o = {}) {
    if (!M.sell) return null;
    const all = aiScripts(cr.id); if (!all.length) return null;   // aucun script IA : vente avec le coffre, comme avant
    const ST = strat(), S0 = o.S !== undefined ? o.S : scGet(cr.id, fanId), tOf = m => Date.parse(m.at) || 0, lastFan = Math.max(0, ...L.filter(m => m.fromFan).map(tOf));
    const what = st => { const ids = (st.media || []).map(f => f.id), D = descrOf(cr.id, ids), d = ids.map(i => D.get(i)).filter(Boolean).slice(0, 3); return d.length ? ` — contenu : ${d.join(" ; ")}` : ""; };
    const P = { all, S: null, sc: null, cur: null, text: "", launch: [], step: false, force: false, lock: null, floor: null, coffre: false, coffreAsk: false, endNow: null, after: false };
    if (S0 && S0.state === "open") {
      const sc = all.find(x => x.id === S0.script_id);
      if (!sc) P.endNow = { why: "script retiré de l'IA", full: false, at: now() };
      else {
        const cur = sc.steps[S0.step] || {}, nxt = sc.steps[S0.step + 1], lm = S0.lock_msg ? L.find(m => m.id === S0.lock_msg) : null;
        const paid = !!(lm && lm.status === "accepted"), lock = S0.lock_msg && !paid ? { price: S0.lock_price } : null, out = Math.max(S0.sent_at || 0, lastFan) + sc.timeout * 3600e3;
        if (now() > out) P.endNow = { why: "plus de réponse du fan", full: false, at: out };
        else if (!nxt && !lock) P.endNow = { why: "script terminé", full: true, at: now(), after: true };
        else {
          Object.assign(P, { S: S0, sc, cur });
          const head = `SCRIPT EN COURS : « ${sc.title} », étape ${S0.step + 1} sur ${sc.steps.length} envoyée.`;
          if (lock) { P.lock = lock; P.floor = cur.floor && !S0.floor_used ? +cur.floor : null;
            P.text = [head, `Le média à ${eurs(lock.price)}${what(cur)} est dans la conversation et il ne l'a pas encore pris.`, ST.nego,
              P.floor ? `S'il refuse le prix ou négocie, tu peux lui proposer une seule fois ${eurs(P.floor)} (plancher = true, avec une phrase courte qui l'annonce) : jamais en dessous, jamais un autre prix.`
                : S0.floor_used ? "Tu lui as déjà fait son prix plancher : ne baisse plus." : "Pas de baisse possible sur ce média : tiens ton prix gentiment."].join("\n");
          } else {
            const since = L.filter(m => m.fromFan && tOf(m) > (S0.sent_at || 0)).length, [a, b] = PACE[cur.pace] || PACE.normal;
            const nx = `Prochaine étape : « ${clip(fillStep(nxt.text, cr, "[son prénom]")) || "(médias seuls)"} » (${stepSum(nxt)}${what(nxt)}).`;
            if (paid || since >= b) { P.force = true; P.text = [head, paid ? "Il vient d'acheter le média." : "", nx, `Elle part juste après ta réponse, telle qu'elle est écrite : écris seulement une bulle courte et naturelle ${paid ? "(ta réaction à son achat)" : "de transition"}, ou rien. Ne la recopie pas, ne la décris pas.`].filter(Boolean).join("\n"); }
            else if (since >= a) { P.step = true; P.text = [head, nx, "Envoie-la quand ça colle à la conversation (etape = true) : ta réponse part d'abord, puis le message de l'étape tel qu'il est écrit, avec son média. Sinon continue de discuter et fais monter l'envie. Ne la recopie pas."].join("\n"); }
            else P.text = [head, nx, `Pas encore : discute encore un peu (environ ${a - since} message${a - since > 1 ? "s" : ""} de sa part), fais monter l'envie vers la suite sans la décrire précisément et sans promettre de délai. Pas d'autre script, pas d'autre média.`].join("\n");
          }
          return P;
        }
      }
    }
    if (P.endNow && P.endNow.after) { P.after = true; P.text = ST.after; return P; }   // script fini à l'instant : on raccompagne le fan, pas de vente
    const ended = P.endNow ? { at: P.endNow.at, full: P.endNow.full } : S0 && S0.ended_at ? { at: S0.ended_at, full: !!S0.full } : null;
    const cool = ended && (!ended.full || M.coolFull) ? ended.at + M.cooldownH * 3600e3 - now() : 0;
    const B = o.burned || burnedOf(cr.id, fanId), avail = all.filter(x => !B.has(x.id)), n = L.filter(m => m.text || m.medias.length).length;
    if (cool > 0) { P.text = `Pas de vente pour l'instant : pause après son dernier script (encore ${ago(cool)}). Discute normalement, ne propose rien et ne promets aucun contenu.`; return P; }
    const lf = [...L].reverse().find(m => m.fromFan), init = !!(lf && (asks(lf.text) || SEXY.test(lf.text))), sexLeft = ended && M.sexDays ? ended.at + M.sexDays * 864e5 - now() : 0;
    if (sexLeft > 0 && !init) { P.text = `Pas de sexualisation de ta part pour l'instant (pause après son dernier script, encore ${ago(sexLeft)}) : reste sympa et naturelle, ne ramène pas la conversation vers le sexe, une scène ou un média. S'il relance lui-même, tu pourras suivre.`; return P; }
    if (!avail.length) { P.coffre = true; P.text = "Il a déjà reçu tous les scripts de l'IA."; return P; }   // coffre en secours, avec ses garde-fous
    if (M.minMsgs && n < M.minMsgs) { P.text = `La conversation vient de commencer (${n} message${n > 1 ? "s" : ""} sur les ${M.minMsgs} nécessaires avant tout script) : fais connaissance, crée du lien. Ne propose rien, ne parle pas encore de photos ou de vidéos.`; return P; }
    const fresh = !B.size; P.launch = avail; P.coffreAsk = true; if (sexLeft > 0) P.text0 = "Il relance lui-même le sujet après son dernier script : tu peux suivre.";
    P.text = [`VENTE PAR SCRIPTS : tu ne vends des médias que par ces scripts, des scènes préparées par l'équipe (chaque étape a son message, ses médias et son prix, envoyés tels quels par le site). Tu n'inventes jamais de média, de scène ni de prix.`, ST.launch,
      `Pour lancer, mets lancer = le numéro du script qui colle le mieux à la conversation. Ta réponse part d'abord (une bulle courte d'amorce, ou rien), puis le message de la 1re étape tel qu'il est écrit. Sinon, discute.`,
      `Scripts disponibles :\n${avail.map(x => `- n°${x.id} « ${x.title} »${x.desc ? " : " + clip(x.desc, 300) : ""} (${ladder(x)})${fresh && x.first ? " — à privilégier pour un nouveau fan" : ""}`).join("\n")}`, P.text0 || ""].filter(Boolean).join("\n\n");
    return P;
  }
  // envoie une étape : teasing éventuel, puis le message tel qu'il est écrit avec ses médias et son prix ; note l'étape reçue et l'état du script
  async function runStep(r, cr, c, sc, k, C, prefix, who) {
    const st = sc.steps[k], tail = C.mark ? " 🤖" : "", files = (st.media || []).filter(f => f && f.id), price = files.length && st.price > 0 ? st.price : 0, text = fillStep(st.text, cr, who);
    let id = null;
    if (files.length) {
      if (st.tease) { await sendText(cr.id, c, prefix + fillStep(st.tease, cr, who) + tail); prefix = ""; await sleep(8000 + Math.random() * 8000); if (!runOf(cr.id)) return false; }
      id = await sendMedia(cr.id, c, files, price, prefix + (text || "🙈") + tail, null, { kind: "step", script_id: sc.id, step: k });
      db.prepare("UPDATE twizz_ai_runs SET medias = medias + 1 WHERE id = ?").run(r.id);
    } else id = await sendText(cr.id, c, prefix + text + tail);
    db.prepare("INSERT INTO twizz_script_sent (creator_id, fan_id, script_id, step, msg_id, user_id, at) VALUES (?,?,?,?,?,NULL,?) ON CONFLICT(creator_id, fan_id, script_id, step) DO UPDATE SET msg_id = excluded.msg_id, user_id = NULL, at = excluded.at")
      .run(cr.id, c.fan.id, sc.id, k, id || null, now());
    if (k === 0) db.prepare(`INSERT INTO twizz_ai_script (creator_id, fan_id, conv_id, script_id, step, sent_at, lock_msg, lock_price, floor_used, relanced, state, started_at, ended_at, end_reason, full)
      VALUES (?,?,?,?,0,?,?,?,0,0,'open',?,NULL,NULL,0) ON CONFLICT(creator_id, fan_id) DO UPDATE SET conv_id = excluded.conv_id, script_id = excluded.script_id, step = 0, sent_at = excluded.sent_at,
      lock_msg = excluded.lock_msg, lock_price = excluded.lock_price, floor_used = 0, relanced = 0, state = 'open', started_at = excluded.started_at, ended_at = NULL, end_reason = NULL, full = 0`)
      .run(cr.id, c.fan.id, c.id, sc.id, now(), price ? id : null, price || null, now());
    else db.prepare("UPDATE twizz_ai_script SET step = ?, sent_at = ?, lock_msg = ?, lock_price = ?, floor_used = 0, relanced = 0 WHERE creator_id = ? AND fan_id = ?").run(k, now(), price ? id : null, price || null, cr.id, c.fan.id);
    return true;
  }
  // une seule baisse : le même média renvoyé au prix plancher, avec la phrase de l'IA
  async function runFloor(r, cr, c, sc, k, text) {
    const st = sc.steps[k], files = (st.media || []).filter(f => f && f.id); if (!files.length || !(st.floor > 0)) return false;
    const id = await sendMedia(cr.id, c, files, st.floor, text, null, { kind: "floor", script_id: sc.id, step: k }); db.prepare("UPDATE twizz_ai_runs SET medias = medias + 1 WHERE id = ?").run(r.id);
    db.prepare("UPDATE twizz_ai_script SET lock_msg = ?, lock_price = ?, floor_used = 1, sent_at = ? WHERE creator_id = ? AND fan_id = ?").run(id, st.floor, now(), cr.id, c.fan.id);
    return true;
  }
  // relance d'un média pas acheté : le délai de l'étape si elle a sa relance écrite
  const relFirstOf = (cid, fan, C, p0) => { const S0 = scGet(cid, fan); if (!S0 || S0.state !== "open" || !S0.lock_msg || S0.relanced) return p0;
    const sc = aiScripts(cid).find(x => x.id === S0.script_id), st = sc && sc.steps[S0.step]; return st && str(st.relance).trim() && st.relanceMin ? st.relanceMin : C.relanceAfter; };
  // jamais « je te l'envoie », « et voilà »… si aucun média ne part avec le message
  const DELIV = [/(?:^|[^a-zà-ÿ])(?:je|j'?|jvais|je vais|vais)\s*(?:te|t'|t)\s*(?:l'|la |le |les |l )?\s*envoi(?:e|er|es)?\b/i, /\bjt'?envoi/i, /\bet voil[aà]\b/i, /\bc'?est parti\b/i, /\bregarde bien\b/i,
    /(?:^|[^a-zà-ÿ])(?:je|j'?)\s*te\s*(?:la |le |les )?pr[ée]par/i, /\bjte pr[ée]par/i, /\btu vas voir\b/i, /(?:^|[^a-zà-ÿ])(?:je|j'?)\s*te\s*r[ée]serv/i, /\bjte r[ée]serv/i];
  const fakeSend = t => DELIV.some(x => x.test(str(t)));
  // ce que le site sait déjà du fan (pour savoir si la découverte est finie)
  const knownOf = (cr, fanId) => { const K = {}; db.prepare("SELECT field, value FROM twizz_fan_profile WHERE creator_id = ? AND fan_id = ?").all(cr.id, fanId).forEach(r => K[r.field] = r.value);
    const B = J((db.prepare("SELECT data FROM twizz_fan_brief WHERE creator_id = ? AND fan_id = ?").get(cr.id, fanId) || {}).data, null) || {}; if (B.prenom) K.prenom = B.prenom; return K; };
  // refus du filtre de xAI : on réessaie une fois avec les messages les plus crus résumés entre crochets
  const CRU = /\b(?:doigt|suc(?:e|er|é)|bite|queue|chatte|baise|baiser|jouir|sperme|cul|seins?|nichons?|branl|gicl|orgasm|mouill|porn|nudes?|à poil|a poil|sodo|fellation|pipe|lécher|lèche|bander|bandé|excit)/i;
  const soften = msgs => msgs.map((m, i) => { if (i === 0) return m; let t = Array.isArray(m.content) ? str((m.content[0] || {}).text) : str(m.content); if (!CRU.test(t)) return { ...m, content: t };
    return { ...m, content: m.role === "user" ? "[il t'écrit un message très osé, à caractère sexuel]" : "[tu lui as répondu sur le même ton coquin]" }; })
    .concat([{ role: "system", content: "Certains messages très crus ont été résumés entre crochets. Réponds de façon coquine et suggestive, sans détail cru, et continue la conversation normalement." }]);
  // tickets : libellé, prix permis, note pour Grok selon où en est le ticket du fan
  const TK = { snap: "Snap", cam: "cam", custom: "vidéo custom" }, TK_TTL = 24 * 3600e3, tkFree = T => !T || T.state === "done" || T.state === "expired";   // un ticket pas payé en 24 h expire
  const tkLabel = T => T.kind === "cam" ? `Cam (${T.minutes >= 60 ? "1 h" : T.minutes + " min"})` : T.kind === "snap" ? "Snap" : "vidéo custom";
  const clampP = (v, a, b) => { const p = Math.round(+v || 0); return p >= a && p <= b ? p : Math.round((a + b) / 2); };
  function tkPlan(M, kind, prix, duree) {
    if (kind === "snap") return { kind, minutes: null, price: clampP(prix, M.snapMin, M.snapMax), text: "Ticket snap" };
    if (kind === "cam") { const m = +duree >= 45 ? 60 : Math.min(30, Math.max(20, Math.round(+duree || 25)));
      return { kind, minutes: m, price: m === 60 ? M.camHour : clampP(prix, M.camMin, M.camMax), text: `Ticket Cam (${m === 60 ? "1 h" : m + " min"})` }; }
    if (kind === "custom") return { kind, minutes: null, price: M.customPrice, text: "Ticket vidéo custom" };
    return null;
  }
  // le ticket du fan ; payé dès que son média est accepté dans la conversation
  function tkOf(cr, fanId, L) {
    const T = db.prepare("SELECT * FROM twizz_ai_ticket WHERE creator_id = ? AND fan_id = ?").get(cr.id, fanId) || null;
    if (T && T.state === "sent" && now() - T.at > TK_TTL && !L.some(x => x.id === T.msg_id && x.status === "accepted")) { T.state = "expired"; db.prepare("UPDATE twizz_ai_ticket SET state = 'expired' WHERE creator_id = ? AND fan_id = ?").run(cr.id, fanId); }
    if (T && T.state === "sent") { const m = L.find(x => x.id === T.msg_id); if (m && m.status === "accepted") { T.state = "paid"; T.paid_at = Date.parse(m.at) || now();
      db.prepare("UPDATE twizz_ai_ticket SET state = 'paid', paid_at = ? WHERE creator_id = ? AND fan_id = ?").run(T.paid_at, cr.id, fanId); } }
    return T;
  }
  function tkNote(M, T) {
    if (!M.tk || !M.sell) return "";
    if (T && T.state === "sent") return `TICKET ${tkLabel(T).toUpperCase()} À ${eurs(T.price)} ENVOYÉ, PAS ENCORE PAYÉ : tu peux le lui rappeler gentiment, sans baisser le prix ni rien envoyer d'autre pour ça. Ne lui demande rien tant qu'il n'a pas payé.`;
    if (T && T.state === "paid") return T.kind === "snap" ? `TICKET SNAP PAYÉ : remercie-le et demande-lui son pseudo Snap. Quand il te l'a donné, remplis snap avec ce pseudo et dis-lui que tu l'ajoutes très vite.`
      : T.kind === "cam" ? (M.camDispo ? `TICKET ${tkLabel(T).toUpperCase()} PAYÉ : remercie-le, demande-lui ce qu'il aimerait pendant la cam et propose-lui un de ces créneaux : ${M.camDispo}. Quand il a répondu et choisi, remplis demande (ce qu'il veut et le créneau choisi) et confirme-lui le créneau.`
        : `TICKET ${tkLabel(T).toUpperCase()} PAYÉ : remercie-le, demande-lui ce qu'il aimerait pendant la cam et quand il est disponible. Quand il a répondu, remplis demande (ce qu'il veut et ses dispos) et dis-lui que tu reviens vers lui pour caler l'heure.`)
      : `TICKET VIDÉO CUSTOM PAYÉ : remercie-le et demande-lui précisément ce qu'il veut voir (tenue, ce que tu fais, s'il veut que tu dises son prénom…). Quand il a répondu, remplis demande avec tous les détails et dis-lui que tu t'en occupes et que tu lui envoies dès que c'est prêt.`;
    return `DEMANDES SPÉCIALES (Snap, cam, vidéo custom) : s'il demande ton Snap, une cam, ou une vidéo tournée rien que pour lui, ne le laisse jamais à l'équipe pour ça : propose-lui le ticket. Remplis ticket (snap, cam ou custom) et prix : Snap de ${M.snapMin} à ${M.snapMax} € (selon ce qu'il a déjà dépensé) ; cam de 20 à 30 min de ${M.camMin} à ${M.camMax} € (remplis aussi duree, de 20 à 30) ; cam d'une heure ${M.camHour} € (duree 60) ; vidéo custom de 3 à 5 min ${M.customPrice} €. Pour une cam, demande d'abord combien de temps il veut s'il ne l'a pas dit. Le ticket part juste après ta bulle, avec le texte « Ticket … » : dans ta bulle, dis-lui simplement de le prendre pour que tu t'occupes de lui. S'il réclame un contenu précis que tu n'as pas dans le coffre, propose-lui la vidéo custom.`;
  }
  function rulesOf(M, L, o = {}) {
    const ST = strat(), K = o.known || {}, first = L.find(m => m.fromFan), t0 = first ? Date.parse(first.at) || now() : now();
    const kycOver = L.length >= ST.kycMax || now() - t0 >= ST.kycHours * 3600e3, kycKnown = !!(K.prenom && (K.ville || K.metier));
    const scriptOpen = o.plan && o.plan.S;
    return ["PRIX : n'écris jamais de prix ni de montant dans tes messages (pas de « 5 € », « c'est 20 euros », « les soft sont moins chères »…) : le prix s'affiche tout seul sur le média. Pour vendre, tu fais envie (« ça te dirait de voir ça ? ») puis le média part, sans rien annoncer. S'il demande combien, reste vague et joueuse (« tu verras 😏 ») et envoie quand c'est le moment.",
      "FORMAT : le plus souvent une seule bulle courte (deux de temps en temps, trois rarement), avec une seule question au plus. Dans l'historique, les mentions entre crochets comme [média envoyé…] sont des notes du site : ne les écris jamais, et ne dis jamais que tu envoies un média (c'est le site qui l'envoie).",
      "COHÉRENCE : réponds d'abord à ce qu'il vient de dire, ses derniers messages ensemble. S'il te pose une question, réponds-y vraiment (s'il te demande ce que tu fais, dis-le). S'il fait une remarque (tu as l'air agressive, tu ne réponds pas…), réagis-y. Ne lui repose jamais une question à laquelle il a déjà répondu, ne réponds pas à une question qu'il n'a pas posée, et reste dans le sujet de la conversation.", ST.style, factsOf(M), scriptOpen || kycKnown ? "" : kycOver ? "Tu as assez parlé de lui : arrête de lui poser des questions sur lui et laisse la conversation avancer." : `DÉCOUVERTE DU FAN :\n${ST.kyc}`,
      M.sell ? `SEXUALISATION :\n${ST.sex}` : "", o.relance ? `RELANCE :\n${ST.relance}` : "",
      o.busy || o.relance ? "" : tkNote(M, o.ticket),
      o.push && !o.busy && !o.relance ? "C'EST LE MOMENT : vous vous chauffez depuis plusieurs messages et tu ne lui as encore rien proposé. Dans cette réponse, arrête de décrire et propose-lui de voir quelque chose : lance le script qui colle (lancer) ou, sinon, fais un teasing (teaser = true). Une phrase courte et naturelle, du genre « ça te dirait de voir ça ? »." : "",
      o.hot && !o.busy && !o.relance ? "INITIATIVE : la conversation est vraiment chaude et vous vous connaissez déjà. N'attends pas qu'il réclame : c'est toi qui proposes, dans le fil de ce que vous vous dites. D'abord un teasing (tu fais monter l'envie et tu lui demandes s'il veut voir, sans rien envoyer), puis le média après sa réponse. Une seule proposition, naturelle ; s'il ne suit pas, n'insiste pas et continue la discussion. Jamais à froid, jamais pour forcer." : "",
      "STYLE : varie tes messages comme une vraie fille : pas toujours une question à la fin, pas le même emoji à chaque fois (un emoji pour deux ou trois bulles suffit), pas toujours la même structure. Parle aussi de toi, réagis, affirme.",
      M.sell ? "TEASER, PAS RACONTER : quand vous vous chauffez, ne décris pas en détail ce que tu es en train de faire, comme en direct : fais monter l'envie et garde le reste pour le média, sinon il a déjà tout gratuitement. S'il demande ce qu'il y a dans un média (avant ou après l'envoi), appuie-toi sur son contenu indiqué (« contenu : … » dans l'historique, ou la description de l'album) : dis franchement ce qu'elle y fait, en une phrase qui lui donne envie de l'ouvrir, sans tout dévoiler. N'invente jamais un contenu qui n'est pas indiqué ; si rien n'est indiqué, reste vague et coquine." : "",
      o.yes && !o.busy && !o.relance ? YES_NOW : "", o.busy || o.relance ? "" : variety(L),
      o.busy ? "IL VIENT DE DIRE QU'IL EST OCCUPÉ OU QU'IL PART : une seule bulle courte et gentille (par exemple « ok vas-y on se capte plus tard »), pas de question, pas de vente, rien d'autre." : ""].filter(Boolean).join("\n\n");
  }
  // le bloc « scripts » des consignes, avec ce que dit le coffre quand il sert en secours (sinon sa consigne de teasing serait perdue)
  const scriptNote = (plan, coffre, sell, hot) => !plan ? "" : [plan.text, !coffre ? "" : sell.albums.length ? (plan.coffre ? "" : hot ? "La conversation est chaude : lance le script qui colle, ou, si aucun ne colle, propose un média du coffre ci-dessous (teasing d'abord)." : "Le coffre ci-dessous sert seulement s'il réclame un contenu précis qu'aucun script ne propose : sinon lance le script qui colle.")
    : sell.note ? `${plan.coffre ? "Coffre" : hot ? "La conversation est chaude : lance le script qui colle, ou, si aucun ne colle, propose un média du coffre. Coffre" : "Coffre, seulement pour un contenu précis qu'aucun script ne propose"} : ${sell.note}.` : ""].filter(Boolean).join("\n\n");

  // le média du ticket : au hasard dans l'album choisi pour les tickets (sinon dans les albums autorisés), un qu'il n'a pas encore reçu si possible
  async function tkMedia(cr, M, c, L) {
    let A = []; try { A = await albumsOf(cr.id); } catch (e) {}
    const pool = M.tkAlbum && A.some(a => a.id === M.tkAlbum) ? A.filter(a => a.id === M.tkAlbum) : M.albums.length ? A.filter(a => M.albums.includes(a.id)) : A;
    for (const a of pool.sort(() => Math.random() - .5)) { try { const f = await pickMedia(cr.id, a.id, c.id, L); if (f) return f; } catch (e) {} }
    for (const a of pool) { try { const F = await filesOf(cr.id, a.id); if (F.length) return F[Math.floor(Math.random() * F.length)]; } catch (e) {} }
    return null;
  }
  // ticket payé et infos reçues : la demande part au Studio (au nom du manager qui a lancé l'IA), les managers sont prévenus
  function toStudio(r, cr, c, T, info) {
    const uid = r.started_by || (db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get() || {}).id, fanTw = str(c.fan.name || "un fan").slice(0, 60);
    if (!cr.model_id || !uid) { db.prepare("UPDATE twizz_ai_runs SET last_error = ? WHERE id = ?").run(`${fanTw} : demande Studio impossible (créatrice sans fiche)`, r.id); return; }
    const paid = `ticket payé ${eurs(T.price)}`, kind = T.kind === "custom" ? "video" : T.kind;
    const request = (T.kind === "snap" ? `Snap à ajouter : ${info} (fan Twizz : ${fanTw}) · ${paid}` : T.kind === "cam" ? `${tkLabel(T)} pour ${fanTw} : ${info} · ${paid}` : `Vidéo custom de 3 à 5 min pour ${fanTw} : ${info} · ${paid}`) + " · demandé par l'IA de secours";
    const id = db.prepare("INSERT INTO customs (sale_id, user_id, model_id, fan, kind, duration, qty, request, due_at, urgent, created_at, price, paid_at) VALUES (NULL,?,?,?,?,?,NULL,?,NULL,0,?,?,?)")
      .run(uid, cr.model_id, (T.kind === "snap" ? info : fanTw).slice(0, 60), kind, T.kind === "cam" ? T.minutes * 60 : null, request.slice(0, 1500), now(), T.price, T.paid_at || now()).lastInsertRowid;
    try { app.locals.twizzMatch && app.locals.twizzMatch(id); } catch (e) {}
    db.prepare("UPDATE twizz_ai_ticket SET state = 'done', custom_id = ? WHERE creator_id = ? AND fan_id = ?").run(id, cr.id, c.fan.id);
    ping(`🤖 ${cr.label} : demande envoyée au Studio`, `${tkLabel(T)} pour ${fanTw} (${paid})`, "ai-studio-" + id);
    log(0, "a", `L'IA de secours a envoyé une demande au Studio : **${tkLabel(T)}** pour **${fanTw}** (${cr.label})`, request.slice(0, 160));
  }

  // vidéo custom prête dans le Studio (demande envoyée par l'IA) : le site l'envoie au fan, offerte (le ticket est déjà payé), puis la marque livrée.
  // Même chemin que l'import depuis l'ordinateur sur Twizz : une vidéo part en morceaux de 5 Mo vers le stockage de Twizz, une photo directement avec le message.
  const CHUNK = 5 * 1024 * 1024;
  async function uploadVideo(cid, buf, name, type) {
    const parts = Math.ceil(buf.length / CHUNK), j = await call("POST", `/storage/init-upload?creatorId=${enc(cid)}`, { filename: name, contentType: type, partNumbers: parts, currentCreator: cid }, true) || {};
    if (!j.uploadId || !Array.isArray(j.signedUrls) || j.signedUrls.length < parts) throw fail("Twizz n'a pas ouvert l'envoi de la vidéo" + (j.message ? " : " + str(j.message) : ""));
    const P = [];
    for (let i = 0; i < parts; i++) { const r = await fetch(j.signedUrls[i], { method: "PUT", headers: { "Content-Type": type }, body: buf.subarray(i * CHUNK, Math.min(buf.length, (i + 1) * CHUNK)), signal: AbortSignal.timeout(120000) });
      const et = r.headers.get("etag"); if (!r.ok || !et) throw fail(`Envoi de la vidéo interrompu (morceau ${i + 1} sur ${parts})`); P.push({ ETag: et, PartNumber: i + 1 }); }
    const f = await call("POST", `/storage/finalize-upload?creatorId=${enc(cid)}`, { uploadId: j.uploadId, parts: P, filename: j.filename || name }, true) || {}, m = f.message;
    if (!m || typeof m !== "object" || !m.Location) throw fail("Twizz n'a pas terminé l'envoi de la vidéo");
    return m;
  }
  let delivering = false;
  async function deliver() {
    if (delivering || !sendOn() || !dataDir) return; delivering = true;
    try {
      const L = db.prepare(`SELECT t.creator_id, t.fan_id, t.conv_id, k.id kid, k.file, k.mime, k.fname, k.fan FROM twizz_ai_ticket t JOIN customs k ON k.id = t.custom_id
        LEFT JOIN twizz_ai_delivery d ON d.custom_id = k.id WHERE t.kind = 'custom' AND k.status = 'ready' AND k.file IS NOT NULL AND d.custom_id IS NULL ORDER BY k.ready_at LIMIT 2`).all();
      for (const x of L) {
        const cr = crOf(x.creator_id); if (!cr) continue;
        db.prepare("INSERT INTO twizz_ai_delivery (custom_id, creator_id, fan_id, conv_id, at, ok) VALUES (?,?,?,?,?,0)").run(x.kid, x.creator_id, x.fan_id, x.conv_id, now());   // une seule tentative
        try {
          const buf = fs.readFileSync(path.join(dataDir, "studio", path.basename(x.file))), type = str(x.mime) || "video/mp4", name = str(x.fname).replace(/[^\w.\- ]+/g, "_") || path.basename(x.file);
          const fd = new FormData(), ids = [{ fileId: "0", isPrivate: true, originalFileName: name }];
          if (/^image\//.test(type)) fd.append("files", new Blob([buf], { type }), name);
          else if (/^video\//.test(type)) { const v = await uploadVideo(cr.id, buf, name, type); fd.set("videoFiles", JSON.stringify([{ Location: v.Location, isPrivate: true, Key: v.Key, ETag: v.ETag, Bucket: v.Bucket, filename: name, size: buf.length }])); }
          else throw fail("ce format s'envoie à la main");
          fd.set("promo", "false"); fd.set("price", "0"); fd.set("text", "ta vidéo rien que pour toi est prête 😘" + (gcfg().mark ? " 🤖" : "")); fd.set("isConversation", "true"); fd.set("conversationId", x.conv_id);
          fd.set("receivers", JSON.stringify([x.fan_id])); fd.set("fileIds", JSON.stringify(ids)); fd.set("quickFiles", "[]"); fd.set("creatorId", cr.id);
          const j = await call("POST", "/mediapush/conversation", fd, true), d = (j && j.data) || j || {}; if (!d.newMessage) throw fail("Twizz a refusé la vidéo" + (d.message ? " : " + str(d.message) : ""));
          db.prepare("UPDATE twizz_ai_delivery SET ok = 1 WHERE custom_id = ?").run(x.kid);
          db.prepare("UPDATE customs SET status = 'delivered', delivered_at = ?, seen = 1 WHERE id = ?").run(now(), x.kid);
          ping(`🤖 ${cr.label} : vidéo custom envoyée`, `Envoyée à ${x.fan} par le site`, "ai-deliv-" + x.kid);
          log(0, "a", `L'IA de secours a envoyé la vidéo custom à **${x.fan}** (${cr.label})`, "");
        } catch (e) {
          db.prepare("UPDATE twizz_ai_delivery SET error = ? WHERE custom_id = ?").run(str(e.message).slice(0, 240), x.kid);
          ping(`🤖 ${cr.label} : vidéo custom à envoyer à la main`, `${x.fan} : ${str(e.message).slice(0, 120)}`, "ai-deliv-" + x.kid);
          console.error("IA de secours, livraison", cr.label, x.fan, e.message);
        }
      }
    } finally { delivering = false; }
  }
  setInterval(() => { deliver().catch(e => console.error("IA de secours, livraison", e.message)); }, 120e3);

  /* ---------- envoi (mêmes requêtes que la messagerie) ---------- */
  async function sendText(cid, c, text) {
    const j = await call("POST", "/messages/send-message", { temp_id: `temp_${now()}_${Math.random().toString(36).slice(2, 11)}`, conversationId: c.id, type: "TEXT", text, creatorId: cid }, true);
    const id = str(j && j.data && j.data._id);
    db.prepare("INSERT INTO twizz_sent (msg_id, conv_id, fan_id, creator_id, user_id, price, at, via) VALUES (?,?,?,?,NULL,NULL,?, 'ia')").run(id, c.id, c.fan.id, cid, now());
    return id;
  }
  // conversation lue par l'IA : marquée lue aussi chez Twizz (une requête ; sautée seulement si la liste dit déjà qu'elle est lue).
  // Le « lu » des messages du fan ne veut rien dire chez Twizz (souvent vrai) : c'est la conversation qui compte (hasNewMessages)
  async function readOnTwizz(cid, c, L) {
    if (c.unread === 0) return;
    try { await call("PATCH", "/messages/read-all-messages", { conversationId: c.id, creatorId: cid }, true); } catch (e) { console.error("IA de secours, lu chez Twizz", e.message); }
  }
  const PROMO_T = { 6: ["HOURS", 6, "h6"], 12: ["HOURS", 12, "h12"], 24: ["HOURS", 24, "h24"], 48: ["DAYS", 2, "d2"] };
  async function sendMedia(cid, c, f, price, text, promo, meta) {
    const F = (Array.isArray(f) ? f : [f]).filter(x => x && x.id), fd = new FormData(), pt = promo && PROMO_T[promo.hours];
    fd.set("promo", pt ? "true" : "false"); fd.set("price", String(price)); fd.set("text", text);
    if (pt) { fd.set("discount", String(promo.pct)); fd.set("discountType", "PERCENTAGE"); fd.set("expireTime", String(pt[1])); fd.set("expireTimeType", pt[0]); }
    fd.set("isConversation", "true"); fd.set("conversationId", c.id);
    fd.set("receivers", JSON.stringify([c.fan.id])); fd.set("fileIds", "[]"); fd.set("quickFiles", JSON.stringify(F.map(x => ({ id: x.id, isPrivate: true })))); fd.set("creatorId", cid);
    const j = await call("POST", "/mediapush/conversation", fd, true), d = (j && j.data) || j || {}, nm = d.newMessage || null;
    if (!nm) throw fail("Twizz a refusé le média" + (d.message ? " : " + str(d.message) : ""));
    const paidNow = nm.mediaPushPrice && isFinite(+nm.mediaPushPrice.resultPrice) ? +nm.mediaPushPrice.resultPrice : pt ? Math.round(price * (100 - promo.pct)) / 100 : price;
    db.prepare("INSERT INTO twizz_sent (msg_id, conv_id, fan_id, creator_id, user_id, price, at, files, promo, via) VALUES (?,?,?,?,NULL,?,?,?,?, 'ia')")
      .run(str(nm._id), c.id, c.fan.id, cid, paidNow, now(), JSON.stringify(F.map(x => x.id)), pt ? JSON.stringify({ type: "pct", value: promo.pct, time: pt[2] }) : null);
    if (meta && paidNow > 0) db.prepare("INSERT OR IGNORE INTO twizz_ai_sold (msg_id, creator_id, fan_id, conv_id, kind, script_id, step, tk_kind, price, at, paid_at) VALUES (?,?,?,?,?,?,?,?,?,?,NULL)")
      .run(str(nm._id), cid, c.fan.id, c.id, meta.kind, meta.script_id ?? null, meta.step ?? null, meta.tk_kind || null, paidNow, now());
    try { const ids = F.map(x => x.id), D = descrOf(cid, ids), AN = mcfg(cid).albumNotes || {}, al = meta && meta.album;
      const albs = new Set(ids.length ? db.prepare(`SELECT DISTINCT album_id FROM twizz_ai_media WHERE creator_id = ? AND album_id IS NOT NULL AND file_id IN (${ids.map(() => "?").join(",")})`).all(cid, ...ids).map(r => r.album_id) : []); if (al && al.id) albs.add(al.id);
      const what = [al && al.name ? `album « ${al.name} »` : "", ...[...albs].map(a => AN[a]).filter(Boolean), ...ids.map(i => D.get(i)).filter(Boolean).slice(0, 3)].filter(Boolean).join(" ; ").slice(0, 400);
      if (what) db.prepare("INSERT OR REPLACE INTO twizz_ai_sentwhat (msg_id, what, at) VALUES (?,?,?)").run(str(nm._id), what, now()); } catch (e) {}
    return str(nm._id);
  }
  // le message « c'est l'IA » : coupé, une fois par séance, ou une fois par fan (puis tous les N jours)
  function needNotice(cr, c, row, C) {
    if (!C.notice) return false;
    if (C.noticeFreq === "fan") { const t = db.prepare("SELECT at FROM twizz_ai_told WHERE creator_id = ? AND fan_id = ?").get(cr.id, c.fan.id); return !t || now() - t.at > C.noticeDays * 864e5; }
    return !row.notified;
  }
  const noticeOf = (cr, C) => str(C.noticeText).replace(/\{creatrice\}/gi, cr.label);
  // Grok écrit parfois les champs de l'outil dans le texte (« teaser=true: … ») : on les retire, et on ne garde qu'un seul teasing
  const TEASE_TAG = /\[?\b(?:teaser|teasing)\s*[=:]\s*(?:true|vrai|oui|1)\b\]?\s*:?/i;
  const untag = t => str(t).split(new RegExp(TEASE_TAG.source, "gi")).join(" ").replace(/\s{2,}/g, " ").trim();
  const NOTE_RE = /\[\s*(?:m[ée]dia|photo|vid[ée]o|le fan|image|vocal|fichier)[^\]\n]{0,90}\]?/gi;
  function unleak(out) {
    if (!out) return out; let seen = false, junk = false;
    // « laisser » vide, false, « non », « null »… : ce n'est pas une raison de laisser le fan à l'équipe
    { const v = typeof out.laisser === "string" ? out.laisser.trim() : ""; out.laisser = !v || /^(false|faux|non|no|none|null|undefined|aucune?|rien|0|-)\.?$/i.test(v) || v.length < 4 ? "" : v; }
    const fix = x => { if (str(x).length > 500) junk = true; const P = str(x).split(new RegExp(TEASE_TAG.source, "i")); let t = P[0];
      if (P.length > 1) { if (!seen) t += " " + P[1]; seen = true; }
      const before = t; t = t.replace(NOTE_RE, " ").replace(/\[\s*$/, ""); if (t !== before) junk = true;
      return t.replace(/\b(?:album|media|prix|remise|laisser|bulles)\s*=\s*\S+/gi, "").replace(/\s{2,}/g, " ").trim(); };
    if (Array.isArray(out.bulles)) out.bulles = out.bulles.map(fix).filter(Boolean);
    if (out.message != null) out.message = fix(out.message);
    if (seen) out.teaser = true;
    if (junk) out.junk = true;   // réponse trop longue ou qui recopie les notes du site : on redemande une fois
    return out;
  }
  const cents = v => Math.round((parseFloat(str(v).replace(",", ".")) || 0) * 100) / 100;   // 9,99 ou 9.99 → 9.99
  const short = t => { if (t.length <= 320) return t; const c = t.slice(0, 320), i = Math.max(c.lastIndexOf(". "), c.lastIndexOf("! "), c.lastIndexOf("? "), c.lastIndexOf("… "));
    return (i > 80 ? c.slice(0, i + 1) : c.slice(0, c.lastIndexOf(" ") > 80 ? c.lastIndexOf(" ") : 320)).trim(); };
  const oneQ = B => { const pure = b => /^[^.!?…]*\?[\s\S]{0,6}$/.test(b), q = B.map((b, i) => /\?/.test(b) ? i : -1).filter(i => i >= 0); if (q.length < 2) return B;
    const keep = q[q.length - 1], out = B.filter((b, i) => i === keep || !q.includes(i) || !pure(b)); return out.length ? out : [B[keep]]; };
  // ce qu'elle a déjà écrit à ce fan (ses 10 derniers messages, sans emojis, ponctuation ni majuscules) : une bulle déjà envoyée n'est jamais renvoyée
  const nrm = t => str(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const saidOf = L => L.filter(m => !m.fromFan).slice(-10).map(m => nrm(m.text)).filter(Boolean);
  // presque pareille aussi : au moins 4 mots, et les trois quarts des mots en commun avec une bulle déjà envoyée
  const words = t => new Set(t.split(" ").filter(w => w.length > 1)), close = (a, b) => { const A = words(a), B = words(b); if (A.size < 4 || B.size < 4) return false; let n = 0; A.forEach(w => { if (B.has(w)) n++; }); return n / (A.size + B.size - n) >= 0.75; };
  const fresh = (B, said) => B.filter(b => { const n = nrm(b); return !n || !said.some(x => x === n || (n.includes(" ") && x.endsWith(" " + n)) || close(n, x)); });
  const REDIT = B => `Tu as déjà écrit exactement ça à ce fan : « ${B.join(" / ")} ». Ne répète jamais une phrase déjà envoyée : réponds autre chose, en suivant la conversation.`;
  const bubbles = out => [...new Set((Array.isArray(out.bulles) && out.bulles.length ? out.bulles : [out.message]).map(x => short(str(x).replace(/🤖/g, "").trim())).filter(Boolean))].slice(0, 3);

  /* ---------- une conversation ---------- */
  /* ---------- une conversation : réponse au fan, ou relance quand il ne répond plus ---------- */
  const isImg = x => x && !x.audio && !x.video && (x.thumb || x.url);
  async function handle(r, cr, c, C, relance) {
    const M = mcfg(cr.id);
    const row = db.prepare("SELECT * FROM twizz_ai_convs WHERE run_id = ? AND conv_id = ?").get(r.id, c.id) || {};
    const j = await G(`/messages/find-all-messages?conversationId=${enc(c.id)}&creatorId=${enc(cr.id)}&page=1`, 0);
    const L = ((j && j.data && j.data.data) || []).map(m => msg(m, c.fan.id)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-30);
    whatOf(L);   // ce que contenaient les médias qu'elle a envoyés
    const last = L[L.length - 1]; if (!last) return false;
    if (relance ? last.fromFan : (!last.fromFan || last.id === row.last_fan_msg)) return false;   // le fan a réécrit, ou déjà répondu
    // achats vus dans la conversation : pour « Ce qui vend »
    { const ok = L.filter(m => !m.fromFan && m.status === "accepted" && m.price > 0); if (ok.length) { const u = db.prepare("UPDATE twizz_ai_sold SET paid_at = ? WHERE msg_id = ? AND paid_at IS NULL"); ok.forEach(m => u.run(Date.parse(m.at) || now(), m.id)); } }
    // un gros payeur écrit pendant la séance : les managers sont prévenus (une fois par séance)
    if (!relance && C.vipAlert > 0 && !row.vip) { const sp = +((db.prepare("SELECT spend FROM twizz_fan_facts WHERE creator_id = ? AND fan_id = ?").get(cr.id, c.fan.id) || {}).spend) || 0;
      if (sp >= C.vipAlert) { db.prepare("INSERT INTO twizz_ai_convs (run_id, conv_id, fan_id, fan_name, vip, at) VALUES (?,?,?,?,1,?) ON CONFLICT(run_id, conv_id) DO UPDATE SET vip = 1").run(r.id, c.id, c.fan.id, c.fan.name, now()); row.vip = 1;
        ping(`💎 ${cr.label} : un gros payeur écrit`, `${c.fan.name || "Un fan"} (${eurs(sp)} dépensés) parle à l'IA de secours`, "ai-vip-" + c.id); } }
    const fanInfo = await fanCtx(cr, c), lastFan = [...L].reverse().find(m => m.fromFan), plan = planOf(cr, M, L, c.fan.id);
    if (plan && plan.endNow) scEnd(cr.id, c.fan.id, plan.endNow.why, plan.endNow.full, plan.endNow.at);
    // le coffre : sans script IA, quand il a déjà reçu tous les scripts, ou s'il réclame un contenu précis (jamais pendant un script)
    // (un média du coffre déjà teasé reste possible au message suivant du fan, même s'il ne le réclame pas mot pour mot)
    const tz0 = teaseOf(cr, c.id, L), teased = teaseOk(tz0, M), busy = !relance && !!lastFan && BUSY.test(lastFan.text);
    const hot = !relance && !busy && hotOf(L), coffre = !busy && (!plan || plan.coffre || (plan.coffreAsk && lastFan && (asks(lastFan.text) || teased || hot)));
    const sell = coffre ? await sellable(cr, M, L, c.id) : { albums: [], note: "" };
    const mark0 = (patch) => db.prepare(`INSERT INTO twizz_ai_convs (run_id, conv_id, fan_id, fan_name, notified, replies, last_fan_msg, blocked, at, relances, relance_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(run_id, conv_id) DO UPDATE SET notified = excluded.notified, replies = excluded.replies, last_fan_msg = excluded.last_fan_msg, blocked = excluded.blocked, at = excluded.at, relances = excluded.relances, relance_at = excluded.relance_at`)
      .run(r.id, c.id, c.fan.id, c.fan.name, patch.notified ?? row.notified ?? 0, patch.replies ?? row.replies ?? 0, relance ? row.last_fan_msg || null : last.id, patch.blocked ?? row.blocked ?? null, now(),
        relance ? (row.relances || 0) + 1 : 0, relance ? now() : row.relance_at || null);   // il a réécrit : les relances repartent de zéro
    const mark = patch => { mark0(patch); if (!relance) db.prepare("UPDATE twizz_ai_convs SET busy = ?, fan_at = ? WHERE run_id = ? AND conv_id = ?").run(busy ? 1 : 0, Date.parse(lastFan ? lastFan.at : last.at) || now(), r.id, c.id); };
    // « ok » juste après avoir dit qu'il partait : pas de réponse, on le laisse partir
    if (!relance && row.busy && lastFan && ACK.test(lastFan.text)) { mark0({}); await readOnTwizz(cr.id, c, L); return false; }
    const tell = needNotice(cr, c, row, C), tail = C.mark ? " 🤖" : "", who = prenomOf(cr, c), pre = tell ? noticeOf(cr, C) + "\n\n" : "";
    const told = () => { if (tell) db.prepare("INSERT INTO twizz_ai_told (creator_id, fan_id, at) VALUES (?,?,?) ON CONFLICT(creator_id, fan_id) DO UPDATE SET at = excluded.at").run(cr.id, c.fan.id, now()); };
    // relance d'un média de script pas acheté : la relance écrite dans l'étape, telle quelle, une fois
    if (relance && plan && plan.lock && str(plan.cur.relance).trim() && !plan.S.relanced) {
      await sendText(cr.id, c, pre + fillStep(plan.cur.relance, cr, who) + tail); told();
      db.prepare("UPDATE twizz_ai_script SET relanced = 1 WHERE creator_id = ? AND fan_id = ?").run(cr.id, c.fan.id);
      db.prepare("UPDATE twizz_ai_runs SET replies = replies + 1, last_at = ?, last_error = NULL WHERE id = ?").run(now(), r.id);
      mark({ notified: tell || row.notified ? 1 : 0, replies: (row.replies || 0) + 1 }); drop(c.id, `/conversations/user/${enc(cr.id)}`); return true;
    }
    const T = tkOf(cr, c.fan.id, L);
    const canSell = sell.albums.length > 0 || !!sell.teaseNow || !!(plan && plan.launch.length), push = canSell && !teased && !(plan && plan.S && plan.S.state === "open") && (hot && pushOf(L) || !relance && !busy && loopOf(L));
    const yes = !relance && !busy && sell.albums.length > 0 && saidYes(tz0, lastFan);
    const opt = { requirePromo: sell.requirePromo, script: busy ? "" : scriptNote(plan, coffre, sell, hot), rules: rulesOf(M, L, { known: knownOf(cr, c.fan.id), plan, relance: !!relance, busy, ticket: T, hot: hot && canSell, push, yes }) };
    if (relance) opt.relance = { since: relance.since, unbought: sell.open ? sell.open.price : plan && plan.lock ? plan.lock.price : null };
    const msgs = [{ role: "system", content: system(cr, M, ficheOf(cr), sell.albums, sell.note, fanInfo, C, opt) }];
    // la dernière photo envoyée par le fan : Grok la regarde (les autres restent en texte)
    const lastPic = [...L].reverse().find(m => m.fromFan && m.medias.some(isImg)); let picUrl = null;
    if (lastPic) { const x = lastPic.medias.find(isImg); try { picUrl = await toImage(x.thumb || x.url); } catch (e) { picUrl = null; } }
    L.forEach(m => { const t = m.fromFan ? lineOf(m) : untag(lineOf(m)); if (!t) return;
      const pic = m === lastPic && picUrl;
      msgs.push({ role: m.fromFan ? "user" : "assistant", content: pic ? [{ type: "text", text: m.text || "[le fan t'envoie cette photo]" }, { type: "image_url", image_url: { url: pic } }] : t }); });
    let out = null, err = null; try { out = await grok(msgs); } catch (e) { err = e; }
    if (!out && picUrl && err.status !== 401) { msgs.forEach(m => { if (Array.isArray(m.content)) m.content = m.content[0].text; }); try { out = await grok(msgs); err = null; } catch (e) { err = e; } }   // image refusée : sans la photo
    if (!out && err && err.status === 403) { try { out = await grok(soften(msgs)); err = null; } catch (e) { err = e; } }   // refus : une seconde chance, adoucie
    // le filtre de sécurité de xAI refuse encore cette conversation (code 403) : le fan est laissé à l'équipe, au lieu de redemander à chaque tour
    if (!out && err && err.status === 403) {
      mark({ blocked: "Grok refuse de répondre à cette conversation (filtre de sécurité de xAI) : à reprendre par un chatter" });
      ping(`🤖 ${cr.label} : un fan à reprendre`, `${c.fan.name || "Un fan"} : Grok refuse de répondre à cette conversation`, "ai-leave-" + c.id);
      log(0, "a", `L'IA de secours laisse **${c.fan.name || "un fan"}** (${cr.label}) à l'équipe`, "Grok refuse de répondre à cette conversation (filtre de sécurité de xAI)");
      console.error("IA de secours", cr.label, c.fan.name, err.message);
      return true;
    }
    if (!out) throw err;
    unleak(out);
    if (out.junk) { try { const again = unleak(await grok(msgs.concat([{ role: "system", content: "Ta réponse était beaucoup trop longue ou recopiait les notes du site entre crochets. Réponds en 1 à 3 bulles courtes, sans crochets." }]))); if (again && !again.junk) out = again; } catch (e) {} }
    const leave = str(out.laisser).trim();
    if (leave) {
      mark({ blocked: leave.slice(0, 200) });
      ping(`🤖 ${cr.label} : un fan à reprendre`, `${c.fan.name || "Un fan"} : ${leave.slice(0, 140)}`, "ai-leave-" + c.id);
      log(0, "a", `L'IA de secours laisse **${c.fan.name || "un fan"}** (${cr.label}) à l'équipe`, leave.slice(0, 160));
      return true;
    }
    // ce que le site fait de la réponse : lancer un script, envoyer l'étape suivante, faire le prix plancher (jamais sur une relance)
    let act = null;
    if (plan && !relance && !busy) {
      if (plan.launch.length && +out.lancer) { const sc = plan.launch.find(x => x.id === +out.lancer); if (sc) act = { kind: "step", sc, k: 0 }; }
      if (!act && plan.S && !plan.lock && (plan.force || (plan.step && out.etape))) act = { kind: "step", sc: plan.sc, k: plan.S.step + 1 };
      if (!act && plan.lock && plan.floor && out.plancher) act = { kind: "floor", sc: plan.sc, k: plan.S.step };
    }
    // tickets : en envoyer un (Snap, cam, vidéo custom), ou, une fois payé, envoyer sa demande au Studio
    // le moment est venu et Grok continue de décrire : le site lance lui-même le premier script disponible
    if (push && !act && !out.teaser && plan && plan.launch.length) act = { kind: "step", sc: plan.launch[0], k: 0 };
    // il a dit oui au teasing et Grok le fait encore attendre : une seconde chance, puis le premier script disponible
    const okAlb = o => o && o.album && sell.albums.some(a => a.id === str(o.album)) && cents(o.prix) >= 3;
    if (yes && !act && !str(out.ticket) && !okAlb(out)) { let again = null; try { again = unleak(await grok(msgs.concat([{ role: "system", content: YES_NOW }]))); } catch (e) {}
      if (okAlb(again) && !str(again.laisser).trim()) out = again; else if (plan && plan.launch.length) act = { kind: "step", sc: plan.launch[0], k: 0 }; }
    // c'est le moment de proposer et Grok continue de décrire : une seconde chance pour qu'il teasse
    if (push && !yes && !act && !out.teaser && !str(out.ticket) && !okAlb(out)) { let again = null; try { again = unleak(await grok(msgs.concat([{ role: "system", content: PUSH_NOW }]))); } catch (e) {}
      if (again && !str(again.laisser).trim() && (again.teaser || +again.lancer) && bubbles(again).length) { out = again; if (plan && plan.launch.length && +out.lancer) { const sc = plan.launch.find(x => x.id === +out.lancer); if (sc) act = { kind: "step", sc, k: 0 }; } } }
    let tk = null, tkInfo = "";
    if (M.tk && M.sell && !relance && !busy && !act) {
      if (tkFree(T) && TK[str(out.ticket)]) { tk = tkPlan(M, str(out.ticket), out.prix, out.duree); tk.f = await tkMedia(cr, M, c, L); if (!tk.f) { tk = null; db.prepare("UPDATE twizz_ai_runs SET last_error = ? WHERE id = ?").run(`${c.fan.name || "un fan"} : ticket impossible, aucun média dans le coffre`, r.id); } }
      else if (T && T.state === "paid") { const v = (T.kind === "snap" ? str(out.snap).replace(/^@/, "") : str(out.demande)).trim(); if (v.length >= 2) tkInfo = v; }
    }
    let B = oneQ(bubbles(out)), price = cents(out.prix), f = null, promo = null, guarded = false; if (busy) B = B.slice(0, 1);
    // jamais deux fois la même bulle à ce fan : les redites sont retirées ; si toute la réponse est redite, on redemande une fois à Grok
    const said = saidOf(L); let rep = false;
    if (fresh(B, said).length < B.length) { B = fresh(B, said);
      if (!B.length && !act) { let again = null; try { again = unleak(await grok(msgs.concat([{ role: "system", content: REDIT(bubbles(out)) }]))); } catch (e) {}
        B = again && !str(again.laisser).trim() ? fresh(oneQ(bubbles(again)), said) : []; if (busy) B = B.slice(0, 1); }
      rep = !B.length; }
    // jamais de prix annoncé dans les bulles : une seconde chance, puis la bulle est retirée
    if (B.some(PRICED)) { let again = null; try { again = unleak(await grok(msgs.concat([{ role: "system", content: NOPRICE }]))); } catch (e) {}
      B = fresh((again && !str(again.laisser).trim() ? oneQ(bubbles(again)) : B).filter(t => !PRICED(t)), said); if (busy) B = B.slice(0, 1); if (!B.length) rep = true; }
    if (!act && !tk && out.album && sell.albums.some(a => a.id === str(out.album)) && price >= 3) {
      price = Math.min(price, M.maxPrice);
      const pct = Math.round(+out.remise || 0), hesit = !!sell.open || L.some(m => !m.fromFan && m.type === "FILE" && m.price > 0 && m.status !== "accepted");
      if (M.promo && pct >= 5 && (sell.requirePromo || hesit)) promo = { pct: Math.min(pct, M.maxDiscount), hours: M.promoHours };
      if (!sell.requirePromo || promo) { try { f = await pickMedia(cr.id, str(out.album), c.id, L, str(out.media).replace(/^m:/, "")); } catch (e) { f = null; } }
    }
    // aucun média ne part avec la réponse : pas de « je te l'envoie », « et voilà »… (une seconde chance, puis on retire la bulle)
    if (!act && !f && !tk && B.some(fakeSend)) { guarded = true;
      let again = null; try { again = unleak(await grok(msgs.concat([{ role: "system", content: "Ta réponse disait que tu envoyais ou préparais un média alors qu'aucun ne part avec ce message : c'est interdit. Réécris ta réponse sans ça." }]))); } catch (e) {}
      B = fresh((again && !str(again.laisser).trim() ? bubbles(again) : B).filter(t => !fakeSend(t)), said); }
    B = shape(B, L);
    if (!B.length && !act && !tk) { if (relance || guarded || rep) mark({}); if (!relance && (guarded || rep)) await readOnTwizz(cr.id, c, L); return false; }   // rien d'utile à envoyer
    // plusieurs bulles : envoyées à la suite, le temps de les taper ; un média du coffre ou le prix plancher part avec la dernière, l'étape du script après
    let usedPre = false; const floor = act && act.kind === "floor";
    for (let i = 0; i < B.length; i++) {
      if (i) { if (!runOf(cr.id)) break; await sleep(Math.min(9000, 1800 + B[i].length * 70 + Math.random() * 1500)); }
      const body = (usedPre ? "" : pre) + B[i] + tail, lastB = i === B.length - 1; usedPre = true;
      if (f && lastB) { await sendMedia(cr.id, c, f, price, body, promo, { kind: "coffre", album: sell.albums.find(a => a.id === str(out.album)) || null }); db.prepare("UPDATE twizz_ai_runs SET medias = medias + 1 WHERE id = ?").run(r.id); }
      else if (floor && lastB) await runFloor(r, cr, c, act.sc, act.k, body);
      else await sendText(cr.id, c, body);
    }
    if (floor && !B.length) { await runFloor(r, cr, c, act.sc, act.k, pre + (fillStep(act.sc.steps[act.k].text, cr, who) || "🙈") + tail); usedPre = true; }
    if (act && act.kind === "step" && runOf(cr.id)) { if (B.length) await sleep(2500 + Math.random() * 3000); await runStep(r, cr, c, act.sc, act.k, C, usedPre ? "" : pre, who); }
    if (tk && runOf(cr.id)) { if (B.length) await sleep(2000 + Math.random() * 2500);
      const id = await sendMedia(cr.id, c, tk.f, tk.price, (usedPre ? "" : pre) + tk.text + tail, null, { kind: "ticket", tk_kind: tk.kind }); usedPre = true;
      db.prepare("UPDATE twizz_ai_runs SET medias = medias + 1 WHERE id = ?").run(r.id);
      db.prepare(`INSERT INTO twizz_ai_ticket (creator_id, fan_id, conv_id, kind, minutes, price, msg_id, state, at, paid_at, custom_id) VALUES (?,?,?,?,?,?,?, 'sent', ?, NULL, NULL)
        ON CONFLICT(creator_id, fan_id) DO UPDATE SET conv_id = excluded.conv_id, kind = excluded.kind, minutes = excluded.minutes, price = excluded.price, msg_id = excluded.msg_id, state = 'sent', at = excluded.at, paid_at = NULL, custom_id = NULL`)
        .run(cr.id, c.fan.id, c.id, tk.kind, tk.minutes, tk.price, id, now()); }
    if (tkInfo) toStudio(r, cr, c, T, tkInfo);
    told();
    if (f) teaseClear(cr, c); else if (out.teaser && (sell.teaseNow || sell.albums.length)) teaseSet(cr, c);   // un média envoyé : il faudra re-teaser pour le suivant
    db.prepare("UPDATE twizz_ai_runs SET replies = replies + 1, last_at = ?, last_error = NULL WHERE id = ?").run(now(), r.id);
    mark({ notified: tell || row.notified ? 1 : 0, replies: (row.replies || 0) + 1 });
    if (!relance) await readOnTwizz(cr.id, c, L);   // un fan laissé à l'équipe reste non lu, pour les chatters
    drop(c.id, `/conversations/user/${enc(cr.id)}`);
    // mémoire : toutes les 3 réponses, au plus toutes les 30 min par fan, l'IA complète la fiche du fan
    if (C.memory && ((row.replies || 0) + 1) % 3 === 0 && now() - (row.mem_at || 0) > 30 * 60e3) {
      db.prepare("UPDATE twizz_ai_convs SET mem_at = ? WHERE run_id = ? AND conv_id = ?").run(now(), r.id, c.id);
      remember(cr, c, L.concat(B.map(b => ({ fromFan: false, text: b, medias: [], type: "TEXT" })))).catch(e => console.error("IA de secours, mémoire", e.message));
    }
    return true;
  }

  /* ---------- mémoire : ce que l'IA a appris du fan va dans sa fiche (cases vides seulement) et dans le résumé ---------- */
  const MEM_TOOL = { type: "function", function: { name: "memoriser", description: "Ce qu'on retient du fan pour la suite.", parameters: { type: "object", properties: {
    prenom: { type: "string", description: "Son vrai prénom s'il l'a dit, sinon vide" }, anniv: { type: "string", description: "Date d'anniversaire s'il l'a dite" }, ville: { type: "string" }, metier: { type: "string" },
    gouts: { type: "string", description: "Ce qu'il aime, en quelques mots" }, resume: { type: "string", description: "Une ou deux phrases : qui il est, ce qu'il aime, comment il achète" },
    etat: { type: "string", description: "Une phrase : où en est la conversation" }, action: { type: "string", description: "Une phrase : la prochaine chose à faire avec lui" },
    difficulte: { type: "string", enum: ["facile", "moyenne", "difficile"], description: "À quel point il est facile de lui vendre en ce moment" } } } } };
  async function remember(cr, c, L) {
    const tr = L.slice(-30).map(m => `[${m.fromFan ? "FAN" : cr.label}] ${lineOf(m)}`).filter(x => x.length > 8).join("\n"); if (!tr) return;
    const known = {}; db.prepare("SELECT field, value FROM twizz_fan_profile WHERE creator_id = ? AND fan_id = ?").all(cr.id, c.fan.id).forEach(x => known[x.field] = x.value);
    const x = await grok([{ role: "system", content: `Tu aides l'équipe de ${cr.label} (créatrice sur Twizz) à se souvenir de ses fans. Lis la conversation et remplis seulement ce que le fan a dit clairement. Déjà connu : ${JSON.stringify(known)}` },
      { role: "user", content: tr }], { tool: MEM_TOOL, temp: 0.2, max: 400 });
    const t = now();
    for (const k of ["anniv", "ville", "metier", "gouts"]) { const v = str(x[k]).trim().slice(0, 120); if (v && !known[k])
      db.prepare("INSERT OR IGNORE INTO twizz_fan_profile (creator_id, fan_id, field, value, source, user_id, at) VALUES (?,?,?,?,'ia',NULL,?)").run(cr.id, c.fan.id, k, v, t); }
    if (str(x.resume).trim()) db.prepare(`INSERT INTO twizz_fan_brief (creator_id, fan_id, conv_id, data, user_id, at) VALUES (?,?,?,?,NULL,?)
      ON CONFLICT(creator_id, fan_id) DO UPDATE SET conv_id = excluded.conv_id, data = excluded.data, user_id = NULL, at = excluded.at`)
      .run(cr.id, c.fan.id, c.id, JSON.stringify({ prenom: str(x.prenom).slice(0, 40), brief: str(x.resume).slice(0, 400), etat: str(x.etat).slice(0, 200), action: str(x.action).slice(0, 200),
        difficulte: ["facile", "moyenne", "difficile"].includes(x.difficulte) ? x.difficulte : "moyenne", n: L.length, by: "IA de secours" }), t);
  }

  /* ---------- vision : Grok décrit chaque média du coffre une fois (pour choisir le bon et le vendre) ---------- */
  const XVISION = () => str(process.env.XAI_VISION_MODEL || "grok-4-1-fast-non-reasoning");
  const SCAN = {};   // par créatrice : { running, done, total, errors }
  async function scan(cid, by) {
    const c = crOf(cid), M = mcfg(cid); if (!c) throw fail("Créatrice inconnue"); if (!XAI()) throw fail("Clé Grok manquante");
    if (SCAN[cid] && SCAN[cid].running) throw fail("Analyse déjà en cours");
    let A = await albumsOf(cid, true), all = A.length; if (M.albums.length) A = A.filter(a => M.albums.includes(a.id));
    const todo = [], st = { albums: A.length, files: 0, already: 0, noImg: 0 };   // une vidéo sans vignette n'a rien à regarder : elle est sautée
    for (const a of A) { let F = []; try { F = await filesOf(cid, a.id); } catch (e) { st.readErr = "Lecture d'un album impossible : " + e.message; }
      const D = descrOf(cid, F.map(f => f.id)); st.files += F.length;
      F.forEach(f => { if (D.has(f.id)) st.already++; else if (!(f.thumb || (f.kind === "image" && f.url))) st.noImg++; else todo.push({ f, a }); }); }
    const note = todo.length ? "" : !all ? "aucun album photo ou vidéo trouvé dans le coffre" : !A.length ? "aucun des albums autorisés n'existe encore dans le coffre" : st.readErr ? st.readErr
      : !st.files ? "les albums sont vides ou Twizz n'a renvoyé aucun média" : st.already === st.files ? "tous les médias sont déjà décrits" : "aucun média n'a de vignette à regarder";
    console.log("IA de secours, analyse du coffre", c.label, JSON.stringify({ ...st, todo: todo.length }));
    const S2 = SCAN[cid] = { running: true, done: 0, total: Math.min(todo.length, 300), errors: 0, at: now(), ...st, note };
    (async () => {
      for (const { f, a } of todo.slice(0, 300)) {
        try { const img = await toImage(f.thumb || f.url);
          const x = await grok([{ role: "user", content: [{ type: "text", text: `${/video/i.test(str(f.mime || f.type || f.kind)) ? "C'est une image tirée d'une vidéo. " : ""}Décris ce média en 20 mots maximum, pour aider à le vendre : ce qu'elle fait (pose, ou action si elle se touche, se masturbe, joue avec un jouet…), tenue, niveau de nudité (habillée, lingerie, seins nus, nue), cadrage, lieu, et si le visage est visible. Termes simples et factuels. Réponds seulement la description.` },
            { type: "image_url", image_url: { url: img } }] }], { tool: null, model: XVISION(), temp: 0.3, max: 80 });
          const d = str(x.text).replace(/\s+/g, " ").trim().slice(0, 160);
          db.prepare("INSERT INTO twizz_ai_media (creator_id, file_id, album_id, kind, descr, err, at) VALUES (?,?,?,?,?,NULL,?) ON CONFLICT(creator_id, file_id) DO UPDATE SET descr = excluded.descr, err = NULL, at = excluded.at")
            .run(cid, f.id, a.id, f.kind, d ? (f.kind === "video" ? "vidéo : " : "photo : ") + d : null, now()); }
        catch (e) { S2.errors++; S2.lastError = str(e.message).slice(0, 200); db.prepare("INSERT INTO twizz_ai_media (creator_id, file_id, album_id, kind, err, at) VALUES (?,?,?,?,?,?) ON CONFLICT(creator_id, file_id) DO UPDATE SET err = excluded.err, at = excluded.at").run(cid, f.id, a.id, f.kind, str(e.message).slice(0, 200), now()); }
        S2.done++; await sleep(1200);
      }
      S2.running = false; S2.end = now();
      log(by || 0, "a", `L'IA de secours a analysé le coffre de **${c.label}**`, `${S2.done - S2.errors} média${S2.done - S2.errors > 1 ? "s" : ""} décrit${S2.done - S2.errors > 1 ? "s" : ""}${S2.errors ? ` · ${S2.errors} erreur${S2.errors > 1 ? "s" : ""}` : ""}`);
    })().catch(e => { S2.running = false; S2.error = e.message; });
    return S2;
  }

  /* ---------- la boucle : toutes les 20 s ; chaque créatrice relue au plus toutes les 40 s ---------- */
  const POLLED = new Map(); let busy = false;
  // une conversation qui échoue ne bloque plus les autres : elle attend un peu (2, 4, 8… min), et après 3 échecs de suite elle est laissée à l'équipe
  const FAILS = new Map(), RUNERR = new Map();
  async function safely(r, cr, c, C, relance) {
    const k = r.id + ":" + c.id, f = FAILS.get(k); if (f && now() < f.until) return false;
    try { const ok = await handle(r, cr, c, C, relance); FAILS.delete(k); RUNERR.delete(r.id); return ok; }
    catch (e) {
      // plusieurs erreurs de suite dans la séance (tous fans confondus) : les managers sont prévenus, au plus toutes les 30 min
      { const E = RUNERR.get(r.id) || { n: 0, ping: 0 }; E.n++; RUNERR.set(r.id, E); if (E.n >= 3 && now() - E.ping > 30 * 60e3) { E.ping = now();
        ping(`🤖 ${cr.label} : l'IA enchaîne les erreurs`, `${E.n} erreurs de suite. Dernière : ${str(e.message).slice(0, 120)}`, "ai-err-" + r.id); } }
      const n = (f ? f.n : 0) + 1, msg = `${c.fan.name || "un fan"} : ${str(e.message)}`.slice(0, 240);
      FAILS.set(k, { n, until: now() + Math.min(30, 2 ** n) * 60e3 });
      db.prepare("UPDATE twizz_ai_runs SET last_error = ?, last_at = ? WHERE id = ?").run(msg, now(), r.id); console.error("IA de secours", cr.label, msg);
      if (n >= 3) { FAILS.delete(k);
        db.prepare("INSERT INTO twizz_ai_convs (run_id, conv_id, fan_id, fan_name, blocked, at) VALUES (?,?,?,?,?,?) ON CONFLICT(run_id, conv_id) DO UPDATE SET blocked = excluded.blocked, at = excluded.at")
          .run(r.id, c.id, c.fan.id, c.fan.name, `L'IA n'arrive pas à lui répondre (${str(e.message).slice(0, 120)}) : à reprendre par un chatter`, now());
        ping(`🤖 ${cr.label} : un fan à reprendre`, `${c.fan.name || "Un fan"} : l'IA n'arrive pas à lui répondre`, "ai-leave-" + c.id); }
      return false;
    }
  }
  const parisHour = () => +new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(new Date());
  const quiet = C => { const h = parisHour(); return C.quietFrom === C.quietTo ? false : C.quietFrom < C.quietTo ? h >= C.quietFrom && h < C.quietTo : h >= C.quietFrom || h < C.quietTo; };
  const ago = ms => { const m = Math.round(ms / 60e3); return m < 60 ? `${m} min` : `${Math.round(m / 60)} h`; };
  async function loop() {
    const runs = active(); if (!runs.length) return;
    if (!aiOn()) { runs.forEach(r => end(r, null, "IA coupée par le fondateur")); return; }
    const C = gcfg();
    for (const r of runs) {
      if (now() - r.started_at > C.maxHours * 3600e3) { end(r, null, `${C.maxHours} h écoulées`); continue; }
      const back = backOf(r); if (back) { end(r, back.id, `${back.username} a pointé`); continue; }
      if (!mcfg(r.creator_id).ok) { end(r, null, "Accord de la créatrice retiré"); continue; }
      if (!sendOn() || !XAI()) continue;   // en pause : rien ne peut partir
      if (now() - (POLLED.get(r.id) || 0) < 40e3) continue; POLLED.set(r.id, now());
      const cr = crOf(r.creator_id); if (!cr) { end(r, null, "Créatrice introuvable"); continue; }
      try {
        const M = mcfg(cr.id), skip = new Set(M.skipTags);
        const j = await G(`/conversations/user/${enc(cr.id)}?page=1&type=GENERAL&creatorId=${enc(cr.id)}`, 20e3);
        const human = db.prepare("SELECT 1 FROM twizz_sent WHERE conv_id = ? AND COALESCE(via, '') <> 'ia' AND user_id IS NOT NULL AND at > ?");
        const tagged = db.prepare("SELECT tag_id FROM twizz_fan_tags WHERE creator_id = ? AND fan_id = ?");
        const spend = db.prepare("SELECT spend FROM twizz_fan_facts WHERE creator_id = ? AND fan_id = ?");
        const fanOff = db.prepare("SELECT 1 FROM twizz_ai_fanoff WHERE creator_id = ? AND fan_id = ?"), RP = strat().points;
        const L = [], RL = [];
        // 1re page du fil + toutes les conversations non lues (filtre « Non lus » de Twizz) : aucun fan qui attend n'est oublié
        let unread = []; try { unread = unreadConvs ? await unreadConvs(cr.id) : []; } catch (e) {}
        const ids = new Set(), all = arr(j).map(x => conv(x, cr.id)).concat(unread).filter(c => c.id && !ids.has(c.id) && ids.add(c.id));
        for (const c of all) {
          const t = Date.parse(c.last.at) || 0, age = now() - t, row = db.prepare("SELECT blocked, replies, last_fan_msg, relances, relance_at, busy, fan_at FROM twizz_ai_convs WHERE run_id = ? AND conv_id = ?").get(r.id, c.id) || {};
          // un fan qui attend une réponse : dans la fenêtre réglée ; une relance : jusqu'à 24 h après son dernier message
          if (!c.fan.id || row.blocked || (age > C.fanWindow * 3600e3 && (c.last.fromFan || age > 24 * 3600e3)) || hereOf(c.id, -1).length || (C.teamPause && human.get(c.id, now() - C.teamPause * 60e3))) continue;
          if (fanOff.get(cr.id, c.fan.id)) continue;   // IA coupée pour ce fan
          if (skip.size) { const tg = tagged.all(cr.id, c.fan.id).find(x => skip.has(x.tag_id));
            if (tg) { const nm = (db.prepare("SELECT name FROM twizz_tags WHERE id = ?").get(tg.tag_id) || {}).name || "tag";
              db.prepare("INSERT INTO twizz_ai_convs (run_id, conv_id, fan_id, fan_name, blocked, at) VALUES (?,?,?,?,?,?) ON CONFLICT(run_id, conv_id) DO UPDATE SET blocked = excluded.blocked, at = excluded.at")
                .run(r.id, c.id, c.fan.id, c.fan.name, `Fan tagué ${nm} : laissé à l'équipe`, now()); continue; } }
          const value = (spend.get(cr.id, c.fan.id) || {}).spend || 0;
          if (c.last.fromFan) {
            const wait = (C.waitMin + (parseInt(c.id.slice(-4), 16) || 0) % (Math.max(1, C.waitMax - C.waitMin) + 1)) * 1000;   // laisse le fan finir d'écrire, comme quelqu'un qui répond
            if (age >= wait && (row.replies || 0) < C.perFan && row.last_fan_msg !== c.last.id) L.push({ c, value, t });
          } else if (C.relance && row.replies && !row.busy && !quiet(C)) { const k = row.relances || 0, since = now() - (row.fan_at || t);
            if (k < RP.length && since >= (k ? RP[k] : relFirstOf(cr.id, c.fan.id, C, RP[0])) * 60e3 && since < 24 * 3600e3 && now() - (row.relance_at || 0) >= 5 * 60e3) RL.push({ c, value, t, age: since }); }
        }
        // les gros payeurs d'abord, puis ceux qui attendent depuis le plus longtemps
        L.sort((a, b) => (b.value - a.value) || (a.t - b.t));
        const ready = x => !((FAILS.get(r.id + ":" + x.c.id) || {}).until > now());   // celles qui viennent d'échouer attendent leur tour
        const LQ = L.filter(ready), RQ = RL.filter(ready);
        for (const x of LQ.slice(0, 3)) { if (!runOf(cr.id)) break; await safely(r, cr, x.c, C); await sleep(2500 + Math.random() * 2500); }
        if (LQ.length < 3 && RQ.length && runOf(cr.id)) { RQ.sort((a, b) => (b.value - a.value) || (a.t - b.t)); const x = RQ[0]; await safely(r, cr, x.c, C, { since: ago(x.age) }); }
      } catch (e) { db.prepare("UPDATE twizz_ai_runs SET last_error = ?, last_at = ? WHERE id = ?").run(str(e.message).slice(0, 240), now(), r.id); console.error("IA de secours", cr.label, e.message); }
    }
  }
  setInterval(() => { if (busy) return; busy = true; loop().catch(e => console.error("IA de secours", e.message)).finally(() => { busy = false; }); }, 20e3);

  /* ---------- API (managers ; interrupteur général et message IA : fondateur) ---------- */
  const mgr = (req, res, next) => req.user.role === "admin" && req.user.rk !== "assistant" && !req.viewAs ? next() : res.status(403).json({ error: "Réservé aux managers" });
  const founder = (req, res, next) => req.user.rk === "founder" && !req.viewAs ? next() : res.status(403).json({ error: "Réservé au fondateur" });
  const wrap = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.code || 400).json({ error: e.message || "Erreur" }); } };
  const okC = cid => { const c = crOf(str(cid)); if (!c) throw fail("Créatrice inconnue"); return c; };
  const sales = r => db.prepare("SELECT COUNT(*) n, COALESCE(SUM(net), 0) net FROM twizz_tx WHERE ai = 1 AND creator_id = ? AND at BETWEEN ? AND ?").get(r.creator_id, r.started_at, (r.ended_at || now()) + 3600e3);
  const view = r => r && { id: r.id, started_at: r.started_at, by: uname(r.started_by), reason: r.reason, ended_at: r.ended_at, ended_by: uname(r.ended_by), end_reason: r.end_reason,
    replies: r.replies, medias: r.medias, error: r.last_error, last_at: r.last_at, sales: sales(r),
    left: db.prepare("SELECT conv_id, fan_id, fan_name, blocked FROM twizz_ai_convs WHERE run_id = ? AND blocked IS NOT NULL ORDER BY at DESC LIMIT 10").all(r.id) };
  const ficheFilled = c => { const m = c.model_id ? db.prepare("SELECT profile FROM models WHERE id = ?").get(c.model_id) : null, p = J(m && m.profile, {}) || {};
    return ["voice", "story"].filter(k => str(p[k]).trim()).length + ["traits", "does", "doesnt", "catalogue", "samples"].filter(k => Array.isArray(p[k]) && p[k].length).length; };
  const state = req => ({ on: aiOn(), key: !!XAI(), send: sendOn(), founder: req.user.rk === "founder", cfg: gcfg(), models: Object.entries(MODELS).map(([k, v]) => ({ id: k, label: v[1] })),
    creators: mapped().map(c => ({ id: c.id, label: c.label, model_id: c.model_id, model: c.model, cfg: mcfg(c.id), fiche: ficheFilled(c), run: view(runOf(c.id)),
      media: db.prepare("SELECT COUNT(*) n FROM twizz_ai_media WHERE creator_id = ? AND descr IS NOT NULL").get(c.id).n, scan: SCAN[c.id] || null,
      scripts: aiScripts(c.id).map(x => ({ id: x.id, title: x.title, steps: x.steps.length, first: x.first, desc: !!x.desc, when: clip(x.desc, 160), timeout: x.timeout, ladder: ladder(x), path: x.steps.map(stepPath) })) })),
    strat: strat(), stratDef: STRAT_DEF,
    recent: db.prepare("SELECT * FROM twizz_ai_runs WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 12").all().map(r => ({ ...view(r), cid: r.creator_id, label: (crOf(r.creator_id) || {}).label || "?" })) });
  app.get("/api/twizz/ai", auth, mgr, wrap(async req => state(req)));
  app.post("/api/twizz/ai/switch", auth, founder, wrap(async req => { const b = req.body || {};
    if (typeof b.on === "boolean") { S.set("twizz_ai_on", b.on); log(req.user.id, "a", `**${req.user.username}** a ${b.on ? "activé" : "coupé"} l'IA de secours`, "");
      if (!b.on) active().forEach(r => end(r, req.user.id, "IA coupée par le fondateur")); }
    return state(req); }));
  app.post("/api/twizz/ai/cfg", auth, mgr, wrap(async req => { const before = gcfg().notice, beforeMark = gcfg().mark, o = setG(req.body || {}, req.user.rk === "founder");
    if (o.notice !== before) log(req.user.id, "a", `**${req.user.username}** a ${o.notice ? "rallumé" : "coupé"} le message « c'est l'IA » de l'IA de secours`, "");
    if (o.mark !== beforeMark) log(req.user.id, "a", `**${req.user.username}** a ${o.mark ? "remis" : "retiré"} le 🤖 à la fin des messages de l'IA de secours`, "");
    return state(req); }));
  // couper ou rallumer l'IA de secours pour un fan (depuis la messagerie)
  app.post("/api/twizz/ai/fan/:cid/:fan", auth, wrap(async req => {
    if (!(req.user.role === "admin" || ["chatter", "tl"].includes(req.user.rk)) || req.viewAs) throw fail("Réservé à l'équipe de la messagerie", 403);
    const c = okC(req.params.cid), fan = str(req.params.fan).slice(0, 80); if (!fan) throw fail("Fan inconnu");
    if (req.body && req.body.off) db.prepare("INSERT INTO twizz_ai_fanoff (creator_id, fan_id, user_id, at) VALUES (?,?,?,?) ON CONFLICT(creator_id, fan_id) DO UPDATE SET user_id = excluded.user_id, at = excluded.at").run(c.id, fan, req.user.id, now());
    else db.prepare("DELETE FROM twizz_ai_fanoff WHERE creator_id = ? AND fan_id = ?").run(c.id, fan);
    return { off: !!(req.body && req.body.off) }; }));
  app.post("/api/twizz/ai/strat", auth, mgr, wrap(async req => { setStrat(req.body || {}); log(req.user.id, "a", `**${req.user.username}** a modifié les règles de vente par scripts de l'IA de secours`, ""); return state(req); }));
  app.post("/api/twizz/ai/cfg/:cid", auth, mgr, wrap(async req => { const c = okC(req.params.cid), was = mcfg(c.id).ok, o = setM(c.id, req.body || {});
    if (o.ok !== was) log(req.user.id, "a", `**${req.user.username}** a ${o.ok ? "coché" : "retiré"} l'accord de **${c.label}** pour l'IA de secours`, "");
    return state(req); }));
  // ce que l'IA sait de la créatrice (consignes envoyées à Grok) et les albums / tags pour les réglages
  app.get("/api/twizz/ai/info/:cid", auth, mgr, wrap(async req => { const c = okC(req.params.cid), M = mcfg(c.id);
    let albums = []; try { albums = await albumsOf(c.id); } catch (e) {}
    const tags = db.prepare("SELECT id, name, color FROM twizz_tags WHERE COALESCE(active, 1) = 1 ORDER BY name").all();
    const A = M.albums.length ? albums.filter(a => M.albums.includes(a.id)) : albums;
    const C = gcfg(), P = parts(c, M, ficheOf(c), M.sell ? A : [], M.sell ? "" : "la vente de médias est coupée pour cette créatrice", "(prénom du fan, note de l'équipe)", C);
    return { albums, tags, base: C.base || BASE_DEF, baseDefault: BASE_DEF, custom: !!C.base, profile: M.profile || P.gen, profileCustom: !!M.profile, live: P.live, locked: P.locked, lockedDefault: LOCKED_DEF, customLocked: !!C.locked }; }));
  // essayer l'IA sans rien envoyer : une fausse conversation, la réponse de Grok s'affiche seulement
  const TRIED = new Map();
  app.post("/api/twizz/ai/try/:cid", auth, mgr, wrap(async req => { const c = okC(req.params.cid), M = mcfg(c.id);
    if (!XAI()) throw fail("Clé Grok manquante : ajoute la variable XAI_API_KEY dans Railway");
    if (now() - (TRIED.get(req.user.id) || 0) < 3000) throw fail("Doucement : attends quelques secondes"); TRIED.set(req.user.id, now());
    const b = req.body || {}, raw = (Array.isArray(b.messages) ? b.messages : []).slice(-30);
    if (!raw.length || !(raw[raw.length - 1] && raw[raw.length - 1].fan) || !str(raw[raw.length - 1].text).trim()) throw fail("Écris un message de fan pour essayer");
    // la fausse conversation : un message par minute ; les médias de script gardent leur prix et « acheté » si on a cliqué « Il achète »
    const LL = raw.map((m, i) => { const fm = m && m.price != null && isFinite(+m.price); return { id: str(m && m.id) || "t" + i, fromFan: !!(m && m.fan), text: str(m && m.text).slice(0, 1000),
      medias: fm ? [{ keys: [] }] : [], type: fm ? "FILE" : "TEXT", price: fm ? +m.price : null, status: m && m.paid ? "accepted" : "", at: new Date(now() - (raw.length - i) * 60e3).toISOString(), teaser: !!(m && m.teaser) }; });
    const ti = LL.map(m => !m.fromFan && m.teaser).lastIndexOf(true), tz = ti < 0 ? null : (() => { const R = LL.slice(ti + 1), i = R.findIndex(m => m.fromFan); return { at: Date.parse(LL[ti].at), answered: i >= 0, live: i >= 0 && !R.slice(i).some(m => !m.fromFan) }; })();
    const T0 = b.state && b.state.script_id ? b.state : null, atId = id => { const i = LL.findIndex(m => m.id === id); return i >= 0 ? Date.parse(LL[i].at) : now(); };
    const S0 = T0 ? { script_id: +T0.script_id, step: +T0.step || 0, sent_at: atId(T0.sentId), lock_msg: T0.lockId || null, lock_price: T0.lock_price || null, floor_used: T0.floor_used ? 1 : 0, relanced: 0,
      state: T0.state || "open", ended_at: T0.state && T0.state !== "open" ? atId(T0.endedId) : null, full: T0.full ? 1 : 0 } : null;
    const burned = new Set((Array.isArray(b.burned) ? b.burned : []).map(Number).filter(Number.isFinite)), lastFan = LL[LL.length - 1];
    const busy = BUSY.test(lastFan.text), plan = planOf(c, M, LL, "essai", { S: S0, burned });
    const hot = !busy && hotOf(LL), coffre = !busy && (!plan || plan.coffre || (plan.coffreAsk && (asks(lastFan.text) || hot || teaseOk(tz, M))));
    let sell = { albums: [], note: "" }; if (coffre) try { sell = await sellable(c, M, LL, null, tz); } catch (e) {} const albums = sell.albums;
    const KN = { new: {}, reg: { prenom: "Thomas", ville: "Lyon" }, big: { prenom: "Thomas", metier: "chef d'entreprise" } };
    // le ticket de l'essai : l'écran le garde et le renvoie ; payé quand on a cliqué « Il achète » sur son média
    let TK0 = b.ticket && TK[b.ticket.kind] ? { kind: b.ticket.kind, minutes: +b.ticket.minutes || null, price: +b.ticket.price || 0, msg_id: str(b.ticket.id), state: ["sent", "paid", "done"].includes(b.ticket.state) ? b.ticket.state : "sent" } : null;
    if (TK0 && TK0.state === "sent" && LL.some(m => m.id === TK0.msg_id && m.status === "accepted")) TK0.state = "paid";
    const canSell = sell.albums.length > 0 || !!sell.teaseNow || !!(plan && plan.launch.length), push = canSell && !teaseOk(tz, M) && !(plan && plan.S && plan.S.state === "open") && (hot && pushOf(LL) || !busy && loopOf(LL));
    const yes = !busy && albums.length > 0 && saidYes(tz, lastFan);
    const opt = { requirePromo: sell.requirePromo, script: busy ? "" : scriptNote(plan, coffre, sell, hot), rules: rulesOf(M, LL, { known: KN[b.fan] || {}, plan, busy, ticket: TK0, hot: hot && canSell, push, yes }) };
    const FANS = { new: "pseudo : Thomas ; n'a encore jamais rien acheté", reg: "pseudo : Thomas ; prénom : Thomas ; ville : Lyon ; a déjà dépensé 150 € avec elle en 8 achats ; tags de l'équipe : Vidéos",
      big: "pseudo : Thomas ; prénom : Thomas ; métier : chef d'entreprise ; a déjà dépensé 850 € avec elle en 30 achats ; tags de l'équipe : Spender ; résumé de l'équipe : achète vite quand on le chauffe, aime qu'on se souvienne de lui" };
    const L = LL.map(m => ({ role: m.fromFan ? "user" : "assistant", content: m.fromFan ? lineOf(m) : untag(lineOf(m)) })).filter(m => m.content);
    const TM = [{ role: "system", content: system(c, M, ficheOf(c), albums, sell.note, FANS[b.fan] || "", gcfg(), opt) }, ...L]; let out;
    try { out = unleak(await grok(TM)); } catch (e) { if (e.status !== 403) throw e; out = unleak(await grok(soften(TM))); }   // refus du filtre : une seconde chance, adoucie
    if (str(out.laisser).trim()) return { bulles: [], laisser: str(out.laisser).trim(), state: T0, burned: [...burned] };
    // même décision qu'en vrai : lancer, étape suivante, prix plancher
    let act = null;
    if (plan && !busy) { if (plan.launch.length && +out.lancer) { const sc = plan.launch.find(x => x.id === +out.lancer); if (sc) act = { kind: "step", sc, k: 0 }; }
      if (!act && plan.S && !plan.lock && (plan.force || (plan.step && out.etape))) act = { kind: "step", sc: plan.sc, k: plan.S.step + 1 };
      if (!act && plan.lock && plan.floor && out.plancher) act = { kind: "floor", sc: plan.sc, k: plan.S.step }; }
    if (push && !act && !out.teaser && plan && plan.launch.length) act = { kind: "step", sc: plan.launch[0], k: 0 };
    const okAlb = o => o && o.album && albums.some(a => a.id === str(o.album)) && cents(o.prix) >= 3;
    if (yes && !act && !str(out.ticket) && !okAlb(out)) { let again = null; try { again = unleak(await grok(TM.concat([{ role: "system", content: YES_NOW }]))); } catch (e) {}
      if (okAlb(again) && !str(again.laisser).trim()) out = again; else if (plan && plan.launch.length) act = { kind: "step", sc: plan.launch[0], k: 0 }; }
    if (push && !yes && !act && !out.teaser && !str(out.ticket) && !okAlb(out)) { let again = null; try { again = unleak(await grok(TM.concat([{ role: "system", content: PUSH_NOW }]))); } catch (e) {}
      if (again && !str(again.laisser).trim() && (again.teaser || +again.lancer) && bubbles(again).length) { out = again; if (plan && plan.launch.length && +out.lancer) { const sc = plan.launch.find(x => x.id === +out.lancer); if (sc) act = { kind: "step", sc, k: 0 }; } } }
    let tk = null, studio = null;
    if (M.tk && M.sell && !busy && !act) {
      if (tkFree(TK0) && TK[str(out.ticket)]) { tk = tkPlan(M, str(out.ticket), out.prix, out.duree); tk.id = "k" + now(); TK0 = { ...tk, msg_id: tk.id, state: "sent" }; }
      else if (TK0 && TK0.state === "paid") { const v = (TK0.kind === "snap" ? str(out.snap).replace(/^@/, "") : str(out.demande)).trim();
        if (v.length >= 2) { studio = `${tkLabel(TK0)} · ${TK0.kind === "snap" ? "Snap du fan : " : ""}${v} · ticket payé ${eurs(TK0.price)}`; TK0 = { ...TK0, state: "done" }; } }
    }
    const al = !act && !tk && out.album ? albums.find(a => a.id === str(out.album)) : null, it = al && (al.items || []).find(x => x.id === str(out.media).replace(/^m:/, ""));
    let B = oneQ(bubbles(out)), guarded = false; if (busy) B = B.slice(0, 1); if (!act && !al && !tk && B.some(fakeSend)) { B = B.filter(t => !fakeSend(t)); guarded = true; }
    if (B.some(PRICED)) { try { const again = unleak(await grok([{ role: "system", content: system(c, M, ficheOf(c), albums, sell.note, FANS[b.fan] || "", gcfg(), opt) }, ...L, { role: "system", content: NOPRICE }]));
      if (!str(again.laisser).trim()) B = oneQ(bubbles(again)); } catch (e) {} B = B.filter(t => !PRICED(t)); }
    const said = saidOf(LL), redit = fresh(B, said).length < B.length;
    if (redit) { B = fresh(B, said); if (!B.length && !act) { try { const again = unleak(await grok([{ role: "system", content: system(c, M, ficheOf(c), albums, sell.note, FANS[b.fan] || "", gcfg(), opt) }, ...L, { role: "system", content: REDIT(bubbles(out)) }]));
      if (!str(again.laisser).trim()) B = fresh(oneQ(bubbles(again)), said).filter(t => act || al || !fakeSend(t)); } catch (e) {} } }
    B = shape(B, LL);
    const pct = Math.round(+out.remise || 0);
    // l'état du script après cette réponse : l'écran le garde et le renvoie au prochain message
    let state = T0, step = null, floor = null, ended = null;
    if (plan && plan.endNow) { state = { ...(T0 || {}), state: plan.endNow.full ? "done" : "quit", full: !!plan.endNow.full, endedId: lastFan.id }; ended = plan.endNow.why; }
    if (act && act.kind === "step") { const st = act.sc.steps[act.k], files = st.media || [], price = files.length && st.price > 0 ? st.price : 0, id = "s" + now(), D = descrOf(c.id, files.map(f => f.id));
      step = { id, script: act.sc.title, k: act.k, n: act.sc.steps.length, text: fillStep(st.text, c, "Thomas"), tease: files.length && st.tease ? fillStep(st.tease, c, "Thomas") : "", medias: files.length, price: files.length ? price : null,
        floor: st.floor || null, what: files.map(f => D.get(f.id)).filter(Boolean).slice(0, 3).join(" ; ") };
      state = { script_id: act.sc.id, step: act.k, sentId: id, lockId: price ? id : null, lock_price: price || null, floor_used: 0, state: "open", full: false };
      if (act.k === 0) burned.add(act.sc.id); }
    if (act && act.kind === "floor") { const id = "f" + now(); floor = { id, price: act.sc.steps[act.k].floor }; state = { ...T0, lockId: id, lock_price: floor.price, floor_used: 1 }; }
    const mode = busy ? "Fan occupé : une bulle courte, pas de vente, pas de relance ensuite" : !plan ? "" : plan.after ? "Script terminé : elle raccompagne le fan, sans vendre" : plan.S ? `Script « ${plan.sc.title} » · étape ${plan.S.step + 1}/${plan.sc.steps.length}${plan.lock ? ` · média à ${eurs(plan.lock.price)} pas encore pris` : plan.force ? " · étape suivante due" : plan.step ? " · étape suivante possible" : ""}`
      : plan.launch.length ? `${plan.launch.length} script${plan.launch.length > 1 ? "s" : ""} disponible${plan.launch.length > 1 ? "s" : ""}, elle lance quand le fan est prêt` : plan.coffre ? "Tous les scripts déjà reçus : coffre en secours" : clip(plan.text.split("(")[0], 90);
    return { bulles: B, step, floor, state, burned: [...burned], ended, mode, guarded, redit, ticket: tk ? { id: tk.id, kind: tk.kind, minutes: tk.minutes, price: tk.price, text: tk.text } : null,
      tkState: TK0 ? { id: TK0.msg_id, kind: TK0.kind, minutes: TK0.minutes, price: TK0.price, state: TK0.state } : null, studio, album: al ? al.name : null, media: it ? it.descr : null, prix: al ? Math.min(cents(out.prix), M.maxPrice) : null,
      remise: al && M.promo && pct >= 5 ? Math.min(pct, M.maxDiscount) : null, laisser: null, teaser: !al && !act && !!out.teaser && !!(sell.teaseNow || albums.length), gate: plan ? "" : albums.length ? "" : sell.note };
  }));
  // ce qui vend : médias payants envoyés par l'IA et achetés, par étape de script, ticket et coffre (achats vus dans les conversations)
  app.get("/api/twizz/ai/stats/:cid", auth, mgr, wrap(async req => { const c = okC(req.params.cid), days = [7, 30, 90].includes(+req.query.days) ? +req.query.days : 30;
    const R = db.prepare("SELECT kind, script_id, step, tk_kind, COUNT(*) sent, SUM(paid_at IS NOT NULL) paid, COALESCE(SUM(CASE WHEN paid_at IS NOT NULL THEN price END), 0) net FROM twizz_ai_sold WHERE creator_id = ? AND at > ? GROUP BY kind, script_id, step, tk_kind").all(c.id, now() - days * 864e5);
    const titles = new Map(db.prepare("SELECT id, title FROM twizz_scripts WHERE creator_id = ? OR creator_id IS NULL").all(c.id).map(x => [x.id, str(x.title).trim() || "Script"]));
    const sc = new Map(); R.filter(x => x.kind === "step" || x.kind === "floor").forEach(x => { const S = sc.get(x.script_id) || { id: x.script_id, title: titles.get(x.script_id) || "Script supprimé", steps: {} }; sc.set(x.script_id, S);
      const k = S.steps[x.step] || (S.steps[x.step] = { step: x.step, sent: 0, paid: 0, net: 0, floorSent: 0, floorPaid: 0 }); if (x.kind === "floor") { k.floorSent += x.sent; k.floorPaid += x.paid; } else { k.sent += x.sent; k.paid += x.paid; } k.net += x.net; });
    const sum = L => L.reduce((o, x) => ({ sent: o.sent + x.sent, paid: o.paid + x.paid, net: o.net + x.net }), { sent: 0, paid: 0, net: 0 });
    return { days, scripts: [...sc.values()].map(S => ({ ...S, steps: Object.values(S.steps).sort((a, b) => a.step - b.step) })),
      tickets: Object.keys(TK).map(k => ({ kind: k, label: TK[k], ...sum(R.filter(x => x.kind === "ticket" && x.tk_kind === k)) })), coffre: sum(R.filter(x => x.kind === "coffre")) }; }));
  app.post("/api/twizz/ai/scan/:cid", auth, mgr, wrap(async req => { await scan(okC(req.params.cid).id, req.user.id); return state(req); }));
  // IA contre chatters sur une créatrice : heures couvertes, médias payants envoyés, ventes en conversation, € par heure (estimations)
  app.get("/api/twizz/ai/compare/:cid", auth, mgr, wrap(async req => { const c = okC(req.params.cid), days = [7, 30, 90].includes(+req.query.days) ? +req.query.days : 30, t = now(), since = t - days * 864e5;
    const span = L => L.reduce((n, x) => n + Math.max(0, Math.min(x.b || t, t) - Math.max(x.a, since)), 0) / 3600e3;
    const aiH = span(db.prepare("SELECT started_at a, ended_at b FROM twizz_ai_runs WHERE creator_id = ? AND COALESCE(ended_at, ?) > ?").all(c.id, t, since));
    const huH = c.model_id ? span(db.prepare("SELECT c.start_at a, c.end_at b FROM clocks c JOIN users u ON u.id = c.user_id WHERE c.model_id = ? AND u.role <> 'admin' AND COALESCE(c.end_at, ?) > ?").all(c.model_id, t, since)) : 0;
    const sent = ai => db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN price > 0 THEN 1 ELSE 0 END), 0) paid FROM twizz_sent WHERE creator_id = ? AND at > ? AND ${ai ? "via = 'ia'" : "COALESCE(via, '') <> 'ia' AND user_id IS NOT NULL"}`).get(c.id, since);
    const tx = ai => db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(net), 0) net FROM twizz_tx WHERE creator_id = ? AND at > ? AND refund = 0 AND net > 0 AND ${ai ? "ai = 1" : "COALESCE(ai, 0) = 0 AND type = 'privatemedia'"}`).get(c.id, since);
    const side = (h, s, x) => ({ hours: Math.round(h * 10) / 10, msgs: s.n, paid: s.paid, sales: x.n, net: Math.round(x.net * 100) / 100,
      perHour: h >= 0.5 ? Math.round(x.net / h * 100) / 100 : null, rate: s.paid ? Math.round(Math.min(x.n, s.paid) / s.paid * 1000) / 10 : null, basket: x.n ? Math.round(x.net / x.n * 100) / 100 : null });
    return { days, ai: side(aiH, sent(true), tx(true)), team: side(huH, sent(false), tx(false)) }; }));
  app.post("/api/twizz/ai/start", auth, mgr, wrap(async req => { const b = req.body || {};
    let cid = str(b.cid); if (!cid && b.model_id) { const c = mapped().find(x => x.model_id === +b.model_id); if (!c) throw fail("Cette créatrice n'est pas reliée à Twizz"); cid = c.id; }
    start(cid, req.user.id, b.reason); return state(req); }));
  app.post("/api/twizz/ai/stop", auth, mgr, wrap(async req => { const r = runOf(str(req.body && req.body.cid)); if (!r) throw fail("L'IA ne tourne pas sur cette créatrice");
    end(r, req.user.id, `Arrêtée par ${req.user.username}`); return state(req); }));

  return { start, end, active };
};
