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
  for (const ch of t) {
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === "\\") { out += ch; esc = true; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") continue;
      if (ch === "\t") { out += " "; continue; }
      out += ch;
    } else { if (ch === '"') inStr = true; out += ch; }
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}
function extractJSON(text) {
  const clean = String(text || "").replace(/```(?:json)?/gi, "");
  const a = clean.indexOf("{"), b = clean.lastIndexOf("}");
  if (a === -1 || b === -1) throw new Error("Réponse IA sans JSON : " + clean.slice(0, 200));
  const raw = clean.slice(a, b + 1);
  try { return JSON.parse(raw); } catch (e) { return JSON.parse(repairJSON(raw)); }
}

// Appel à l'IA, avec nouvelles tentatives si elle est momentanément surchargée
async function ask(prompt, model, maxTokens, tag) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await client.messages.create({
        model, max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }]
      });
      if (res.stop_reason === "max_tokens") console.warn(`Réponse IA coupée (max_tokens=${maxTokens})`);
      try { if (usageHook && res.usage) usageHook(tag || {}, model, res.usage); } catch (e) {}
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
- Contenu : flirt léger et compliments permis, mais JAMAIS de contenu sexuel explicite. Si la créatrice devient explicite, reste vague ou change de sujet.
- Fais varier ton intérêt honnêtement : messages génériques, copier-coller, vente trop rapide, prix incohérents, incohérences de personnalité, excuses excessives → l'intérêt baisse. Écoute, questions sur toi, humour, personnalisation, rareté bien amenée → l'intérêt monte.
- Tu n'achètes jamais au-delà de ton budget restant.
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
  return askJSON(prompt, MODEL_FAN, 600, { sim: sim.id, user: sim.user_id, kind: "fan" });
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
async function evaluate(sim, persona, stats) {
  const prompt = `Tu es responsable formation dans une agence qui gère des créatrices de contenu. Évalue la performance d'un chatter lors d'une simulation d'entraînement. Sois exigeant, précis et constructif, en français.

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
6. Éthique & respect : pas de pression sur un fan vulnérable, respect d'un refus, aucune fausse promesse (rencontre réelle, exclusivité mensongère), aucun contenu explicite inutile. Une faute grave ici doit faire fortement baisser le score global.

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
  return askJSON(prompt, MODEL_EVAL, 3500, { sim: sim.id, user: sim.user_id, kind: "eval" });
}

module.exports = { fanTurn, hint, evaluate, transcript, MOCK, setUsageHook };
