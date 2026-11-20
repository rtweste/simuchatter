// IA de secours : quand un chatter manque, un manager la lance sur une créatrice et elle répond aux fans à sa place.
// Elle écrit avec Grok (xAI, variable XAI_API_KEY), jamais avec la clé Anthropic du site, d'après la fiche de la créatrice.
// Le fan est toujours prévenu : par le premier message « c'est l'IA de … », par un 🤖 à la fin de chaque message, ou les deux (au moins un des deux, réglé par le fondateur).
// Sur le site, les bulles écrites par l'IA portent un 🤖 pour l'équipe.
// Elle s'arrête toute seule dès qu'un chatter pointe sur cette créatrice ou ouvre sa messagerie. Interrupteur général : le fondateur.
module.exports = function mount(app, db, auth, admin, { twizz, inbox, notify, gest }) {
  const { call, S } = twizz;
  const { conv, msg, arr, file, hereOf, G, drop, mapped, sendOn } = inbox;
  const str = v => (v == null ? "" : String(v)), now = () => Date.now(), enc = encodeURIComponent;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = (...a) => { try { gest.log(...a); } catch (e) {} };
  const fail = (m, code) => { const e = new Error(m); e.code = code || 400; return e; };
  const J = (v, d) => { try { const x = JSON.parse(v); return x == null ? d : x; } catch (e) { return d; } };

  db.exec(`CREATE TABLE IF NOT EXISTS twizz_ai_runs (id INTEGER PRIMARY KEY, creator_id TEXT NOT NULL, model_id INTEGER, started_by INTEGER, started_at INTEGER NOT NULL, reason TEXT,
      ended_at INTEGER, ended_by INTEGER, end_reason TEXT, replies INTEGER NOT NULL DEFAULT 0, medias INTEGER NOT NULL DEFAULT 0, last_error TEXT, last_at INTEGER);
    CREATE TABLE IF NOT EXISTS twizz_ai_convs (run_id INTEGER NOT NULL, conv_id TEXT NOT NULL, fan_id TEXT, fan_name TEXT, notified INTEGER NOT NULL DEFAULT 0, replies INTEGER NOT NULL DEFAULT 0,
      last_fan_msg TEXT, blocked TEXT, at INTEGER, PRIMARY KEY (run_id, conv_id));
    CREATE TABLE IF NOT EXISTS twizz_ai_told (creator_id TEXT NOT NULL, fan_id TEXT NOT NULL, at INTEGER, PRIMARY KEY (creator_id, fan_id));`);

  /* ---------- réglages ---------- */
  const MODELS = { fast: ["grok-4-1-fast-non-reasoning", "Rapide"], smart: ["grok-4-1-fast-reasoning", "Plus réfléchi (un peu plus lent)"] };
  const G_DEF = { notice: true, mark: false, base: "", locked: "", noticeText: "Petite précision : c'est l'IA de {creatrice} qui te répond en ce moment 😊", noticeFreq: "run", noticeDays: 30,
    waitMin: 35, waitMax: 80, teamPause: 15, fanWindow: 12, perFan: 40, maxHours: 12, model: "fast" };
  const M_DEF = { ok: false, sell: true, maxPrice: 100, gap: 20, pile: true, albums: [], skipTags: [], extra: "", profile: "" };
  const gcfg = () => { const o = { ...G_DEF, ...(S.get("twizz_ai_cfg", {}) || {}) }; if (!o.notice && !o.mark) o.mark = true; return o; };   // jamais les deux coupés
  const mcfg = cid => ({ ...M_DEF, ...(S.get("twizz_ai_m:" + cid, {}) || {}) });
  const int = (v, a, b, name) => { const n = parseInt(v, 10); if (!Number.isFinite(n) || n < a || n > b) throw fail(`${name} : entre ${a} et ${b}`); return n; };
  function setG(b, founder) {
    const c = gcfg(), o = { ...c };
    if (typeof b.notice === "boolean" && b.notice !== c.notice) { if (!founder) throw fail("Seul le fondateur peut allumer ou couper le message IA"); o.notice = b.notice; }
    if (typeof b.mark === "boolean" && b.mark !== c.mark) { if (!founder) throw fail("Seul le fondateur peut régler le 🤖 dans les messages"); o.mark = b.mark; }
    if (!o.notice && !o.mark) throw fail("Garde au moins un des deux : le message « c'est l'IA » ou le 🤖 à la fin des messages. Sinon le fan ne saurait jamais que c'est une IA.");
    if (b.noticeText != null) { const t = str(b.noticeText).trim().slice(0, 240); if (t.length < 8) throw fail("Message IA trop court"); o.noticeText = t; }
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
    if (b.base != null) { const t = str(b.base).trim().slice(0, 8000); o.base = t && t !== BASE_DEF ? t : ""; }   // vide : instructions par défaut
    if (b.locked != null) { const t = str(b.locked).trim().slice(0, 4000); o.locked = t && t !== LOCKED_DEF ? t : ""; }   // vide : règles par défaut
    S.set("twizz_ai_cfg", o); return o;
  }
  function setM(cid, b) {
    const o = { ...mcfg(cid) };
    if (typeof b.ok === "boolean") o.ok = b.ok;
    if (typeof b.sell === "boolean") o.sell = b.sell;
    if (typeof b.pile === "boolean") o.pile = b.pile;
    if (b.maxPrice != null) o.maxPrice = int(b.maxPrice, 3, 500, "Prix maximum");
    if (b.gap != null) o.gap = int(b.gap, 0, 1440, "Délai entre deux médias payants");
    if (Array.isArray(b.albums)) o.albums = b.albums.map(str).filter(Boolean).slice(0, 60);
    if (Array.isArray(b.skipTags)) o.skipTags = b.skipTags.map(x => parseInt(x, 10)).filter(Number.isFinite).slice(0, 40);
    if (b.extra != null) o.extra = str(b.extra).slice(0, 2000);
    if (b.profile != null) o.profile = str(b.profile).trim().slice(0, 10000);   // vide : texte tiré de la fiche
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
      body: JSON.stringify({ model: XMODEL(), messages, tools: [TOOL], tool_choice: { type: "function", function: { name: "repondre" } }, temperature: 0.8, max_tokens: 600 }), signal: AbortSignal.timeout(60000) }); }
    catch (e) { throw fail("Grok ne répond pas : " + e.message); }
    const j = await r.json().catch(() => null);
    if (!r.ok) throw fail(`Grok a refusé la demande (code ${r.status})${j && j.error ? " : " + str(j.error.message || j.error).slice(0, 160) : ""}`);
    const m = j && j.choices && j.choices[0] && j.choices[0].message; if (!m) throw fail("Réponse de Grok vide");
    const tc = (m.tool_calls || []).find(x => x && x.function && x.function.name === "repondre");
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
  const BASE_DEF = [`Tu es l'IA de {creatrice}, créatrice de contenus sur Twizz (plateforme de contenus payants réservée aux adultes). Tu réponds à ses fans à sa place pendant que son équipe est absente, en écrivant comme elle.`,
    `Ton but : garder le fan content et attaché, créer du lien, et lui proposer de temps en temps un média payant quand le moment s'y prête (jamais de pression).`,
    `Écris comme un vrai texto, dans la langue du fan (français familier par défaut).`,
    `Ne parle jamais de l'équipe ou d'une agence. Pas de numéro, pas de réseaux perso, pas de fausse exclusivité.`,
    `Remplis aussi « laisser » si le fan veut parler à un humain, se plaint, demande un remboursement ou un contenu personnalisé, ou si tu ne sais pas quoi répondre sans inventer.`].join("\n\n");
  const LOCKED_DEF = [`RÈGLES FIXES (elles passent avant tout le reste) :`,
    `- {mark} Si un fan te demande si tu es la vraie {creatrice}, un humain ou une IA, réponds honnêtement que tu es son IA. N'écris jamais 🤖 toi-même.`,
    `- Jamais de rendez-vous ni de rencontre promis ; jamais de menace, de chantage ou de culpabilisation.`,
    `- Remplis « laisser » (et rien n'est envoyé) si le fan dit avoir moins de 18 ans ou parle de mineurs, s'il semble en détresse ou parle de se faire du mal, ou s'il dit dépenser plus qu'il ne peut.`].join("\n");
  function parts(c, M, fiche, albums, sellNote, fanInfo, C) {
    const base = str((C && C.base) || BASE_DEF).replace(/\{creatrice\}/gi, c.label);
    const gen = profileOf(c, M, fiche), profile = M.profile ? str(M.profile).replace(/\{creatrice\}/gi, c.label) : gen;
    const live = [fanInfo ? `Ce qu'on sait du fan : ${fanInfo}` : "",
      albums.length ? `Albums du coffre que tu peux proposer (identifiant : nom, nombre de médias) :\n${albums.map(a => `- ${a.id} : ${a.name} (${a.count})`).join("\n")}\nPour joindre un média, remplis album et prix (entre 3 et ${M.maxPrice} €, nombre rond, d'après son catalogue). Le site choisit dans l'album un média que ce fan n'a pas encore reçu. Ne promets jamais un contenu précis qui ne serait pas dans ces albums.`
        : `Pas de média à proposer maintenant${sellNote ? " : " + sellNote : ""}. Discute seulement.`].filter(Boolean).join("\n\n");
    const auto = [profile, live].filter(Boolean).join("\n\n");
    const markText = (C && C.mark) ? "Chacun de tes messages est signé 🤖 par le site." : "Le site prévient le fan que c'est ton IA qui répond.";
    const lockedRaw = str((C && C.locked) || "").trim();
    const locked = (lockedRaw || LOCKED_DEF).replace(/\{creatrice\}/gi, c.label).replace(/\{mark\}/g, markText);
    return { base, auto, locked, profile, gen, live };
  }
  // ce qui vient de la fiche, des consignes Twizz et du manager (remplaçable par un texte écrit à la main pour cette créatrice)
  function profileOf(c, M, fiche) {
    return [fiche.text ? `FICHE DE ${c.label.toUpperCase()}\n${fiche.text}` : "", c.note ? `Ses consignes sur Twizz, à respecter absolument : ${c.note}` : "",
      M.extra ? `Consignes du manager pour ${c.label}, à respecter absolument : ${M.extra}` : "", fiche.prices ? `Son catalogue et ses prix : ${fiche.prices}` : ""].filter(Boolean).join("\n\n");
  }
  const system = (...a) => { const p = parts(...a); return [p.base, p.auto, p.locked].filter(Boolean).join("\n\n"); };
  const lineOf = m => m.type === "FILE" && !m.fromFan ? `[média envoyé${m.price > 0 ? ` à ${m.price} € — ${m.status === "accepted" ? "acheté" : "pas encore acheté"}` : " gratuit"}]${m.text ? " " + m.text : ""}`
    : m.text || (m.medias.length ? (m.fromFan ? "[le fan envoie un média]" : "[média]") : "");

  /* ---------- coffre ---------- */
  async function albumsOf(cid) {
    const j = await G(`/quick-files/albums?creatorId=${enc(cid)}`, 300e3).catch(() => null);
    return arr(j).map(a => ({ id: str(a._id || a.id), name: str(a.name || a.title || "Album").slice(0, 60), count: +(a.filesCount ?? a.count ?? (a.files || []).length ?? 0) || 0,
      audio: str(a.type) === "audio" || (!a.type && /vocal|audio|voix/i.test(str(a.name))) })).filter(a => a.id && !a.audio && a.count > 0).slice(0, 40);
  }
  // un média de l'album que ce fan n'a pas encore reçu (médias vus dans la conversation, historique gardé sur le site, envois du site)
  async function pickMedia(cid, albumId, convId, L) {
    const j = await G(`/quick-files/album/${enc(albumId)}?creatorId=${enc(cid)}`, 300e3);
    const d = j && (j.data ?? j), F = (Array.isArray(d) ? d : (d && (d.files || d.quickFiles || d.items)) || []).map(file).filter(f => f.id && f.kind !== "audio");
    const sent = new Set(L.flatMap(m => m.medias.flatMap(x => x.keys)));
    try { db.prepare("SELECT keys FROM twizz_media_hist WHERE conv_id = ?").all(convId).forEach(r => J(r.keys, []).forEach(k => sent.add(k))); } catch (e) {}
    try { db.prepare("SELECT files FROM twizz_sent WHERE conv_id = ? AND files IS NOT NULL").all(convId).forEach(r => J(r.files, []).forEach(k => sent.add(str(k)))); } catch (e) {}
    const left = F.filter(f => !f.keys.some(k => sent.has(k)) && !sent.has(f.id));
    return left.length ? left[Math.floor(Math.random() * left.length)] : null;
  }
  // ce que l'IA peut vendre à ce fan maintenant (réglages de la créatrice + ce qu'il a déjà reçu)
  async function sellable(cr, M, L) {
    if (!M.sell) return { albums: [], note: "la vente de médias est coupée pour cette créatrice" };
    const paid = L.filter(m => !m.fromFan && m.type === "FILE" && m.price > 0), last = paid[paid.length - 1];
    if (M.pile && last && last.status !== "accepted") return { albums: [], note: "il n'a pas encore acheté le dernier média payant ; tu peux lui en reparler gentiment, sans en envoyer un autre" };
    if (M.gap && last && now() - (Date.parse(last.at) || 0) < M.gap * 60e3) return { albums: [], note: "un média payant vient de lui être proposé" };
    let A = await albumsOf(cr.id); if (M.albums.length) A = A.filter(a => M.albums.includes(a.id));
    return { albums: A, note: A.length ? "" : "aucun album autorisé dans le coffre" };
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
  // le message « c'est l'IA » : coupé, une fois par séance, ou une fois par fan (puis tous les N jours)
  function needNotice(cr, c, row, C) {
    if (!C.notice) return false;
    if (C.noticeFreq === "fan") { const t = db.prepare("SELECT at FROM twizz_ai_told WHERE creator_id = ? AND fan_id = ?").get(cr.id, c.fan.id); return !t || now() - t.at > C.noticeDays * 864e5; }
    return !row.notified;
  }
  const noticeOf = (cr, C) => str(C.noticeText).replace(/\{creatrice\}/gi, cr.label);

  /* ---------- une conversation ---------- */
  async function handle(r, cr, c, C) {
    const M = mcfg(cr.id);
    const row = db.prepare("SELECT * FROM twizz_ai_convs WHERE run_id = ? AND conv_id = ?").get(r.id, c.id) || {};
    const j = await G(`/messages/find-all-messages?conversationId=${enc(c.id)}&creatorId=${enc(cr.id)}&page=1`, 0);
    const L = ((j && j.data && j.data.data) || []).map(m => msg(m, c.fan.id)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-30);
    const last = L[L.length - 1]; if (!last || !last.fromFan || last.id === row.last_fan_msg) return false;
    const note = db.prepare("SELECT text FROM twizz_fan_notes WHERE creator_id = ? AND fan_id = ?").get(cr.id, c.fan.id);
    const fanInfo = [c.fan.name && c.fan.name !== "Fan" ? "prénom ou pseudo : " + c.fan.name : "", note && note.text ? "note de l'équipe : " + str(note.text).slice(0, 300) : ""].filter(Boolean).join(" ; ");
    const sell = await sellable(cr, M, L);
    const msgs = [{ role: "system", content: system(cr, M, ficheOf(cr), sell.albums, sell.note, fanInfo, C) }];
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
    const text = str(out.message).replace(/🤖/g, "").trim().slice(0, 1500); if (!text) return false;
    const tell = needNotice(cr, c, row, C);
    const body = (tell ? noticeOf(cr, C) + "\n\n" : "") + text + (C.mark ? " 🤖" : "");
    let price = Math.round(+out.prix || 0), f = null;
    if (out.album && sell.albums.some(a => a.id === str(out.album)) && price >= 3) {
      price = Math.min(price, M.maxPrice);
      try { f = await pickMedia(cr.id, str(out.album), c.id, L); } catch (e) { f = null; }
    }
    if (f) { await sendMedia(cr.id, c, f, price, body); db.prepare("UPDATE twizz_ai_runs SET medias = medias + 1 WHERE id = ?").run(r.id); }
    else await sendText(cr.id, c, body);
    if (tell) db.prepare("INSERT INTO twizz_ai_told (creator_id, fan_id, at) VALUES (?,?,?) ON CONFLICT(creator_id, fan_id) DO UPDATE SET at = excluded.at").run(cr.id, c.fan.id, now());
    db.prepare("UPDATE twizz_ai_runs SET replies = replies + 1, last_at = ?, last_error = NULL WHERE id = ?").run(now(), r.id);
    mark({ notified: tell || row.notified ? 1 : 0, replies: (row.replies || 0) + 1 });
    drop(c.id, `/conversations/user/${enc(cr.id)}`);
    return true;
  }

  /* ---------- la boucle : toutes les 20 s ; chaque créatrice relue au plus toutes les 45 s ---------- */
  const POLLED = new Map(); let busy = false;
  async function loop() {
    const runs = active(); if (!runs.length) return;
    if (!aiOn()) { runs.forEach(r => end(r, null, "IA coupée par le fondateur")); return; }
    const C = gcfg();
    for (const r of runs) {
      if (now() - r.started_at > C.maxHours * 3600e3) { end(r, null, `${C.maxHours} h écoulées`); continue; }
      const back = backOf(r); if (back) { end(r, back.id, `${back.username} a pointé`); continue; }
      if (!mcfg(r.creator_id).ok) { end(r, null, "Accord de la créatrice retiré"); continue; }
      if (!sendOn() || !XAI()) continue;   // en pause : rien ne peut partir
      if (now() - (POLLED.get(r.id) || 0) < 45e3) continue; POLLED.set(r.id, now());
      const cr = crOf(r.creator_id); if (!cr) { end(r, null, "Créatrice introuvable"); continue; }
      try {
        const M = mcfg(cr.id), skip = new Set(M.skipTags);
        const j = await G(`/conversations/user/${enc(cr.id)}?page=1&type=GENERAL&creatorId=${enc(cr.id)}`, 20e3);
        const human = db.prepare("SELECT 1 FROM twizz_sent WHERE conv_id = ? AND COALESCE(via, '') <> 'ia' AND user_id IS NOT NULL AND at > ?");
        const tagged = db.prepare("SELECT tag_id FROM twizz_fan_tags WHERE creator_id = ? AND fan_id = ?");
        const L = [];
        for (const c of arr(j).map(x => conv(x, cr.id))) {
          const t = Date.parse(c.last.at) || 0, age = now() - t, row = db.prepare("SELECT blocked, replies, last_fan_msg FROM twizz_ai_convs WHERE run_id = ? AND conv_id = ?").get(r.id, c.id) || {};
          const wait = (C.waitMin + (parseInt(c.id.slice(-4), 16) || 0) % (Math.max(1, C.waitMax - C.waitMin) + 1)) * 1000;   // laisse le fan finir d'écrire, comme quelqu'un qui répond
          if (!c.fan.id || !c.last.fromFan || age < wait || age > C.fanWindow * 3600e3 || row.blocked || (row.replies || 0) >= C.perFan || row.last_fan_msg === c.last.id) continue;
          if (hereOf(c.id, -1).length || (C.teamPause && human.get(c.id, now() - C.teamPause * 60e3))) continue;
          if (skip.size) { const tg = tagged.all(cr.id, c.fan.id).find(x => skip.has(x.tag_id));
            if (tg) { const nm = (db.prepare("SELECT name FROM twizz_tags WHERE id = ?").get(tg.tag_id) || {}).name || "tag";
              db.prepare("INSERT INTO twizz_ai_convs (run_id, conv_id, fan_id, fan_name, blocked, at) VALUES (?,?,?,?,?,?) ON CONFLICT(run_id, conv_id) DO UPDATE SET blocked = excluded.blocked, at = excluded.at")
                .run(r.id, c.id, c.fan.id, c.fan.name, `Fan tagué ${nm} : laissé à l'équipe`, now()); continue; } }
          L.push(c);
        }
        L.sort((a, b) => (Date.parse(a.last.at) || 0) - (Date.parse(b.last.at) || 0));
        for (const c of L.slice(0, 2)) { if (!runOf(cr.id)) break; await handle(r, cr, c, C); await sleep(2500 + Math.random() * 2500); }
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
    left: db.prepare("SELECT conv_id, fan_name, blocked FROM twizz_ai_convs WHERE run_id = ? AND blocked IS NOT NULL ORDER BY at DESC LIMIT 10").all(r.id) };
  const ficheFilled = c => { const m = c.model_id ? db.prepare("SELECT profile FROM models WHERE id = ?").get(c.model_id) : null, p = J(m && m.profile, {}) || {};
    return ["voice", "story"].filter(k => str(p[k]).trim()).length + ["traits", "does", "doesnt", "catalogue", "samples"].filter(k => Array.isArray(p[k]) && p[k].length).length; };
  const state = req => ({ on: aiOn(), key: !!XAI(), send: sendOn(), founder: req.user.rk === "founder", cfg: gcfg(), models: Object.entries(MODELS).map(([k, v]) => ({ id: k, label: v[1] })),
    creators: mapped().map(c => ({ id: c.id, label: c.label, model_id: c.model_id, model: c.model, cfg: mcfg(c.id), fiche: ficheFilled(c), run: view(runOf(c.id)) })),
    recent: db.prepare("SELECT * FROM twizz_ai_runs WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 12").all().map(r => ({ ...view(r), label: (crOf(r.creator_id) || {}).label || "?" })) });
  app.get("/api/twizz/ai", auth, mgr, wrap(async req => state(req)));
  app.post("/api/twizz/ai/switch", auth, founder, wrap(async req => { const b = req.body || {};
    if (typeof b.on === "boolean") { S.set("twizz_ai_on", b.on); log(req.user.id, "a", `**${req.user.username}** a ${b.on ? "activé" : "coupé"} l'IA de secours`, "");
      if (!b.on) active().forEach(r => end(r, req.user.id, "IA coupée par le fondateur")); }
    return state(req); }));
  app.post("/api/twizz/ai/cfg", auth, mgr, wrap(async req => { const before = gcfg().notice, beforeMark = gcfg().mark, o = setG(req.body || {}, req.user.rk === "founder");
    if (o.notice !== before) log(req.user.id, "a", `**${req.user.username}** a ${o.notice ? "rallumé" : "coupé"} le message « c'est l'IA » de l'IA de secours`, "");
    if (o.mark !== beforeMark) log(req.user.id, "a", `**${req.user.username}** a ${o.mark ? "remis" : "retiré"} le 🤖 à la fin des messages de l'IA de secours`, "");
    return state(req); }));
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
    const L = (Array.isArray(req.body && req.body.messages) ? req.body.messages : []).slice(-20).map(m => ({ role: m && m.fan ? "user" : "assistant", content: str(m && m.text).slice(0, 1000) })).filter(m => m.content);
    if (!L.length || L[L.length - 1].role !== "user") throw fail("Écris un message de fan pour essayer");
    let albums = []; try { albums = M.sell ? await albumsOf(c.id) : []; } catch (e) {} if (M.albums.length) albums = albums.filter(a => M.albums.includes(a.id));
    const out = await grok([{ role: "system", content: system(c, M, ficheOf(c), albums, M.sell ? "" : "la vente de médias est coupée pour cette créatrice", "", gcfg()) }, ...L]);
    const al = out.album ? albums.find(a => a.id === str(out.album)) : null;
    return { message: str(out.message).replace(/🤖/g, "").trim(), album: al ? al.name : null, prix: al ? Math.min(Math.round(+out.prix || 0), M.maxPrice) : null, laisser: str(out.laisser).trim() || null };
  }));
  app.post("/api/twizz/ai/start", auth, mgr, wrap(async req => { const b = req.body || {};
    let cid = str(b.cid); if (!cid && b.model_id) { const c = mapped().find(x => x.model_id === +b.model_id); if (!c) throw fail("Cette créatrice n'est pas reliée à Twizz"); cid = c.id; }
    start(cid, req.user.id, b.reason); return state(req); }));
  app.post("/api/twizz/ai/stop", auth, mgr, wrap(async req => { const r = runOf(str(req.body && req.body.cid)); if (!r) throw fail("L'IA ne tourne pas sur cette créatrice");
    end(r, req.user.id, `Arrêtée par ${req.user.username}`); return state(req); }));

  return { start, end, active };
};
