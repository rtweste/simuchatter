// IA de secours : quand un chatter manque, un manager la lance sur une créatrice et elle répond aux fans à sa place.
// Elle écrit avec Grok (xAI, variable XAI_API_KEY), jamais avec la clé Anthropic du site, d'après la fiche de la créatrice.
// Le fan est toujours prévenu : par le premier message « c'est l'IA de … », par un 🤖 à la fin de chaque message, ou les deux (au moins un des deux, réglé par le fondateur).
// Sur le site, les bulles écrites par l'IA portent un 🤖 pour l'équipe.
// Elle s'arrête toute seule dès qu'un chatter pointe sur cette créatrice ou ouvre sa messagerie. Interrupteur général : le fondateur.
module.exports = function mount(app, db, auth, admin, { twizz, inbox, notify, gest }) {
  const { call, S } = twizz;
  const { conv, msg, arr, file, hereOf, G, drop, mapped, sendOn, unreadConvs } = inbox;
  const str = v => (v == null ? "" : String(v)), now = () => Date.now(), enc = encodeURIComponent;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = (...a) => { try { gest.log(...a); } catch (e) {} };
  const fail = (m, code) => { const e = new Error(m); e.code = code || 400; return e; };
  const J = (v, d) => { try { const x = JSON.parse(v); return x == null ? d : x; } catch (e) { return d; } };
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
  db.exec("CREATE TABLE IF NOT EXISTS twizz_ai_tease (creator_id TEXT NOT NULL, conv_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (creator_id, conv_id))");
  for (const [k, t] of [["relances", "INTEGER NOT NULL DEFAULT 0"], ["relance_at", "INTEGER"], ["mem_at", "INTEGER"]])
    if (!db.prepare("PRAGMA table_info(twizz_ai_convs)").all().some(x => x.name === k)) db.exec(`ALTER TABLE twizz_ai_convs ADD COLUMN ${k} ${t}`);

  /* ---------- réglages ---------- */
  const MODELS = { fast: ["grok-4-1-fast-non-reasoning", "Rapide"], smart: ["grok-4-1-fast-reasoning", "Plus réfléchi (un peu plus lent)"] };
  const G_DEF = { notice: true, mark: false, base: "", noticeText: "Petite précision : c'est l'IA de {creatrice} qui te répond en ce moment 😊", noticeFreq: "run", noticeDays: 30,
    waitMin: 35, waitMax: 80, teamPause: 15, fanWindow: 12, perFan: 40, maxHours: 12, model: "fast",
    relance: true, relanceAfter: 45, relanceMax: 1, quietFrom: 1, quietTo: 9, memory: true };
  const M_DEF = { ok: false, sell: true, maxPrice: 100, gap: 20, pile: true, albums: [], albumNotes: {}, skipTags: [], extra: "", profile: "", scripts: true, promo: true, maxDiscount: 30, promoHours: 24, vision: true,
    minMsgs: 8, tease: true, teaseWindow: 90, askSkip: false };
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
    if (typeof b.relance === "boolean") o.relance = b.relance;
    if (typeof b.memory === "boolean") o.memory = b.memory;
    if (b.relanceAfter != null) o.relanceAfter = int(b.relanceAfter, 10, 720, "Relance après");
    if (b.relanceMax != null) o.relanceMax = int(b.relanceMax, 1, 5, "Relances maximum par fan");
    if (b.quietFrom != null) o.quietFrom = int(b.quietFrom, 0, 23, "Début des heures calmes");
    if (b.quietTo != null) o.quietTo = int(b.quietTo, 0, 23, "Fin des heures calmes");
    if (b.base != null) { const t = str(b.base).trim().slice(0, 8000); o.base = t && t !== BASE_DEF ? t : ""; }   // vide : instructions par défaut
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
    if (b.teaseWindow != null) o.teaseWindow = int(b.teaseWindow, 10, 720, "Délai pour envoyer après le teasing");
    if (b.maxDiscount != null) o.maxDiscount = int(b.maxDiscount, 5, 90, "Remise maximum");
    if (b.promoHours != null) { const h = parseInt(b.promoHours, 10); if (![6, 12, 24, 48].includes(h)) throw fail("Durée de promo : 6, 12, 24 ou 48 h"); o.promoHours = h; }
    if (b.albumNotes && typeof b.albumNotes === "object") o.albumNotes = Object.fromEntries(Object.entries(b.albumNotes).slice(0, 80).map(([k, v]) => [str(k).slice(0, 60), str(v).trim().slice(0, 240)]).filter(([k, v]) => k && v));
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
    let sold = null; try { sold = sales(r); } catch (e) {}
    const recap = `${r.replies} réponse${r.replies > 1 ? "s" : ""} · ${r.medias} média${r.medias > 1 ? "s" : ""} envoyé${r.medias > 1 ? "s" : ""}${sold && sold.net ? ` · ${String((+sold.net).toFixed(2)).replace(".", ",")} € vendus` : ""}`;
    log(by || 0, "a", `IA de secours arrêtée sur **${c.label}**`, `${why} · ${recap}`);
    ping(`IA de secours arrêtée sur ${c.label}`, `${why} · ${recap}`, "ai-" + r.creator_id);
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
    bulles: { type: "array", items: { type: "string" }, maxItems: 3, description: "Ta réponse en 1 à 3 bulles courtes envoyées à la suite, comme quelqu'un qui tape vite (le plus souvent 1 ou 2). Le média éventuel part avec la dernière bulle." },
    message: { type: "string", description: "Ta réponse en une seule bulle, si tu ne remplis pas bulles." },
    album: { type: "string", description: "Facultatif : identifiant d'un album du coffre (liste fournie) pour joindre un média payant à ton message." },
    media: { type: "string", description: "Facultatif : identifiant précis du média choisi dans la liste de l'album (m:…), si l'album en liste." },
    teaser: { type: "boolean", description: "Mets true quand ton message fait envie d'un média précis sans l'envoyer (tu l'annonces, tu le décris, tu le fais désirer). Obligatoire avant de pouvoir envoyer un média. C'est un champ technique : n'écris jamais « teaser » dans le texte de tes messages." },
    remise: { type: "integer", description: "Facultatif : remise en % sur ce média, seulement dans les cas permis par les consignes." },
    prix: { type: "integer", description: "Prix du média en euros, nombre rond (obligatoire si album est rempli)." },
    laisser: { type: "string", description: "Facultatif : remplis-le seulement si l'équipe doit reprendre ce fan elle-même (raison courte). Rien n'est alors envoyé au fan." }
  } } } };
  async function grok(messages, o = {}) {
    const tool = o.tool === undefined ? TOOL : o.tool, body = { model: o.model || XMODEL(), messages, temperature: o.temp ?? 0.9, max_tokens: o.max || 900 };
    if (tool) { body.tools = [tool]; body.tool_choice = { type: "function", function: { name: tool.function.name } }; }
    let r; try { r = await fetch(XBASE() + "/chat/completions", { method: "POST", headers: { Authorization: "Bearer " + XAI(), "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(60000) }); }
    catch (e) { throw fail("Grok ne répond pas : " + e.message); }
    const j = await r.json().catch(() => null);
    if (!r.ok) throw fail(`Grok a refusé la demande (code ${r.status})${j && j.error ? " : " + str(j.error.message || j.error).slice(0, 160) : ""}`);
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
      albums.length ? `Albums du coffre que tu peux proposer (identifiant : nom, nombre de médias — description ; sous l'album, des médias qu'il n'a pas encore reçus) :\n${albums.map(alb).join("\n")}\nPour joindre un média, remplis album et prix (entre 3 et ${M.maxPrice} €, nombre rond, d'après son catalogue). Si l'album liste des médias, remplis aussi media avec celui qui colle le mieux à la conversation, et donne envie d'après sa description. Sinon le site choisit dans l'album un média qu'il n'a pas encore reçu. Ne promets jamais un contenu précis qui ne serait pas dans ces albums.${promo ? "\n" + promo : ""}`
        : `Pas de média à proposer maintenant${sellNote ? " : " + sellNote : ""}. Discute seulement.`,
      opt.relance ? `RELANCE : le fan ne répond plus depuis ${opt.relance.since}${opt.relance.unbought ? ` et n'a pas acheté le média à ${opt.relance.unbought} €` : ""}. Écris une relance courte et naturelle, comme si tu pensais à lui, sans reproche. Si une relance n'a pas de sens ici, laisse bulles et message vides.` : ""].filter(Boolean).join("\n\n");
    const auto = [profile, live].filter(Boolean).join("\n\n");
    const locked = [`RÈGLES FIXES (elles passent avant tout le reste) :`,
      `- ${C && C.mark ? "Chacun de tes messages est signé 🤖 par le site." : "Le site prévient le fan que c'est ton IA qui répond."} Si un fan te demande si tu es la vraie ${c.label}, un humain ou une IA, réponds honnêtement que tu es son IA. N'écris jamais 🤖 toi-même.`,
      `- Jamais de rendez-vous ni de rencontre promis ; jamais de menace, de chantage ou de culpabilisation.`,
      `- Remplis « laisser » (et rien n'est envoyé) si le fan dit avoir moins de 18 ans ou parle de mineurs, s'il semble en détresse ou parle de se faire du mal, ou s'il dit dépenser plus qu'il ne peut.`].join("\n");
    return { base, auto, locked, profile, gen, live };
  }
  // scripts de la bibliothèque (épinglés et les plus utilisés d'abord) : des exemples de messages qui marchent
  const scriptsOf = cid => { try { return db.prepare("SELECT title, body, steps FROM twizz_scripts WHERE (creator_id IS NULL OR creator_id = '' OR creator_id = ?) ORDER BY COALESCE(pinned, 0) DESC, COALESCE(uses, 0) DESC LIMIT 12").all(cid)
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
  const lineOf = m => m.type === "FILE" && !m.fromFan ? `[média envoyé${m.price > 0 ? ` à ${m.price} € — ${m.status === "accepted" ? "acheté" : "pas encore acheté"}` : " gratuit"}]${m.text ? " " + m.text : ""}`
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
    return { at: t.at, answered: L.some(m => m.fromFan && (Date.parse(m.at) || 0) > t.at) };
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
    if (M.tease && !skip && !(tease && tease.answered && now() - tease.at < M.teaseWindow * 60e3)) {
      const what = await peek();
      return { albums: [], teaseNow: true, note: tease && !tease.answered ? "tu viens de lui teaser un média : attends sa réponse, continue de le chauffer sans rien envoyer"
        : `avant tout média, tu dois d'abord le teaser : fais-lui envie de ce que tu pourrais lui montrer (sans l'envoyer, sans prix), fais monter la tension. Un seul teasing, court, comme un vrai message. Coche le champ teaser de l'outil (ne l'écris jamais dans ton message). Tu pourras l'envoyer seulement après sa réponse${what ? `. Ce que tu peux teaser : ${what}` : ""}` }; }
    const paid = L.filter(m => !m.fromFan && m.type === "FILE" && m.price > 0), last = paid[paid.length - 1], open = last && last.status !== "accepted";
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

  /* ---------- envoi (mêmes requêtes que la messagerie) ---------- */
  async function sendText(cid, c, text) {
    const j = await call("POST", "/messages/send-message", { temp_id: `temp_${now()}_${Math.random().toString(36).slice(2, 11)}`, conversationId: c.id, type: "TEXT", text, creatorId: cid }, true);
    db.prepare("INSERT INTO twizz_sent (msg_id, conv_id, fan_id, creator_id, user_id, price, at, via) VALUES (?,?,?,?,NULL,NULL,?, 'ia')").run(str(j && j.data && j.data._id), c.id, c.fan.id, cid, now());
  }
  const PROMO_T = { 6: ["HOURS", 6, "h6"], 12: ["HOURS", 12, "h12"], 24: ["HOURS", 24, "h24"], 48: ["DAYS", 2, "d2"] };
  async function sendMedia(cid, c, f, price, text, promo) {
    const fd = new FormData(), pt = promo && PROMO_T[promo.hours];
    fd.set("promo", pt ? "true" : "false"); fd.set("price", String(price)); fd.set("text", text);
    if (pt) { fd.set("discount", String(promo.pct)); fd.set("discountType", "PERCENTAGE"); fd.set("expireTime", String(pt[1])); fd.set("expireTimeType", pt[0]); }
    fd.set("isConversation", "true"); fd.set("conversationId", c.id);
    fd.set("receivers", JSON.stringify([c.fan.id])); fd.set("fileIds", "[]"); fd.set("quickFiles", JSON.stringify([{ id: f.id, isPrivate: true }])); fd.set("creatorId", cid);
    const j = await call("POST", "/mediapush/conversation", fd, true), d = (j && j.data) || j || {}, nm = d.newMessage || null;
    if (!nm) throw fail("Twizz a refusé le média" + (d.message ? " : " + str(d.message) : ""));
    const paidNow = nm.mediaPushPrice && isFinite(+nm.mediaPushPrice.resultPrice) ? +nm.mediaPushPrice.resultPrice : pt ? Math.round(price * (100 - promo.pct)) / 100 : price;
    db.prepare("INSERT INTO twizz_sent (msg_id, conv_id, fan_id, creator_id, user_id, price, at, files, promo, via) VALUES (?,?,?,?,NULL,?,?,?,?, 'ia')")
      .run(str(nm._id), c.id, c.fan.id, cid, paidNow, now(), JSON.stringify([f.id]), pt ? JSON.stringify({ type: "pct", value: promo.pct, time: pt[2] }) : null);
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
  function unleak(out) {
    if (!out) return out; let seen = false;
    const fix = x => { const P = str(x).split(new RegExp(TEASE_TAG.source, "i")); let t = P[0];
      if (P.length > 1) { if (!seen) t += " " + P[1]; seen = true; }
      return t.replace(/\b(?:album|media|prix|remise|laisser|bulles)\s*=\s*\S+/gi, "").replace(/\s{2,}/g, " ").trim(); };
    if (Array.isArray(out.bulles)) out.bulles = out.bulles.map(fix).filter(Boolean);
    if (out.message != null) out.message = fix(out.message);
    if (seen) out.teaser = true;
    return out;
  }
  const bubbles = out => (Array.isArray(out.bulles) && out.bulles.length ? out.bulles : [out.message]).map(x => str(x).replace(/🤖/g, "").trim().slice(0, 1200)).filter(Boolean).slice(0, 3);

  /* ---------- une conversation ---------- */
  /* ---------- une conversation : réponse au fan, ou relance quand il ne répond plus ---------- */
  const isImg = x => x && !x.audio && !x.video && (x.thumb || x.url);
  async function handle(r, cr, c, C, relance) {
    const M = mcfg(cr.id);
    const row = db.prepare("SELECT * FROM twizz_ai_convs WHERE run_id = ? AND conv_id = ?").get(r.id, c.id) || {};
    const j = await G(`/messages/find-all-messages?conversationId=${enc(c.id)}&creatorId=${enc(cr.id)}&page=1`, 0);
    const L = ((j && j.data && j.data.data) || []).map(m => msg(m, c.fan.id)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-30);
    const last = L[L.length - 1]; if (!last) return false;
    if (relance ? last.fromFan : (!last.fromFan || last.id === row.last_fan_msg)) return false;   // le fan a réécrit, ou déjà répondu
    const fanInfo = await fanCtx(cr, c), sell = await sellable(cr, M, L, c.id);
    const opt = { requirePromo: sell.requirePromo };
    if (relance) opt.relance = { since: relance.since, unbought: sell.open ? sell.open.price : null };
    const msgs = [{ role: "system", content: system(cr, M, ficheOf(cr), sell.albums, sell.note, fanInfo, C, opt) }];
    // la dernière photo envoyée par le fan : Grok la regarde (les autres restent en texte)
    const lastPic = [...L].reverse().find(m => m.fromFan && m.medias.some(isImg)); let picUrl = null;
    if (lastPic) { const x = lastPic.medias.find(isImg); try { picUrl = await toImage(x.thumb || x.url); } catch (e) { picUrl = null; } }
    L.forEach(m => { const t = m.fromFan ? lineOf(m) : untag(lineOf(m)); if (!t) return;
      const pic = m === lastPic && picUrl;
      msgs.push({ role: m.fromFan ? "user" : "assistant", content: pic ? [{ type: "text", text: m.text || "[le fan t'envoie cette photo]" }, { type: "image_url", image_url: { url: pic } }] : t }); });
    let out; try { out = await grok(msgs); }
    catch (e) { if (!picUrl) throw e; msgs.forEach(m => { if (Array.isArray(m.content)) m.content = m.content[0].text; }); out = await grok(msgs); }   // image refusée : sans la photo
    unleak(out);
    const mark = (patch) => db.prepare(`INSERT INTO twizz_ai_convs (run_id, conv_id, fan_id, fan_name, notified, replies, last_fan_msg, blocked, at, relances, relance_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(run_id, conv_id) DO UPDATE SET notified = excluded.notified, replies = excluded.replies, last_fan_msg = excluded.last_fan_msg, blocked = excluded.blocked, at = excluded.at, relances = excluded.relances, relance_at = excluded.relance_at`)
      .run(r.id, c.id, c.fan.id, c.fan.name, patch.notified ?? row.notified ?? 0, patch.replies ?? row.replies ?? 0, relance ? row.last_fan_msg || null : last.id, patch.blocked ?? row.blocked ?? null, now(),
        (row.relances || 0) + (relance ? 1 : 0), relance ? now() : row.relance_at || null);
    const leave = str(out.laisser).trim();
    if (leave) {
      mark({ blocked: leave.slice(0, 200) });
      ping(`🤖 ${cr.label} : un fan à reprendre`, `${c.fan.name || "Un fan"} : ${leave.slice(0, 140)}`, "ai-leave-" + c.id);
      log(0, "a", `L'IA de secours laisse **${c.fan.name || "un fan"}** (${cr.label}) à l'équipe`, leave.slice(0, 160));
      return true;
    }
    const B = bubbles(out); if (!B.length) { if (relance) mark({}); return false; }   // pas de relance utile : on ne redemande pas
    const tell = needNotice(cr, c, row, C), tail = C.mark ? " 🤖" : "";
    let price = Math.round(+out.prix || 0), f = null, promo = null;
    if (out.album && sell.albums.some(a => a.id === str(out.album)) && price >= 3) {
      price = Math.min(price, M.maxPrice);
      const pct = Math.round(+out.remise || 0), hesit = !!sell.open || L.some(m => !m.fromFan && m.type === "FILE" && m.price > 0 && m.status !== "accepted");
      if (M.promo && pct >= 5 && (sell.requirePromo || hesit)) promo = { pct: Math.min(pct, M.maxDiscount), hours: M.promoHours };
      if (!sell.requirePromo || promo) { try { f = await pickMedia(cr.id, str(out.album), c.id, L, str(out.media).replace(/^m:/, "")); } catch (e) { f = null; } }
    }
    // plusieurs bulles : envoyées à la suite, le temps de les taper ; le média part avec la dernière
    for (let i = 0; i < B.length; i++) {
      if (i) { if (!runOf(cr.id)) break; await sleep(Math.min(9000, 1800 + B[i].length * 70 + Math.random() * 1500)); }
      const body = (i === 0 && tell ? noticeOf(cr, C) + "\n\n" : "") + B[i] + tail;
      if (f && i === B.length - 1) { await sendMedia(cr.id, c, f, price, body, promo); db.prepare("UPDATE twizz_ai_runs SET medias = medias + 1 WHERE id = ?").run(r.id); }
      else await sendText(cr.id, c, body);
    }
    if (tell) db.prepare("INSERT INTO twizz_ai_told (creator_id, fan_id, at) VALUES (?,?,?) ON CONFLICT(creator_id, fan_id) DO UPDATE SET at = excluded.at").run(cr.id, c.fan.id, now());
    if (f) teaseClear(cr, c); else if (out.teaser && (sell.teaseNow || sell.albums.length)) teaseSet(cr, c);   // un média envoyé : il faudra re-teaser pour le suivant
    db.prepare("UPDATE twizz_ai_runs SET replies = replies + 1, last_at = ?, last_error = NULL WHERE id = ?").run(now(), r.id);
    mark({ notified: tell || row.notified ? 1 : 0, replies: (row.replies || 0) + 1 });
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
          const x = await grok([{ role: "user", content: [{ type: "text", text: "Décris ce média en 15 mots maximum, pour aider à le vendre : tenue, pose, cadrage, lieu, ambiance, niveau de nudité (habillée, lingerie, seins nus, nue) et si le visage est visible. Réponds seulement la description." },
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
        const L = [], RL = [];
        // 1re page du fil + toutes les conversations non lues (filtre « Non lus » de Twizz) : aucun fan qui attend n'est oublié
        let unread = []; try { unread = unreadConvs ? await unreadConvs(cr.id) : []; } catch (e) {}
        const ids = new Set(), all = arr(j).map(x => conv(x, cr.id)).concat(unread).filter(c => c.id && !ids.has(c.id) && ids.add(c.id));
        for (const c of all) {
          const t = Date.parse(c.last.at) || 0, age = now() - t, row = db.prepare("SELECT blocked, replies, last_fan_msg, relances, relance_at FROM twizz_ai_convs WHERE run_id = ? AND conv_id = ?").get(r.id, c.id) || {};
          if (!c.fan.id || row.blocked || age > C.fanWindow * 3600e3 || hereOf(c.id, -1).length || (C.teamPause && human.get(c.id, now() - C.teamPause * 60e3))) continue;
          if (skip.size) { const tg = tagged.all(cr.id, c.fan.id).find(x => skip.has(x.tag_id));
            if (tg) { const nm = (db.prepare("SELECT name FROM twizz_tags WHERE id = ?").get(tg.tag_id) || {}).name || "tag";
              db.prepare("INSERT INTO twizz_ai_convs (run_id, conv_id, fan_id, fan_name, blocked, at) VALUES (?,?,?,?,?,?) ON CONFLICT(run_id, conv_id) DO UPDATE SET blocked = excluded.blocked, at = excluded.at")
                .run(r.id, c.id, c.fan.id, c.fan.name, `Fan tagué ${nm} : laissé à l'équipe`, now()); continue; } }
          const value = (spend.get(cr.id, c.fan.id) || {}).spend || 0;
          if (c.last.fromFan) {
            const wait = (C.waitMin + (parseInt(c.id.slice(-4), 16) || 0) % (Math.max(1, C.waitMax - C.waitMin) + 1)) * 1000;   // laisse le fan finir d'écrire, comme quelqu'un qui répond
            if (age >= wait && (row.replies || 0) < C.perFan && row.last_fan_msg !== c.last.id) L.push({ c, value, t });
          } else if (C.relance && row.replies && (row.relances || 0) < C.relanceMax && age >= C.relanceAfter * 60e3 && (!row.relance_at || t > row.relance_at) && !quiet(C)) RL.push({ c, value, t, age });
        }
        // les gros payeurs d'abord, puis ceux qui attendent depuis le plus longtemps
        L.sort((a, b) => (b.value - a.value) || (a.t - b.t));
        for (const x of L.slice(0, 3)) { if (!runOf(cr.id)) break; await handle(r, cr, x.c, C); await sleep(2500 + Math.random() * 2500); }
        if (L.length < 3 && RL.length && runOf(cr.id)) { RL.sort((a, b) => (b.value - a.value) || (a.t - b.t)); const x = RL[0]; await handle(r, cr, x.c, C, { since: ago(x.age) }); }
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
    creators: mapped().map(c => ({ id: c.id, label: c.label, model_id: c.model_id, model: c.model, cfg: mcfg(c.id), fiche: ficheFilled(c), run: view(runOf(c.id)),
      media: db.prepare("SELECT COUNT(*) n FROM twizz_ai_media WHERE creator_id = ? AND descr IS NOT NULL").get(c.id).n, scan: SCAN[c.id] || null })),
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
    return { albums, tags, base: C.base || BASE_DEF, baseDefault: BASE_DEF, custom: !!C.base, profile: M.profile || P.gen, profileCustom: !!M.profile, live: P.live, locked: P.locked }; }));
  // essayer l'IA sans rien envoyer : une fausse conversation, la réponse de Grok s'affiche seulement
  const TRIED = new Map();
  app.post("/api/twizz/ai/try/:cid", auth, mgr, wrap(async req => { const c = okC(req.params.cid), M = mcfg(c.id);
    if (!XAI()) throw fail("Clé Grok manquante : ajoute la variable XAI_API_KEY dans Railway");
    if (now() - (TRIED.get(req.user.id) || 0) < 3000) throw fail("Doucement : attends quelques secondes"); TRIED.set(req.user.id, now());
    const L = (Array.isArray(req.body && req.body.messages) ? req.body.messages : []).slice(-20).map(m => ({ role: m && m.fan ? "user" : "assistant", content: str(m && m.text).slice(0, 1000) })).filter(m => m.content);
    if (!L.length || L[L.length - 1].role !== "user") throw fail("Écris un message de fan pour essayer");
    // même porte de vente qu'en vrai : messages échangés dans l'essai, teasing repéré sur les réponses de l'IA
    const raw = (req.body.messages || []).slice(-30), LL = raw.map((m, i) => ({ fromFan: !!(m && m.fan), text: str(m && m.text), medias: [], type: "TEXT", at: new Date(now() - (raw.length - i) * 60e3).toISOString(), teaser: !!(m && m.teaser) }));
    const ti = LL.map(m => !m.fromFan && m.teaser).lastIndexOf(true), tz = ti < 0 ? null : { at: Date.parse(LL[ti].at), answered: LL.slice(ti + 1).some(m => m.fromFan) };
    let sell = { albums: [], note: "" }; try { sell = await sellable(c, M, LL, null, tz); } catch (e) {} const albums = sell.albums;
    const FANS = { new: "pseudo : Thomas ; n'a encore jamais rien acheté", reg: "pseudo : Thomas ; prénom : Thomas ; ville : Lyon ; a déjà dépensé 150 € avec elle en 8 achats ; tags de l'équipe : Vidéos",
      big: "pseudo : Thomas ; prénom : Thomas ; métier : chef d'entreprise ; a déjà dépensé 850 € avec elle en 30 achats ; tags de l'équipe : Spender ; résumé de l'équipe : achète vite quand on le chauffe, aime qu'on se souvienne de lui" };
    const out = unleak(await grok([{ role: "system", content: system(c, M, ficheOf(c), albums, sell.note, FANS[req.body && req.body.fan] || "", gcfg()) }, ...L.map(m => m.role === "user" ? m : { ...m, content: untag(m.content) })]));
    const al = out.album ? albums.find(a => a.id === str(out.album)) : null, it = al && (al.items || []).find(x => x.id === str(out.media).replace(/^m:/, ""));
    const pct = Math.round(+out.remise || 0);
    return { bulles: bubbles(out), album: al ? al.name : null, media: it ? it.descr : null, prix: al ? Math.min(Math.round(+out.prix || 0), M.maxPrice) : null,
      remise: al && M.promo && pct >= 5 ? Math.min(pct, M.maxDiscount) : null, laisser: str(out.laisser).trim() || null,
      teaser: !al && !!out.teaser && !!(sell.teaseNow || albums.length), gate: albums.length ? "" : sell.note };
  }));
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
