// Candidatures : page publique /postuler (pubs de recrutement) et suivi côté manager
const crypto = require("crypto");

module.exports = function mount(app, db, auth, admin, ctx) {
  const { bcrypt, gest, ai } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS applications (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, first_name TEXT NOT NULL, age INTEGER NOT NULL,
    contact_type TEXT NOT NULL, contact TEXT NOT NULL, slots TEXT NOT NULL DEFAULT '[]', exp TEXT, motivation TEXT, test_reply TEXT,
    source TEXT, status TEXT NOT NULL DEFAULT 'new', user_id INTEGER, decided_at INTEGER, decided_by INTEGER, ip_hash TEXT, seen INTEGER NOT NULL DEFAULT 0)`);
  for (const [c, t] of [["test_answers", "TEXT"], ["ai_score", "INTEGER"], ["ai_detail", "TEXT"], ["ai_at", "INTEGER"], ["ai_err", "TEXT"], ["ai_tries", "INTEGER NOT NULL DEFAULT 0"]])
    if (!db.prepare("PRAGMA table_info(applications)").all().some(x => x.name === c)) db.exec(`ALTER TABLE applications ADD COLUMN ${c} ${t}`);
  // test de chatting : 3 situations de fans
  const SCEN = [
    { id: "new", who: "Thomas · nouvel abonné", goal: "Accroche et création de lien", fan: ["salut 😊 ça va ?", "je viens de m'abonner, tu fais quoi ce soir ?"] },
    { id: "price", who: "Kevin · abonné depuis 2 mois", goal: "Objection sur le prix", fan: ["ta vidéo à 25 € c'est abusé", "sur d'autres comptes c'est 10 € 😒"] },
    { id: "irl", who: "Marc · fan régulier", goal: "Gérer une demande de rencontre sans la promettre", fan: ["j'ai trop envie qu'on se voie en vrai", "je suis sur Lyon ce week-end, on prend un verre ? 🍸"] }];
  async function grade(id) {
    const r = db.prepare("SELECT * FROM applications WHERE id = ?").get(id); if (!r || !ai || !ai.gradeApplicant) return;
    const ans = J(r.test_answers) || []; if (!ans.length) return;
    db.prepare("UPDATE applications SET ai_tries = ai_tries + 1 WHERE id = ?").run(id);
    const items = SCEN.map(sc => { const a = ans.find(x => x.id === sc.id) || {}; return { ...sc, text: a.text || "", ms: a.ms || 0, paste: !!a.paste }; });
    try { const g = await ai.gradeApplicant(items, { app: id });
      db.prepare("UPDATE applications SET ai_score = ?, ai_detail = ?, ai_at = ?, ai_err = NULL WHERE id = ?").run(Math.max(0, Math.min(100, Math.round(g.score))), JSON.stringify(g), Date.now(), id);
    } catch (e) { db.prepare("UPDATE applications SET ai_err = ? WHERE id = ?").run(String(e.message || e).slice(0, 200), id); }
  }
  // nouveau barème (KYC = point fort, gestes commerciaux sur le prix acceptés, esquive douce de la rencontre) : on re-note une fois les candidatures des 60 derniers jours
  setTimeout(async () => { try {
    if (db.prepare("SELECT 1 FROM settings WHERE key = 'apply_grade_v3'").get()) return;
    db.prepare("INSERT INTO settings (key, value) VALUES ('apply_grade_v3', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    const ids = db.prepare("SELECT id FROM applications WHERE test_answers IS NOT NULL AND at > ? ORDER BY id DESC").all(Date.now() - 60 * 864e5).map(r => r.id);
    for (const id of ids) { await grade(id); await new Promise(r => setTimeout(r, 1500)); }
    if (ids.length) console.log(`Candidatures re-notées : ${ids.length}`);
  } catch (e) { console.error("re-notation", e.message); } }, 20e3);
  // candidatures restées sans note (redémarrage, IA indisponible) : on retente en arrière-plan
  setInterval(() => { try { db.prepare("SELECT id FROM applications WHERE test_answers IS NOT NULL AND ai_score IS NULL AND ai_tries < 3 AND at > ? ORDER BY id LIMIT 3").all(Date.now() - 7 * 864e5).forEach(r => grade(r.id)); } catch (e) {} }, 5 * 60e3);
  const J = s => { try { return JSON.parse(s || "null"); } catch (e) { return null; } };
  const slots = () => (gest.agency().slots || []).map(s => ({ id: s[0], start: s[1], end: s[2] }));
  const EXP = { chat: "Oui, déjà chatter", sales: "Vente ou service client", none: "Aucune expérience" };
  const CONTACT = { whatsapp: "WhatsApp", telegram: "Telegram", email: "E-mail" };

  // ---------- public ----------
  app.get("/api/apply/config", (req, res) => res.json({ slots: slots(), exp: EXP, contact: CONTACT, scenarios: SCEN.map(({ id, who, fan }) => ({ id, who, fan })) }));
  const hits = new Map();
  app.post("/api/apply", (req, res) => {
    const b = req.body || {}, ip = crypto.createHash("sha256").update(String(req.ip) + "stellads").digest("hex").slice(0, 16), now = Date.now();
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
    const ids = slots().map(s => s.id), sl = (Array.isArray(b.slots) ? b.slots : []).filter(x => ids.includes(x));
    if (!sl.length) return res.status(400).json({ error: "Choisis au moins un créneau" });
    if (!EXP[b.exp]) return res.status(400).json({ error: "Indique ton expérience" });
    const mot = String(b.motivation || "").trim().slice(0, 800);
    if (mot.length < 15) return res.status(400).json({ error: "Dis-nous en quelques mots pourquoi tu veux nous rejoindre" });
    const answers = SCEN.map(sc => { const a = (Array.isArray(b.answers) ? b.answers : []).find(x => x && x.id === sc.id) || {};
      return { id: sc.id, text: String(a.text || "").trim().slice(0, 600), ms: Math.max(0, Math.min(36e5, Math.round(Number(a.ms) || 0))), paste: !!a.paste }; });
    if (answers.some(a => a.text.length < 5)) return res.status(400).json({ error: "Réponds aux 3 messages du test de chatting" });
    const test = answers[0].text;
    if (!b.consent) return res.status(400).json({ error: "Coche la case d'accord pour envoyer ta candidature" });
    const src = String(b.source || "").toLowerCase().replace(/[^\w\-]/g, "").slice(0, 30) || null;
    const newId = db.prepare("INSERT INTO applications (at, first_name, age, contact_type, contact, slots, exp, motivation, test_reply, test_answers, source, ip_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(now, name, age, ct, contact, JSON.stringify(sl), b.exp, mot, test, JSON.stringify(answers), src, ip).lastInsertRowid;
    try { if (b.ref && ctx.referrals) ctx.referrals.attach(newId, b.ref); } catch (e) {}   // parrainage
    setTimeout(() => grade(newId), 50);   // correction par l'IA en arrière-plan : ne ralentit pas l'envoi
    h.push(now); hits.set(ip, h);
    gest.log(null, "a", `Nouvelle candidature de **${name}**`, `${age} ans · ${CONTACT[ct]}${src ? " · pub : " + src : ""}`);
    res.json({ ok: true });
  });

  // ---------- manager ----------
  const view = r => { const dup = db.prepare("SELECT COUNT(*) n FROM applications WHERE contact = ? AND id <> ?").get(r.contact, r.id).n;
    const u = r.user_id ? db.prepare("SELECT username, role, active FROM users WHERE id = ?").get(r.user_id) : null;
    return { id: r.id, at: r.at, firstName: r.first_name, age: r.age, contactType: r.contact_type, contactLabel: CONTACT[r.contact_type], contact: r.contact,
      slots: J(r.slots) || [], exp: r.exp, expLabel: EXP[r.exp], motivation: r.motivation, testReply: r.test_reply, source: r.source, status: r.status,
      decidedAt: r.decided_at, user: u, seen: !!r.seen, dup,
      test: (J(r.test_answers) || []).map(a => { const sc = SCEN.find(x => x.id === a.id) || {}; return { ...a, who: sc.who, fan: sc.fan, goal: sc.goal }; }),
      score: r.ai_score, grade: J(r.ai_detail), gradePending: !!r.test_answers && r.ai_score == null && !r.ai_err, gradeErr: r.ai_err }; };
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
