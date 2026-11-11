// Assistant des chatters (« Demande à StellADS »), Wrapped du mois, team leaders
module.exports = function mount(app, db, auth, admin, ctx) {
  const { compta, planning, gest, ai } = ctx;
  const eur = n => (Math.round((n || 0) * 100) / 100).toLocaleString("fr-FR") + " €";
  const day = ms => new Date(ms).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });
  db.exec(`CREATE TABLE IF NOT EXISTS team_leads (recruit_id INTEGER PRIMARY KEY, leader_id INTEGER NOT NULL, since INTEGER NOT NULL, goal_at INTEGER, prime REAL);
    CREATE TABLE IF NOT EXISTS team_tips (id INTEGER PRIMARY KEY, recruit_id INTEGER NOT NULL, leader_id INTEGER NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS assistant_log (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, at INTEGER NOT NULL, q TEXT, a TEXT, escalated INTEGER NOT NULL DEFAULT 0);`);
  const user = id => db.prepare("SELECT id, username, role, active, created_at FROM users WHERE id = ?").get(id);

  /* =================== ASSISTANT =================== */
  const FAQ = `FONCTIONNEMENT DE L'AGENCE STELLADS (site stellads.fr)
- Déclarer une vente : quand le média payant passe de « En attente » à « Accepté » sur Twizz, le chatter prend une capture d'écran et la dépose dans Ventes → « Déclarer une vente », avec le montant brut et la créatrice. L'IA du site lit la capture et pré-remplit le montant. Le manager valide ou refuse ensuite. Ne jamais déclarer deux fois la même vente (refus « Doublon » = point de sanction). Ne pas déclarer un média encore « En attente ».
- Pointer : sur l'Accueil ou le Planning, glisser « pour commencer » en choisissant la créatrice ; en fin de shift, bouton « Terminer ». Au moment de terminer, une fenêtre de passation permet de noter les fans à suivre pour le chatter suivant (ou « Rien à signaler »).
- Passation : en arrivant sur une créatrice, le chatter voit sur son Accueil la passation du chatter précédent et coche les fans dont il s'est occupé. Un fan prioritaire non suivi est signalé au manager.
- Planning : les shifts de la semaine sont dans Planning. On peut y proposer un échange de shift et demander un renfort.
- Paie : calculée par quinzaine (du 1 au 15, puis du 16 à la fin du mois), sur les ventes nettes (ventes brutes moins la commission de la plateforme). Le taux de commission dépend de paliers ; certains paliers donnent une prime. Tout est visible dans « Ma paie ».
- Sanctions : des points sont donnés selon le barème ; ils comptent sur une fenêtre glissante. Avertissement puis suspension des shifts au-delà d'un seuil. Le chatter peut donner son explication sur une sanction depuis sa page.
- Simulateur (Simu Chatter) : entraînement face à des fans simulés par l'IA, avec une évaluation. Le manager peut assigner des entraînements.
- Éthique : ne jamais promettre de rencontre réelle ni d'exclusivité mensongère, ne jamais mettre la pression sur un fan fragile, respecter un refus.
- Pour une question que l'assistant ne peut pas régler : le bouton « Transmettre au manager » prévient l'équipe.`;
  function context(uid) {
    const u = user(uid), A = gest.agency(), now = Date.now(), lines = [];
    lines.push(`CHATTER : ${u.username} (${u.role === "trainee" ? "en formation" : "chatter"}). Nous sommes le ${day(now)}, ${new Date(now).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })}.`);
    lines.push(`PALIERS DE COMMISSION (ventes nettes de la quinzaine) : ${A.tiers.map(t => `dès ${t.from} € : ${t.rate} %${t.prime ? ` + prime ${t.prime} €` : ""}`).join(" ; ")}. Commission de la plateforme : ${A.fee} %.`);
    lines.push(`BARÈME DES SANCTIONS : ${A.rules.map(r => `${r.label} → ${r.points || 0} pt${r.amount ? ` et ${r.amount} € d'amende` : ""}${r.kind === "prime" ? " et perte de la prime" : ""}`).join(" ; ")}. Avertissement à ${A.thresholds.warnAt} points, suspension de ${A.thresholds.suspendDays} jours à ${A.thresholds.suspendAt} points, points comptés sur ${A.thresholds.windowDays} jours. Retard toléré : ${A.tolerance} min.`);
    lines.push(`CRÉNEAUX DU PLANNING : ${A.slots.map(s => `${s[0]} (${s[1]}–${s[2]})`).join(", ")}.`);
    try { const p = compta.periodInfo(compta.periodOfDate(compta.parisDate(now))), c = compta.computeCompta(p.key), me = c.chatters.find(x => x.id === uid);
      if (me) lines.push(`SA PAIE, quinzaine ${p.label} : ventes nettes ${eur(me.sales)} (${me.salesCount} ventes validées), taux ${me.rate} %, commission ${eur(me.commission)}, primes ${eur(me.prime)}, ajustements ${eur(me.adjTotal)}, total estimé ${eur(me.pay)}.`); const nx = A.tiers.find(t => t.from > me.sales); if (nx) lines.push(`PROCHAIN PALIER : ${nx.rate} %${nx.prime ? ` + prime ${nx.prime} €` : ""} à partir de ${nx.from} € de ventes nettes, il lui manque ${eur(nx.from - me.sales)}.`); } catch (e) {}
    const st = db.prepare("SELECT status, COUNT(*) n, COALESCE(SUM(amount),0) s FROM sales WHERE user_id = ? AND created_at > ? GROUP BY status").all(uid, now - 15 * 864e5);
    if (st.length) lines.push(`SES VENTES DES 15 DERNIERS JOURS : ${st.map(r => `${r.n} ${r.status === "pending" ? "en attente" : r.status === "validated" ? "validées" : "refusées"} (${eur(r.s)})`).join(", ")}.`);
    const ref = db.prepare("SELECT amount, reason, reviewed_at FROM sales WHERE user_id = ? AND status = 'refused' ORDER BY reviewed_at DESC LIMIT 3").all(uid);
    if (ref.length) lines.push(`SES DERNIÈRES VENTES REFUSÉES : ${ref.map(r => `${eur(r.amount)} (${r.reason || "sans motif"})`).join(" ; ")}.`);
    try { const w = A.thresholds.windowDays * 864e5, pts = db.prepare("SELECT COALESCE(SUM(points),0) p FROM sanctions WHERE user_id = ? AND status = 'active' AND created_at > ?").get(uid, now - w).p;
      const last = db.prepare("SELECT COALESCE(detail, label) detail, points, created_at FROM sanctions WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 3").all(uid);
      lines.push(`SES POINTS DE SANCTION ACTUELS : ${pts}.${last.length ? " Dernières : " + last.map(l => `${l.detail || "sanction"} (${l.points} pt, ${day(l.created_at)})`).join(" ; ") : ""}`); } catch (e) {}
    try { const today = new Date(now - 864e5).toISOString().slice(0, 10);
      const sh = planning.decorate(db.prepare(`${planning.SHIFT_SQL} WHERE s.user_id = ? AND s.date >= ? ORDER BY s.date, s.start LIMIT 8`).all(uid, today)).filter(s => s.end_ms > now).slice(0, 4);
      lines.push(sh.length ? `SES PROCHAINS SHIFTS : ${sh.map(s => `${day(s.start_ms)} ${s.start}–${s.end} sur ${s.model_name}`).join(" ; ")}.` : "SES PROCHAINS SHIFTS : aucun shift prévu.");
      const pu = planning.punctuality(uid, compta.periodOfDate(compta.parisDate(now))); if (pu.total) lines.push(`SA PONCTUALITÉ (quinzaine) : ${pu.pct} % à l'heure, ${pu.late} retard(s), ${pu.absent} absence(s).`); } catch (e) {}
    const tl = db.prepare("SELECT u.username FROM team_leads t JOIN users u ON u.id = t.leader_id WHERE t.recruit_id = ?").get(uid); if (tl) lines.push(`SON TEAM LEADER : ${tl.username}.`);
    if (u.role === "trainee") lines.push("FORMATION : l'élève doit remplir ses critères (simulateur + formation Twizz en vidéo) en 24 h après sa première connexion ; ensuite un manager lui fait passer un entretien avant de le recruter.");
    if (A.assistantInfo) lines.push("INFOS AJOUTÉES PAR LE MANAGER :\n" + A.assistantInfo);
    return lines.join("\n");
  }
  const SYSTEM = c => `Tu es « StellADS », l'assistant interne de l'agence StellADS pour ses chatters. Tu réponds en français, en tutoyant, de façon courte (3 à 6 phrases maximum), claire et bienveillante, sans jargon.
Tu réponds UNIQUEMENT à partir des informations ci-dessous. Si la réponse n'y est pas ou si c'est une décision qui revient au manager (exception, litige, changement de planning, réclamation de paie), dis-le simplement et propose d'utiliser le bouton « Transmettre au manager ». N'invente jamais de chiffre, de règle ou de date.
Tu ne parles que du travail à l'agence. Tu ne rédiges pas de messages explicites et tu rappelles les règles éthiques si on te demande de les contourner.

${FAQ}

${c}`;
  const hits = new Map();
  app.post("/api/assistant", auth, async (req, res) => {
    if (!["chatter", "trainee"].includes(req.user.role)) return res.status(403).json({ error: "Réservé aux chatters" });
    const h = (hits.get(req.user.id) || []).filter(t => Date.now() - t < 3600e3); if (h.length >= 30) return res.status(429).json({ error: "Tu as posé beaucoup de questions cette heure-ci : réessaie un peu plus tard ou transmets au manager." });
    const hist = (Array.isArray(req.body?.history) ? req.body.history : []).slice(-8).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 1200) })).filter(m => m.content);
    if (!hist.length || hist[hist.length - 1].role !== "user") return res.status(400).json({ error: "Pose ta question" });
    while (hist.length && hist[0].role !== "user") hist.shift();
    h.push(Date.now()); hits.set(req.user.id, h);
    try { const a = await ai.assistant(SYSTEM(context(req.user.id)), hist, { user: req.user.id });
      const id = db.prepare("INSERT INTO assistant_log (user_id, at, q, a) VALUES (?,?,?,?)").run(req.user.id, Date.now(), hist[hist.length - 1].content, a).lastInsertRowid;
      res.json({ ok: true, answer: a, id }); }
    catch (e) { console.error("assistant", e.message); res.status(500).json({ error: "L'assistant ne répond pas pour le moment. Tu peux transmettre ta question au manager." }); }
  });
  // manager : voir exactement ce que l'assistant sait d'un chatter
  app.get("/api/admin/assistant/context/:id", auth, admin, (req, res) => { const id = parseInt(req.params.id, 10); if (!user(id)) return res.status(404).json({ error: "Introuvable" }); res.json({ faq: FAQ, context: context(id) }); });
  app.post("/api/assistant/escalate", auth, (req, res) => {
    const q = String(req.body?.question || "").trim().slice(0, 600); if (!q) return res.status(400).json({ error: "Question vide" });
    if (req.body?.id) db.prepare("UPDATE assistant_log SET escalated = 1 WHERE id = ? AND user_id = ?").run(parseInt(req.body.id, 10), req.user.id);
    gest.log(req.user.id, "a", `**${req.user.username}** a une question pour un manager`, "« " + q + " »");
    res.json({ ok: true });
  });

  /* =================== WRAPPED DU MOIS =================== */
  const monthBounds = m => { const [y, mo] = m.split("-").map(Number); const a = Date.parse(`${m}-01T00:00:00+01:00`), b = Date.parse(`${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, "0")}-01T00:00:00+01:00`); return [a, b]; };
  const prevMonth = m => { const [y, mo] = m.split("-").map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`; };
  const thisMonth = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }).slice(0, 7);
  function wrapped(uid, m) {
    const [a, b] = monthBounds(m), u = user(uid); if (!u) return null;
    const sales = db.prepare("SELECT s.amount, s.sold_at, m.name model FROM sales s JOIN models m ON m.id = s.model_id WHERE s.user_id = ? AND s.status = 'validated' AND s.sold_at >= ? AND s.sold_at < ? ORDER BY s.sold_at").all(uid, a, b);
    const total = sales.reduce((t, s) => t + s.amount, 0);
    const byDay = {}; sales.forEach(s => { const d = new Date(s.sold_at).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }); byDay[d] = (byDay[d] || 0) + s.amount; });
    const bestDay = Object.entries(byDay).sort((x, y) => y[1] - x[1])[0];
    const byModel = {}; sales.forEach(s => { const k = byModel[s.model] = byModel[s.model] || { n: 0, ca: 0 }; k.n++; k.ca += s.amount; });
    const fav = Object.entries(byModel).sort((x, y) => y[1].ca - x[1].ca)[0];
    const big = sales.reduce((m2, s) => !m2 || s.amount > m2.amount ? s : m2, null);
    const byHour = Array(24).fill(0); sales.forEach(s => { byHour[Number(new Date(s.sold_at).toLocaleTimeString("fr-FR", { hour: "2-digit", timeZone: "Europe/Paris" }).slice(0, 2))] += s.amount; });
    const goldH = byHour.indexOf(Math.max(...byHour));
    const clocks = db.prepare("SELECT start_at, end_at FROM clocks WHERE user_id = ? AND reinforce = 0 AND start_at >= ? AND start_at < ?").all(uid, a, b);
    const hours = clocks.reduce((t, c) => t + ((c.end_at || Math.min(Date.now(), b)) - c.start_at) / 3.6e6, 0);
    const [pa, pb] = monthBounds(prevMonth(m)), prevTotal = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM sales WHERE user_id = ? AND status = 'validated' AND sold_at >= ? AND sold_at < ?").get(uid, pa, pb).t;
    const team = db.prepare("SELECT user_id, SUM(amount) t FROM sales WHERE status = 'validated' AND sold_at >= ? AND sold_at < ? GROUP BY user_id ORDER BY t DESC").all(a, b);
    const rank = team.findIndex(r => r.user_id === uid) + 1;
    let kudos = 0; try { kudos = db.prepare("SELECT COUNT(*) n FROM sale_kudos k JOIN sales s ON s.id = k.sale_id WHERE s.user_id = ? AND k.at >= ? AND k.at < ?").get(uid, a, b).n; } catch (e) {}
    const sims = db.prepare("SELECT COUNT(*) n, MAX(score) best FROM sims WHERE user_id = ? AND status = 'done' AND started_at >= ? AND started_at < ?").get(uid, a, b);
    let punct = null; try { const S = planning.decorate(db.prepare(`${planning.SHIFT_SQL} WHERE s.user_id = ? AND s.date >= ? AND s.date < ?`).all(uid, new Date(a).toISOString().slice(0, 10), new Date(b).toISOString().slice(0, 10))).filter(s => s.state !== "future" && s.state !== "missing");
      if (S.length) punct = Math.round(S.filter(s => s.clock_in && !s.late).length / S.length * 100); } catch (e) {}
    const mlabel = new Date(a + 864e5).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "Europe/Paris" });
    return { month: m, label: mlabel, username: u.username, total: Math.round(total * 100) / 100, count: sales.length, avg: sales.length ? Math.round(total / sales.length) : 0,
      bestDay: bestDay ? { date: bestDay[0], label: day(Date.parse(bestDay[0] + "T12:00:00Z")), ca: bestDay[1] } : null, fav: fav ? { name: fav[0], ca: fav[1].ca, n: fav[1].n, share: total ? Math.round(fav[1].ca / total * 100) : 0 } : null,
      big: big ? { amount: big.amount, model: big.model, label: day(big.sold_at) } : null, goldHour: total ? goldH : null, hours: Math.round(hours), shifts: clocks.length, punct,
      prevTotal: Math.round(prevTotal), growth: prevTotal ? Math.round((total / prevTotal - 1) * 100) : null, rank, teamSize: team.length, kudos, sims: sims.n, simBest: sims.best,
      days: Object.keys(byDay).length, teamTotal: Math.round(team.reduce((t, r) => t + r.t, 0)) };
  }
  app.get("/api/wrapped", auth, (req, res) => {
    const m = /^\d{4}-\d{2}$/.test(req.query.m || "") ? req.query.m : prevMonth(thisMonth());
    const uid = req.user.role === "admin" && req.query.u ? parseInt(req.query.u, 10) : req.user.id;
    const w = wrapped(uid, m); if (!w) return res.status(404).json({ error: "Introuvable" }); res.json(w);
  });
  // la carte « ton Wrapped est prêt » : les 10 premiers jours du mois, pour le mois précédent
  app.get("/api/wrapped/ready", auth, (req, res) => {
    const d = Number(new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }).slice(8, 10)), m = prevMonth(thisMonth());
    if (req.user.role !== "chatter" || d > 10) return res.json({ ready: false });
    const w = wrapped(req.user.id, m); res.json({ ready: !!(w && w.count), month: m, label: w ? w.label : "", total: w ? w.total : 0 });
  });

  /* =================== TEAM LEADERS =================== */
  const firstTier = () => { const t = compta.getTiers(); return (t.find(x => x.from > 0) || { from: 500 }).from; };
  function recruitView(r) {
    const u = user(r.recruit_id); if (!u) return null; const now = Date.now();
    const s14 = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM sales WHERE user_id = ? AND status = 'validated' AND sold_at > ?").get(u.id, now - 14 * 864e5);
    const ref = db.prepare("SELECT COUNT(*) n FROM sales WHERE user_id = ? AND status = 'refused' AND reviewed_at > ?").get(u.id, now - 14 * 864e5).n;
    let late = 0, abs = 0; try { planning.decorate(db.prepare(`${planning.SHIFT_SQL} WHERE s.user_id = ? AND s.date >= ?`).all(u.id, new Date(now - 14 * 864e5).toISOString().slice(0, 10))).filter(s => s.state !== "future" && s.state !== "missing" && s.end_ms < now).forEach(s => { if (s.state === "absent") abs++; else if (s.late > 5) late++; }); } catch (e) {}
    const last = db.prepare("SELECT MAX(start_at) t FROM clocks WHERE user_id = ?").get(u.id).t;
    let net = 0; try { const c = compta.computeCompta(compta.periodOfDate(compta.parisDate(now))); net = (c.chatters.find(x => x.id === u.id) || {}).sales || 0; } catch (e) {}
    let training = null; if (u.role === "trainee") try { training = gest.training(u.id, true); } catch (e) {}
    const tips = db.prepare("SELECT id, text, at, seen FROM team_tips WHERE recruit_id = ? ORDER BY at DESC LIMIT 5").all(u.id);
    return { id: u.id, username: u.username, role: u.role, active: !!u.active, since: r.since, sales14: s14.s, n14: s14.n, refused14: ref, late14: late, abs14: abs, lastShift: last,
      goal: { target: firstTier(), net: Math.round(net * 100) / 100, done: !!r.goal_at, prime: r.prime || gest.agency().tlPrime }, training: training ? { done: training.done, total: training.total, ready: training.ready } : null, tips };
  }
  // objectif : la recrue atteint le premier palier sur une quinzaine → prime au team leader (une seule fois)
  function checkGoals() { try {
    const now = Date.now(), pkey = compta.periodOfDate(compta.parisDate(now)), c = compta.computeCompta(pkey), target = firstTier(), prime = gest.agency().tlPrime;
    db.prepare("SELECT t.*, u.username ru, l.username lu FROM team_leads t JOIN users u ON u.id = t.recruit_id JOIN users l ON l.id = t.leader_id WHERE t.goal_at IS NULL AND u.role = 'chatter'").all().forEach(t => {
      const me = c.chatters.find(x => x.id === t.recruit_id); if (!me || me.sales < target) return;
      db.prepare("UPDATE team_leads SET goal_at = ?, prime = ? WHERE recruit_id = ?").run(now, prime, t.recruit_id);
      if (prime > 0) try { db.prepare("INSERT INTO pay_adjust (period, user_id, amount, reason, created_at, created_by) VALUES (?,?,?,?,?,?)").run(pkey, t.leader_id, prime, `Prime team leader · ${t.ru} a atteint ${target} €`, now, null); } catch (e) {}
      gest.log(t.leader_id, "a", `**${t.ru}** a atteint son premier palier : prime team leader pour **${t.lu}**`, prime > 0 ? `+${eur(prime)} ajoutés à la paie de ${t.lu}` : "Objectif atteint");
    }); } catch (e) { console.error("team leaders", e.message); } }
  setInterval(checkGoals, 30 * 60e3).unref(); setTimeout(checkGoals, 15e3).unref();
  app.get("/api/team-lead", auth, (req, res) => {
    checkGoals();
    const mine = db.prepare("SELECT * FROM team_leads WHERE leader_id = ? ORDER BY since").all(req.user.id).map(recruitView).filter(Boolean).filter(r => r.active);
    const lead = db.prepare("SELECT t.*, u.username FROM team_leads t JOIN users u ON u.id = t.leader_id WHERE t.recruit_id = ?").get(req.user.id);
    const tips = lead ? db.prepare("SELECT id, text, at, seen FROM team_tips WHERE recruit_id = ? ORDER BY at DESC LIMIT 5").all(req.user.id) : [];
    res.json({ recruits: mine, leader: lead ? { username: lead.username, since: lead.since } : null, tips, prime: gest.agency().tlPrime, target: firstTier() });
  });
  app.post("/api/team-lead/tip", auth, (req, res) => {
    const rid = parseInt(req.body?.recruitId, 10), t = String(req.body?.text || "").trim().slice(0, 400);
    if (!db.prepare("SELECT 1 FROM team_leads WHERE recruit_id = ? AND leader_id = ?").get(rid, req.user.id)) return res.status(403).json({ error: "Ce n'est pas ta recrue" });
    if (t.length < 3) return res.status(400).json({ error: "Écris ton conseil" });
    db.prepare("INSERT INTO team_tips (recruit_id, leader_id, text, at) VALUES (?,?,?,?)").run(rid, req.user.id, t, Date.now()); res.json({ ok: true });
  });
  app.post("/api/team-lead/seen", auth, (req, res) => { db.prepare("UPDATE team_tips SET seen = 1 WHERE recruit_id = ?").run(req.user.id); res.json({ ok: true }); });
  // manager : choisir le team leader d'une recrue
  app.get("/api/admin/team-lead/:id", auth, admin, (req, res) => {
    const id = parseInt(req.params.id, 10), t = db.prepare("SELECT t.*, u.username FROM team_leads t JOIN users u ON u.id = t.leader_id WHERE t.recruit_id = ?").get(id);
    res.json({ leader: t ? { id: t.leader_id, username: t.username, since: t.since, goalAt: t.goal_at, prime: t.prime } : null,
      recruits: db.prepare("SELECT u.id, u.username, t.goal_at FROM team_leads t JOIN users u ON u.id = t.recruit_id WHERE t.leader_id = ?").all(id),
      candidates: db.prepare("SELECT id, username FROM users WHERE role = 'chatter' AND active = 1 AND id <> ? ORDER BY username").all(id), prime: gest.agency().tlPrime, target: firstTier() });
  });
  app.put("/api/admin/team-lead/:id", auth, admin, (req, res) => {
    const id = parseInt(req.params.id, 10), lid = req.body?.leaderId ? parseInt(req.body.leaderId, 10) : null, r = user(id);
    if (!r) return res.status(404).json({ error: "Introuvable" });
    if (!lid) { db.prepare("DELETE FROM team_leads WHERE recruit_id = ?").run(id); gest.log(req.user.id, "a", `a retiré le team leader de **${r.username}**`, "Team leader"); return res.json({ ok: true }); }
    const l = user(lid); if (!l || l.role !== "chatter" || lid === id) return res.status(400).json({ error: "Team leader invalide" });
    db.prepare("INSERT INTO team_leads (recruit_id, leader_id, since) VALUES (?,?,?) ON CONFLICT(recruit_id) DO UPDATE SET leader_id = excluded.leader_id").run(id, lid, Date.now());
    gest.log(req.user.id, "a", `a choisi **${l.username}** comme team leader de **${r.username}**`, `Prime de ${eur(gest.agency().tlPrime)} quand ${r.username} atteint ${firstTier()} € sur une quinzaine`);
    res.json({ ok: true });
  });
};
