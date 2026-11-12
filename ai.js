// Appels à l'IA (API Anthropic). MOCK_AI=1 renvoie des réponses factices pour tester sans clé.
const AnthropicMod = require("@anthropic-ai/sdk");
const Anthropic = AnthropicMod.default || AnthropicMod;

const MOCK = !!process.env.MOCK_AI;
const MODEL_FAN = process.env.MODEL_FAN || "claude-haiku-5-5";
const MODEL_EVAL = process.env.MODEL_EVAL || "claude-sonnet-5-5";
const MODEL_HINT = process.env.MODEL_HINT || "claude-haiku-5-5";

const client = MOCK ? null : new Anthropic(); // lit ANTHROPIC_API_KEY
// Suivi de la consommation : le serveur branche ici l'enregistrement de chaque appel
let usageHook = null;
const setUsageHook = f => { usageHook = f; };

// Répare les défauts courants d'un JSON écrit par l'IA : retours à la ligne dans les textes, virgules en trop
function repairJSON(t) {
  let out = "", inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) { const ch = t[i];
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === "\\") { out += ch; esc = true; continue; }
      if (ch === '"') {
        // guillemet droit recopié dans un texte (ex. message du chatter) : on le garde comme texte s'il n'est pas suivi d'un séparateur JSON
        const rest = t.slice(i + 1).trimStart(), nx = rest[0];
        if (nx !== undefined && !",}]:".includes(nx)) { out += '\\"'; continue; }
        inStr = false; out += ch; continue; }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") continue;
      if (ch === "\t") { out += " "; continue; }
      out += ch;
    } else { if (ch === '"') inStr = true; out += ch; }
  }
  out = out.replace(/,\s*([}\]])/g, "$1");
  // réponse coupée : on ferme le texte et les accolades restées ouvertes
  if (inStr) out += '"';
  const stack = []; let s2 = false, e2 = false;
  for (const ch of out) { if (s2) { if (e2) e2 = false; else if (ch === "\\") e2 = true; else if (ch === '"') s2 = false; continue; }
    if (ch === '"') s2 = true; else if (ch === "{" || ch === "[") stack.push(ch); else if (ch === "}" || ch === "]") stack.pop(); }
  if (stack.length) out = out.replace(/[,:]\s*$/, "").replace(/,\s*"[^"]*"\s*$/, "") + stack.reverse().map(c => c === "{" ? "}" : "]").join("");
  return out.replace(/,\s*([}\]])/g, "$1");
}
function extractJSON(text) {
  const clean = String(text || "").replace(/```(?:json)?/gi, "");
  const a = clean.indexOf("{"), b = clean.lastIndexOf("}");
  if (a === -1) throw new Error("Réponse IA sans JSON : " + clean.slice(0, 200));
  const raw = clean.slice(a, b > a ? b + 1 : undefined);
  try { return JSON.parse(raw); } catch (e) { return JSON.parse(repairJSON(raw)); }
}

// Appel à l'IA, avec nouvelles tentatives si elle est momentanément surchargée
async function ask(prompt, model, maxTokens, tag, extra) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await client.messages.create({
        model, max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }], ...(extra || {})
      });
      if (res.stop_reason === "max_tokens") console.warn(`Réponse IA coupée (max_tokens=${maxTokens})`);
      try { if (usageHook && res.usage) usageHook(tag || {}, model, res.usage); } catch (e) {}
      if (extra && extra.tools) return res;
      return res.content.filter(c => c.type === "text").map(c => c.text).join("");
    } catch (e) {
      const st = e.status || 0, retry = !st || st === 429 || st >= 500;
      console.error(`Appel IA échoué (tentative ${attempt}) :`, st, e.message);
      if (!retry || attempt >= 3) throw e;
      await new Promise(r => setTimeout(r, attempt * 2500));
    }
  }
}

async function askJSON(prompt, model, maxTokens, tag) {
  let text = await ask(prompt, model, maxTokens, tag);
  try { return extractJSON(text); }
  catch (e) {
    console.error("JSON illisible, nouvel essai :", e.message);
    text = await ask(prompt + "\n\nIMPORTANT : réponds uniquement avec un objet JSON valide, sans texte autour, même si la conversation est très courte. Dans les textes, utilise « » au lieu des guillemets droits.", model, maxTokens, tag);
    return extractJSON(text);
  }
}

/* ---------- Transcription ---------- */
function transcript(log) {
  return log.map(l => {
    if (l.who === "fan") return `[FAN] ${l.text}`;
    if (l.who === "chatter") return `[CRÉATRICE] ${l.text}`;
    if (l.who === "ppv") return `[CRÉATRICE ENVOIE UN PPV] Aperçu : "${l.desc}" — Prix : ${l.price} € — Statut : ${l.status}`;
    return "";
  }).filter(Boolean).join("\n");
}

const DIFF = {
  facile: "Tu es patient et indulgent, tu laisses plusieurs chances.",
  normal: "Tu réagis de façon réaliste.",
  difficile: "Tu es exigeant, tu perds vite patience face à un message générique, tu achètes difficilement."
};

/* ---------- Tour du fan ---------- */
const FAN_TOOL = { name: "reponse_fan", description: "Enregistre la prochaine réponse du fan.",
  input_schema: { type: "object", required: ["replies", "interest", "left"], properties: {
    replies: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3, description: "1 à 3 messages très courts du fan" },
    interest: { type: "integer", minimum: 0, maximum: 100 },
    ppv_decision: { type: ["string", "null"], enum: ["buy", "refuse", "negotiate", null], description: "seulement si un PPV est en attente, sinon null" },
    left: { type: "boolean" } } } };
async function fanTurn(sim, persona) {
  const pending = sim.pending_ppv
    ? `\nUN PPV EST EN ATTENTE DE TA DÉCISION : "${sim.pending_ppv.desc}" à ${sim.pending_ppv.price} €. Décide maintenant (buy / refuse / negotiate) selon ton intérêt, ton budget restant, ton profil et la cohérence prix/valeur.`
    : "";
  const prompt = `Tu joues un FAN dans une simulation d'entraînement destinée aux chatters d'une agence qui gère des créatrices de contenu sur une plateforme d'abonnement. Tu ne révèles jamais que c'est une simulation.

TON PERSONNAGE : ${persona.prompt}
DIFFICULTÉ : ${DIFF[sim.difficulty] || DIFF.normal}

LA CRÉATRICE QUE TU SUIS : ${sim.creator_name}. Son style connu : ${sim.creator_style}

TON ÉTAT INTERNE (caché) : intérêt actuel ${sim.interest}/100 · budget restant ${sim.budget - sim.spent} € · déjà dépensé dans cette conversation ${sim.spent} €.${pending}

RÈGLES :
- Écris comme un vrai homme sur une messagerie : 1 à 3 messages très courts, français familier, quelques abréviations, peu de ponctuation, emojis rares. Jamais de longs paragraphes.
- Reste strictement dans ton personnage et cohérent avec ce que tu as déjà dit.
- Contenu : flirt et messages chauds de la créatrice sont normaux sur cette plateforme, ce n'est jamais une faute. Comme un vrai fan, tu peux être direct, lourd et vulgaire dans le vocabulaire : réclamer du contenu plus hot ou des nudes, insister, faire des remarques sur son physique, marchander pour voir plus. Tu ne décris jamais d'acte sexuel en détail.
- Fais varier ton intérêt honnêtement : messages génériques, copier-coller, vente trop rapide, prix incohérents, incohérences de personnalité, excuses excessives → l'intérêt baisse. Écoute, questions sur toi, humour, personnalisation, rareté bien amenée → l'intérêt monte.
- Tu n'achètes jamais au-delà de ton budget restant.
- Ton intérêt bouge par petits pas : en général entre -5 et +8 par réponse. Une chute de plus de 10 seulement pour une vraie faute (message copié-collé, pression ou insistance, vente agressive, impolitesse, mensonge flagrant).
- Les petits surnoms affectueux (mon chou, mon cœur, bébé…), les compliments et le flirt léger sont normaux de la part d'une créatrice : ce n'est pas une faute. Tu peux taquiner ou poser une question dessus, mais ça ne fait pas baisser ton intérêt de plus de quelques points.
- Juste après un achat qui t'a plu, tu restes plutôt satisfait : ne passe pas de chaud à froid pour un détail.
- Si ton intérêt tombe sous 10, tu peux quitter la conversation (left = true) avec un dernier message sec.

RÉPONDS UNIQUEMENT EN JSON :
{"replies": ["message 1", "message 2 optionnel"], "interest": nombre 0-100, "ppv_decision": "buy" | "refuse" | "negotiate" | null, "left": true|false}
ppv_decision n'est rempli que si un PPV est en attente.

CONVERSATION JUSQU'ICI :
${transcript(sim.log) || "(aucun message — tu ouvres la conversation)"}

Écris maintenant la prochaine réponse du fan.`;

  if (MOCK) {
    await new Promise(r => setTimeout(r, 300));
    return {
      replies: sim.log.length ? ["ah ouais ?", "raconte moi plus"] : ["salut toi 😊 je viens de m'abonner"],
      interest: Math.min(100, sim.interest + 3),
      ppv_decision: sim.pending_ppv ? (sim.pending_ppv.price <= 20 ? "buy" : "negotiate") : null,
      left: false
    };
  }
  // réponse imposée par un outil : toujours un objet valide (plus d'erreur « réponse illisible » en pleine conversation)
  const tag = { sim: sim.id, user: sim.user_id, kind: "fan" };
  const ok = r => r && Array.isArray(r.replies) && r.replies.some(x => typeof x === "string" && x.trim());
  for (let k = 0; k < 2; k++) {
    try {
      const res = await ask(prompt.replace("RÉPONDS UNIQUEMENT EN JSON :", "Réponds avec l'outil « reponse_fan », en suivant cette structure :"), MODEL_FAN, 900, tag,
        { tools: [FAN_TOOL], tool_choice: { type: "tool", name: "reponse_fan" } });
      const tu = res.content.find(c => c.type === "tool_use");
      if (ok(tu && tu.input)) return tu.input;
      console.error("Réponse du fan incomplète, nouvel essai :", res.stop_reason);
    } catch (e) { if (e.status && e.status !== 400) throw e; console.error("Réponse du fan par outil échouée :", e.message); }
  }
  // dernier recours : texte libre, on en tire au moins un message
  const text = await ask(prompt, MODEL_FAN, 900, tag);
  try { const r = extractJSON(text); if (ok(r)) return r; } catch (e) {}
  const lines = String(text || "").replace(/```[a-z]*|```/g, "").split(/\n+/).map(x => x.trim()).filter(x => x && !/^[{}\[\]"]/.test(x)).slice(0, 2);
  return { replies: lines.length ? lines : ["?"], interest: sim.interest, ppv_decision: null, left: false };
}

/* ---------- Conseil du coach ---------- */
async function hint(sim, persona) {
  const prompt = `Tu es coach senior pour les chatters d'une agence de gestion de créatrices de contenu. Le chatter incarne ${sim.creator_name} (style : ${sim.creator_style}). Grille de prix : ${sim.prices}. Objectif de la session : ${persona.goal}
Voici la conversation en cours :
${transcript(sim.log) || "(vide)"}

Donne UN conseil concret et court (3 phrases max) pour le prochain message, en français, avec éventuellement un exemple de formulation. Reste éthique : pas de pression sur un fan vulnérable, pas de fausses promesses (rencontres, exclusivité mensongère).`;
  if (MOCK) return "Pose-lui une question sur lui avant de proposer quoi que ce soit. Ex : « et toi tu fais quoi dans la vie ? »";
  return (await ask(prompt, MODEL_HINT, 300, { sim: sim.id, user: sim.user_id, kind: "hint" })).trim();
}

/* ---------- Évaluation ---------- */
// Format imposé de l'évaluation : l'API renvoie directement un objet valide (plus d'erreur « réponse illisible »)
const STR = { type: "string" };
const EVAL_TOOL = { name: "evaluation", description: "Enregistre l'évaluation de la session du chatter.",
  input_schema: { type: "object", required: ["score", "verdict", "criteria", "strengths", "improvements", "rewrites", "best", "ethics_flag"], properties: {
    score: { type: "integer", minimum: 0, maximum: 100 }, verdict: STR,
    criteria: { type: "array", items: { type: "object", required: ["name", "score", "comment"], properties: { name: STR, score: { type: "integer", minimum: 0, maximum: 10 }, comment: STR } } },
    strengths: { type: "array", items: STR }, improvements: { type: "array", items: STR },
    rewrites: { type: "array", items: { type: "object", required: ["original", "better", "why"], properties: { original: STR, better: STR, why: STR } } },
    best: { type: "object", required: ["message", "why"], properties: { message: STR, why: STR } },
    ethics_flag: { type: ["string", "null"], description: "null si rien à signaler, sinon la description du problème" } } } };
async function evaluate(sim, persona, stats) {
  const prompt = `Tu es responsable formation dans une agence qui gère des créatrices de contenu. Évalue la performance d'un chatter lors d'une simulation d'entraînement, en français. Cette note sert au recrutement : elle doit permettre de savoir si cette personne peut devenir chatter. Sois juste, concret et bienveillant, pas sévère : tu évalues un débutant, pas un expert.

BARÈME DE LA NOTE GLOBALE (respecte-le strictement) :
- 80 à 100 : excellent, à recruter sans hésiter. Lien naturel, vraie écoute, vente amenée au bon moment avec des prix cohérents.
- 70 à 79 : recrutable. Crée le lien, reste dans le personnage, tente au moins une vente cohérente ; quelques maladresses normales pour un débutant.
- 50 à 69 : à former. Des bases, mais des lacunes nettes : vente absente ou précipitée, messages génériques, peu d'écoute, personnage pas tenu.
- 0 à 49 : à écarter. Ne tient pas la conversation, messages incohérents ou hors personnage, agressivité, pression sur un fan fragile, fausse promesse, ou presque rien écrit.
Un chatter correct qui crée le lien et tente au moins une vente bien amenée mérite au moins 70, même si le fan n'achète pas.

NE FAIT PAS BAISSER LA NOTE : fautes d'orthographe légères, style familier, abréviations, messages courts (c'est normal sur une messagerie), surnoms affectueux, messages chauds ou osés, un fan qui refuse une vente pourtant bien amenée.
Un critère sans objet dans cette conversation (par exemple aucune objection du fan) reçoit 7, pas une note basse.
En difficulté « difficile », juge surtout la tenue de la conversation et le sang-froid, moins le chiffre d'affaires.
Session très courte (moins de 4 messages du chatter) : trop peu pour recruter, note globale de 55 au maximum, et dis-le dans le verdict.
La note globale reflète ta décision de recrutement ; elle n'est pas la moyenne stricte des critères.

PROFIL DU FAN SIMULÉ : ${persona.prompt}
OBJECTIF DE LA SESSION : ${persona.goal}
DIFFICULTÉ : ${sim.difficulty}
CRÉATRICE INCARNÉE : ${sim.creator_name} — style attendu : ${sim.creator_style}
GRILLE DE PRIX : ${sim.prices}

STATISTIQUES : revenu généré ${sim.revenue} € · PPV envoyés ${stats.ppvSent} · PPV achetés ${stats.ppvBought} · temps de réponse moyen ${stats.avgRt !== null ? stats.avgRt + " s" : "n/a"} · conseils du coach utilisés ${sim.hints} · fan parti : ${sim.left_conv ? "oui" : "non"} · intérêt final du fan ${sim.interest}/100.

CRITÈRES (note chacun sur 10) :
1. Accroche & création du lien
2. Personnalisation & écoute (questions, rebond sur ce que dit le fan)
3. Respect du personnage de la créatrice (ton, style d'écriture, cohérence)
4. Technique de vente (timing, construction de la valeur, teasing, prix cohérents)
5. Gestion des objections
6. Éthique & respect : pas de pression sur un fan vulnérable, respect d'un refus, aucune fausse promesse (rencontre réelle, exclusivité mensongère). Les messages chauds ou osés ne sont pas une faute. Une faute grave ici doit faire fortement baisser le score global.

N'applique PAS toi-même la pénalité des conseils : elle est calculée à part.

CONVERSATION :
${transcript(sim.log)}

RÉPONDS UNIQUEMENT EN JSON :
{"score": 0-100, "verdict": "une phrase de synthèse", "criteria": [{"name": "...", "score": 0-10, "comment": "1-2 phrases"}], "strengths": ["..."], "improvements": ["..."], "rewrites": [{"original": "message exact du chatter", "better": "version améliorée", "why": "courte raison"}], "best": {"message": "le message exact du chatter le plus réussi", "why": "pourquoi il fonctionne, en une phrase courte"}, "ethics_flag": null ou "description du problème"}
Donne 2 à 3 réécritures des messages les plus perfectibles (moins si le chatter a écrit très peu). Même si la conversation est très courte, évalue-la quand même et réponds en JSON. Dans les textes, utilise « » plutôt que des guillemets droits.`;
  if (MOCK) {
    return {
      score: 68, verdict: "Bonne prise de contact, vente un peu précipitée.",
      criteria: ["Accroche & lien", "Personnalisation & écoute", "Respect du personnage", "Technique de vente", "Gestion des objections", "Éthique & respect"]
        .map((n, i) => ({ name: n, score: [7, 6, 8, 6, 5, 9][i], comment: "Commentaire de test." })),
      strengths: ["Ton chaleureux"], improvements: ["Poser plus de questions avant de vendre"],
      rewrites: [{ original: sim.log.find(l => l.who === "chatter")?.text || "…", better: "Version améliorée de test", why: "Plus personnel" }],
      best: { message: sim.log.filter(l => l.who === "chatter").slice(-1)[0]?.text || "…", why: "Message de test : rebond personnel sur ce que dit le fan." },
      ethics_flag: null
    };
  }
  const tag = { sim: sim.id, user: sim.user_id, kind: "eval" };
  try {
    const res = await ask(prompt.replace("RÉPONDS UNIQUEMENT EN JSON :", "Donne ton évaluation avec l'outil « evaluation », en suivant cette structure :"), MODEL_EVAL, 6000, tag,
      { tools: [EVAL_TOOL], tool_choice: { type: "tool", name: "evaluation" } });
    const tu = res.content.find(c => c.type === "tool_use");
    if (tu && tu.input && typeof tu.input.score === "number" && Array.isArray(tu.input.criteria)) return tu.input;
    console.error("Évaluation par outil incomplète, passage au texte :", res.stop_reason);
  } catch (e) { if (e.status && e.status !== 400) throw e; console.error("Évaluation par outil échouée, passage au texte :", e.message); }
  return askJSON(prompt, MODEL_EVAL, 6000, tag);
}

/* ---------- Lecture d'une capture de vente (Twizz) ---------- */
const MODEL_VISION = process.env.MODEL_VISION || "claude-haiku-5-5";
const VISION_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const SALE_TOOL = { name: "lecture_capture", description: "Enregistre ce que montre la capture d'écran de vente.",
  input_schema: { type: "object", required: ["is_sale", "amount", "status", "notes"], properties: {
    is_sale: { type: "boolean", description: "true si la capture montre une conversation avec un média payant (PPV) envoyé à un fan" },
    amount: { type: ["number", "null"], description: "prix du média payant le plus récent, en euros, tel qu'affiché ; null si illisible" },
    status: { type: "string", enum: ["accepted", "pending", "refused", "unknown"], description: "état de ce média : accepted = acheté / « Accepté », pending = « En attente », refused = refusé / annulé" },
    other_amounts: { type: "array", items: { type: "number" }, description: "autres prix de médias payants visibles sur la capture, s'il y en a" },
    notes: { type: "string", description: "une phrase courte en français si quelque chose est ambigu, sinon chaîne vide" } } } };
const saleCanRead = mime => !MOCK ? VISION_MIME.includes(mime) : true;
async function readSale(buf, mime, tag) {
  if (MOCK) return { is_sale: true, amount: 25, status: "accepted", other_amounts: [], notes: "" };
  if (!VISION_MIME.includes(mime)) return null;
  const res = await ask([
    { type: "image", source: { type: "base64", media_type: mime, data: buf.toString("base64") } },
    { type: "text", text: "Capture d'écran d'une conversation sur la plateforme Twizz, envoyée par un chatter pour prouver une vente. Ne regarde que l'interface (bulles, prix, mentions d'état), pas le contenu des médias. Repère le média payant le plus récent : son prix en euros et son état (« Accepté » = vendu, « En attente », refusé). Réponds avec l'outil lecture_capture." }
  ], MODEL_VISION, 400, { ...(tag || {}), kind: "sale" }, { tools: [SALE_TOOL], tool_choice: { type: "tool", name: "lecture_capture" } });
  const tu = res.content.find(c => c.type === "tool_use");
  return tu && tu.input && typeof tu.input.is_sale === "boolean" ? tu.input : null;
}

/* ---------- Assistant des chatters (« Demande à StellADS ») ---------- */
async function assistant(system, history, tag) {
  if (MOCK) { const q = (history[history.length - 1] || {}).content || "";
    return /paie|gagn|commission/i.test(q) ? "Mode test : d'après tes chiffres, ta paie de la quinzaine est indiquée plus haut dans mes infos. [Réponse simulée]"
      : /sanction|point/i.test(q) ? "Mode test : tu peux voir tes points dans Ma paie. [Réponse simulée]"
      : "Mode test : voici une réponse simulée. En vrai, je réponds à partir des règles de l'agence et de tes chiffres. [Réponse simulée]"; }
  const res = await client.messages.create({ model: MODEL_HINT, max_tokens: 600, system, messages: history });
  try { if (usageHook && res.usage) usageHook({ ...(tag || {}), kind: "assistant" }, MODEL_HINT, res.usage); } catch (e) {}
  return res.content.filter(c => c.type === "text").map(c => c.text).join("").trim();
}

/* ---------- Candidatures : correction du test de chatting ---------- */
const APPLY_TOOL = { name: "note_candidat", description: "Enregistre la note du test de chatting d'un candidat.",
  input_schema: { type: "object", required: ["score", "criteres", "regles_ok", "verdict", "par_reponse"], properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    criteres: { type: "object", required: ["ecriture", "chaleur", "vente", "regles"], properties: {
      ecriture: { type: "integer", minimum: 0, maximum: 10 }, chaleur: { type: "integer", minimum: 0, maximum: 10 }, vente: { type: "integer", minimum: 0, maximum: 10 }, regles: { type: "integer", minimum: 0, maximum: 10 } } },
    regles_ok: { type: "boolean" }, style_ia: { type: "boolean" },
    verdict: { type: "string" }, points_forts: { type: "array", items: { type: "string" } }, a_ameliorer: { type: "array", items: { type: "string" } },
    par_reponse: { type: "array", items: { type: "object", required: ["id", "note", "commentaire"], properties: { id: { type: "string" }, note: { type: "integer", minimum: 0, maximum: 10 }, commentaire: { type: "string" } } } } } } };
async function gradeApplicant(items, tag) {
  if (MOCK) { const len = items.reduce((t, x) => t + x.text.length, 0), irl = items.find(x => x.id === "irl"), refuse = irl && !/(\b(oui|ok|avec plaisir|carr[ée]ment)\b|snap|insta|whats|num[ée]ro|appel)/i.test(irl.text);
    const sc = Math.max(20, Math.min(92, Math.round(35 + len / 9 + (refuse ? 15 : -20))));
    return { score: sc, criteres: { ecriture: 7, chaleur: Math.min(10, Math.round(len / 40)), vente: 6, regles: refuse ? 9 : 2 }, regles_ok: !!refuse, style_ia: false,
      verdict: refuse ? "Ton naturel, bonne gestion de la demande de rencontre." : "Accepte implicitement la rencontre en vrai : règle non respectée.", points_forts: ["Ton chaleureux"], a_ameliorer: ["Relancer avec une question"],
      par_reponse: items.map(x => ({ id: x.id, note: 6, commentaire: "Commentaire de test." })) }; }
  const conv = items.map((x, i) => `### Situation ${i + 1} (${x.id}) · ${x.who}\nObjectif évalué : ${x.goal}\nLe fan écrit :\n${x.fan.map(m => "« " + m + " »").join("\n")}\nRéponse du candidat${x.paste ? " (texte collé depuis ailleurs)" : ""}, écrite en ${Math.round((x.ms || 0) / 1000)} s :\n« ${x.text} »`).join("\n\n");
  const prompt = `Tu recrutes des chatters pour une agence française qui gère la messagerie de créatrices de contenu sur une plateforme d'abonnement (Twizz). Le chatter écrit aux fans à la place de la créatrice, à la première personne, pour créer du lien et vendre des contenus (photos, vidéos), sans contenu explicite.
Règles de l'agence, non négociables : jamais de rendez-vous fixé ni de rencontre promise, jamais d'appel ni d'échange de contacts perso (numéro, Snap, Insta, WhatsApp, adresse) ; jamais de fausse promotion ni de mensonge sur le contenu ; rester respectueux.

Comment l'agence gère une demande de rencontre : on ne casse pas le fan. Esquiver, temporiser, rester flou ou repousser avec légèreté est la BONNE méthode : « on verra plus tard », « pas tout de suite », « apprenons d'abord à nous connaître ici », « peut-être un jour, en attendant… », « je suis timide », changer de sujet avec une question ou ramener vers le contenu. Ces réponses respectent les règles (regles_ok = vrai) et sont bien notées. Un refus net mais gentil est aussi accepté. La règle n'est enfreinte QUE si le candidat accepte clairement (« oui », « avec plaisir », « samedi à 20 h »), fixe un lieu ou une date, demande ou donne un moyen de contact hors de la plateforme, ou propose un appel : là seulement regles = 0 à 2 et regles_ok = faux.

Note le test d'un candidat sur 3 situations. Ce sont des débutants qui postulent : juge leur instinct et leur ton, pas un niveau de professionnel. Des messages courts sont normaux dans un chat : une ou deux phrases naturelles et pertinentes suffisent pour une bonne note. Critères (0 à 10) :
- ecriture : clarté et ton naturel à l'écrit (style SMS, abréviations et émojis acceptés ; seules les fautes qui gênent la lecture comptent) ;
- chaleur : créer du lien, être sympa, personnaliser, relancer avec une question ;
- vente : face à l'objection prix, garder le fan sans brader ni mentir (valoriser le contenu, rassurer, faire une contre-proposition honnête, rester détendu : tout cela est bien) ;
- regles : la demande de rencontre, selon la méthode ci-dessus.
Barème : une réponse correcte et pertinente vaut 6 à 7, une bonne réponse 8 à 9, 10 si elle est vraiment excellente ; en dessous de 5 seulement si la réponse est à côté du sujet, vide, grossière ou enfreint une règle. Un candidat correct sur les 3 situations doit avoir au moins 60.
Score global sur 100 : pondère regles 30 %, chaleur 25 %, vente 25 %, ecriture 20 %. Si regles_ok est faux, le score ne dépasse pas 45.
style_ia = vrai seulement si les réponses ressemblent clairement à un texte généré ou copié (très long, structuré, impersonnel) ; une réponse simplement bien écrite n'est pas suspecte.
Sois juste et bienveillant. Commentaires courts et concrets, en français, sur un ton neutre.

${conv}`;
  const res = await ask(prompt, MODEL_HINT, 900, { ...(tag || {}), kind: "apply" }, { tools: [APPLY_TOOL], tool_choice: { type: "tool", name: "note_candidat" } });
  const tu = res.content.find(c => c.type === "tool_use"); if (!tu || typeof tu.input?.score !== "number") throw new Error("Note du candidat illisible");
  return tu.input;
}

module.exports = { fanTurn, hint, evaluate, transcript, MOCK, setUsageHook, readSale, saleCanRead, assistant, gradeApplicant };
