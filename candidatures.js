// Candidatures : page publique /postuler (pubs de recrutement) et suivi côté manager
const crypto = require("crypto");

module.exports = function mount(app, db, auth, admin, ctx) {
  const { bcrypt, gest, ai } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS applications (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, first_name TEXT NOT NULL, age INTEGER NOT NULL,
    contact_type TEXT NOT NULL, contact TEXT NOT NULL, slots TEXT NOT NULL DEFAULT '[]', exp TEXT, motivation TEXT, test_reply TEXT,
    source TEXT, status TEXT NOT NULL DEFAULT 'new', user_id INTEGER, decided_at INTEGER, decided_by INTEGER, ip_hash TEXT, seen INTEGER NOT NULL DEFAULT 0)`);
  for (const [c, t] of [["quiz", "TEXT"], ["pub_token", "TEXT"], ["test_answers", "TEXT"], ["ai_score", "INTEGER"], ["ai_detail", "TEXT"], ["ai_at", "INTEGER"], ["ai_err", "TEXT"], ["ai_tries", "INTEGER NOT NULL DEFAULT 0"]])
    if (!db.prepare("PRAGMA table_info(applications)").all().some(x => x.name === c)) db.exec(`ALTER TABLE applications ADD COLUMN ${c} ${t}`);
  // test de chatting : 3 situations de fans
  const SCEN = [
    { id: "new", who: "Thomas · nouvel abonné", goal: "Accroche et création de lien", fan: ["salut 😊 ça va ?", "je viens de m'abonner, tu fais quoi ce soir ?"] },
    { id: "price", who: "Kevin · abonné depuis 2 mois", goal: "Objection sur le prix", fan: ["ta vidéo à 25 € c'est abusé", "sur d'autres comptes c'est 10 € 😒"] },
    { id: "irl", who: "Marc · fan régulier", goal: "Gérer une demande de rencontre sans la promettre", fan: ["j'ai trop envie qu'on se voie en vrai", "je suis sur Lyon ce week-end, on prend un verre ? 🍸"] }];
  // nouveau test : 4 questions de chatting (choix multiples, corrigées ici) puis une seule mise en situation écrite
  const LIVE = ["price"];
  const QUIZ = [
    { id: "q_hello", crit: "chaleur", q: "Un nouvel abonné t'écrit « salut, ça va ? ». Que réponds-tu ?",
      opts: ["« ça va et toi »", "« Coucou toi 😏 ça va super, contente que tu sois là ! Tu t'appelles comment ? »", "Tu lui envoies tout de suite une vidéo payante", "Tu attends qu'il t'écrive autre chose"], ok: 1 },
    { id: "q_kyc", crit: "chaleur", q: "Pourquoi demander son prénom et son âge à un nouvel abonné ?",
      opts: ["Pour remplir un formulaire", "Ça ne sert à rien, il vaut mieux vendre tout de suite", "Pour personnaliser la conversation et vérifier qu'il est majeur", "Pour le mettre mal à l'aise"], ok: 2 },
    { id: "q_ppv", crit: "vente", q: "Quel est le meilleur moment pour proposer un contenu payant ?",
      opts: ["Dès le premier message", "Quand la conversation est lancée et que le fan est réceptif", "Jamais, on attend qu'il demande", "Toutes les deux minutes, pour être sûr"], ok: 1 },
    { id: "q_irl", crit: "regles", q: "Un fan te propose de vous voir en vrai ce week-end. Que fais-tu ?",
      opts: ["Tu acceptes pour le garder", "Tu lui donnes ton Snap pour en parler ailleurs", "Tu montres que l'idée te plaît mais tu ramènes la discussion ici, sans rien promettre", "Tu le bloques"], ok: 2 }];
  const quizOf = r => { const q = J(r.quiz); if (!Array.isArray(q)) return null;
    const items = QUIZ.map(x => { const a = q.find(y => y && y.id === x.id) || {}; return { id: x.id, q: x.q, crit: x.crit, choice: a.choice ?? null, answer: x.opts[a.choice] ?? null, good: x.opts[x.ok], ok: a.choice === x.ok }; });
    return { items, correct: items.filter(x => x.ok).length, total: items.length }; };
  async function grade(id) {
    const r = db.prepare("SELECT * FROM applications WHERE id = ?").get(id); if (!r || !ai || !ai.gradeApplicant) return;
    const ans = J(r.test_answers) || []; if (!ans.length) return;
    db.prepare("UPDATE applications SET ai_tries = ai_tries + 1 WHERE id = ?").run(id);
    const items = SCEN.filter(sc => ans.some(x => x.id === sc.id)).map(sc => { const a = ans.find(x => x.id === sc.id) || {}; return { ...sc, text: a.text || "", ms: a.ms || 0, paste: !!a.paste }; });
    try { const g = await ai.gradeApplicant(items, { app: id });
      // questions de chatting : elles comptent pour 40 % du score ; la question sur la rencontre décide du critère « règles »
      const qz = quizOf(r);
      if (qz) { const pct = qz.correct / qz.total * 100, irl = qz.items.find(x => x.id === "q_irl");
        g.quiz = qz; g.score_ia = g.score; g.score = Math.round(g.score * .6 + pct * .4);
        g.criteres = g.criteres || {}; if (irl) { g.criteres.regles = irl.ok ? Math.max(8, g.criteres.regles || 0) : Math.min(2, g.criteres.regles ?? 2); if (!irl.ok) { g.regles_ok = false; g.score = Math.min(g.score, 45); } }
        if (qz.correct < qz.total) (g.a_ameliorer = g.a_ameliorer || []).push(`Questions : ${qz.correct}/${qz.total} bonnes réponses`); }
      db.prepare("UPDATE applications SET ai_score = ?, ai_detail = ?, ai_at = ?, ai_err = NULL WHERE id = ?").run(Math.max(0, Math.min(100, Math.round(g.score))), JSON.stringify(g), Date.now(), id);
    } catch (e) { console.error("correction candidature", id, e.message || e);
      // une re-correction ratée ne fait pas disparaître la note d'avant
      if (!r.ai_detail) db.prepare("UPDATE applications SET ai_err = ? WHERE id = ?").run(String(e.message || e).slice(0, 200), id); }
  }
  // nouveau barème (KYC = point fort, gestes commerciaux sur le prix acceptés, esquive douce de la rencontre) : on re-note une fois les candidatures des 60 derniers jours
  setTimeout(async () => { try {
    if (db.prepare("SELECT 1 FROM settings WHERE key = 'apply_grade_v3'").get()) return;
    db.prepare("INSERT INTO settings (key, value) VALUES ('apply_grade_v3', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    const ids = db.prepare("SELECT id FROM applications WHERE test_answers IS NOT NULL AND at > ? ORDER BY id DESC").all(Date.now() - 60 * 864e5).map(r => r.id);
    for (const id of ids) { await grade(id); await new Promise(r => setTimeout(r, 1500)); }
    if (ids.length) console.log(`Candidatures re-notées : ${ids.length}`);
  } catch (e) { console.error("re-notation", e.message); } }, 20e3);
  // rattrapage : les candidatures dont la correction a échoué ou manque (60 derniers jours) sont corrigées à nouveau, une fois
  setTimeout(async () => { try {
    if (db.prepare("SELECT 1 FROM settings WHERE key = 'apply_grade_fix1'").get()) return;
    db.prepare("INSERT INTO settings (key, value) VALUES ('apply_grade_fix1', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    const ids = db.prepare("SELECT id FROM applications WHERE test_answers IS NOT NULL AND (ai_detail IS NULL OR ai_err IS NOT NULL) AND at > ? ORDER BY id DESC").all(Date.now() - 60 * 864e5).map(r => r.id);
    for (const id of ids) { db.prepare("UPDATE applications SET ai_err = NULL, ai_tries = 0 WHERE id = ?").run(id); await grade(id); await new Promise(r => setTimeout(r, 1500)); }
    if (ids.length) console.log(`Candidatures corrigées à nouveau : ${ids.length}`);
  } catch (e) { console.error("rattrapage corrections", e.message); } }, 45e3);
  // candidatures restées sans note (redémarrage, IA indisponible) : on retente en arrière-plan
  setInterval(() => { try { db.prepare("SELECT id FROM applications WHERE test_answers IS NOT NULL AND ai_score IS NULL AND ai_tries < 3 AND at > ? ORDER BY id LIMIT 3").all(Date.now() - 7 * 864e5).forEach(r => grade(r.id)); } catch (e) {} }, 5 * 60e3);
  const J = s => { try { return JSON.parse(s || "null"); } catch (e) { return null; } };
  const slots = () => (gest.agency().slots || []).map(s => ({ id: s[0], start: s[1], end: s[2] }));
  const EXP = { chat: "Oui, déjà chatter", sales: "Vente ou service client", none: "Aucune expérience" };
  const CONTACT = { whatsapp: "WhatsApp", telegram: "Telegram", email: "E-mail" };

  // ---------- un seul essai par mois : même adresse IP ou même contact (WhatsApp / Telegram / e-mail) ----------
  const COOL = 30 * 864e5;
  // vraie adresse du visiteur : derrière l'hébergeur (et un éventuel Cloudflare), req.ip peut être celle du proxy, la même pour tout le monde
  const clientIp = req => String(req.headers["cf-connecting-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "");
  const ipOf = req => crypto.createHash("sha256").update(clientIp(req) + "stellads").digest("hex").slice(0, 16);
  const normC = (ct, c) => { c = String(c || "").trim().toLowerCase(); return ct === "whatsapp" ? c.replace(/\D/g, "").slice(-9) : ct === "telegram" ? c.replace(/^@?/, "@").replace(/\s/g, "") : c; };
  // les comptes de l'équipe (connectés) peuvent repasser le test autant qu'ils veulent pour le vérifier
  const isStaff = req => { try { const t = req.cookies && req.cookies.tok; if (!t) return false;
    const u = db.prepare("SELECT u.role, u.active, t.expires_at FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ?").get(t);
    return !!(u && u.active && u.role === "admin" && u.expires_at > Date.now()); } catch (e) { return false; } };
  // renvoie la date à partir de laquelle on peut retenter, ou null si rien ne bloque
  const blockOf = (req, ct, contact) => { if (isStaff(req)) return null;
    const ip = ipOf(req), n = ct && contact ? normC(ct, contact) : null;
    const rows = db.prepare("SELECT at, ip_hash, contact_type, contact FROM applications WHERE at > ? ORDER BY at DESC").all(Date.now() - COOL);
    // adresse partagée (wifi commun, opérateur, proxy) : 3 contacts différents ou plus → on ne bloque plus sur l'adresse, seulement sur le contact
    const sameIp = rows.filter(r => r.ip_hash === ip), shared = new Set(sameIp.map(r => r.contact_type + ":" + normC(r.contact_type, r.contact))).size >= 3;
    const hit = rows.find(r => (!shared && r.ip_hash === ip) || (n && n.length >= 4 && r.contact_type === ct && normC(ct, r.contact) === n));
    return hit ? hit.at + COOL : null; };
  const frDate = t => new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" });

  // ---------- public ----------
  app.get("/api/apply/config", (req, res) => res.json({ slots: slots(), exp: EXP, contact: CONTACT, scenarios: SCEN.filter(sc => LIVE.includes(sc.id)).map(({ id, who, fan }) => ({ id, who, fan })),
    quiz: QUIZ.map(({ id, q, opts }) => ({ id, q, opts })), blocked: blockOf(req) }));
  // vérifié dès la 1re étape : inutile de faire tout le test pour être bloqué à la fin
  app.get("/api/apply/check", (req, res) => { const ct = CONTACT[req.query.type] ? req.query.type : null;
    res.json({ blocked: blockOf(req, ct, String(req.query.contact || "").slice(0, 80)) }); });
  // résultat du test : le WhatsApp du manager n'est donné que si le score atteint le seuil choisi dans les Réglages
  const unlockOf = r => { const ag = gest.agency() || {}, wa = String(ag.applyWhatsapp || "").replace(/[^\d]/g, ""), min = Number.isFinite(+ag.applyUnlock) && ag.applyUnlock !== "" && ag.applyUnlock != null ? +ag.applyUnlock : 70;
    const g = J(r.ai_detail) || {};   // une faute sur la règle de la rencontre ne débloque jamais le contact
    return wa.length >= 9 && r.ai_score != null && r.ai_score >= min && g.regles_ok !== false ? { score: r.ai_score, whatsapp: "+" + wa, link: `https://wa.me/${wa}?text=${encodeURIComponent(`Bonjour, je suis ${r.first_name}, je viens de réussir le test de chatting StellADS 🙂`)}` } : null; };
  app.get("/api/apply/result/:token", (req, res) => {
    const t = String(req.params.token || ""); if (!/^[a-f0-9]{24}$/.test(t)) return res.status(404).json({ error: "Introuvable" });
    const r = db.prepare("SELECT * FROM applications WHERE pub_token = ?").get(t); if (!r || Date.now() - r.at > 3600e3) return res.status(404).json({ error: "Introuvable" });
    if (r.ai_score == null && !r.ai_err && Date.now() - r.at < 120e3) return res.json({ state: "pending" });
    const ag = gest.agency() || {}, min = ag.applyUnlock != null && ag.applyUnlock !== "" && Number.isFinite(+ag.applyUnlock) ? +ag.applyUnlock : 70, g = J(r.ai_detail) || {};
    // passed : test réussi (même si le WhatsApp n'est pas encore renseigné) · graded : la correction a pu se faire
    // score + seuil renvoyés aussi en cas de refus : l'écran « Presque » affiche la jauge et l'écart au seuil
    const graded = r.ai_score != null;
    res.json({ state: "done", unlock: unlockOf(r), graded, passed: graded && r.ai_score >= min && g.regles_ok !== false,
      score: graded ? Math.round(r.ai_score) : null, min: graded ? +min : null, rule: graded && g.regles_ok === false }); });
  const hits = new Map();
  app.post("/api/apply", (req, res) => {
    const b = req.body || {}, ip = ipOf(req), now = Date.now();
    // anti-robots : champ piège, formulaire rempli trop vite, trop d'envois depuis la même adresse
    if (b.website) return res.json({ ok: true });
    if (!(Number(b.t) > 6000)) return res.status(400).json({ error: "Prends le temps de remplir le formulaire 🙂" });
    const h = (hits.get(ip) || []).filter(x => now - x < 3600e3); if (h.length >= 5) return res.status(429).json({ error: "Trop d'envois. Réessaie dans une heure." });
    const name = String(b.firstName || "").trim().replace(/\s+/g, " ").slice(0, 40), age = parseInt(b.age, 10);
    const ct = CONTACT[b.contactType] ? b.contactType : null; let contact = String(b.contact || "").trim().slice(0, 80);
    if (name.length < 2) return res.status(400).json({ error: "Indique ton prénom" });
    if (!(age >= 18 && age <= 80)) return res.status(400).json({ error: "Il faut avoir 18 ans ou plus pour postuler" });
    if (!ct) return res.status(400).json({ error: "Choisis comment te contacter" });
    if (ct === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact)) return res.status(400).json({ error: "Adresse e-mail invalide" });
    if (ct === "whatsapp") { contact = contact.replace(/[^\d+]/g, ""); if (contact.replace(/\D/g, "").length < 9) return res.status(400).json({ error: "Numéro WhatsApp invalide" }); }
    if (ct === "telegram") { contact = contact.replace(/^@?/, "@").replace(/\s/g, ""); if (!/^@[\w]{4,32}$/.test(contact)) return res.status(400).json({ error: "Pseudo Telegram invalide (ex. @prenom)" }); }
    const until = blockOf(req, ct, contact);
    if (until) return res.status(429).json({ error: `Tu as déjà passé le test récemment. Tu pourras retenter ta chance à partir du ${frDate(until)}.`, until });
    const ids = slots().map(s => s.id), sl = (Array.isArray(b.slots) ? b.slots : []).filter(x => ids.includes(x));
    if (!sl.length) return res.status(400).json({ error: "Choisis au moins un créneau" });
    if (!EXP[b.exp]) return res.status(400).json({ error: "Indique ton expérience" });
    const mot = String(b.motivation || "").trim().slice(0, 800);
    if (mot.length < 15) return res.status(400).json({ error: "Dis-nous en quelques mots pourquoi tu veux nous rejoindre" });
    const answers = SCEN.filter(sc => LIVE.includes(sc.id)).map(sc => { const a = (Array.isArray(b.answers) ? b.answers : []).find(x => x && x.id === sc.id) || {};
      return { id: sc.id, text: String(a.text || "").trim().slice(0, 600), ms: Math.max(0, Math.min(36e5, Math.round(Number(a.ms) || 0))), paste: !!a.paste }; });
    if (answers.some(a => a.text.length < 5)) return res.status(400).json({ error: "Réponds au fan du test de chatting" });
    const quiz = QUIZ.map(x => { const a = (Array.isArray(b.quiz) ? b.quiz : []).find(y => y && y.id === x.id) || {}; const c = Number.isInteger(a.choice) && a.choice >= 0 && a.choice < x.opts.length ? a.choice : null; return { id: x.id, choice: c }; });
    if (quiz.some(x => x.choice === null)) return res.status(400).json({ error: "Réponds aux questions du test de chatting" });
    const tok = crypto.randomBytes(12).toString("hex");
    const test = answers[0].text;
    if (!b.consent) return res.status(400).json({ error: "Coche la case d'accord pour envoyer ta candidature" });
    const src = String(b.source || "").toLowerCase().replace(/[^\w\-]/g, "").slice(0, 30) || null;
    const newId = db.prepare("INSERT INTO applications (at, first_name, age, contact_type, contact, slots, exp, motivation, test_reply, test_answers, quiz, pub_token, source, ip_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(now, name, age, ct, contact, JSON.stringify(sl), b.exp, mot, test, JSON.stringify(answers), JSON.stringify(quiz), tok, src, ip).lastInsertRowid;
    try { if (b.ref && ctx.referrals) ctx.referrals.attach(newId, b.ref); } catch (e) {}   // parrainage
    setTimeout(() => grade(newId), 50);   // correction par l'IA en arrière-plan : ne ralentit pas l'envoi
    h.push(now); hits.set(ip, h);
    gest.log(null, "a", `Nouvelle candidature de **${name}**`, `${age} ans · ${CONTACT[ct]}${src ? " · pub : " + src : ""}`);
    res.json({ ok: true, token: tok });
  });

  // ---------- manager ----------
  const view = r => { const dup = db.prepare("SELECT COUNT(*) n FROM applications WHERE contact = ? AND id <> ?").get(r.contact, r.id).n;
    const u = r.user_id ? db.prepare("SELECT username, role, active FROM users WHERE id = ?").get(r.user_id) : null;
    // parrainage : le chatter qui a envoyé son lien
    const rf = r.ref_user ? db.prepare("SELECT username, display_name FROM users WHERE id = ?").get(r.ref_user) : null;
    return { id: r.id, at: r.at, firstName: r.first_name, age: r.age, contactType: r.contact_type, contactLabel: CONTACT[r.contact_type], contact: r.contact,
      slots: J(r.slots) || [], exp: r.exp, expLabel: EXP[r.exp], motivation: r.motivation, testReply: r.test_reply, source: r.source, status: r.status,
      decidedAt: r.decided_at, user: u, seen: !!r.seen, dup, refBy: rf ? (rf.display_name || rf.username) : null,
      test: (J(r.test_answers) || []).map(a => { const sc = SCEN.find(x => x.id === a.id) || {}; return { ...a, who: sc.who, fan: sc.fan, goal: sc.goal }; }),
      quiz: quizOf(r), score: r.ai_score, grade: J(r.ai_detail), gradePending: !!r.test_answers && r.ai_score == null && !r.ai_err, gradeErr: r.ai_err }; };
  app.get("/api/admin/applications", auth, admin, (req, res) => {
    const rows = db.prepare("SELECT * FROM applications ORDER BY (status = 'new') DESC, at DESC LIMIT 300").all().map(view);
    const since = Date.now() - 30 * 864e5, src = {};
    db.prepare("SELECT source, status FROM applications WHERE at > ?").all(since).forEach(r => { const k = r.source || "direct"; src[k] = src[k] || { n: 0, hired: 0 }; src[k].n++; if (r.status === "accepted") src[k].hired++; });
    res.json({ items: rows, counts: { new: rows.filter(r => r.status === "new").length, accepted: rows.filter(r => r.status === "accepted").length, refused: rows.filter(r => r.status === "refused").length },
      sources: Object.entries(src).map(([k, v]) => ({ source: k, ...v })).sort((a, b) => b.n - a.n), link: "/postuler" });
  });
  app.post("/api/admin/applications/:id/regrade", auth, admin, async (req, res) => {
    const id = parseInt(req.params.id, 10); db.prepare("UPDATE applications SET ai_err = NULL, ai_score = NULL, ai_tries = 0 WHERE id = ?").run(id); await grade(id);
    const r = db.prepare("SELECT * FROM applications WHERE id = ?").get(id); if (!r) return res.status(404).json({ error: "Introuvable" }); res.json({ ok: true, item: view(r) });
  });
  app.get("/api/admin/applications/count", auth, admin, (req, res) => res.json({ new: db.prepare("SELECT COUNT(*) n FROM applications WHERE status = 'new'").get().n }));
  app.post("/api/admin/applications/:id/seen", auth, admin, (req, res) => { db.prepare("UPDATE applications SET seen = 1 WHERE id = ?").run(parseInt(req.params.id, 10)); res.json({ ok: true }); });
  // créer le compte élève de la personne (identifiant tiré du prénom, mot de passe généré)
  const WORDS = ["lune", "rose", "nova", "ciel", "jade", "opal", "vega", "luna", "zest", "miel", "aube", "iris", "sable", "perle"];
  const pick = a => a[crypto.randomInt(a.length)];
  app.post("/api/admin/applications/:id/accept", auth, admin, (req, res) => {
    const r = db.prepare("SELECT * FROM applications WHERE id = ?").get(parseInt(req.params.id, 10)); if (!r) return res.status(404).json({ error: "Introuvable" });
    if (r.status === "accepted" && r.user_id) return res.status(400).json({ error: "Son compte est déjà créé" });
    let base = r.first_name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20); if (base.length < 3) base = (base + "chat").slice(0, 8);
    let username = base, n = 1; while (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) username = base + (++n);
    const password = `${pick(WORDS)}-${pick(WORDS)}-${10 + crypto.randomInt(89)}`, now = Date.now();
    const uid = db.prepare("INSERT INTO users (username, pass_hash, role, created_at) VALUES (?,?,?,?)").run(username, bcrypt.hashSync(password, 10), "trainee", now).lastInsertRowid;
    db.prepare("UPDATE applications SET status = 'accepted', user_id = ?, decided_at = ?, decided_by = ?, seen = 1 WHERE id = ?").run(uid, now, req.user.id, r.id);
    gest.log(req.user.id, "a", `a accepté la candidature de **${r.first_name}** · compte élève **${username}** créé`, r.source ? "pub : " + r.source : "Candidature");
    res.json({ ok: true, username, password, item: view(db.prepare("SELECT * FROM applications WHERE id = ?").get(r.id)) });
  });
  app.post("/api/admin/applications/:id/refuse", auth, admin, (req, res) => {
    const r = db.prepare("SELECT * FROM applications WHERE id = ?").get(parseInt(req.params.id, 10)); if (!r) return res.status(404).json({ error: "Introuvable" });
    db.prepare("UPDATE applications SET status = 'refused', decided_at = ?, decided_by = ?, seen = 1 WHERE id = ?").run(Date.now(), req.user.id, r.id);
    gest.log(req.user.id, "a", `a refusé la candidature de **${r.first_name}**`, "Candidature");
    res.json({ ok: true });
  });
  app.post("/api/admin/applications/:id/reopen", auth, admin, (req, res) => {
    db.prepare("UPDATE applications SET status = 'new', decided_at = NULL WHERE id = ? AND user_id IS NULL").run(parseInt(req.params.id, 10)); res.json({ ok: true });
  });
  // suppression définitive (données personnelles)
  app.delete("/api/admin/applications/:id", auth, admin, (req, res) => {
    db.prepare("DELETE FROM applications WHERE id = ?").run(parseInt(req.params.id, 10)); res.json({ ok: true });
  });
};
