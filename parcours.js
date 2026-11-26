// Chatters en formation (après la sélection de 24 h et l'entretien) :
// jour 1 (bienvenue + vidéos de la messagerie), 9 modules débloqués selon la réussite (vidéo + exercice + 3 entraînements, 2 par jour au maximum),
// shifts accompagnés avec une inbox réservée de 15 à 20 fans, alertes au manager, onglet « Formation » (sélection + formation) et prime de formation.
const TZ = "Europe/Paris";
const parisDate = ms => new Date(ms).toLocaleDateString("sv-SE", { timeZone: TZ });
const periodOfDate = d => { const [y, m, day] = d.split("-"); return `${y}-${m}-${Number(day) <= 15 ? "A" : "B"}`; };
const str = v => String(v == null ? "" : v);
const J = (s, d) => { try { const x = JSON.parse(s); return x == null ? d : x; } catch (e) { return d; } };
const H = 3600e3, D = 864e5;

// ordre des modules : les règles d'abord, « Ton shift » débloque les shifts accompagnés, les gros clients en dernier
const MODS = ["tw15", "tw9", "tw10", "tw12", "tw11", "tw16", "tw17", "tw8", "tw18", "tw13", "tw14"];   // « Ton shift » reste 6e : il débloque les shifts accompagnés
const SUP_AFTER = "tw16", TRAIN_NEED = 3, PER_DAY = 2, TYPING_GOAL = 60, MAX_DAYS = 14;
const WELCOME = { id: "tw0", title: "Bienvenue en formation", file: "formation-00-bienvenue.mp4", sub: "Comment se passe ta formation" };

module.exports = function mount(app, db, auth, admin, { gest: G, notify, inbox, perms }) {
  db.exec(`CREATE TABLE IF NOT EXISTS sup_shifts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, model_id INTEGER NOT NULL, cid TEXT, start_at INTEGER NOT NULL, end_at INTEGER NOT NULL,
      fans TEXT, notes TEXT, by_id INTEGER, created_at INTEGER NOT NULL, cancelled_at INTEGER);
    CREATE INDEX IF NOT EXISTS sup_shifts_user ON sup_shifts(user_id);
    CREATE TABLE IF NOT EXISTS form_alerts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL UNIQUE, text TEXT, at INTEGER NOT NULL, done_at INTEGER);`);
  const now = () => Date.now();
  const S = { get: (k, d) => { const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(k); return r ? r.value : d; }, set: (k, v) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, String(v)) };
  const prime = () => { const v = +S.get("formation_prime", 15); return Number.isFinite(v) && v >= 0 ? v : 15; };
  const managers = () => db.prepare("SELECT id FROM users WHERE active = 1 AND deleted_at IS NULL AND role = 'admin' AND COALESCE(grade, '') <> 'assistant'").all().map(r => r.id);
  const user = id => db.prepare("SELECT id, username, role, active, stage, stage_at, created_at FROM users WHERE id = ?").get(id);
  const exists = f => { try { return require("fs").existsSync(require("path").join(__dirname, "public", "video", "twizz", f)); } catch (e) { return false; } };
  const J1 = () => [WELCOME, ...G.COURSE].filter(v => exists(v.file));
  const MODLIST = () => MODS.map(id => G.ADV.find(v => v.id === id)).filter(v => v && exists(v.file));
  const simOf = vid => (G.QUIZ[vid] || []).map(p => p.sim).find(Boolean) || null;
  const typingBest = uid => { try { return db.prepare("SELECT MAX(score) s FROM skill_tests WHERE user_id = ? AND kind = 'typing' AND json_extract(data, '$.acc') >= 90").get(uid).s || null; } catch (e) { return null; } };

  // ---------- où en est un chatter en formation ----------
  function state(uid) {
    const u = user(uid), since = (u && u.stage_at) || 0, t = now(), today = parisDate(t);
    const j1 = G.course(uid, true, J1()); j1.label = "JOUR 1 · LES BASES";
    const mc = G.course(uid, true, MODLIST(), true);
    const trains = {}; db.prepare("SELECT video_id, ended_at FROM ex_runs WHERE user_id = ? AND part = 'train' AND passed = 1 AND started_at >= ? ORDER BY ended_at").all(uid, since).forEach(r => (trains[r.video_id] = trains[r.video_id] || []).push(r.ended_at));
    const tries = {}; db.prepare("SELECT video_id, part, COUNT(*) n, SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) ok FROM ex_runs WHERE user_id = ? AND status = 'done' AND started_at >= ? GROUP BY video_id, part").all(uid, since).forEach(r => { const o = tries[r.video_id] = tries[r.video_id] || { ex: 0, exOk: 0, train: 0, trainOk: 0 }; if (r.part === "train") { o.train = r.n; o.trainOk = r.ok; } else { o.ex += r.n; o.exOk += r.ok; } });
    const mods = mc.videos.map((v, i) => { const tr = trains[v.id] || [], exOk = !!(v.quiz && v.quiz.every(p => p.passed)), watched = v.done || (v.quiz && v.dur && v.pos >= v.dur - 3);
      const complete = v.done && tr.length >= TRAIN_NEED, doneAt = complete ? tr[TRAIN_NEED - 1] : null;
      return { id: v.id, n: i + 1, title: v.title, sub: v.sub, src: v.src, video: v, exOk, trainOk: Math.min(tr.length, TRAIN_NEED), trainNeed: TRAIN_NEED, complete, doneAt, tries: tries[v.id] || { ex: 0, exOk: 0, train: 0, trainOk: 0 }, sim: simOf(v.id) }; });
    const doneToday = mods.filter(m => m.doneAt && parisDate(m.doneAt) === today).length;
    let prev = j1.complete, cap = false;
    mods.forEach(m => { m.locked = !prev; if (!m.complete && prev && doneToday >= PER_DAY) { m.locked = true; m.cap = true; cap = true; } prev = prev && m.complete; });
    const done = mods.filter(m => m.complete).length, typing = typingBest(uid), supOpen = !!(mods.find(m => m.id === SUP_AFTER) || {}).complete;
    const sups = db.prepare("SELECT s.*, m.name model FROM sup_shifts s JOIN models m ON m.id = s.model_id WHERE s.user_id = ? AND s.cancelled_at IS NULL ORDER BY s.start_at").all(uid).map(supView);
    const cur = mods.find(m => !m.complete && !m.locked) || null;
    // la seule chose à faire maintenant
    let next;
    if (!j1.complete) { const v = j1.next || j1.videos.find(x => !x.done); next = { kind: "j1", title: v ? v.title : "Les bases", sub: `Jour 1 · vidéo ${v ? v.n : j1.done + 1} sur ${j1.total}`, btn: v && v.pos > 3 ? "Reprendre la vidéo" : "Regarder la vidéo", vid: v ? v.id : null, set: "base" }; }
    else if (cur) {
      const watchedEnough = cur.video.done || cur.exOk;
      if (!cur.exOk) next = { kind: "video", mod: cur.id, title: cur.title, sub: `Module ${cur.n} sur ${mods.length} · ${cur.video.pos > 3 ? "reprends la vidéo, l'exercice t'attend à la fin" : "la vidéo, puis l'exercice au simulateur"}`, btn: cur.video.pos > 3 ? "Reprendre" : "Regarder la vidéo", vid: cur.id, set: "adv" };
      else next = { kind: "train", mod: cur.id, title: cur.title, sub: `Module ${cur.n} sur ${mods.length} · entraînement ${cur.trainOk + 1} sur ${TRAIN_NEED}`, btn: `Lancer l'entraînement ${cur.trainOk + 1}/${TRAIN_NEED}`, vid: cur.id, n: cur.trainOk + 1 };
      if (!watchedEnough && cur.exOk) next.kind = "train";
    }
    else if (cap) next = { kind: "cap", title: "C'est tout pour aujourd'hui", sub: `${PER_DAY} modules validés aujourd'hui : le suivant se débloque demain. En attendant, entraîne-toi au simulateur ou travaille ta frappe.` };
    else if (done === mods.length && (typing || 0) < TYPING_GOAL) next = { kind: "typing", title: "Ta vitesse de frappe", sub: `Les ${mods.length} modules sont validés 🎉 Il te reste à atteindre ${TYPING_GOAL} mots/min (ton meilleur : ${typing ? Math.round(typing) : "—"}).`, btn: "Faire le test de frappe", href: "/tests?t=typing" };
    else if (done === mods.length) next = { kind: "ready", title: "Prêt pour l'entretien final", sub: "Tout est validé. Ton manager a été prévenu : il va te proposer ton entretien final." };
    else next = { kind: "wait", title: "Ta formation", sub: "La suite arrive bientôt." };
    const day = Math.max(1, Math.floor((t - since) / D) + 1), ready = done === mods.length && mods.length > 0 && (typing || 0) >= TYPING_GOAL;
    const lastNote = [...sups].reverse().find(s => s.notes && s.end_at < t) || null;
    return { user: u ? { id: u.id, username: u.username } : null, since, day, j1, mods, done, total: mods.length, cap, doneToday, typing, typingGoal: TYPING_GOAL, supOpen, sups, next, ready, lastNote, perDay: PER_DAY };
  }
  // les deux listes de vidéos de la page Formation pour un chatter en formation (même lecteur que les autres)
  G.setStageLib(uid => { const s = state(uid); const adv = { unlocked: true, videos: s.mods.map(m => ({ ...m.video, n: m.n, locked: m.locked })), total: s.total, done: s.done, complete: s.done === s.total, next: null }; return { base: s.j1, adv }; });

  // ---------- shifts accompagnés ----------
  const hm = ms => new Date(ms).toLocaleTimeString("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  const dLong = ms => new Date(ms).toLocaleDateString("fr-FR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
  function supView(s) { const fans = J(s.fans, null), t = now();
    return { id: s.id, user_id: s.user_id, model_id: s.model_id, model: s.model, start_at: s.start_at, end_at: s.end_at, date: parisDate(s.start_at), start: hm(s.start_at), end: hm(s.end_at), when: `${dLong(s.start_at)} · ${hm(s.start_at)}–${hm(s.end_at)}`,
      state: t < s.start_at ? "future" : t < s.end_at ? "live" : "done", fans: fans ? fans.length : null, notes: s.notes || "", username: s.username || null }; }
  const activeSup = uid => { const t = now(); return db.prepare("SELECT * FROM sup_shifts WHERE user_id = ? AND cancelled_at IS NULL AND start_at <= ? AND end_at > ? ORDER BY start_at DESC LIMIT 1").get(uid, t, t); };
  // inbox du chatter en formation : seulement pendant son shift, seulement ses fans réservés
  app.locals.supAccess = uid => { const s = activeSup(uid); if (!s || !s.cid) return null; const F = J(s.fans, []) || [];
    return { cid: s.cid, fans: new Set(F.map(f => f.fan)), convs: new Set(F.map(f => f.conv).filter(Boolean)), shift: s.id, end: s.end_at }; };
  app.locals.supNext = uid => { const s = db.prepare("SELECT s.*, m.name model FROM sup_shifts s JOIN models m ON m.id = s.model_id WHERE s.user_id = ? AND s.cancelled_at IS NULL AND s.end_at > ? ORDER BY s.start_at LIMIT 1").get(uid, now()); return s ? supView(s) : null; };
  // fans réservés en ce moment sur une créatrice (les autres chatters et l'IA ne les voient pas)
  app.locals.supReserved = cid => { const t = now(), out = new Set();
    db.prepare("SELECT fans FROM sup_shifts WHERE cid = ? AND cancelled_at IS NULL AND start_at <= ? AND end_at > ?").all(cid, t, t).forEach(r => (J(r.fans, []) || []).forEach(f => { out.add(f.fan); if (f.conv) out.add(f.conv); })); return out; };
  app.locals.supFanAt = (cid, fan, at) => db.prepare("SELECT fans FROM sup_shifts WHERE cid = ? AND cancelled_at IS NULL AND start_at <= ? AND end_at + 1800000 >= ?").all(cid, at, at).some(r => (J(r.fans, []) || []).some(f => f.fan === fan));
  app.locals.supFans = uid => { const s = activeSup(uid); return s ? J(s.fans, []) || [] : []; };
  // planning des managers : les shifts accompagnés de la semaine
  app.locals.supWeek = (from, to) => db.prepare("SELECT s.*, m.name model, u.username FROM sup_shifts s JOIN models m ON m.id = s.model_id JOIN users u ON u.id = s.user_id WHERE s.cancelled_at IS NULL").all()
    .filter(s => { const d = parisDate(s.start_at); return d >= from && d <= to; }).map(supView);
  // au début du shift : 15 à 20 fans tirés au hasard parmi ceux qui n'ont jamais rien acheté sur cette créatrice
  let picking = false;
  async function pickFans() { if (picking || !inbox || !inbox.G) return; picking = true;
    try { const t = now();
      for (const s of db.prepare("SELECT * FROM sup_shifts WHERE cancelled_at IS NULL AND fans IS NULL AND start_at <= ? AND end_at > ?").all(t + 5 * 60e3, t)) {
        const cr = db.prepare("SELECT twizz_id FROM twizz_creators WHERE model_id = ? LIMIT 1").get(s.model_id); if (!cr) continue; const cid = cr.twizz_id;
        const buyers = new Set(db.prepare("SELECT DISTINCT fan_id FROM twizz_tx WHERE creator_id = ? AND net > 0").all(cid).map(r => r.fan_id));
        try { db.prepare("SELECT fan_id FROM twizz_vip WHERE creator_id = ?").all(cid).forEach(r => buyers.add(r.fan_id)); } catch (e) {}
        const pool = new Map();
        for (let p = 1; p <= 4 && pool.size < 60; p++) { try { const j = await inbox.G(`/conversations/user/${encodeURIComponent(cid)}?page=${p}&type=GENERAL&creatorId=${encodeURIComponent(cid)}`, 60e3);
            const L = inbox.arr(j).map(c => inbox.conv(c, cid)); if (!L.length) break; L.forEach(c => { if (c.fan && c.fan.id && !buyers.has(c.fan.id)) pool.set(c.fan.id, { fan: c.fan.id, conv: c.id, name: c.fan.name }); }); } catch (e) { break; }
          await new Promise(r => setTimeout(r, 1500)); }
        const A = [...pool.values()]; for (let i = A.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [A[i], A[k]] = [A[k], A[i]]; }
        const pick = A.slice(0, 18);
        db.prepare("UPDATE sup_shifts SET cid = ?, fans = ? WHERE id = ?").run(cid, JSON.stringify(pick), s.id);
        G.log(s.user_id, "a", `Shift accompagné : ${pick.length} fans réservés`, `${dLong(s.start_at)} · ${hm(s.start_at)}–${hm(s.end_at)}`);
      }
    } catch (e) { console.error("Formation, fans réservés", e.message); } finally { picking = false; } }
  setInterval(pickFans, 60e3).unref(); setTimeout(pickFans, 15e3).unref();

  // ---------- alertes au manager ----------
  function alert(uid, kind, key, text, sub) {
    try { const r = db.prepare("INSERT OR IGNORE INTO form_alerts (user_id, kind, key, text, at) VALUES (?,?,?,?,?)").run(uid, kind, key, text, now()); if (!r.changes) return;
      const u = user(uid); G.log(uid, "a", `**${u ? u.username : "?"}** · ${text}`, sub || "Formation");
      if (notify) notify.pushMany(managers(), null, { title: `🎓 ${u ? u.username : "Un chatter en formation"}`, body: text, url: `/suivi-formation?u=${uid}`, tag: "form-" + key }); } catch (e) { console.error("Formation, alerte", e.message); } }
  function sweepAlerts() { const t = now();
    db.prepare("SELECT id, stage_at FROM users WHERE stage = 'formation' AND active = 1 AND deleted_at IS NULL").all().forEach(u => { try {
      const s = state(u.id); if (s.ready) return;
      // même exercice raté 5 fois de suite
      s.mods.forEach(m => { const R = db.prepare("SELECT id, passed FROM ex_runs WHERE user_id = ? AND video_id = ? AND status = 'done' ORDER BY id DESC LIMIT 5").all(u.id, m.id);
        if (R.length === 5 && R.every(r => !r.passed)) alert(u.id, "fail5", `fail5:${u.id}:${m.id}:${R[0].id}`, `a raté 5 fois de suite l'exercice « ${m.title} »`); });
      // aucun progrès depuis 2 jours
      const last = Math.max(u.stage_at || 0, (db.prepare("SELECT MAX(ended_at) t FROM ex_runs WHERE user_id = ? AND passed = 1").get(u.id).t) || 0, (db.prepare("SELECT MAX(done_at) t FROM course_progress WHERE user_id = ?").get(u.id).t) || 0);
      if (t - last > 2 * D) alert(u.id, "stall", `stall:${u.id}:${parisDate(last)}`, "n'a fait aucun progrès depuis 2 jours");
      // 14 jours dépassés
      if (u.stage_at && t - u.stage_at > MAX_DAYS * D) alert(u.id, "over14", `over14:${u.id}:${u.stage_at}`, `est en formation depuis plus de ${MAX_DAYS} jours`);
      // il lui faut un shift accompagné et aucun n'est prévu depuis 2 jours
      if (s.supOpen) { const m6 = s.mods.find(m => m.id === SUP_AFTER), upcoming = s.sups.some(x => x.end_at > t), lastSup = Math.max(...s.sups.map(x => x.end_at), (m6 && m6.doneAt) || 0);
        if (!upcoming && t - lastSup > 2 * D) alert(u.id, "noshift", `noshift:${u.id}:${parisDate(lastSup)}`, "attend un shift accompagné depuis 2 jours"); }
    } catch (e) { console.error("Formation, alertes", e.message); } });
    // prêt pour l'entretien final : une seule fois
    db.prepare("SELECT id FROM users WHERE stage = 'formation' AND active = 1").all().forEach(u => { try { if (state(u.id).ready) alert(u.id, "ready", `ready:${u.id}`, "a tout validé : prêt pour l'entretien final"); } catch (e) {} });
  }
  setInterval(sweepAlerts, 10 * 60e3).unref(); setTimeout(sweepAlerts, 30e3).unref();

  // ---------- côté chatter en formation ----------
  const stageOnly = (req, res, next) => req.user.stage === "formation" ? next() : res.status(403).json({ error: "Réservé aux chatters en formation" });
  app.get("/api/parcours", auth, stageOnly, (req, res) => res.json(state(req.user.id)));
  // entraînements : 3 sessions sur la leçon du module, avec un fan et une situation tirés au hasard
  const trainOf = (req, res) => { const s = state(req.user.id), m = s.mods.find(x => x.id === req.params.vid);
    if (!m || m.locked) { res.status(403).json({ error: "Ce module n'est pas encore débloqué" }); return null; }
    if (!m.exOk) { res.status(400).json({ error: "Regarde d'abord la vidéo et réussis l'exercice de fin" }); return null; }
    if (!m.sim) { res.status(400).json({ error: "Pas d'entraînement pour ce module" }); return null; } return m; };
  const runOf = (req, res) => { const r = G.EXO.load(+req.params.rid); if (!r || r.user_id !== req.user.id || r.video_id !== req.params.vid || r.part !== "train") { res.status(404).json({ error: "Entraînement introuvable" }); return null; } return r; };
  const exErr = (res, e) => res.status(e.status || 500).json({ error: e.status ? e.message : "Erreur, réessaie dans un instant" });
  app.post("/api/parcours/:vid/train/start", auth, stageOnly, (req, res) => { const m = trainOf(req, res); if (!m) return;
    if (G.EXO.todayCount(req.user.id) >= 40) return res.status(429).json({ error: "40 essais aujourd'hui : reviens demain, repose-toi un peu 🙂" });
    res.json(G.EXO.pub(G.EXO.start(req.user.id, m.id, "train", m.sim, true))); });
  app.post("/api/parcours/:vid/train/run/:rid", auth, stageOnly, async (req, res) => { const r = runOf(req, res); if (!r) return; try { res.json(await G.EXO.act(r, req.body || {})); } catch (e) { exErr(res, e); } });
  app.post("/api/parcours/:vid/train/run/:rid/end", auth, stageOnly, async (req, res) => { const r = runOf(req, res); if (!r) return;
    try { const R = await G.EXO.grade(r), s = state(req.user.id), m = s.mods.find(x => x.id === req.params.vid);
      if (m && m.complete && R.passed && m.trainOk === TRAIN_NEED && m.doneAt && now() - m.doneAt < 60e3) G.log(req.user.id, "a", `**${req.user.username}** a validé le module ${m.n} « ${m.title} »`, `${s.done} / ${s.total} modules`);
      res.json({ ...R, module: m ? { trainOk: m.trainOk, trainNeed: TRAIN_NEED, complete: m.complete } : null }); } catch (e) { exErr(res, e); } });
  app.get("/api/parcours/shifts", auth, (req, res) => res.json(db.prepare("SELECT s.*, m.name model FROM sup_shifts s JOIN models m ON m.id = s.model_id WHERE s.user_id = ? AND s.cancelled_at IS NULL ORDER BY s.start_at").all(req.user.id).map(supView)));

  // ---------- onglet « Formation » des managers ----------
  const mgr = (req, res, next) => req.user.rk === "assistant" ? res.status(403).json({ error: "Réservé aux fondateurs et aux managers" }) : next();
  function selection() { const t = now();
    return db.prepare("SELECT id, username, active, created_at FROM users WHERE role = 'trainee' AND deleted_at IS NULL ORDER BY created_at DESC").all().map(u => {
      let tr; try { tr = G.training(u.id); } catch (e) { return null; }
      const dl = tr.deadline || {}; if (!u.active && !(dl.rejectedAt && t - dl.rejectedAt < 7 * D)) return null;
      const C = tr.criteria, simC = C.filter(c => !["speed", "typing"].includes(c.key)), ty = C.find(c => c.key === "typing"), sp = C.find(c => c.key === "speed");
      const iv = tr.interview || {};
      const st = dl.state === "rejected" ? "failed" : iv.done && iv.decision === "refused" ? "refused" : tr.ready ? "passed" : "running";
      return { id: u.id, username: u.username, state: st, left: dl.state === "running" ? dl.left : null, end: dl.end || null, notStarted: dl.state === "notstarted",
        sim: { ok: simC.length > 0 && simC.every(c => c.ok), done: simC.filter(c => c.ok).length, total: simC.length, items: simC.map(c => ({ label: c.label, value: c.value, ok: c.ok })) },
        typing: ty ? { ok: ty.ok, value: ty.value } : null, speed: sp ? { ok: sp.ok, value: sp.value } : null,
        interview: { done: !!iv.done, started: !!iv.started, decision: iv.decision || null, label: iv.decisionLabel || null } };
    }).filter(Boolean); }
  function trainees() {
    return db.prepare("SELECT id FROM users WHERE stage = 'formation' AND active = 1 AND deleted_at IS NULL ORDER BY stage_at").all().map(u => { const s = state(u.id);
      const open = db.prepare("SELECT kind FROM form_alerts WHERE user_id = ? AND done_at IS NULL AND kind <> 'ready'").all(u.id);
      return { id: u.id, username: s.user.username, day: s.day, since: s.since, done: s.done, total: s.total, typing: s.typing, typingGoal: TYPING_GOAL, ready: s.ready, blocked: open.length > 0,
        cur: (s.mods.find(m => !m.complete) || {}).title || null, nextSup: s.sups.find(x => x.end_at > now()) || null, sups: s.sups.length }; }); }
  const alerts = () => db.prepare("SELECT a.*, u.username FROM form_alerts a JOIN users u ON u.id = a.user_id WHERE a.done_at IS NULL AND u.active = 1 AND u.stage = 'formation' ORDER BY a.at DESC LIMIT 30").all();
  app.get("/api/admin/formation", auth, admin, mgr, (req, res) => res.json({ selection: selection(), trainees: trainees(), alerts: alerts(), prime: prime(), models: db.prepare("SELECT id, name FROM models ORDER BY name").all(),
    chatters: db.prepare("SELECT id, username FROM users WHERE role = 'chatter' AND active = 1 AND deleted_at IS NULL AND COALESCE(stage, '') = '' ORDER BY username").all() }));
  // fiche d'un chatter en formation
  app.get("/api/admin/formation/:uid", auth, admin, mgr, (req, res) => { const u = user(+req.params.uid); if (!u || u.stage !== "formation") return res.status(404).json({ error: "Ce compte n'est pas en formation" });
    const s = state(u.id);
    // ce que Grok lui reproche le plus souvent : les derniers conseils des exercices ratés
    const fails = db.prepare("SELECT video_id, result, ended_at FROM ex_runs WHERE user_id = ? AND status = 'done' AND passed = 0 AND started_at >= ? ORDER BY id DESC LIMIT 40").all(u.id, s.since || 0)
      .map(r => { const R = J(r.result, {}); return { video_id: r.video_id, at: r.ended_at, conseil: R.conseil || "", missed: (R.criteria || []).filter(c => !c.ok).map(c => c.name) }; });
    const miss = {}; fails.forEach(f => f.missed.forEach(n => miss[n] = (miss[n] || 0) + 1));
    // ventes faites pendant ses shifts accompagnés (fans réservés uniquement)
    const sups = db.prepare("SELECT s.*, m.name model FROM sup_shifts s JOIN models m ON m.id = s.model_id WHERE s.user_id = ? AND s.cancelled_at IS NULL ORDER BY s.start_at DESC").all(u.id).sort((a, b) => { const r = x => x.start_at <= now() && x.end_at > now() ? 0 : x.start_at > now() ? 1 : 2; return r(a) - r(b) || (r(a) === 1 ? a.start_at - b.start_at : b.start_at - a.start_at); }).map(x => { const v = supView(x), F = J(x.fans, []) || [];
      let sales = 0, n = 0; if (x.cid && F.length) { const ids = new Set(F.map(f => f.fan)); db.prepare("SELECT fan_id, net FROM twizz_tx WHERE creator_id = ? AND at >= ? AND at < ? AND net > 0").all(x.cid, x.start_at, x.end_at + 30 * 60e3).forEach(t => { if (ids.has(t.fan_id)) { sales += t.net; n++; } }); }
      // suivi en direct : un lien vers chaque conversation réservée dans la messagerie
      const fanLinks = x.cid ? F.slice(0, 20).map(f => ({ name: f.name || "Fan", href: `/messagerie?cr=${encodeURIComponent(x.cid)}&conv=${encodeURIComponent(f.conv || "")}&fan=${encodeURIComponent(f.fan)}&name=${encodeURIComponent(f.name || "Fan")}` })) : [];
      return { ...v, sales: Math.round(sales * 100) / 100, nSales: n, fanLinks }; });
    res.json({ ...s, mods: s.mods.map(m => ({ id: m.id, n: m.n, title: m.title, complete: m.complete, locked: m.locked, cap: m.cap, exOk: m.exOk, trainOk: m.trainOk, trainNeed: m.trainNeed, doneAt: m.doneAt, tries: m.tries, watched: m.video.done || m.video.pos })),
      fails: fails.slice(0, 6), missed: Object.entries(miss).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, n]) => ({ name, n })), sups,
      alerts: db.prepare("SELECT * FROM form_alerts WHERE user_id = ? AND done_at IS NULL ORDER BY at DESC").all(u.id), prime: prime() }); });
  const okUser = (req, res, role) => { const u = user(+req.params.uid); if (!u) { res.status(404).json({ error: "Compte introuvable" }); return null; } return u; };
  // sélection : retenu après l'entretien → chatter en formation ; refusé → compte fermé
  app.post("/api/admin/formation/:uid/retain", auth, admin, mgr, (req, res) => { const u = okUser(req, res); if (!u) return; if (u.role !== "trainee") return res.status(400).json({ error: "Ce compte n'est pas en sélection" });
    db.prepare("UPDATE users SET role = 'chatter', stage = 'formation', stage_at = ?, active = 1 WHERE id = ?").run(now(), u.id); try { db.prepare("DELETE FROM training_ready WHERE user_id = ?").run(u.id); } catch (e) {}
    G.log(req.user.id, "a", `**${u.username}** est retenu : il passe en formation`, "Parcours chatter en formation");
    if (notify) notify.push(u.id, "info", { title: "🎓 Tu es retenu !", body: "Bienvenue en formation : ta première étape t'attend sur ta page « Ma formation ».", url: "/ma-formation", tag: "form-start" }).catch(() => {});
    res.json({ ok: true }); });
  app.post("/api/admin/formation/:uid/refuse", auth, admin, mgr, (req, res) => { const u = okUser(req, res); if (!u) return; if (u.role !== "trainee") return res.status(400).json({ error: "Ce compte n'est pas en sélection" });
    db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(u.id); db.prepare("DELETE FROM tokens WHERE user_id = ?").run(u.id);
    try { db.prepare("UPDATE trainee_deadline SET rejected_at = COALESCE(rejected_at, ?) WHERE user_id = ?").run(now(), u.id); } catch (e) {}
    G.log(req.user.id, "a", `**${u.username}** n'est pas retenu après la sélection`, "Compte fermé"); res.json({ ok: true }); });
  // fin de formation : passer chatter (prime ajoutée à sa paie) ou arrêter
  app.post("/api/admin/formation/:uid/hire", auth, admin, mgr, (req, res) => { const u = okUser(req, res); if (!u) return; if (u.stage !== "formation") return res.status(400).json({ error: "Ce compte n'est pas en formation" });
    const amt = prime(), pk = periodOfDate(parisDate(now()));
    db.prepare("UPDATE users SET stage = NULL WHERE id = ?").run(u.id);
    if (amt > 0) db.prepare("INSERT INTO pay_adjust (period, user_id, amount, reason, created_at, created_by) VALUES (?,?,?,?,?,?)").run(pk, u.id, amt, "Prime de formation", now(), req.user.id);
    db.prepare("UPDATE form_alerts SET done_at = ? WHERE user_id = ? AND done_at IS NULL").run(now(), u.id);
    G.log(req.user.id, "a", `**${u.username}** a fini sa formation : il passe chatter 🎉`, amt > 0 ? `Prime de formation de ${amt} € ajoutée à sa paie` : "");
    if (notify) notify.push(u.id, "info", { title: "🎉 Tu es chatter !", body: "Bravo, ta formation est validée. Bienvenue dans l'équipe.", url: "/home", tag: "form-hire" }).catch(() => {});
    res.json({ ok: true, prime: amt }); });
  app.post("/api/admin/formation/:uid/stop", auth, admin, mgr, (req, res) => { const u = okUser(req, res); if (!u) return; if (u.stage !== "formation") return res.status(400).json({ error: "Ce compte n'est pas en formation" });
    db.prepare("UPDATE users SET stage = NULL, active = 0 WHERE id = ?").run(u.id); db.prepare("DELETE FROM tokens WHERE user_id = ?").run(u.id);
    db.prepare("UPDATE sup_shifts SET cancelled_at = ? WHERE user_id = ? AND end_at > ? AND cancelled_at IS NULL").run(now(), u.id, now());
    db.prepare("UPDATE form_alerts SET done_at = ? WHERE user_id = ? AND done_at IS NULL").run(now(), u.id);
    G.log(req.user.id, "a", `Formation de **${u.username}** arrêtée`, "Compte fermé, aucune prime"); res.json({ ok: true }); });
  // remettre un chatter actuel en formation (il garde son compte et son historique ; le parcours repart de zéro)
  app.post("/api/admin/formation/:uid/restart", auth, admin, mgr, (req, res) => { const u = okUser(req, res); if (!u) return; if (u.role !== "chatter" || u.stage) return res.status(400).json({ error: "Seul un chatter actif peut être remis en formation" });
    const ids = [WELCOME.id, ...G.COURSE.map(v => v.id), ...MODS], q = ids.map(() => "?").join(",");
    db.prepare(`DELETE FROM course_progress WHERE user_id = ? AND video_id IN (${q})`).run(u.id, ...ids); db.prepare(`DELETE FROM course_quiz WHERE user_id = ? AND video_id IN (${q})`).run(u.id, ...ids);
    db.prepare("UPDATE users SET stage = 'formation', stage_at = ? WHERE id = ?").run(now(), u.id);
    G.log(req.user.id, "a", `**${u.username}** est remis en formation`, "Le parcours repart du jour 1");
    if (notify) notify.push(u.id, "info", { title: "🎓 Retour en formation", body: "Ton manager t'a remis en formation : ton parcours t'attend sur « Ma formation ».", url: "/ma-formation", tag: "form-start" }).catch(() => {});
    res.json({ ok: true }); });
  // shifts accompagnés : planifier, annuler, noter les corrections
  app.post("/api/admin/formation/:uid/sup", auth, admin, mgr, (req, res) => { const u = okUser(req, res); if (!u) return; if (u.stage !== "formation") return res.status(400).json({ error: "Ce compte n'est pas en formation" });
    const b = req.body || {}, mid = +b.model_id, dur = [45, 60].includes(+b.dur) ? +b.dur : 60, at = +b.start_at;
    if (!db.prepare("SELECT 1 FROM models WHERE id = ?").get(mid)) return res.status(400).json({ error: "Choisis une créatrice" });
    if (!(at > now() - 5 * 60e3) || at > now() + 30 * D) return res.status(400).json({ error: "Choisis un horaire à venir" });
    if (!db.prepare("SELECT twizz_id FROM twizz_creators WHERE model_id = ?").get(mid)) return res.status(400).json({ error: "Cette créatrice n'est pas reliée à Twizz : impossible d'ouvrir sa messagerie" });
    if (db.prepare("SELECT 1 FROM sup_shifts WHERE user_id = ? AND cancelled_at IS NULL AND start_at < ? AND end_at > ?").get(u.id, at + dur * 60e3, at)) return res.status(400).json({ error: "Il a déjà un shift accompagné sur ce créneau" });
    const id = db.prepare("INSERT INTO sup_shifts (user_id, model_id, start_at, end_at, by_id, created_at) VALUES (?,?,?,?,?,?)").run(u.id, mid, at, at + dur * 60e3, req.user.id, now()).lastInsertRowid;
    const m = db.prepare("SELECT name FROM models WHERE id = ?").get(mid), when = `${dLong(at)} · ${hm(at)}–${hm(at + dur * 60e3)}`;
    G.log(req.user.id, "a", `Shift accompagné planifié pour **${u.username}**`, `${m.name} · ${when}`);
    if (notify) notify.push(u.id, "info", { title: "🎓 Shift accompagné planifié", body: `${m.name} · ${when}`, url: "/ma-formation", tag: "sup-" + id }).catch(() => {});
    res.json({ ok: true, id }); });
  app.delete("/api/admin/formation/sup/:id", auth, admin, mgr, (req, res) => { const s = db.prepare("SELECT * FROM sup_shifts WHERE id = ?").get(+req.params.id); if (!s) return res.status(404).json({ error: "Introuvable" });
    db.prepare("UPDATE sup_shifts SET cancelled_at = ? WHERE id = ?").run(now(), s.id);
    if (notify && s.start_at > now()) notify.push(s.user_id, "info", { title: "Shift accompagné annulé", body: `${dLong(s.start_at)} · ${hm(s.start_at)}`, url: "/ma-formation", tag: "sup-" + s.id }).catch(() => {});
    res.json({ ok: true }); });
  app.put("/api/admin/formation/sup/:id/notes", auth, admin, mgr, (req, res) => { const s = db.prepare("SELECT * FROM sup_shifts WHERE id = ?").get(+req.params.id); if (!s) return res.status(404).json({ error: "Introuvable" });
    db.prepare("UPDATE sup_shifts SET notes = ? WHERE id = ?").run(str(req.body && req.body.notes).slice(0, 2000), s.id); res.json({ ok: true }); });
  app.post("/api/admin/formation/alerts/:id/done", auth, admin, mgr, (req, res) => { db.prepare("UPDATE form_alerts SET done_at = ? WHERE id = ?").run(now(), +req.params.id); res.json({ ok: true }); });
  app.put("/api/admin/formation/prime", auth, admin, mgr, (req, res) => { const v = Math.round(+(req.body && req.body.amount)); if (!(v >= 0 && v <= 500)) return res.status(400).json({ error: "Montant invalide" }); S.set("formation_prime", v); res.json({ ok: true, prime: v }); });

  return { state };
};
