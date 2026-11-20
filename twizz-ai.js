// IA de secours : quand un chatter manque, un manager la lance sur une créatrice et elle répond aux fans à sa place.
// Elle écrit avec Grok (xAI, variable XAI_API_KEY), jamais avec la clé Anthropic du site.
// Le fan le sait : son premier message dans une conversation dit que c'est l'IA de la créatrice, puis chaque message finit par 🤖.
// Elle s'arrête toute seule dès qu'un chatter pointe sur cette créatrice ou ouvre sa messagerie. Interrupteur général : le fondateur.
module.exports = function mount(app, db, auth, admin, { twizz, inbox, notify, gest }) {
  const { call, S } = twizz;
  const { conv, msg, arr, file, hereOf, G, drop, mapped, sendOn } = inbox;
  const str = v => (v == null ? "" : String(v)), now = () => Date.now(), enc = encodeURIComponent;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = (...a) => { try { gest.log(...a); } catch (e) {} };
  const fail = (m, code) => { const e = new Error(m); e.code = code || 400; return e; };

  db.exec(`CREATE TABLE IF NOT EXISTS twizz_ai_runs (id INTEGER PRIMARY KEY, creator_id TEXT NOT NULL, model_id INTEGER, started_by INTEGER, started_at INTEGER NOT NULL, reason TEXT,
      ended_at INTEGER, ended_by INTEGER, end_reason TEXT, replies INTEGER NOT NULL DEFAULT 0, medias INTEGER NOT NULL DEFAULT 0, last_error TEXT, last_at INTEGER);
    CREATE TABLE IF NOT EXISTS twizz_ai_convs (run_id INTEGER NOT NULL, conv_id TEXT NOT NULL, fan_id TEXT, fan_name TEXT, notified INTEGER NOT NULL DEFAULT 0, replies INTEGER NOT NULL DEFAULT 0,
      last_fan_msg TEXT, blocked TEXT, at INTEGER, PRIMARY KEY (run_id, conv_id));`);

  const MAX_H = 12, PER_CONV = 40, MAX_PRICE = 200;
  const aiOn = () => !!S.get("twizz_ai_on", false);
  const maxPrice = () => { const v = parseInt(S.get("twizz_ai_max_price", 100), 10); return v >= 3 && v <= MAX_PRICE ? v : 100; };
  const XAI = () => str(process.env.XAI_API_KEY).trim();
  const XBASE = () => str(process.env.XAI_BASE || "https://api.x.ai/v1").replace(/\/+$/, "");
  const XMODEL = () => str(process.env.XAI_MODEL || "grok-4-1-fast-non-reasoning");
  const managers = () => db.prepare("SELECT id FROM users WHERE active = 1 AND deleted_at IS NULL AND role = 'admin' AND COALESCE(grade, '') <> 'assistant'").all().map(r => r.id);
  const ping = (title, body, tag) => { try { notify.pushMany(managers(), null, { title, body, url: "/messagerie", tag }); } catch (e) {} };
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
    log(by || 0, "a", `IA de secours arrêtée sur **${c.label}**`, `${why} · ${r.replies} réponse${r.replies > 1 ? "s" : ""}`);
    ping(`IA de secours arrêtée sur ${c.label}`, str(why), "ai-" + r.creator_id);
    return true;
  }
  // un chatter ouvre la messagerie de cette créatrice : il reprend la main (appelé par la messagerie)
  app.locals.aiHuman = (cid, user) => {
    if (!user || !["chatter", "tl"].includes(user.rk)) return false;
    const r = runOf(cid); return r ? end(r, user.id, `${user.username} a ouvert la messagerie`) : false;
  };
  // un chatter a pointé sur la créatrice depuis le lancement
  const backOf = r => r.model_id ? db.prepare(`SELECT u.id, u.username FROM clocks c JOIN users u ON u.id = c.user_id
    WHERE c.model_id = ? AND c.end_at IS NULL AND c.start_at > ? AND u.role <> 'admin' ORDER BY c.start_at LIMIT 1`).get(r.model_id, r.started_at) : null;

  /* ---------- Grok ---------- */
  const TOOL = { type: "function", function: { name: "repondre", description: "Ta réponse au fan, envoyée telle quelle.", parameters: { type: "object", properties: {
    message: { type: "string", description: "Le texte envoyé au fan, comme un texto. N'ajoute pas 🤖 : le site l'ajoute." },
    album: { type: "string", description: "Facultatif : identifiant d'un album du coffre (liste fournie) pour joindre un média payant à ton message." },
    prix: { type: "integer", description: "Prix du média en euros, nombre rond (obligatoire si album est rempli)." },
    laisser: { type: "string", description: "Facultatif : remplis-le seulement si l'équipe doit reprendre ce fan elle-même (raison courte). Rien n'est alors envoyé au fan." }
  }, required: ["message"] } } };
  async function grok(messages) {
    let r; try { r = await fetch(XBASE() + "/chat/completions", { method: "POST", headers: { Authorization: "Bearer " + XAI(), "Content-Type": "application/json" },
      body: JSON.stringify({ model: XMODEL(), messages, tools: [TOOL], tool_choice: { type: "function", function: { name: "repondre" } }, temperature: 0.8, max_tokens: 500 }), signal: AbortSignal.timeout(45000) }); }
    catch (e) { throw fail("Grok ne répond pas : " + e.message); }
    const j = await r.json().catch(() => null);
    if (!r.ok) throw fail(`Grok a refusé la demande (code ${r.status})${j && j.error ? " : " + str(j.error.message || j.error).slice(0, 160) : ""}`);
    const m = j && j.choices && j.choices[0] && j.choices[0].message; if (!m) throw fail("Réponse de Grok vide");
    const tc = (m.tool_calls || []).find(x => x && x.function && x.function.name === "repondre");
    if (tc) { try { return JSON.parse(tc.function.arguments || "{}"); } catch (e) { throw fail("Réponse de Grok illisible"); } }
    return { message: str(m.content) };
  }
  function system(c, model, albums, fanInfo) {
    return [`Tu es l'IA de ${c.label}, créatrice de contenus sur Twizz (plateforme de contenus payants réservée aux adultes). Tu réponds à ses fans à sa place pendant que son équipe est absente.`,
      `Le fan sait qu'il parle à une IA : le site le lui dit dans ton premier message et ajoute 🤖 à chacun de tes messages. Si on te demande si tu es la vraie ${c.label} ou un humain, réponds franchement que tu es son IA.`,
      model && model.style ? `Son style : ${model.style}` : "", c.note ? `Ses consignes, à respecter absolument (ce qu'elles interdisent t'est interdit aussi) : ${c.note}` : "",
      model && model.prices ? `Sa grille de prix : ${model.prices}` : "", fanInfo ? `Ce qu'on sait du fan : ${fanInfo}` : "",
      `Ton but : garder le fan content et attaché, créer du lien, et lui proposer de temps en temps un média payant du coffre quand le moment s'y prête (pas à chaque message, jamais de pression).`,
      albums.length ? `Albums du coffre que tu peux proposer (identifiant : nom, nombre de médias) :\n${albums.map(a => `- ${a.id} : ${a.name} (${a.count})`).join("\n")}\nPour joindre un média, remplis album et prix (entre 3 et ${maxPrice()} €, nombre rond, d'après la grille de prix). Le site choisit dans l'album un média que ce fan n'a pas encore reçu. Ne promets jamais un contenu précis qui ne serait pas dans ces albums.` : "Pas de média à proposer pour le moment : discute seulement.",
      `Écris comme un vrai texto : court, naturel, dans la langue du fan (français familier par défaut), un emoji au plus.`,
      `Interdits : rendez-vous, rencontre, appel, numéro, réseaux perso, fausse exclusivité, fausses promesses, parler de l'équipe ou d'une agence, menacer ou culpabiliser.`,
      `Remplis « laisser » (et rien n'est envoyé) si : le fan dit avoir moins de 18 ans ou parle de mineurs ; il semble en détresse ou parle de se faire du mal ; il dit dépenser plus qu'il ne peut ; il veut parler à un humain, se plaint, demande un remboursement ou un contenu personnalisé ; tu ne sais pas quoi répondre sans inventer.`
    ].filter(Boolean).join("\n\n");
  }
  const lineOf = m => m.type === "FILE" && !m.fromFan ? `[média envoyé${m.price > 0 ? ` à ${m.price} € — ${m.status === "accepted" ? "acheté" : "pas encore acheté"}` : " gratuit"}]${m.text ? " " + m.text : ""}`
    : m.text || (m.medias.length ? (m.fromFan ? "[le fan envoie un média]" : "[média]") : "");

  /* ---------- coffre ---------- */
  async function albumsOf(cid) {
    const j = await G(`/quick-files/albums?creatorId=${enc(cid)}`, 300e3).catch(() => null);
    return arr(j).map(a => ({ id: str(a._id || a.id), name: str(a.name || a.title || "Album").slice(0, 60), count: +(a.filesCount ?? a.count ?? (a.files || []).length ?? 0) || 0,
      audio: str(a.type) === "audio" || (!a.type && /vocal|audio|voix/i.test(str(a.name))) })).filter(a => a.id && !a.audio && a.count > 0).slice(0, 30);
  }
  // un média de l'album que ce fan n'a pas encore reçu (médias vus dans la conversation, historique gardé sur le site, envois du site)
  async function pickMedia(cid, albumId, convId, L) {
    const j = await G(`/quick-files/album/${enc(albumId)}?creatorId=${enc(cid)}`, 300e3);
    const d = j && (j.data ?? j), F = (Array.isArray(d) ? d : (d && (d.files || d.quickFiles || d.items)) || []).map(file).filter(f => f.id && f.kind !== "audio");
    const sent = new Set(L.flatMap(m => m.medias.flatMap(x => x.keys)));
    try { db.prepare("SELECT keys FROM twizz_media_hist WHERE conv_id = ?").all(convId).forEach(r => JSON.parse(r.keys || "[]").forEach(k => sent.add(k))); } catch (e) {}
    try { db.prepare("SELECT files FROM twizz_sent WHERE conv_id = ? AND files IS NOT NULL").all(convId).forEach(r => JSON.parse(r.files || "[]").forEach(k => sent.add(str(k)))); } catch (e) {}
    const left = F.filter(f => !f.keys.some(k => sent.has(k)) && !sent.has(f.id));
    return left.length ? left[Math.floor(Math.random() * left.length)] : null;
  }

  /* ---------- envoi (mêmes requêtes que la messagerie) ---------- */
  async function sendText(cid, c, text) {
    const j = await call("POST", "/messages/send-message", { temp_id: `temp_${now()}_${Math.random().toString(36).slice(2, 11)}`, conversationId: c.id, type: "TEXT", text, creatorId: cid }, true);
    db.prepare("INSERT INTO twizz_sent (msg_id, conv_id, fan_id, creator_id, user_id, price, at, via) VALUES (?,?,?,?,NULL,NULL,?, 'ia')").run(str(j && j.data && j.data._id), c.id, c.fan.id, cid, now());
  }
  async function sendMedia(cid, c, f, price, text) {
    const fd = new FormData();
    fd.set("promo", "false"); fd.set("price", String(price)); fd.set("text", text); fd.set("isConversation", "true"); fd.set("conversationId", c.id);
    fd.set("receivers", JSON.stringify([c.fan.id])); fd.set("fileIds", "[]"); fd.set("quickFiles", JSON.stringify([{ id: f.id, isPrivate: true }])); fd.set("creatorId", cid);
    const j = await call("POST", "/mediapush/conversation", fd, true), d = (j && j.data) || j || {}, nm = d.newMessage || null;
    if (!nm) throw fail("Twizz a refusé le média" + (d.message ? " : " + str(d.message) : ""));
    db.prepare("INSERT INTO twizz_sent (msg_id, conv_id, fan_id, creator_id, user_id, price, at, files, via) VALUES (?,?,?,?,NULL,?,?,?, 'ia')").run(str(nm._id), c.id, c.fan.id, cid, price, now(), JSON.stringify([f.id]));
  }

  /* ---------- une conversation ---------- */
  async function handle(r, cr, c) {
    const row = db.prepare("SELECT * FROM twizz_ai_convs WHERE run_id = ? AND conv_id = ?").get(r.id, c.id) || {};
    const j = await G(`/messages/find-all-messages?conversationId=${enc(c.id)}&creatorId=${enc(cr.id)}&page=1`, 0);
    const L = ((j && j.data && j.data.data) || []).map(m => msg(m, c.fan.id)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-30);
    const last = L[L.length - 1]; if (!last || !last.fromFan || last.id === row.last_fan_msg) return false;
    const model = cr.model_id ? db.prepare("SELECT style, prices FROM models WHERE id = ?").get(cr.model_id) : null;
    const note = db.prepare("SELECT text FROM twizz_fan_notes WHERE creator_id = ? AND fan_id = ?").get(cr.id, c.fan.id);
    const fanInfo = [c.fan.name && c.fan.name !== "Fan" ? "prénom ou pseudo : " + c.fan.name : "", note && note.text ? "note de l'équipe : " + str(note.text).slice(0, 300) : ""].filter(Boolean).join(" ; ");
    const albums = await albumsOf(cr.id);
    const msgs = [{ role: "system", content: system(cr, model, albums, fanInfo) }];
    L.forEach(m => { const t = lineOf(m); if (t) msgs.push({ role: m.fromFan ? "user" : "assistant", content: t }); });
    const out = await grok(msgs);
    const mark = (patch) => db.prepare(`INSERT INTO twizz_ai_convs (run_id, conv_id, fan_id, fan_name, notified, replies, last_fan_msg, blocked, at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(run_id, conv_id) DO UPDATE SET notified = excluded.notified, replies = excluded.replies, last_fan_msg = excluded.last_fan_msg, blocked = excluded.blocked, at = excluded.at`)
      .run(r.id, c.id, c.fan.id, c.fan.name, patch.notified ?? row.notified ?? 0, patch.replies ?? row.replies ?? 0, last.id, patch.blocked ?? row.blocked ?? null, now());
    const leave = str(out.laisser).trim();
    if (leave) {
      mark({ blocked: leave.slice(0, 200) });
      ping(`🤖 ${cr.label} : un fan à reprendre`, `${c.fan.name || "Un fan"} : ${leave.slice(0, 140)}`, "ai-leave-" + c.id);
      log(0, "a", `L'IA de secours laisse **${c.fan.name || "un fan"}** (${cr.label}) à l'équipe`, leave.slice(0, 160));
      return true;
    }
    let text = str(out.message).replace(/🤖/g, "").trim().slice(0, 1500); if (!text) return false;
    const first = !row.notified;
    const body = (first ? `🤖 Petite précision : c'est l'IA de ${cr.label} qui te répond en ce moment.\n\n` : "") + text + " 🤖";
    let price = Math.round(+out.prix || 0), f = null;
    if (out.album && albums.some(a => a.id === str(out.album)) && price >= 3) {
      price = Math.min(price, maxPrice());
      try { f = await pickMedia(cr.id, str(out.album), c.id, L); } catch (e) { f = null; }
    }
    if (f) { await sendMedia(cr.id, c, f, price, body); db.prepare("UPDATE twizz_ai_runs SET medias = medias + 1 WHERE id = ?").run(r.id); }
    else await sendText(cr.id, c, body);
    db.prepare("UPDATE twizz_ai_runs SET replies = replies + 1, last_at = ?, last_error = NULL WHERE id = ?").run(now(), r.id);
    mark({ notified: 1, replies: (row.replies || 0) + 1 });
    drop(c.id, `/conversations/user/${enc(cr.id)}`);
    return true;
  }

  /* ---------- la boucle : toutes les 20 s ; chaque créatrice relue au plus toutes les 45 s ---------- */
  const POLLED = new Map(); let busy = false;
  async function loop() {
    const runs = active(); if (!runs.length) return;
    if (!aiOn()) { runs.forEach(r => end(r, null, "IA coupée par le fondateur")); return; }
    for (const r of runs) {
      if (now() - r.started_at > MAX_H * 3600e3) { end(r, null, `${MAX_H} h écoulées`); continue; }
      const back = backOf(r); if (back) { end(r, back.id, `${back.username} a pointé`); continue; }
      if (!sendOn() || !XAI()) continue;   // en pause : rien ne peut partir
      if (now() - (POLLED.get(r.id) || 0) < 45e3) continue; POLLED.set(r.id, now());
      const cr = crOf(r.creator_id); if (!cr) { end(r, null, "Créatrice introuvable"); continue; }
      try {
        const j = await G(`/conversations/user/${enc(cr.id)}?page=1&type=GENERAL&creatorId=${enc(cr.id)}`, 20e3);
        const human = db.prepare("SELECT 1 FROM twizz_sent WHERE conv_id = ? AND COALESCE(via, '') <> 'ia' AND user_id IS NOT NULL AND at > ?");
        const L = arr(j).map(x => conv(x, cr.id)).filter(c => {
          const t = Date.parse(c.last.at) || 0, age = now() - t, row = db.prepare("SELECT blocked, replies, last_fan_msg FROM twizz_ai_convs WHERE run_id = ? AND conv_id = ?").get(r.id, c.id) || {};
          const wait = 35e3 + (parseInt(c.id.slice(-4), 16) || 0) % 45e3;   // laisse le fan finir d'écrire (35 à 80 s, comme quelqu'un qui répond)
          return c.fan.id && c.last.fromFan && age >= wait && age < 12 * 3600e3 && !row.blocked && (row.replies || 0) < PER_CONV && row.last_fan_msg !== c.last.id
            && !hereOf(c.id, -1).length && !human.get(c.id, now() - 15 * 60e3);
        }).sort((a, b) => (Date.parse(a.last.at) || 0) - (Date.parse(b.last.at) || 0)).slice(0, 2);
        for (const c of L) { if (!runOf(cr.id)) break; await handle(r, cr, c); await sleep(2500 + Math.random() * 2500); }
      } catch (e) { db.prepare("UPDATE twizz_ai_runs SET last_error = ?, last_at = ? WHERE id = ?").run(str(e.message).slice(0, 240), now(), r.id); console.error("IA de secours", cr.label, e.message); }
    }
  }
  setInterval(() => { if (busy) return; busy = true; loop().catch(e => console.error("IA de secours", e.message)).finally(() => { busy = false; }); }, 20e3);

  /* ---------- API (managers ; interrupteur : fondateur) ---------- */
  const mgr = (req, res, next) => req.user.role === "admin" && req.user.rk !== "assistant" && !req.viewAs ? next() : res.status(403).json({ error: "Réservé aux managers" });
  const founder = (req, res, next) => req.user.rk === "founder" && !req.viewAs ? next() : res.status(403).json({ error: "Réservé au fondateur" });
  const wrap = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.code || 400).json({ error: e.message || "Erreur" }); } };
  const sales = r => db.prepare("SELECT COUNT(*) n, COALESCE(SUM(net), 0) net FROM twizz_tx WHERE ai = 1 AND creator_id = ? AND at BETWEEN ? AND ?").get(r.creator_id, r.started_at, (r.ended_at || now()) + 3600e3);
  const view = r => r && { id: r.id, started_at: r.started_at, by: uname(r.started_by), reason: r.reason, ended_at: r.ended_at, ended_by: uname(r.ended_by), end_reason: r.end_reason,
    replies: r.replies, medias: r.medias, error: r.last_error, last_at: r.last_at, sales: sales(r),
    left: db.prepare("SELECT conv_id, fan_name, blocked FROM twizz_ai_convs WHERE run_id = ? AND blocked IS NOT NULL ORDER BY at DESC LIMIT 10").all(r.id) };
  const state = req => ({ on: aiOn(), key: !!XAI(), send: sendOn(), founder: req.user.rk === "founder", maxPrice: maxPrice(),
    creators: mapped().map(c => ({ id: c.id, label: c.label, model_id: c.model_id, model: c.model, run: view(runOf(c.id)) })),
    recent: db.prepare("SELECT * FROM twizz_ai_runs WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 8").all().map(r => ({ ...view(r), label: (crOf(r.creator_id) || {}).label || "?" })) });
  app.get("/api/twizz/ai", auth, mgr, wrap(async req => state(req)));
  app.post("/api/twizz/ai/switch", auth, founder, wrap(async req => { const b = req.body || {};
    if (typeof b.on === "boolean") { S.set("twizz_ai_on", b.on); log(req.user.id, "a", `**${req.user.username}** a ${b.on ? "activé" : "coupé"} l'IA de secours`, "");
      if (!b.on) active().forEach(r => end(r, req.user.id, "IA coupée par le fondateur")); }
    if (b.maxPrice != null) { const v = parseInt(b.maxPrice, 10); if (!(v >= 3 && v <= MAX_PRICE)) throw fail(`Prix maximum : entre 3 et ${MAX_PRICE} €`); S.set("twizz_ai_max_price", v); }
    return state(req); }));
  app.post("/api/twizz/ai/start", auth, mgr, wrap(async req => { const b = req.body || {};
    let cid = str(b.cid); if (!cid && b.model_id) { const c = mapped().find(x => x.model_id === +b.model_id); if (!c) throw fail("Cette créatrice n'est pas reliée à Twizz"); cid = c.id; }
    start(cid, req.user.id, b.reason); return state(req); }));
  app.post("/api/twizz/ai/stop", auth, mgr, wrap(async req => { const r = runOf(str(req.body && req.body.cid)); if (!r) throw fail("L'IA ne tourne pas sur cette créatrice");
    end(r, req.user.id, `Arrêtée par ${req.user.username}`); return state(req); }));

  return { start, end, active };
};
