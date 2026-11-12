// Rôles et équipes : nominations (Fondateur / Manager), équipes des Team Leaders, espace « Mon équipe », réglages du Fondateur
module.exports = function mount(app, db, auth, admin, ctx) {
  const { compta, planning, gest, perms, alerts: ALERTS, PERSONAS } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS role_log (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, by_user INTEGER, user_id INTEGER, from_rk TEXT, to_rk TEXT);
    CREATE TABLE IF NOT EXISTS team_leads (recruit_id INTEGER PRIMARY KEY, leader_id INTEGER NOT NULL, since INTEGER NOT NULL, goal_at INTEGER, prime REAL);
    CREATE TABLE IF NOT EXISTS team_tips (id INTEGER PRIMARY KEY, recruit_id INTEGER NOT NULL, leader_id INTEGER NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0);`);
  const has = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const AG = () => { try { return gest.agency(); } catch (e) { return {}; } };
  const parisDate = ms => new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  // minuit (heure de Paris) d'une date AAAA-MM-JJ, en ms
  const parisMidnight = d => { const t = Date.parse(d + "T00:00:00Z"); const loc = new Date(new Date(t).toLocaleString("en-US", { timeZone: "Europe/Paris" })), utc = new Date(new Date(t).toLocaleString("en-US", { timeZone: "UTC" })); return t - (loc - utc); };
  const r2 = n => Math.round(n * 100) / 100;
  const RK = u => perms.rk(u);
  const user = id => db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  const firstTier = () => { const t = compta.getTiers(); return (t.find(x => x.from > 0) || { from: 500 }).from; };
  const tlOnly = (req, res, next) => (req.user.rk === "tl" || ["founder", "manager"].includes(req.user.rk)) ? next() : res.status(403).json({ error: "Réservé aux Team Leaders" });
  const LBL = perms.LABEL;

  /* ===================== NOMINATIONS ===================== */
  // prime Team Leader : seulement pour une recrue (élève, ou chatter arrivé il y a moins de 30 jours) qui n'a pas encore atteint le premier palier
  function attach(uid, leaderId) {
    const u = user(uid); if (!u) return;
    db.prepare("UPDATE users SET team_lead = ? WHERE id = ?").run(leaderId || null, uid);
    const tl = db.prepare("SELECT * FROM team_leads WHERE recruit_id = ?").get(uid);
    if (!leaderId) { if (tl && !tl.goal_at) db.prepare("DELETE FROM team_leads WHERE recruit_id = ?").run(uid); return; }
    if (tl) { if (!tl.goal_at) db.prepare("UPDATE team_leads SET leader_id = ? WHERE recruit_id = ?").run(leaderId, uid); return; }
    if (u.role === "trainee" || Date.now() - u.created_at < 30 * 864e5) db.prepare("INSERT INTO team_leads (recruit_id, leader_id, since) VALUES (?,?,?)").run(uid, leaderId, Date.now());
  }
  function people() {
    const now = Date.now(), wk = now - 7 * 864e5;
    const ca = {}; db.prepare("SELECT user_id, SUM(amount) s FROM sales WHERE status != 'refused' AND sold_at > ? GROUP BY user_id").all(wk).forEach(r => ca[r.user_id] = r.s);
    return db.prepare("SELECT id, username, role, grade, team_lead, active, created_at FROM users WHERE deleted_at IS NULL AND active = 1 ORDER BY username COLLATE NOCASE").all()
      .map(u => ({ id: u.id, username: u.username, role: u.role, grade: u.grade, rk: RK(u), team: u.team_lead || null, since: u.created_at, ca7: r2(ca[u.id] || 0) }));
  }
  app.get("/api/admin/roles", auth, admin, (req, res) => {
    const ps = people(), pkey = compta.periodOfDate(parisDate(Date.now()));
    const teams = ps.filter(p => p.rk === "tl").map(t => { const mem = ps.filter(p => p.team === t.id && (p.rk === "chatter" || p.rk === "trainee"));
      let on = 0, tot = 0; mem.forEach(m => { try { const x = planning.punctuality(m.id, pkey); on += x.onTime; tot += x.total; } catch (e) {} });
      return { id: t.id, username: t.username, members: mem.map(m => m.id), ca7: r2(mem.reduce((s, m) => s + m.ca7, 0)), punct: tot ? Math.round(on / tot * 100) : null }; });
    const log = db.prepare(`SELECT l.*, b.username by_name, u.username user_name FROM role_log l LEFT JOIN users b ON b.id = l.by_user LEFT JOIN users u ON u.id = l.user_id ORDER BY l.at DESC LIMIT 6`).all();
    res.json({ me: { id: req.user.id, rk: req.user.rk }, people: ps, teams, log, prime: AG().tlPrime ?? 30, target: firstTier() });
  });
  app.post("/api/admin/roles/:id", auth, admin, (req, res) => {
    const me = req.user.rk, id = parseInt(req.params.id, 10), u = user(id), b = req.body || {};
    if (!["founder", "manager"].includes(me)) return res.status(403).json({ error: "Réservé au Fondateur et aux managers" });
    if (!u || u.deleted_at) return res.status(404).json({ error: "Membre introuvable" });
    if (id === req.user.id) return res.status(400).json({ error: "Tu ne peux pas changer ton propre rôle" });
    const from = RK(u); if (from === "founder") return res.status(403).json({ error: "Le rôle de Fondateur ne peut pas être changé" });
    const to = b.to || from;
    if (!["chatter", "tl", "assistant", "manager", "trainee"].includes(to)) return res.status(400).json({ error: "Rôle invalide" });
    if ((to === "manager" || from === "manager") && to !== from && me !== "founder") return res.status(403).json({ error: "Seul le Fondateur peut nommer ou retirer un manager" });
    if (from === "trainee" && to !== "trainee") return res.status(400).json({ error: "Valide d'abord sa formation dans l'onglet Équipe" });
    if (to === "trainee" && from !== "trainee") return res.status(400).json({ error: "Un chatter ne peut pas repasser élève" });
    let team = b.team === undefined ? u.team_lead : (b.team ? parseInt(b.team, 10) : null);
    if (team && !["chatter", "trainee"].includes(to)) team = null;
    if (team) { const t = user(team); if (!t || t.grade !== "tl" || !t.active || t.id === id) return res.status(400).json({ error: "Team Leader invalide" }); }
    const MAP = { chatter: ["chatter", null], tl: ["chatter", "tl"], assistant: ["admin", "assistant"], manager: ["admin", null], trainee: ["trainee", null] };
    const [role, grade] = MAP[to];
    db.exec("BEGIN");
    try {
      if (to !== from) {
        db.prepare("UPDATE users SET role = ?, grade = ? WHERE id = ?").run(role, grade, id);
        if (role !== u.role) db.prepare("DELETE FROM tokens WHERE user_id = ?").run(id);   // nouvel espace : reconnexion
        if (from === "tl") { db.prepare("UPDATE users SET team_lead = NULL WHERE team_lead = ?").run(id); db.prepare("DELETE FROM team_leads WHERE leader_id = ? AND goal_at IS NULL").run(id); }
        db.prepare("INSERT INTO role_log (at, by_user, user_id, from_rk, to_rk) VALUES (?,?,?,?,?)").run(Date.now(), req.user.id, id, from, to);
        if (to === "manager" || from === "manager") perms.flog(req.user.id, `a ${to === "manager" ? "nommé" : "retiré"} ${u.username} ${to === "manager" ? "manager" : "des managers"}`);
      }
      if ((team || null) !== (u.team_lead || null) || to !== from) attach(id, team);
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); console.error("rôles", e.message); return res.status(500).json({ error: "Impossible d'enregistrer" }); }
    const tn = team ? user(team).username : null;
    if (to !== from) gest.log(req.user.id, "a", `a nommé **${u.username}** ${LBL[to]}`, `Avant : ${LBL[from]}`);
    else if ((team || null) !== (u.team_lead || null)) gest.log(req.user.id, "a", tn ? `a rattaché **${u.username}** à l'équipe de **${tn}**` : `a retiré **${u.username}** de son équipe`, "Équipes");
    res.json({ ok: true, rk: to, team });
  });

  /* ===================== MON ÉQUIPE (Team Leader) ===================== */
  function teamOf(lid) { return db.prepare("SELECT id, username, role, created_at FROM users WHERE team_lead = ? AND active = 1 AND deleted_at IS NULL AND role IN ('chatter','trainee') ORDER BY username COLLATE NOCASE").all(lid); }
  const persona = id => PERSONAS.find(p => p.id === id) || { name: id, label: id };
  function dashboard(lid) {
    const now = Date.now(), today = parisDate(now), a = AG(), pmax = +a.pauseMax || 15;
    const mem = teamOf(lid), ids = mem.map(m => m.id), names = new Set(mem.map(m => m.username));
    const lead = user(lid);
    const out = { now, today, leader: { id: lid, username: lead ? lead.username : "?" }, pauseMax: pmax, prime: a.tlPrime ?? 30, target: firstTier(),
      personas: PERSONAS.map(p => ({ id: p.id, name: p.name, label: p.label })), members: [], events: [], timeline: null, alerts: [], primes: [] };
    if (!ids.length) return out;
    const IN = `(${ids.map(() => "?").join(",")})`;
    // semaine (lundi → aujourd'hui) et semaine d'avant
    const dow = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7, mon = addDays(today, -dow), wk0 = parisMidnight(mon), pw0 = wk0 - 7 * 864e5, d7 = parisMidnight(addDays(today, -6));
    const sales = db.prepare(`SELECT s.id, s.user_id, s.amount, s.sold_at, s.status, s.created_at, m.name model FROM sales s JOIN models m ON m.id = s.model_id WHERE s.user_id IN ${IN} AND s.status != 'refused' AND s.sold_at >= ?`).all(...ids, Math.min(pw0, d7));
    const pkey = compta.periodOfDate(today);
    let comp = null; try { comp = compta.computeCompta(pkey); } catch (e) {}
    // shifts du jour (et de la veille s'ils débordent)
    let shifts = []; try { shifts = planning.decorate(db.prepare(`${planning.SHIFT_SQL} WHERE s.date BETWEEN ? AND ? AND s.user_id IN ${IN} ORDER BY s.date, s.start`).all(addDays(today, -1), today, ...ids)).filter(s => s.end_ms > now - 20 * 3.6e6); } catch (e) {}
    const clocks = db.prepare(`SELECT c.id, c.user_id, c.start_at, c.end_at, c.reinforce, m.name model FROM clocks c JOIN models m ON m.id = c.model_id WHERE c.user_id IN ${IN} AND (c.end_at IS NULL OR c.end_at > ?)`).all(...ids, now - 20 * 3.6e6);
    const pauses = has("pauses") ? db.prepare(`SELECT id, user_id, start_at, end_at FROM pauses WHERE user_id IN ${IN} AND start_at > ?`).all(...ids, Math.min(wk0, now - 20 * 3.6e6)) : [];
    const sims = db.prepare(`SELECT user_id, score, started_at, difficulty, persona_id FROM sims WHERE user_id IN ${IN} AND status = 'done' AND score IS NOT NULL ORDER BY started_at DESC`).all(...ids);
    const asg = has("sim_assignments") ? db.prepare(`SELECT * FROM sim_assignments WHERE user_id IN ${IN} AND done_at IS NULL ORDER BY created_at DESC`).all(...ids) : [];
    const tips = db.prepare(`SELECT id, recruit_id, text, at, seen FROM team_tips WHERE recruit_id IN ${IN} ORDER BY at DESC`).all(...ids);
    const lastWeek = {};
    mem.forEach(m => { lastWeek[m.id] = sales.filter(s => s.user_id === m.id && s.sold_at >= pw0 && s.sold_at < wk0).reduce((t, s) => t + s.amount, 0); });
    const prevRank = [...mem].sort((x, y) => lastWeek[y.id] - lastWeek[x.id]).map(m => m.id);
    mem.forEach(m => {
      const ws = sales.filter(s => s.user_id === m.id && s.sold_at >= wk0), ca = ws.reduce((t, s) => t + s.amount, 0);
      const spark = []; for (let i = 6; i >= 0; i--) { const d0 = parisMidnight(addDays(today, -i)), d1 = d0 + 864e5; spark.push(r2(sales.filter(s => s.user_id === m.id && s.sold_at >= d0 && s.sold_at < d1).reduce((t, s) => t + s.amount, 0))); }
      const ck = clocks.find(c => c.user_id === m.id && !c.end_at && !c.reinforce), po = ck ? pauses.find(p => p.user_id === m.id && !p.end_at && p.start_at >= ck.start_at) : null;
      const miss = shifts.find(s => s.user_id === m.id && s.state === "missing");
      const next = shifts.find(s => s.user_id === m.id && s.state === "future");
      let st = "off", since = null, sub = "";
      if (m.role === "trainee") { st = "trainee"; }
      if (po) { st = "pause"; since = po.start_at; sub = ck.model; } else if (ck) { st = "on"; since = ck.start_at; sub = ck.model; } else if (miss && m.role !== "trainee") { st = "late"; since = miss.start_ms; sub = `${miss.model_name} · shift de ${miss.start}`; }
      else if (next && m.role !== "trainee") sub = `prochain shift ${next.start} · ${next.model_name}`;
      const wp = pauses.filter(p => p.user_id === m.id && p.start_at >= wk0 && p.end_at), pavg = wp.length ? Math.round(wp.reduce((t, p) => t + (p.end_at - p.start_at), 0) / wp.length / 60000) : null;
      let pu = null; try { pu = planning.punctuality(m.id, pkey); } catch (e) {}
      const ms = sims.filter(s => s.user_id === m.id), last5 = ms.slice(0, 5);
      let tr = null; if (m.role === "trainee") try { const t = gest.training(m.id, true); tr = { done: t.done, total: t.total, ready: t.ready, tip: String(t.tip || "").replace(/<[^>]+>/g, ""), course: t.course ? { done: t.course.done, total: t.course.total } : null }; } catch (e) {}
      const pay = comp ? comp.chatters.find(x => x.id === m.id) : null;
      out.members.push({ id: m.id, username: m.username, role: m.role, since: m.created_at, status: st, statusSince: since, statusSub: sub,
        ca: r2(ca), n: ws.length, pending: ws.filter(s => s.status === "pending").length, avg: ws.length ? Math.round(ca / ws.length) : 0, spark, prevRank: prevRank.indexOf(m.id) + 1, lastWeek: r2(lastWeek[m.id]),
        punct: pu ? { pct: pu.pct, total: pu.total, late: pu.late, absent: pu.absent, last: pu.last } : null, pauseAvg: pavg, pauseOver: wp.filter(p => p.end_at - p.start_at > pmax * 60000).length, pauseN: wp.length,
        sim: { last: ms[0] ? { score: ms[0].score, at: ms[0].started_at } : null, avg5: last5.length ? Math.round(last5.reduce((t, s) => t + s.score, 0) / last5.length) : null, n7: ms.filter(s => s.started_at > now - 7 * 864e5).length, trend: ms.slice(0, 8).map(s => s.score).reverse() },
        assignments: asg.filter(x => x.user_id === m.id).map(x => ({ id: x.id, persona: persona(x.persona_id).label, name: persona(x.persona_id).name, difficulty: x.difficulty, goal: x.goal, due: x.due_at, mine: x.created_by === lid })),
        training: tr, tips: tips.filter(t => t.recruit_id === m.id).slice(0, 5), periodSales: pay ? r2(pay.sales) : 0 });
    });
    out.members.sort((x, y) => y.ca - x.ca || x.username.localeCompare(y.username));
    // fil en direct : ventes, débuts de shift, pauses (12 dernières heures)
    const ev = [], nm = id => (mem.find(m => m.id === id) || {}).username || "?";
    sales.filter(s => s.created_at > now - 12 * 3.6e6).forEach(s => ev.push({ id: "s" + s.id, k: "sale", at: s.created_at, who: nm(s.user_id), uid: s.user_id, amount: s.amount, text: `déclare une vente · ${s.model}`, pending: s.status === "pending" }));
    clocks.filter(c => c.start_at > now - 12 * 3.6e6).forEach(c => ev.push({ id: "c" + c.id, k: c.reinforce ? "renfort" : "shift", at: c.start_at, who: nm(c.user_id), uid: c.user_id, text: c.reinforce ? `part en renfort sur ${c.model}` : `commence son shift · ${c.model}` }));
    pauses.filter(p => p.start_at > now - 12 * 3.6e6).forEach(p => ev.push({ id: "p" + p.id, k: "pause", at: p.start_at, who: nm(p.user_id), uid: p.user_id, text: p.end_at ? `fait une pause de ${Math.max(1, Math.round((p.end_at - p.start_at) / 60000))} min` : "part en pause" }));
    shifts.filter(s => s.state === "missing").forEach(s => ev.push({ id: "m" + s.id, k: "late", at: s.start_ms, who: s.username, uid: s.user_id, text: `n'a pas pointé son shift de ${s.start}` }));
    out.events = ev.sort((x, y) => y.at - x.at).slice(0, 12);
    // ligne de temps du jour
    const tday = shifts.filter(s => s.end_ms > now - 14 * 3.6e6);
    const lo0 = parisMidnight(today) + 12 * 3.6e6;
    const lo = Math.min(lo0, ...tday.map(s => s.start_ms)), hi = Math.max(lo + 14 * 3.6e6, ...tday.map(s => s.end_ms));
    out.timeline = { from: Math.floor(lo / 3.6e6) * 3.6e6, to: Math.ceil(hi / 3.6e6) * 3.6e6,
      rows: mem.map(m => ({ id: m.id, username: m.username, trainee: m.role === "trainee",
        shifts: tday.filter(s => s.user_id === m.id).map(s => ({ a: s.start_ms, b: s.end_ms, state: s.state, late: s.late, model: s.model_name, label: `${s.start}–${s.end}` })),
        clocks: clocks.filter(c => c.user_id === m.id && !c.reinforce && (c.end_at || now) > lo).map(c => ({ a: c.start_at, b: c.end_at })),
        pauses: pauses.filter(p => p.user_id === m.id && (p.end_at || now) > lo).map(p => ({ a: p.start_at, b: p.end_at })) })) };
    // alertes de l'équipe
    try { (ALERTS ? ALERTS.alerts() : []).filter(x => ["pause", "late", "sos"].includes(x.kind) && names.has(x.who)).forEach(x => {
      const m = mem.find(y => y.username === x.who);
      out.alerts.push({ key: x.key, kind: x.kind, lvl: x.lvl, at: x.at, who: x.who, uid: m ? m.id : null, title: x.title, sub: x.sub, href: x.kind === "sos" ? (x.actions[0] || {}).href : null }); }); } catch (e) {}
    out.members.forEach(m => {
      if (m.training && !m.training.ready) { const lastSim = m.sim.last ? m.sim.last.at : m.since; if (now - lastSim > 3 * 864e5) out.alerts.push({ key: "tr:" + m.id, kind: "train", lvl: 1, at: lastSim + 3 * 864e5, who: m.username, uid: m.id, title: `${m.username} n'avance plus en formation`, sub: `Rien depuis ${Math.floor((now - lastSim) / 864e5)} jours · ${m.training.done} / ${m.training.total} critères` }); }
      m.assignments.filter(x => x.due && x.due < now).forEach(x => out.alerts.push({ key: "as:" + x.id, kind: "asg", lvl: 1, at: x.due, who: m.username, uid: m.id, title: `Entraînement en retard · ${m.username}`, sub: `${x.persona} · objectif ${x.goal}` }));
    });
    out.alerts.sort((x, y) => y.lvl - x.lvl || y.at - x.at);
    // primes Team Leader en cours
    out.primes = db.prepare("SELECT t.*, u.username, u.role FROM team_leads t JOIN users u ON u.id = t.recruit_id WHERE t.leader_id = ? AND u.active = 1 AND u.deleted_at IS NULL ORDER BY t.goal_at IS NULL DESC, t.since").all(lid)
      .map(t => { const m = out.members.find(x => x.id === t.recruit_id); return { id: t.recruit_id, username: t.username, role: t.role, done: !!t.goal_at, prime: t.prime || out.prime, net: m ? m.periodSales : 0, target: out.target }; });
    return out;
  }
  const leaderFor = req => req.user.rk === "tl" ? req.user.id : (parseInt(req.query.tl || req.body?.tl, 10) || null);
  app.get("/api/team", auth, tlOnly, (req, res) => {
    const lid = leaderFor(req);
    if (!lid) return res.json({ teams: db.prepare("SELECT id, username FROM users WHERE grade = 'tl' AND active = 1 AND deleted_at IS NULL ORDER BY username").all() });
    try { res.json(dashboard(lid)); } catch (e) { console.error("mon équipe", e); res.status(500).json({ error: "Impossible de charger l'équipe" }); }
  });
  const mine = (req, res) => { const uid = parseInt(req.body?.userId, 10), lid = leaderFor(req), u = user(uid);
    if (!u || !u.active || u.team_lead !== lid) { res.status(403).json({ error: "Ce membre n'est pas dans ton équipe" }); return null; } return u; };
  app.post("/api/team/tip", auth, tlOnly, (req, res) => {
    const u = mine(req, res); if (!u) return; const t = String(req.body?.text || "").trim().slice(0, 400);
    if (t.length < 3) return res.status(400).json({ error: "Écris ton conseil" });
    const id = db.prepare("INSERT INTO team_tips (recruit_id, leader_id, text, at) VALUES (?,?,?,?)").run(u.id, req.user.id, t, Date.now()).lastInsertRowid;
    res.json({ ok: true, id });
  });
  app.post("/api/team/assign", auth, tlOnly, (req, res) => {
    const u = mine(req, res); if (!u) return; const b = req.body || {};
    if (!has("sim_assignments")) return res.status(500).json({ error: "Entraînements indisponibles" });
    if (!PERSONAS.some(p => p.id === b.personaId)) return res.status(400).json({ error: "Choisis un scénario" });
    const diff = ["facile", "normal", "difficile"].includes(b.difficulty) ? b.difficulty : "normal";
    const goal = Math.max(10, Math.min(100, parseInt(b.goal, 10) || 70)), due = Number(b.dueAt) > Date.now() ? Number(b.dueAt) : null;
    db.prepare("INSERT INTO sim_assignments (user_id, persona_id, difficulty, goal, due_at, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)").run(u.id, b.personaId, diff, goal, due, String(b.note || "").slice(0, 200), req.user.id, Date.now());
    res.json({ ok: true });
  });
  // demander un renfort pour la créatrice d'un membre (shift non pointé ou en cours)
  app.post("/api/team/help", auth, tlOnly, (req, res) => {
    const u = mine(req, res); if (!u) return; const now = Date.now(), today = parisDate(now);
    let s = null; try { s = planning.decorate(db.prepare(`${planning.SHIFT_SQL} WHERE s.user_id = ? AND s.date BETWEEN ? AND ?`).all(u.id, addDays(today, -1), today)).find(x => ["missing", "live"].includes(x.state) && x.end_ms > now); } catch (e) {}
    const ck = db.prepare("SELECT model_id FROM clocks WHERE user_id = ? AND end_at IS NULL AND reinforce = 0").get(u.id);
    const model = s ? s.model_id : ck ? ck.model_id : null;
    if (!model) return res.status(400).json({ error: `${u.username} n'a pas de shift en cours` });
    if (db.prepare("SELECT 1 FROM help_requests WHERE model_id = ? AND resolved_at IS NULL AND created_at > ?").get(model, now - 12 * 3.6e6)) return res.json({ ok: true, already: true });
    db.prepare("INSERT INTO help_requests (model_id, for_user, created_by, reason, created_at) VALUES (?,?,?,?,?)").run(model, u.id, req.user.id, s && s.state === "missing" ? "pas pointé" : "demandé par le Team Leader", now);
    gest.log(req.user.id, "a", `a demandé un renfort pour **${u.username}**`, s && s.state === "missing" ? "Shift pas pointé" : "Team Leader");
    res.json({ ok: true });
  });
  // signaler un membre aux managers : note sur sa fiche + journal
  app.post("/api/team/flag", auth, tlOnly, (req, res) => {
    const u = mine(req, res); if (!u) return; const t = String(req.body?.text || "").trim().slice(0, 600);
    if (t.length < 3) return res.status(400).json({ error: "Explique en quelques mots" });
    try { db.prepare("INSERT INTO user_notes (user_id, kind, text, created_at, created_by) VALUES (?,?,?,?,?)").run(u.id, "tl", `Signalé par ${req.user.username} (Team Leader) : ${t}`, Date.now(), req.user.id); } catch (e) {}
    gest.log(req.user.id, "a", `a signalé **${u.username}** aux managers`, t.slice(0, 120));
    res.json({ ok: true });
  });

  /* ===================== RÉGLAGES DU FONDATEUR ===================== */
  app.get("/api/admin/founder", auth, admin, (req, res) => {
    if (!["founder", "manager"].includes(req.user.rk)) return res.status(403).json({ error: "Réservé au Fondateur" });
    const now = Date.now(), pkey = compta.periodOfDate(parisDate(now)), pi = compta.periodInfo(pkey);
    let c = null; try { c = compta.computeCompta(pkey); } catch (e) {}
    const prev = pi.prev, pc = (() => { try { return compta.computeCompta(prev); } catch (e) { return null; } })();
    const sum = x => x ? { brut: x.totals.brut, net: x.totals.net, creators: x.totals.creators, chatters: x.totals.chatters, margin: x.totals.margin, primes: (x.chatters || []).reduce((t, y) => t + (y.prime || 0) + (y.adjTotal || 0), 0) } : null;
    const pend = db.prepare("SELECT COUNT(*) n FROM sales WHERE status = 'pending'").get().n;
    const models = db.prepare("SELECT id, name, creator_pct FROM models ORDER BY name").all().map(m => ({ ...m, net: c ? r2(((c.models || []).find(x => x.id === m.id) || {}).net || 0) : 0 }));
    res.json({ founder: req.user.rk === "founder", tiers: compta.getTiers(), models, period: { key: pkey, label: pi.label, locked: compta.isLocked(pkey), totals: sum(c) },
      prevPeriod: prev ? { key: prev, label: compta.periodInfo(prev).label, locked: compta.isLocked(prev), totals: sum(pc) } : null, pendingSales: pend,
      managers: db.prepare("SELECT id, username, grade FROM users WHERE role = 'admin' AND active = 1 AND deleted_at IS NULL AND (grade IS NULL OR grade = 'founder') ORDER BY grade = 'founder' DESC, username").all(),
      log: db.prepare("SELECT f.at, f.text, u.username FROM founder_log f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.at DESC LIMIT 8").all() });
  });
  /* ----- remise à zéro de la compta d'une quinzaine (Fondateur) ----- */
  const founderOnly = (req, res) => { if (req.user.rk !== "founder") { res.status(403).json({ error: "Réservé au Fondateur" }); return false; } return true; };
  function resetPreview(pkey) {
    const pi = compta.periodInfo(pkey); if (!pi) return null;
    const inP = ms => compta.periodOfDate(parisDate(ms)) === pkey;
    const sales = db.prepare("SELECT id, amount, status, sold_at FROM sales").all().filter(x => inP(x.sold_at));
    const rev = db.prepare("SELECT r.*, m.name FROM revenues r JOIN models m ON m.id = r.model_id WHERE r.period = ?").all(pkey)
      .filter(r => ["brut", "net", "abo", "live", "coll", "push"].some(k => r[k] != null));
    const revTot = rev.reduce((t, r) => t + (r.v2 ? ["abo", "live", "coll", "push"].reduce((x, k) => x + (r[k] || 0), 0) : (r.brut || 0)), 0);
    const adj = db.prepare("SELECT a.amount, a.reason, u.username FROM pay_adjust a LEFT JOIN users u ON u.id = a.user_id WHERE a.period = ? ORDER BY a.created_at").all(pkey);
    const att = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM attributions WHERE period = ?").get(pkey);
    const pay = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM payouts WHERE period = ?").get(pkey);
    const cpd = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM creator_paid WHERE period = ?").get(pkey);
    let t = null; try { t = compta.computeCompta(pkey).totals; } catch (e) {}
    return { key: pkey, label: pi.label, locked: compta.isLocked(pkey), totals: t ? { brut: t.brut, net: t.net, chatters: t.chatters, creators: t.creators, margin: t.margin } : null,
      parts: [
        { k: "revenues", label: "CA saisi à la main", sub: rev.length ? rev.map(r => r.name).join(", ") : "Aucun", n: rev.length, amount: r2(revTot), on: rev.length > 0 },
        { k: "adjust", label: "Ajustements et primes de paie", sub: adj.length ? adj.slice(0, 3).map(a => `${a.username || "?"} ${a.amount > 0 ? "+" : ""}${r2(a.amount)} € (${(a.reason || "").slice(0, 40)})`).join(" · ") + (adj.length > 3 ? ` · +${adj.length - 3}` : "") : "Aucun", n: adj.length, amount: r2(adj.reduce((x, a) => x + a.amount, 0)), on: adj.length > 0 },
        { k: "attrib", label: "Corrections manuelles de ventes par chatter", sub: att.n ? `${att.n} correction${att.n > 1 ? "s" : ""}` : "Aucune", n: att.n, amount: r2(att.s), on: att.n > 0 },
        { k: "payouts", label: "Paies marquées versées", sub: pay.n ? `${pay.n} chatter${pay.n > 1 ? "s" : ""}` : "Aucune", n: pay.n, amount: r2(pay.s), on: pay.n > 0 },
        { k: "creatorpaid", label: "Parts créatrices marquées versées", sub: cpd.n ? `${cpd.n} créatrice${cpd.n > 1 ? "s" : ""}` : "Aucune", n: cpd.n, amount: r2(cpd.s), on: cpd.n > 0 },
        { k: "sales", label: "Ventes déclarées de la quinzaine", sub: sales.length ? `${sales.filter(x => x.status === "validated").length} validées · ${sales.filter(x => x.status === "pending").length} en attente · ${sales.filter(x => x.status === "refused").length} refusées` : "Aucune", n: sales.length, amount: r2(sales.filter(x => x.status !== "refused").reduce((x, y) => x + y.amount, 0)), on: false }
      ] };
  }
  app.get("/api/admin/founder/reset", auth, admin, (req, res) => {
    if (!founderOnly(req, res)) return;
    const k = String(req.query.period || compta.periodOfDate(parisDate(Date.now()))), pv = resetPreview(k);
    if (!pv) return res.status(400).json({ error: "Période invalide" }); res.json(pv);
  });
  app.post("/api/admin/founder/reset", auth, admin, (req, res) => {
    if (!founderOnly(req, res)) return;
    const k = String(req.body?.period || ""), pv = resetPreview(k); if (!pv) return res.status(400).json({ error: "Période invalide" });
    const parts = new Set(Array.isArray(req.body?.parts) ? req.body.parts : []); if (!parts.size) return res.status(400).json({ error: "Choisis ce qu'il faut remettre à zéro" });
    const inP = ms => compta.periodOfDate(parisDate(ms)) === k;
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM period_locks WHERE period = ?").run(k);
      if (parts.has("revenues")) db.prepare("DELETE FROM revenues WHERE period = ?").run(k);
      if (parts.has("adjust")) db.prepare("DELETE FROM pay_adjust WHERE period = ?").run(k);
      if (parts.has("attrib")) db.prepare("DELETE FROM attributions WHERE period = ?").run(k);
      if (parts.has("payouts")) db.prepare("DELETE FROM payouts WHERE period = ?").run(k);
      if (parts.has("creatorpaid")) db.prepare("DELETE FROM creator_paid WHERE period = ?").run(k);
      if (parts.has("sales")) { const ids = db.prepare("SELECT id, sold_at FROM sales").all().filter(x => inP(x.sold_at)).map(x => x.id);
        ids.forEach(id => { db.prepare("DELETE FROM sales WHERE id = ?").run(id); if (has("sale_kudos")) db.prepare("DELETE FROM sale_kudos WHERE sale_id = ?").run(id); }); }
      db.prepare("DELETE FROM ca_snaps WHERE period = ?").run(k);
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); console.error("remise à zéro", e.message); return res.status(500).json({ error: "Impossible de remettre à zéro" }); }
    const names = pv.parts.filter(x => parts.has(x.k)).map(x => x.label.toLowerCase());
    perms.flog(req.user.id, `a remis à zéro la quinzaine ${pv.label} (${names.join(", ")})`);
    gest.log(req.user.id, "a", `a remis à zéro la compta du **${pv.label}**`, names.join(", "));
    res.json({ ok: true, after: resetPreview(k) });
  });
  return { attach, dashboard };
};
