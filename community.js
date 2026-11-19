// Vie d'équipe : victoires postées automatiquement dans le chat (paliers, première vente, record perso),
// anniversaires et ancienneté, bienvenue des nouveaux chatters, coéquipier du mois (vote de l'équipe),
// salon #off avec une question du jour chaque matin.
module.exports = function mount(app, db, auth, admin, { chat, compta }) {
  db.exec(`CREATE TABLE IF NOT EXISTS community_done (key TEXT PRIMARY KEY, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS community_tier (user_id INTEGER NOT NULL, period TEXT NOT NULL, tier INTEGER NOT NULL, PRIMARY KEY (user_id, period));
    CREATE TABLE IF NOT EXISTS motm_votes (month TEXT NOT NULL, voter INTEGER NOT NULL, user_id INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (month, voter));
    CREATE TABLE IF NOT EXISTS motm_winners (month TEXT NOT NULL, user_id INTEGER NOT NULL, votes INTEGER NOT NULL, PRIMARY KEY (month, user_id));`);
  try { db.exec("ALTER TABLE users ADD COLUMN birthday TEXT"); } catch (e) {}

  /* ---------- outils ---------- */
  const FMT = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const PZ = (ms = Date.now()) => { const p = Object.fromEntries(FMT.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, ym: `${p.year}-${p.month}`, md: `${p.month}-${p.day}`, y: +p.year, m: +p.month, d: +p.day, h: +p.hour }; };
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const monthLabel = ym => `${MOIS[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`;
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  // minuit (heure de Paris) à la fin du mois
  const monthEnd = ym => { const [y, m] = ym.split("-").map(Number); let g = Date.UTC(y, m, 1) - 3600e3; if (PZ(g).h !== 0) g -= 3600e3; return g; };
  const done = k => !!db.prepare("SELECT 1 FROM community_done WHERE key = ?").get(k);
  const mark = k => db.prepare("INSERT OR IGNORE INTO community_done (key, at) VALUES (?,?)").run(k, Date.now());
  const CH = slug => db.prepare("SELECT * FROM chat_channels WHERE slug = ?").get(slug);
  const say = (slug, body, kind, meta) => { const ch = CH(slug); if (ch) chat.post(ch, null, body, kind, meta); };
  const hooks = {};   // branchés par d'autres modules (ex. Stella's)
  const win = (type, u, extra = {}) => { say("general", "", "win", { type, user_id: u.id, username: u.username, ...extra }); try { hooks.win && hooks.win(type, u, extra); } catch (e) {} };
  // membres de l'équipe : comptes actifs, activés, hors élèves
  const STAFF = "active = 1 AND deleted_at IS NULL AND role <> 'trainee' AND pass_hash <> '!'";
  const chatters = () => db.prepare(`SELECT id, username, bio, birthday, created_at FROM users WHERE ${STAFF} AND role = 'chatter'`).all();
  // ancienneté : 1, 3, 6 mois puis chaque année
  const addMonths = (date, n) => { const [y, m, d] = date.split("-").map(Number), t = (m - 1) + n, Y = y + Math.floor(t / 12), M = t % 12 + 1;
    return `${Y}-${String(M).padStart(2, "0")}-${String(Math.min(d, daysIn(Y, M))).padStart(2, "0")}`; };
  const senLabel = n => n < 12 ? `${n} mois` : n === 12 ? "1 an" : `${n / 12} ans`;
  function milestone(createdAt, today) {
    const c = compta.parisDate(createdAt);
    for (const n of [1, 3, 6, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120]) { const d = addMonths(c, n); if (d === today) return n; if (d > today) break; }
    return 0;
  }
  const bdayToday = (bd, t) => !!bd && (bd === t.md || (bd === "02-29" && t.md === "02-28" && daysIn(t.y, 2) === 28));

  /* ---------- premier passage : rien d'ancien n'est annoncé ---------- */
  if (!done("init")) {
    chatters().forEach(u => mark("welcome:" + u.id));
    db.prepare("SELECT DISTINCT user_id FROM sales WHERE status = 'validated'").all().forEach(r => mark("first:" + r.user_id));
    mark("init");
  }

  /* ---------- victoires ---------- */
  function wins() {
    const now = Date.now(), t = PZ(now), team = chatters(), ids = new Set(team.map(u => u.id)), byId = Object.fromEntries(team.map(u => [u.id, u]));
    // bienvenue aux nouveaux chatters (avant leurs premières victoires)
    team.forEach(u => { if (!done("welcome:" + u.id)) { mark("welcome:" + u.id); win("welcome", u, { bio: u.bio || "" }); } });
    // première vente validée
    db.prepare("SELECT DISTINCT user_id FROM sales WHERE status = 'validated' AND reviewed_at > ?").all(now - 30 * 60e3).forEach(r => {
      if (!ids.has(r.user_id) || done("first:" + r.user_id)) return; mark("first:" + r.user_id);
      if (db.prepare("SELECT MIN(reviewed_at) t FROM sales WHERE user_id = ? AND status = 'validated'").get(r.user_id).t > now - 30 * 60e3) win("first", byId[r.user_id]);
    });
    // record perso : meilleure journée (montant compté au chatter), annoncé une fois par jour
    const todayUsers = db.prepare("SELECT DISTINCT user_id FROM sales WHERE status = 'validated' AND sold_at > ?").all(now - 2 * 864e5).map(r => r.user_id).filter(id => ids.has(id));
    todayUsers.forEach(uid => {
      const k = `rec:${uid}:${t.date}`; if (done(k)) return;
      const days = {}; db.prepare("SELECT sold_at, COALESCE(com_amount, amount) v FROM sales WHERE user_id = ? AND status = 'validated'").all(uid).forEach(s => { const d = compta.parisDate(s.sold_at); days[d] = (days[d] || 0) + s.v; });
      const today = days[t.date] || 0; delete days[t.date]; const prev = Object.values(days);
      if (prev.length >= 3 && today > Math.max(...prev) && today >= 50) { mark(k); win("record", byId[uid], { amount: Math.round(today * 100) / 100 }); }
    });
    // nouveau palier de commission sur la quinzaine
    const key = compta.periodOfDate(t.date), tiers = compta.getTiers();
    let c; try { c = compta.computeCompta(key); } catch (e) { return; }
    c.chatters.filter(x => ids.has(x.id) && !x.flat).forEach(x => {
      const row = db.prepare("SELECT tier FROM community_tier WHERE user_id = ? AND period = ?").get(x.id, key);
      if (!row) return db.prepare("INSERT INTO community_tier (user_id, period, tier) VALUES (?,?,?)").run(x.id, key, x.tier);
      if (x.tier <= row.tier) return;
      db.prepare("UPDATE community_tier SET tier = ? WHERE user_id = ? AND period = ?").run(x.tier, x.id, key);
      const tr = tiers[x.tier] || {}, before = tiers[row.tier] || {};
      win("tier", byId[x.id], { rate: tr.rate, from: tr.from, prime: !!tr.prime && tr.rate === before.rate });
    });
  }

  /* ---------- anniversaires, ancienneté, question du jour ---------- */
  function daily() {
    const t = PZ();
    if (t.h < 9) return;
    db.prepare(`SELECT id, username, role, grade, birthday, created_at FROM users WHERE ${STAFF}`).all().forEach(u => {
      if (bdayToday(u.birthday, t) && !done(`bday:${u.id}:${t.y}`)) { mark(`bday:${u.id}:${t.y}`); win("bday", u); }
      if (u.role === "chatter" || (u.role === "admin" && u.grade !== "founder")) { const n = milestone(u.created_at, t.date);
        if (n && !done(`sen:${u.id}:${n}`)) { mark(`sen:${u.id}:${n}`); win("sen", u, { months: n, label: senLabel(n) }); } }
    });
    if (!done("qotd:" + t.date) && CH("off")) { mark("qotd:" + t.date);
      const start = Date.UTC(2026, 0, 1), n = Math.floor((Date.UTC(t.y, t.m - 1, t.d) - start) / 864e5);
      say("off", QUESTIONS[((n * 37) % QUESTIONS.length + QUESTIONS.length) % QUESTIONS.length], "qotd", {}); }
  }

  /* ---------- coéquipier du mois ---------- */
  const voteOpen = (t = PZ()) => done("motm-open:" + t.ym);
  function motm() {
    const t = PZ(), last = daysIn(t.y, t.m);
    // le vote s'ouvre 3 jours avant la fin du mois, à 10 h, et se ferme à minuit le dernier jour
    if (t.d >= last - 2 && t.h >= 10 && !voteOpen(t)) { mark("motm-open:" + t.ym);
      say("general", "", "motm", { month: t.ym, label: monthLabel(t.ym) }); }
    // résultats le 1er à 10 h
    const prev = t.m === 1 ? `${t.y - 1}-12` : `${t.y}-${String(t.m - 1).padStart(2, "0")}`;
    if (t.h >= 10 && done("motm-open:" + prev) && !done("motm-done:" + prev)) { mark("motm-done:" + prev);
      const rows = db.prepare("SELECT v.user_id, u.username, COUNT(*) n FROM motm_votes v JOIN users u ON u.id = v.user_id WHERE v.month = ? AND u.active = 1 GROUP BY v.user_id ORDER BY n DESC").all(prev);
      if (!rows.length) return;
      const top = rows.filter(r => r.n === rows[0].n);
      top.forEach(r => db.prepare("INSERT OR IGNORE INTO motm_winners (month, user_id, votes) VALUES (?,?,?)").run(prev, r.user_id, r.n));
      const mx = { users: top.map(r => ({ id: r.user_id, username: r.username })), month: prev, label: monthLabel(prev) }; try { hooks.win && hooks.win("motm", {}, mx); } catch (e) {}
      say("general", "", "win", { type: "motm", users: top.map(r => ({ id: r.user_id, username: r.username })), votes: rows[0].n, voters: db.prepare("SELECT COUNT(*) n FROM motm_votes WHERE month = ?").get(prev).n, month: prev, label: monthLabel(prev) });
    }
  }
  // état d'une carte de vote (pour le chat)
  function motmState(month, uid) {
    const t = PZ(), open = month === t.ym && voteOpen(t);
    const mine = db.prepare("SELECT v.user_id, u.username FROM motm_votes v JOIN users u ON u.id = v.user_id WHERE v.month = ? AND v.voter = ?").get(month, uid);
    const voters = db.prepare("SELECT COUNT(*) n FROM motm_votes WHERE month = ?").get(month).n;
    const winners = db.prepare("SELECT w.user_id id, u.username, w.votes FROM motm_winners w JOIN users u ON u.id = w.user_id WHERE w.month = ?").all(month);
    return { open, voters, announced: done("motm-done:" + month), mine: mine ? { id: mine.user_id, username: mine.username } : null, winners, closed: !open && month < t.ym,
      left: open ? Math.max(0, monthEnd(month) - Date.now()) : 0 };
  }
  chat.hooks.motm = (meta, uid) => motmState(meta.month, uid);
  app.get("/api/community/motm", auth, (req, res) => {
    if (req.user.role === "trainee") return res.status(403).json({ error: "Réservé à l'équipe" });
    const t = PZ(), av = Object.fromEntries(db.prepare("SELECT user_id, updated_at FROM user_avatars").all().map(r => [r.user_id, r.updated_at]));
    const cands = db.prepare(`SELECT id, username, display_name, color, bio FROM users WHERE ${STAFF} AND role = 'chatter' AND id <> ? ORDER BY COALESCE(display_name, username) COLLATE NOCASE`).all(req.user.id)
      .map(u => ({ id: u.id, username: u.username, name: u.display_name || u.username, color: u.color || null, bio: u.bio || "", avatar: av[u.id] ? `/api/avatar/${u.id}?v=${av[u.id]}` : null }));
    res.json({ month: t.ym, label: monthLabel(t.ym), ...motmState(t.ym, req.user.id), candidates: cands });
  });
  app.post("/api/community/motm", auth, (req, res) => {
    if (req.user.role === "trainee") return res.status(403).json({ error: "Réservé à l'équipe" });
    const t = PZ(); if (!voteOpen(t)) return res.status(400).json({ error: "Le vote n'est pas ouvert en ce moment" });
    const id = parseInt(req.body?.user_id, 10);
    if (id === req.user.id) return res.status(400).json({ error: "Tu ne peux pas voter pour toi 😉" });
    if (!db.prepare(`SELECT 1 FROM users WHERE id = ? AND ${STAFF} AND role = 'chatter'`).get(id)) return res.status(400).json({ error: "Chatter introuvable" });
    db.prepare("INSERT INTO motm_votes (month, voter, user_id, at) VALUES (?,?,?,?) ON CONFLICT(month, voter) DO UPDATE SET user_id = excluded.user_id, at = excluded.at").run(t.ym, req.user.id, id, Date.now());
    const m = db.prepare("SELECT id FROM chat_messages WHERE kind = 'motm' AND meta LIKE ? ORDER BY id DESC LIMIT 1").get(`%"month":"${t.ym}"%`);
    if (m) chat.bump(m.id);
    res.json({ ok: true });
  });

  /* ---------- tâches ---------- */
  const run = () => { for (const f of [wins, daily, motm]) try { f(); } catch (e) { console.error("communauté", e.message); } };
  setTimeout(run, 15e3); setInterval(run, 60e3).unref();

  // fête du jour pour la personne connectée (confettis à l'ouverture du site)
  function celebrate(uid) {
    const u = db.prepare("SELECT id, username, display_name, role, grade, birthday, created_at FROM users WHERE id = ?").get(uid); if (!u || u.role === "trainee") return null;
    const t = PZ(), name = u.display_name || u.username;
    if (bdayToday(u.birthday, t)) return { type: "bday", key: `bday-${t.y}`, title: `Joyeux anniversaire ${name} !`, sub: "Toute l'équipe StellADS te le souhaite 🎂" };
    const n = (u.role === "chatter" || u.grade !== "founder") ? milestone(u.created_at, t.date) : 0;
    if (n) return { type: "sen", key: `sen-${n}`, title: `${senLabel(n)} chez StellADS !`, sub: `Merci pour tout ce que tu apportes à l'équipe, ${name} ⭐` };
    return null;
  }
  // badge sur la carte de profil
  const motmOf = uid => db.prepare("SELECT month FROM motm_winners WHERE user_id = ? ORDER BY month DESC").all(uid).map(r => ({ month: r.month, label: monthLabel(r.month) }));
  return { celebrate, motmOf, hooks };
};

const QUESTIONS = [
  "Ton plat préféré, celui que tu pourrais manger tous les jours ?",
  "La série que tu recommandes à tout le monde en ce moment ?",
  "Si tu pouvais partir n'importe où demain, ce serait où ?",
  "Ton son du moment, celui qui tourne en boucle ?",
  "Café, thé ou rien du tout pour démarrer la journée ?",
  "Le meilleur conseil qu'on t'ait jamais donné ?",
  "Ta petite routine pour te mettre dans le bain avant un shift ?",
  "Un film que tu peux revoir dix fois sans te lasser ?",
  "Plutôt lève-tôt ou couche-tard ?",
  "Ton snack préféré pendant un shift ?",
  "Si tu gagnais 10 000 € demain, tu ferais quoi en premier ?",
  "Une compétence que tu aimerais apprendre cette année ?",
  "Ton dessin animé préféré quand tu étais petit·e ?",
  "Le pays dont tu rêves de goûter la cuisine ?",
  "Ta saison préférée et pourquoi ?",
  "Un objectif perso que tu veux atteindre avant la fin de l'année ?",
  "Ton emoji le plus utilisé ?",
  "La chose qui te fait rire à coup sûr ?",
  "Si tu avais un super-pouvoir pour une journée, ce serait lequel ?",
  "Ton jeu vidéo ou jeu de société préféré ?",
  "Un artiste que tu aimerais voir en concert ?",
  "Mer ou montagne ?",
  "Le dernier truc qui t'a rendu·e vraiment fier·e ?",
  "Ton endroit préféré pour te poser et décompresser ?",
  "Si tu ouvrais un restaurant, il servirait quoi ?",
  "Le talent caché que personne ici ne connaît ?",
  "Ton animal préféré ? (Bonus : photo de ton animal si tu en as un)",
  "La meilleure chose qui t'est arrivée cette semaine ?",
  "Un livre ou un podcast qui t'a marqué·e ?",
  "Si tu pouvais dîner avec n'importe quelle personne (vivante ou non), qui ?",
  "Ta boisson préférée ?",
  "Le métier dont tu rêvais quand tu étais enfant ?",
  "Une habitude qui a changé ta vie ?",
  "Sucré ou salé ?",
  "La chanson parfaite pour se motiver ?",
  "Ton dessert préféré ?",
  "Si ta vie était un film, il s'appellerait comment ?",
  "Un mot ou une expression que tu dis tout le temps ?",
  "Le dernier fou rire que tu as eu ?",
  "Ville ou campagne ?",
  "Ton meilleur souvenir de vacances ?",
  "Un truc que tu fais mieux que tout le monde ?",
  "Le petit plaisir qui illumine ta journée ?",
  "Netflix, YouTube ou TikTok ?",
  "Ton fruit préféré ?",
  "Une destination que tu as adorée et que tu conseillerais ?",
  "Si tu pouvais maîtriser une langue d'un coup, laquelle ?",
  "Ton rituel du dimanche ?",
  "Le meilleur compliment qu'on t'ait fait ?",
  "Ton sport préféré, à regarder ou à pratiquer ?",
  "Un plat de ton pays ou de ta région que tout le monde devrait goûter ?",
  "Plutôt soirée tranquille ou grosse sortie ?",
  "Ton personnage de fiction préféré ?",
  "Ta façon préférée de te récompenser après une grosse journée ?",
  "Une chose que tu aimerais essayer au moins une fois dans ta vie ?",
  "Chien ou chat ?",
  "La meilleure appli de ton téléphone (à part StellADS 😄) ?",
  "Ton souvenir d'école le plus drôle ?",
  "Si tu pouvais vivre à une autre époque, laquelle ?",
  "Ta couleur préférée ?",
  "Le dernier truc que tu as appris et qui t'a surpris·e ?",
  "Pizza : avec ou sans ananas ?",
  "Une chanson qui te rappelle un super moment ?",
  "Ton combo parfait pour une soirée film ?",
  "Ce que tu ferais d'une journée de 25 heures ?",
  "Ton bruit préféré ? (pluie, vagues, café qui coule…)",
  "Le cadeau le plus mémorable que tu aies reçu ?",
  "Ton look préféré : confort ou stylé ?",
  "Une petite victoire perso de cette semaine ?",
  "Le plat que tu cuisines le mieux ?",
  "Si tu pouvais adopter n'importe quel animal, même improbable ?",
  "Ta citation ou phrase fétiche ?",
  "L'endroit le plus beau que tu aies vu ?",
  "Ce qui te motive le plus en ce moment ?",
  "Ton heure préférée de la journée ?",
  "Plutôt plage, randonnée ou visite de ville en vacances ?",
  "Si tu pouvais avoir un robot qui fait une seule tâche pour toi, laquelle ?",
  "La série que tu as abandonnée en cours de route ?",
  "Ton souvenir préféré avec un ami ?",
  "Le meilleur repas de ta vie ?",
  "Une tradition de famille que tu adores ?",
  "Ton rêve le plus fou ?",
  "Qu'est-ce qui te fait te sentir chez toi, où que tu sois ?",
  "Le dernier truc qui t'a fait sourire ?",
  "Ta playlist du moment, en trois titres ?",
  "Un défi que tu as relevé et dont tu es fier·e ?",
  "Ton pire talent ? 😂",
  "L'objet dont tu ne te sépares jamais ?",
  "Ta façon préférée de commencer le week-end ?",
  "Si tu devais résumer ta semaine en un emoji ?"
];
