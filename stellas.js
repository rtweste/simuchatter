// Stella's : la monnaie de l'équipe. Gagnées en vendant, en étant à l'heure, en aidant ; perdues avec les sanctions ;
// dépensées dans la boutique (cosmétiques, avantages, bonus de paie dans la limite d'un budget mensuel).

// catalogue (les prix et l'activation se règlent dans la Gestion)
const ITEMS = [
  { id: "frame_halo", shelf: "cos", slot: "frame", rar: "C", price: 150, name: "Cadre Halo", desc: "Un liseré lumineux autour de ta photo." },
  { id: "frame_aurora", shelf: "cos", slot: "frame", rar: "E", price: 900, name: "Cadre Aurore", desc: "Un anneau de lumière animé qui tourne autour de ta photo.", featured: true },
  { id: "frame_crown", shelf: "cos", slot: "frame", rar: "L", price: 2000, name: "Couronne d'or", desc: "Le cadre ultime, avec une couronne au-dessus de ta photo." },
  { id: "name_gold", shelf: "cos", slot: "name", rar: "R", price: 400, name: "Pseudo Champagne", desc: "Ton nom en or brillant dans le chat." },
  { id: "name_ice", shelf: "cos", slot: "name", rar: "R", price: 400, name: "Pseudo Glacier", desc: "Ton nom en bleu glacé dans le chat." },
  { id: "banner_nebula", shelf: "cos", slot: "banner", rar: "E", price: 900, name: "Bannière Nébuleuse", desc: "Un ciel de nuit en haut de ta carte de profil." },
  { id: "fx_stars", shelf: "cos", slot: "fx", rar: "L", price: 1800, name: "Pluie d'étoiles", desc: "Tes ventes arrivent dans #ventes sous une pluie d'étoiles dorées." },
  { id: "title_custom", shelf: "cos", slot: "title", rar: "R", price: 500, name: "Titre personnalisé", desc: "Écris ton titre, il s'affiche sous ton nom. Validé par un manager.", request: "title" },
  { id: "joker", shelf: "adv", price: 250, name: "Joker retard", desc: "Efface un retard de 15 min maximum : pas de sanction et pas de perte de Stella's.", consumable: true, perMonth: 1 },
  { id: "pause15", shelf: "adv", price: 120, name: "Pause bonus", desc: "+15 min de pause sur un shift, sans alerte « pause trop longue ».", consumable: true },
  { id: "bonus10", shelf: "rew", price: 800, eur: 10, name: "Bonus de paie 10 €", desc: "Ajouté à ta prochaine paie dès que le fondateur valide.", request: "bonus" },
  { id: "bonus25", shelf: "rew", price: 2000, eur: 25, name: "Bonus de paie 25 €", desc: "Ajouté à ta prochaine paie dès que le fondateur valide.", request: "bonus" }
];
const RULES = {   // gains et pertes par défaut
  sale10: 1, superSale: 10, ontime: 5, streak7: 25, streak30: 120, swap: 20, sos: 15, handover: 3, tier: 30, challenge: 50, motm: 150,
  sancLight: 30, sancMid: 60, sancHeavy: 100
};
const CAPPED = new Set(["ontime", "streak", "swap", "sos", "handover", "tier"]);   // gains limités par jour (hors ventes, défis, coéquipier, ajouts manuels)

module.exports = function mount(app, db, auth, admin, { compta, planning, gest, community }) {
  db.exec(`CREATE TABLE IF NOT EXISTS stella_tx (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, sub TEXT,
      ref TEXT UNIQUE, by_user INTEGER, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS stella_tx_user ON stella_tx(user_id, at);
    CREATE TABLE IF NOT EXISTS stella_owned (user_id INTEGER NOT NULL, item_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, item_id));
    CREATE TABLE IF NOT EXISTS stella_equip (user_id INTEGER NOT NULL, slot TEXT NOT NULL, item_id TEXT NOT NULL, value TEXT, PRIMARY KEY (user_id, slot));
    CREATE TABLE IF NOT EXISTS stella_inv (user_id INTEGER NOT NULL, item_id TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, item_id));
    CREATE TABLE IF NOT EXISTS stella_goal (user_id INTEGER PRIMARY KEY, item_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS stella_requests (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, item_id TEXT NOT NULL, kind TEXT NOT NULL, cost INTEGER NOT NULL, eur REAL, text TEXT,
      status TEXT NOT NULL DEFAULT 'pending', month TEXT NOT NULL, created_at INTEGER NOT NULL, decided_by INTEGER, decided_at INTEGER, adj_id INTEGER);
    CREATE TABLE IF NOT EXISTS stella_jokers (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, shift_id INTEGER NOT NULL, source_key TEXT UNIQUE NOT NULL, late INTEGER, at INTEGER NOT NULL, cancelled_by INTEGER);`);
  try { db.exec("ALTER TABLE pauses ADD COLUMN bonus INTEGER NOT NULL DEFAULT 0"); } catch (e) {}

  const now = () => Date.now();
  const getSet = (k, d) => { const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(k); return r ? r.value : d; };
  const setSet = (k, v) => db.prepare("INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, String(v));
  if (!getSet("stellas_start")) setSet("stellas_start", now());
  const START = +getSet("stellas_start");
  const CFG = () => { let c = {}; try { c = JSON.parse(getSet("stellas", "{}")); } catch (e) {}
    return { open: c.open !== false, cap: c.cap ?? 300, budget: c.budget ?? 100, envelope: c.envelope ?? 300, rules: { ...RULES, ...(c.rules || {}) }, items: c.items || {} }; };
  const item = id => { const d = ITEMS.find(i => i.id === id); if (!d) return null; const o = CFG().items[id] || {}; return { ...d, price: o.price ?? d.price, active: o.active !== false }; };
  const items = () => ITEMS.map(i => item(i.id));
  const FMT = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
  const pd = ms => { const p = Object.fromEntries(FMT.formatToParts(new Date(ms)).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; };
  const month = (ms = now()) => pd(ms).slice(0, 7);
  const dayStart = ms => { const d = pd(ms); let t = Date.parse(d + "T00:00:00Z") - 3600e3; while (pd(t) !== d) t += 3600e3; while (pd(t - 60e3) === d) t -= 3600e3; return t; };
  const monthStart = () => { const m = month(); let t = Date.parse(m + "-01T00:00:00Z") - 3 * 3600e3; while (month(t) !== m) t += 600e3; return t; };
  const eur = n => Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
  const user = id => db.prepare("SELECT id, username, role, grade, active, display_name FROM users WHERE id = ?").get(id);
  const log = (...a) => { try { gest.log(...a); } catch (e) {} };

  /* ---------- soldes et mouvements ---------- */
  const balance = uid => db.prepare("SELECT COALESCE(SUM(amount),0) b FROM stella_tx WHERE user_id = ?").get(uid).b;
  // écrit un mouvement (idempotent grâce à ref) ; une perte ne fait jamais passer sous zéro ; les gains plafonnés par jour
  function tx(uid, amount, kind, label, sub = "", ref = null, by = null, at = now()) {
    amount = Math.round(amount); if (!amount) return 0;
    if (ref && db.prepare("SELECT 1 FROM stella_tx WHERE ref = ?").get(ref)) return 0;
    if (amount < 0) { const b = balance(uid); amount = Math.max(amount, -b); }
    else if (CAPPED.has(kind)) { const got = db.prepare(`SELECT COALESCE(SUM(amount),0) n FROM stella_tx WHERE user_id = ? AND amount > 0 AND at >= ? AND kind IN (${[...CAPPED].map(() => "?").join(",")})`).get(uid, dayStart(now()), ...CAPPED).n;
      amount = Math.min(amount, Math.max(0, CFG().cap - got)); }
    if (!amount && !ref) return 0;
    db.prepare("INSERT INTO stella_tx (user_id, amount, kind, label, sub, ref, by_user, at) VALUES (?,?,?,?,?,?,?,?)").run(uid, amount, kind, label, sub || "", ref, by, at);
    return amount;
  }
  const isChatter = uid => { const u = user(uid); return u && u.active && u.role === "chatter"; };

  /* ---------- gains automatiques ---------- */
  function scan() {
    const C = CFG(), R = C.rules, t = now(), sup = +(gest.agency().superSale ?? 100);
    // ventes validées (montant compté au chatter), reprises si la vente est refusée ensuite
    db.prepare("SELECT s.id, s.user_id, s.amount, COALESCE(s.com_amount, s.amount) v, m.name model FROM sales s JOIN models m ON m.id = s.model_id WHERE s.status = 'validated' AND s.reviewed_at > ?").all(START).forEach(s => {
      if (!isChatter(s.user_id)) return;
      const n = Math.floor(s.v / 10) * R.sale10 + (s.v >= sup && s.v > 0 ? R.superSale : 0);
      if (n > 0) tx(s.user_id, n, "sale", s.v >= sup ? "Super vente validée" : "Vente validée", `${eur(s.v)} sur ${s.model}`, "sale:" + s.id);
    });
    db.prepare("SELECT t.id, t.user_id, t.amount, t.sub, CAST(substr(t.ref, 6) AS INTEGER) sid FROM stella_tx t WHERE t.kind = 'sale' AND t.ref LIKE 'sale:%'").all().forEach(x => {
      const s = db.prepare("SELECT status FROM sales WHERE id = ?").get(x.sid);
      if (s && s.status !== "validated") tx(x.user_id, -x.amount, "sale_back", "Vente annulée", x.sub, "sale-back:" + x.sid);
    });
    // ponctualité et séries (un joker compte comme « à l'heure » pour la série)
    const since = pd(Math.max(START, t - 40 * 864e5) - 864e5);
    const shifts = planning.decorate(db.prepare(`${planning.SHIFT_SQL} WHERE s.date >= ? ORDER BY s.date, s.start`).all(since)).filter(s => s.start_ms >= START && s.state !== "future" && s.state !== "missing");
    const jok = new Set(db.prepare("SELECT source_key FROM stella_jokers WHERE cancelled_by IS NULL").all().map(r => r.source_key));
    const byUser = {}; shifts.forEach(s => (byUser[s.user_id] = byUser[s.user_id] || []).push(s));
    Object.entries(byUser).forEach(([uid, list]) => { uid = +uid; if (!isChatter(uid)) return;
      let run = 0; list.sort((a, b) => a.start_ms - b.start_ms).forEach(s => {
        const ok = !!s.clock_in && !s.late, joker = jok.has(`late:${s.id}:${uid}`);
        if (ok) tx(uid, R.ontime, "ontime", "Shift commencé à l'heure", `${s.model_name} · ${s.start}`, `ontime:${s.id}:${uid}`, null, s.clock_in);
        if (ok || joker) { run++;
          if (run % 7 === 0) tx(uid, R.streak7, "streak", `Série de ${run} shifts à l'heure`, "Bonus de régularité", `streak7:${s.id}:${uid}`);
          if (run % 30 === 0) tx(uid, R.streak30, "streak", `Série de ${run} shifts à l'heure`, "Un mois parfait", `streak30:${s.id}:${uid}`); }
        else if (s.state === "done" || s.state === "absent") run = 0;
      });
    });
    // shifts repris pour un collègue
    db.prepare("SELECT w.id, w.to_user, u.username fu FROM shift_swaps w JOIN users u ON u.id = w.from_user WHERE w.status = 'approved' AND w.decided_at > ?").all(START)
      .forEach(w => { if (isChatter(w.to_user)) tx(w.to_user, R.swap, "swap", `Shift repris pour ${w.fu}`, "Échange validé par un manager", "swap:" + w.id); });
    // meilleure réponse en aide fan (24 h après la demande, au moins une étoile)
    try { db.prepare("SELECT id, user_id FROM chat_messages WHERE kind = 'sos' AND deleted_at IS NULL AND created_at > ? AND created_at < ?").all(START, t - 864e5).forEach(m => {
      const best = db.prepare("SELECT r.user_id, COUNT(x.user_id) n FROM chat_messages r JOIN chat_reactions x ON x.message_id = r.id AND x.emoji = '⭐' WHERE r.thread_root = ? AND r.deleted_at IS NULL AND r.user_id <> ? GROUP BY r.id ORDER BY n DESC, r.id LIMIT 1").get(m.id, m.user_id || 0);
      if (best && isChatter(best.user_id)) tx(best.user_id, R.sos, "sos", "Meilleure réponse en aide fan", `${best.n} étoile${best.n > 1 ? "s" : ""} de l'équipe`, "sos:" + m.id);
    }); } catch (e) {}
    // passations (une par créatrice et par jour)
    try { db.prepare("SELECT h.id, h.from_user, h.model_id, h.at, m.name FROM handovers h JOIN models m ON m.id = h.model_id WHERE h.at > ?").all(START).forEach(h => {
      if (isChatter(h.from_user)) tx(h.from_user, R.handover, "handover", "Passation remplie", h.name, `ho:${h.from_user}:${h.model_id}:${pd(h.at)}`, null, h.at); }); } catch (e) {}
    // défis gagnés
    try { db.prepare("SELECT r.challenge_id, r.user_id, c.title FROM challenge_results r JOIN challenges c ON c.id = r.challenge_id WHERE r.won = 1 AND c.end_at > ?").all(START)
      .forEach(r => { if (isChatter(r.user_id)) tx(r.user_id, R.challenge, "challenge", "Défi gagné", r.title, `chal:${r.challenge_id}:${r.user_id}`); }); } catch (e) {}
    // sanctions : perte selon la gravité, rendue si la sanction est annulée
    db.prepare("SELECT id, user_id, label, points, status FROM sanctions WHERE created_at > ?").all(START).forEach(s => {
      const lvl = s.points >= 3 ? ["sancHeavy", "grave"] : s.points >= 2 ? ["sancMid", "moyenne"] : ["sancLight", "légère"];
      if (s.status === "active") tx(s.user_id, -R[lvl[0]], "sanction", `Sanction ${lvl[1]}`, s.label.replace(/^[^·]+· /, ""), "sanc:" + s.id);
      else { const g = db.prepare("SELECT amount FROM stella_tx WHERE ref = ?").get("sanc:" + s.id); if (g) tx(s.user_id, -g.amount, "sanction_back", "Sanction annulée", s.label.replace(/^[^·]+· /, ""), "sanc-back:" + s.id); }
    });
  }
  // victoires annoncées par la vie d'équipe : palier atteint, coéquipier du mois
  if (community && community.hooks) community.hooks.win = (type, u, extra = {}) => { try {
    const R = CFG().rules;
    if (type === "tier" && isChatter(u.id)) tx(u.id, R.tier, "tier", extra.prime ? `Palier de ${eur(extra.from)} atteint` : `Palier de ${extra.rate} % atteint`, "Quinzaine en cours", `tier:${u.id}:${compta.periodOfDate(pd(now()))}:${extra.rate}:${extra.from}`);
    if (type === "motm") (extra.users || []).forEach(w => { if (isChatter(w.id)) tx(w.id, R.motm, "motm", "Coéquipier du mois", extra.label || "", `motm:${extra.month}:${w.id}`); });
  } catch (e) { console.error("stellas win", e.message); } };
  setTimeout(() => { try { scan(); } catch (e) { console.error("stellas", e.message); } }, 20e3);
  setInterval(() => { try { scan(); } catch (e) { console.error("stellas", e.message); } }, 60e3).unref();

  /* ---------- état pour le chatter ---------- */
  const budgetUsed = () => db.prepare("SELECT COALESCE(SUM(eur),0) n FROM stella_requests WHERE kind = 'bonus' AND month = ? AND status IN ('pending','approved')").get(month()).n;
  const inv = uid => Object.fromEntries(db.prepare("SELECT item_id, qty FROM stella_inv WHERE user_id = ? AND qty > 0").all(uid).map(r => [r.item_id, r.qty]));
  const jokersThisMonth = uid => db.prepare("SELECT COUNT(*) n FROM stella_tx WHERE user_id = ? AND ref LIKE 'buy:joker:%' AND at >= ?").get(uid, monthStart()).n;
  function streakOf(uid) {
    const list = planning.decorate(db.prepare(`${planning.SHIFT_SQL} WHERE s.user_id = ? AND s.date >= ? ORDER BY s.date, s.start`).all(uid, pd(now() - 60 * 864e5)))
      .filter(s => s.state === "done" || s.state === "absent" || (s.state === "live" && s.clock_in));
    const jok = new Set(db.prepare("SELECT source_key FROM stella_jokers WHERE user_id = ? AND cancelled_by IS NULL").all(uid).map(r => r.source_key));
    let run = 0, best = 0; list.forEach(s => { if ((s.clock_in && !s.late) || jok.has(`late:${s.id}:${uid}`)) { run++; best = Math.max(best, run); } else run = 0; });
    return { run, best, next: 7 - (run % 7) };
  }
  function looksOf(uid) { const o = {}; db.prepare("SELECT slot, item_id, value FROM stella_equip WHERE user_id = ?").all(uid).forEach(r => o[r.slot] = r.slot === "title" ? r.value : r.item_id); return o; }
  function meState(uid) {
    const C = CFG(), bal = balance(uid), owned = new Set(db.prepare("SELECT item_id FROM stella_owned WHERE user_id = ?").all(uid).map(r => r.item_id));
    const eq = looksOf(uid), iv = inv(uid), left = Math.max(0, C.budget - budgetUsed()), jm = jokersThisMonth(uid);
    const pend = db.prepare("SELECT id, item_id, kind, cost, eur, text, status, created_at FROM stella_requests WHERE user_id = ? AND (status = 'pending' OR created_at > ?) ORDER BY created_at DESC").all(uid, now() - 14 * 864e5);
    const goal = (db.prepare("SELECT item_id FROM stella_goal WHERE user_id = ?").get(uid) || {}).item_id || null;
    const sinceW = now() - 7 * 864e5, sinceM = monthStart();
    const sum = (a, b, pos) => db.prepare(`SELECT COALESCE(SUM(amount),0) n FROM stella_tx WHERE user_id = ? AND at >= ? AND amount ${pos ? ">" : "<"} 0 AND kind NOT IN ('buy','refund')`).get(uid, a).n;
    const spent = -db.prepare("SELECT COALESCE(SUM(amount),0) n FROM stella_tx WHERE user_id = ? AND at >= ? AND kind = 'buy'").get(uid, sinceM).n
      - db.prepare("SELECT COALESCE(SUM(amount),0) n FROM stella_tx WHERE user_id = ? AND at >= ? AND kind = 'refund'").get(uid, sinceM).n;
    const list = items().filter(i => i.active || owned.has(i.id)).map(i => {
      let state = "buy", note = "";
      if (i.shelf === "cos" && i.slot !== "title" && owned.has(i.id)) state = (eq[i.slot] === i.id) ? "equipped" : "owned";
      if (i.id === "title_custom" && eq.title) { note = `Ton titre : « ${eq.title} »`; }
      if (i.request && pend.some(r => r.item_id === i.id && r.status === "pending")) state = "pending";
      if (i.consumable && iv[i.id]) note = `${iv[i.id]} en réserve`;
      if (i.perMonth && jm >= i.perMonth && state === "buy") { state = "limit"; note = "Déjà pris ce mois-ci"; }
      if (i.eur && state === "buy" && i.eur > left) { state = "soldout"; note = "Épuisé ce mois-ci · retour le 1er"; }
      if (state === "buy" && bal < i.price) { state = "short"; note = `Encore ${i.price - bal}`; }
      if (!i.active) state = state === "equipped" || state === "owned" ? state : "off";
      return { ...i, state, note, missing: Math.max(0, i.price - bal) };
    });
    return { open: C.open, balance: bal, week: sum(sinceW, 0, true), monthGain: sum(sinceM, 0, true), monthSpent: Math.max(0, spent), streak: streakOf(uid), goal, items: list, equipped: eq, inv: iv,
      budget: { total: C.budget, left }, requests: pend, rules: C.rules, cap: C.cap };
  }
  const chatterOnly = (req, res, next) => req.user.role === "chatter" ? next() : res.status(403).json({ error: "La boutique est réservée aux chatters" });
  // managers et fondateurs : aperçu de la boutique telle que la voient les chatters (lecture seule, pas d'achat)
  const canSee = (req, res, next) => req.user.role === "chatter" || (req.user.role === "admin" && req.user.rk !== "assistant") ? next() : res.status(403).json({ error: "La boutique est réservée aux chatters" });
  app.get("/api/stellas/me", auth, canSee, (req, res) => res.json({ ...meState(req.user.id), preview: req.user.role !== "chatter" }));
  app.get("/api/stellas/history", auth, canSee, (req, res) => {
    const before = +req.query.before || now() + 1, kind = req.query.kind;
    const where = kind === "gain" ? "AND amount > 0 AND kind NOT IN ('refund')" : kind === "buy" ? "AND kind IN ('buy','refund')" : kind === "loss" ? "AND amount < 0 AND kind NOT IN ('buy')" : "";
    res.json(db.prepare(`SELECT id, amount, kind, label, sub, at FROM stella_tx WHERE user_id = ? AND at < ? AND amount <> 0 ${where} ORDER BY at DESC, id DESC LIMIT 40`).all(req.user.id, before));
  });
  app.get("/api/stellas/weekly", auth, canSee, (req, res) => {
    // 8 dernières semaines (lundi), gains par famille
    const wd = (new Date(pd(now()) + "T12:00:00Z").getUTCDay() + 6) % 7, mon = dayStart(now() - wd * 864e5);
    const out = []; for (let i = 7; i >= 0; i--) { const a = dayStart(mon - i * 7 * 864e5 + 6 * 3600e3), b = i ? dayStart(mon - (i - 1) * 7 * 864e5 + 6 * 3600e3) : now() + 1;
      const g = k => db.prepare(`SELECT COALESCE(SUM(amount),0) n FROM stella_tx WHERE user_id = ? AND at >= ? AND at < ? AND amount > 0 AND kind IN (${k.map(() => "?").join(",")})`).get(req.user.id, a, b, ...k).n;
      out.push({ from: a, sales: g(["sale"]), time: g(["ontime", "streak"]), help: g(["swap", "sos", "handover", "tier", "challenge", "motm", "grant"]) }); }
    res.json(out);
  });
  // nouveaux mouvements (petites notifications)
  app.get("/api/stellas/feed", auth, (req, res) => {
    if (req.user.role !== "chatter") return res.json({ items: [], last: 0 });
    const after = +req.query.after || 0, last = (db.prepare("SELECT MAX(id) m FROM stella_tx WHERE user_id = ?").get(req.user.id) || {}).m || 0;
    const items = after ? db.prepare("SELECT id, amount, kind, label, sub FROM stella_tx WHERE user_id = ? AND id > ? AND amount <> 0 AND kind NOT IN ('buy','refund') ORDER BY id LIMIT 5").all(req.user.id, after) : [];
    res.json({ uid: req.user.id, items, last, balance: balance(req.user.id) });
  });

  /* ---------- achats ---------- */
  app.post("/api/stellas/buy", auth, chatterOnly, (req, res) => {
    const C = CFG(); if (!C.open) return res.status(400).json({ error: "La boutique est fermée pour le moment" });
    const it = item(String(req.body?.item || "")); if (!it || !it.active) return res.status(404).json({ error: "Article introuvable" });
    const uid = req.user.id, bal = balance(uid);
    if (bal < it.price) return res.status(400).json({ error: `Il te manque ${it.price - bal} Stella's` });
    if (it.shelf === "cos" && !it.request && db.prepare("SELECT 1 FROM stella_owned WHERE user_id = ? AND item_id = ?").get(uid, it.id)) return res.status(400).json({ error: "Tu l'as déjà" });
    if (it.request && db.prepare("SELECT 1 FROM stella_requests WHERE user_id = ? AND item_id = ? AND status = 'pending'").get(uid, it.id)) return res.status(400).json({ error: "Une demande est déjà en attente" });
    if (it.perMonth && jokersThisMonth(uid) >= it.perMonth) return res.status(400).json({ error: "Tu en as déjà pris un ce mois-ci" });
    let text = null;
    if (it.request === "title") { text = String(req.body?.text || "").replace(/\s+/g, " ").trim().slice(0, 24);
      if (text.length < 2) return res.status(400).json({ error: "Écris ton titre (2 à 24 caractères)" }); }
    if (it.eur && it.eur > Math.max(0, C.budget - budgetUsed())) return res.status(400).json({ error: "Épuisé ce mois-ci, retour le 1er" });
    const ref = `buy:${it.id}:${uid}:${now()}`;
    db.exec("BEGIN");
    try {
      tx(uid, -it.price, "buy", `Achat · ${it.name}`, it.request ? "En attente de validation" : it.shelf === "cos" ? "Cosmétique" : it.shelf === "adv" ? "Avantage" : "Récompense", ref);
      if (it.shelf === "cos" && !it.request) { db.prepare("INSERT OR IGNORE INTO stella_owned (user_id, item_id, at) VALUES (?,?,?)").run(uid, it.id, now());
        db.prepare("INSERT INTO stella_equip (user_id, slot, item_id) VALUES (?,?,?) ON CONFLICT(user_id, slot) DO UPDATE SET item_id = excluded.item_id, value = NULL").run(uid, it.slot, it.id); }
      if (it.consumable) db.prepare("INSERT INTO stella_inv (user_id, item_id, qty) VALUES (?,?,1) ON CONFLICT(user_id, item_id) DO UPDATE SET qty = qty + 1").run(uid, it.id);
      if (it.request) db.prepare("INSERT INTO stella_requests (user_id, item_id, kind, cost, eur, text, month, created_at) VALUES (?,?,?,?,?,?,?,?)").run(uid, it.id, it.request, it.price, it.eur || null, text, month(), now());
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); return res.status(500).json({ error: "Achat impossible, réessaie" }); }
    log(uid, "a", `**${req.user.username}** a acheté **${it.name}** dans la boutique`, `${it.price} Stella's${it.request ? " · à valider" : ""}`);
    res.json({ ok: true, state: meState(uid) });
  });
  app.post("/api/stellas/equip", auth, chatterOnly, (req, res) => {
    const uid = req.user.id, it = item(String(req.body?.item || ""));
    if (req.body?.off) { const slot = String(req.body.off); db.prepare("DELETE FROM stella_equip WHERE user_id = ? AND slot = ? AND slot <> 'title'").run(uid, slot); return res.json({ ok: true, state: meState(uid) }); }
    if (!it || it.shelf !== "cos" || it.request || !db.prepare("SELECT 1 FROM stella_owned WHERE user_id = ? AND item_id = ?").get(uid, it.id)) return res.status(400).json({ error: "Tu ne possèdes pas cet article" });
    db.prepare("INSERT INTO stella_equip (user_id, slot, item_id) VALUES (?,?,?) ON CONFLICT(user_id, slot) DO UPDATE SET item_id = excluded.item_id").run(uid, it.slot, it.id);
    res.json({ ok: true, state: meState(uid) });
  });
  app.post("/api/stellas/title/hide", auth, chatterOnly, (req, res) => {
    db.prepare("DELETE FROM stella_equip WHERE user_id = ? AND slot = 'title'").run(req.user.id); res.json({ ok: true, state: meState(req.user.id) });
  });
  app.post("/api/stellas/goal", auth, chatterOnly, (req, res) => {
    const it = req.body?.item ? item(String(req.body.item)) : null;
    if (it) db.prepare("INSERT INTO stella_goal (user_id, item_id) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET item_id = excluded.item_id").run(req.user.id, it.id);
    else db.prepare("DELETE FROM stella_goal WHERE user_id = ?").run(req.user.id);
    res.json({ ok: true, state: meState(req.user.id) });
  });

  /* ---------- joker retard ---------- */
  function jokerShifts(uid) {
    return planning.decorate(db.prepare(`${planning.SHIFT_SQL} WHERE s.user_id = ? AND s.date >= ?`).all(uid, pd(now() - 7 * 864e5)))
      .filter(s => s.clock_in && s.late > 0 && s.late <= 15)
      .filter(s => { const k = `late:${s.id}:${uid}`; return !db.prepare("SELECT 1 FROM stella_jokers WHERE source_key = ?").get(k) && !db.prepare("SELECT 1 FROM sanctions WHERE source_key = ? AND status = 'active'").get(k); })
      .map(s => ({ shift_id: s.id, date: s.date, start: s.start, end: s.end, model: s.model_name, late: s.late }));
  }
  app.get("/api/stellas/joker", auth, chatterOnly, (req, res) => res.json({ have: inv(req.user.id).joker || 0, shifts: jokerShifts(req.user.id) }));
  app.post("/api/stellas/joker", auth, chatterOnly, (req, res) => {
    const uid = req.user.id; if (!(inv(uid).joker > 0)) return res.status(400).json({ error: "Tu n'as pas de joker retard" });
    const s = jokerShifts(uid).find(x => x.shift_id === +req.body?.shift_id); if (!s) return res.status(400).json({ error: "Ce retard ne peut pas être effacé (plus de 15 min, déjà sanctionné ou trop ancien)" });
    const key = `late:${s.shift_id}:${uid}`;
    db.prepare("UPDATE stella_inv SET qty = qty - 1 WHERE user_id = ? AND item_id = 'joker'").run(uid);
    db.prepare("INSERT INTO stella_jokers (user_id, shift_id, source_key, late, at) VALUES (?,?,?,?,?)").run(uid, s.shift_id, key, s.late, now());
    db.prepare("UPDATE sanction_props SET status = 'ignored' WHERE source_key = ? AND status = 'open'").run(key);
    log(uid, "a", `**${req.user.username}** a utilisé un joker retard`, `${s.date} · ${s.start}–${s.end} · ${s.model} · ${s.late} min effacées`);
    res.json({ ok: true, state: meState(uid) });
  });
  /* ---------- pause bonus ---------- */
  app.post("/api/stellas/pause-bonus", auth, chatterOnly, (req, res) => {
    const uid = req.user.id; if (!(inv(uid).pause15 > 0)) return res.status(400).json({ error: "Tu n'as pas de pause bonus" });
    const p = db.prepare("SELECT p.id FROM pauses p JOIN clocks c ON c.id = p.clock_id WHERE p.user_id = ? AND p.end_at IS NULL AND c.end_at IS NULL").get(uid);
    if (!p) return res.status(400).json({ error: "Lance d'abord une pause, puis utilise ta pause bonus" });
    db.prepare("UPDATE stella_inv SET qty = qty - 1 WHERE user_id = ? AND item_id = 'pause15'").run(uid);
    db.prepare("UPDATE pauses SET bonus = bonus + 15, over_logged = 0 WHERE id = ?").run(p.id);
    log(uid, "pl", `**${req.user.username}** utilise une pause bonus`, "+15 min de pause");
    res.json({ ok: true, state: meState(uid) });
  });

  /* ---------- cosmétiques de toute l'équipe (pour l'affichage) ---------- */
  app.get("/api/stellas/looks", auth, (req, res) => {
    const out = {}; db.prepare("SELECT e.user_id, e.slot, e.item_id, e.value FROM stella_equip e JOIN users u ON u.id = e.user_id WHERE u.active = 1").all()
      .forEach(r => { (out[r.user_id] = out[r.user_id] || {})[r.slot] = r.slot === "title" ? r.value : r.item_id; });
    res.json(out);
  });

  /* ================= GESTION ================= */
  const staff = (req, res, next) => ["founder", "manager"].includes(req.user.rk) ? next() : res.status(403).json({ error: "Réservé au fondateur et aux managers" });
  const founder = (req, res, next) => req.user.rk === "founder" ? next() : res.status(403).json({ error: "Réservé au fondateur" });
  const envelopeLeft = uid => Math.max(0, CFG().envelope - db.prepare("SELECT COALESCE(SUM(amount),0) n FROM stella_tx WHERE kind = 'grant' AND by_user = ? AND amount > 0 AND at >= ?").get(uid, monthStart()).n);
  const reqRow = r => { const it = item(r.item_id) || {}; return { ...r, item_name: it.name || r.item_id }; };
  app.get("/api/admin/stellas/overview", auth, admin, staff, (req, res) => {
    const C = CFG(), m0 = monthStart(), isF = req.user.rk === "founder";
    const chatters = db.prepare("SELECT id, username, display_name FROM users WHERE role = 'chatter' AND active = 1 AND deleted_at IS NULL ORDER BY username").all();
    const ids = chatters.map(c => c.id), q = ids.map(() => "?").join(",") || "0";
    const gainBy = Object.fromEntries(db.prepare(`SELECT user_id, SUM(amount) n FROM stella_tx WHERE at >= ? AND amount > 0 AND kind NOT IN ('refund','sale_back','sanction_back') AND user_id IN (${q}) GROUP BY user_id`).all(m0, ...ids).map(r => [r.user_id, r.n]));
    const mix = uid => { const r = db.prepare(`SELECT kind, SUM(amount) n FROM stella_tx WHERE user_id = ? AND at >= ? AND amount > 0 GROUP BY kind ORDER BY n DESC LIMIT 1`).get(uid, m0); return r ? ({ sale: "ventes", ontime: "ponctualité", streak: "ponctualité", swap: "entraide", sos: "entraide", handover: "passations", tier: "paliers", challenge: "défis", motm: "coéquipier du mois", grant: "coups de pouce" }[r.kind] || "") : ""; };
    const team = chatters.map(c => { const last = db.prepare("SELECT amount, label FROM stella_tx WHERE user_id = ? AND amount <> 0 ORDER BY at DESC, id DESC LIMIT 1").get(c.id), st = streakOf(c.id);
      return { id: c.id, username: c.username, name: c.display_name || c.username, balance: balance(c.id), month: gainBy[c.id] || 0, streak: st.run, mix: mix(c.id), last: last ? { amount: last.amount, label: last.label } : null }; })
      .sort((a, b) => b.month - a.month);
    const reqs = db.prepare("SELECT r.*, u.username FROM stella_requests r JOIN users u ON u.id = r.user_id WHERE r.status = 'pending' ORDER BY r.created_at").all().map(reqRow);
    // ponctualité du mois (shifts commencés à l'heure / shifts passés)
    let pct = null; try { const sh = planning.decorate(db.prepare(`${planning.SHIFT_SQL} WHERE s.date >= ? AND s.date <= ?`).all(month() + "-01", pd(now()))).filter(s => s.state === "done" || s.state === "absent" || (s.state === "live" && s.clock_in));
      if (sh.length) pct = Math.round(sh.filter(s => s.clock_in && !s.late).length / sh.length * 100); } catch (e) {}
    res.json({ role: req.user.rk, open: C.open, circulation: isF ? db.prepare(`SELECT COALESCE(SUM(amount),0) n FROM stella_tx WHERE user_id IN (${q})`).get(...ids).n : null,
      distributed: db.prepare(`SELECT COALESCE(SUM(amount),0) n FROM stella_tx WHERE at >= ? AND amount > 0 AND kind NOT IN ('refund','sale_back','sanction_back')`).get(m0).n,
      distributedTime: db.prepare("SELECT COALESCE(SUM(amount),0) n FROM stella_tx WHERE at >= ? AND kind IN ('ontime','streak')").get(m0).n,
      spent: -db.prepare("SELECT COALESCE(SUM(amount),0) n FROM stella_tx WHERE at >= ? AND kind = 'buy'").get(m0).n - db.prepare("SELECT COALESCE(SUM(amount),0) n FROM stella_tx WHERE at >= ? AND kind = 'refund'").get(m0).n,
      purchases: db.prepare("SELECT COUNT(*) n FROM stella_tx WHERE at >= ? AND kind = 'buy'").get(m0).n, punctuality: pct,
      budget: { total: C.budget, used: budgetUsed() }, envelope: req.user.rk === "manager" ? { total: C.envelope, left: envelopeLeft(req.user.id) } : null,
      requests: reqs, team, jokers: db.prepare("SELECT j.*, u.username FROM stella_jokers j JOIN users u ON u.id = j.user_id WHERE j.at > ? AND j.cancelled_by IS NULL ORDER BY j.at DESC LIMIT 5").all(now() - 7 * 864e5) });
  });
  app.post("/api/admin/stellas/requests/:id", auth, admin, staff, (req, res) => {
    const r = db.prepare("SELECT * FROM stella_requests WHERE id = ?").get(+req.params.id); if (!r || r.status !== "pending") return res.status(400).json({ error: "Demande déjà traitée" });
    if (r.kind === "bonus" && req.user.rk !== "founder") return res.status(403).json({ error: "Seul le fondateur valide les bonus en €" });
    const ok = req.body?.action === "approve", u = user(r.user_id), it = item(r.item_id) || { name: r.item_id };
    let adj = null;
    if (ok && r.kind === "bonus") { let pk = compta.periodOfDate(pd(now())); if (compta.isLocked(pk)) return res.status(400).json({ error: "La paie de la quinzaine est verrouillée" });
      adj = db.prepare("INSERT INTO pay_adjust (period, user_id, amount, reason, created_at, created_by) VALUES (?,?,?,?,?,?)").run(pk, r.user_id, r.eur, `Bonus Stella's · ${it.name}`, now(), req.user.id).lastInsertRowid; }
    if (ok && r.kind === "title") { db.prepare("INSERT OR IGNORE INTO stella_owned (user_id, item_id, at) VALUES (?,?,?)").run(r.user_id, r.item_id, now());
      db.prepare("INSERT INTO stella_equip (user_id, slot, item_id, value) VALUES (?,?,?,?) ON CONFLICT(user_id, slot) DO UPDATE SET item_id = excluded.item_id, value = excluded.value").run(r.user_id, "title", r.item_id, r.text); }
    if (!ok) tx(r.user_id, r.cost, "refund", `Remboursé · ${it.name}`, "Demande refusée", "refund:" + r.id, req.user.id);
    db.prepare("UPDATE stella_requests SET status = ?, decided_by = ?, decided_at = ?, adj_id = ? WHERE id = ?").run(ok ? "approved" : "refused", req.user.id, now(), adj, r.id);
    log(req.user.id, "a", `**${req.user.username}** a ${ok ? "validé" : "refusé"} la demande de **${u ? u.username : "?"}**`, `${it.name}${r.text ? ` « ${r.text} »` : ""}${r.eur ? ` · ${eur(r.eur)}` : ""}`);
    res.json({ ok: true });
  });
  app.post("/api/admin/stellas/grant", auth, admin, staff, (req, res) => {
    const uid = +req.body?.user_id, n = Math.round(+req.body?.amount || 0), why = String(req.body?.reason || "").trim().slice(0, 120);
    if (!isChatter(uid)) return res.status(400).json({ error: "Chatter introuvable" });
    if (!n) return res.status(400).json({ error: "Indique un montant" });
    if (!why) return res.status(400).json({ error: "Indique un motif : le chatter le verra" });
    if (req.user.rk !== "founder") { if (n < 0) return res.status(403).json({ error: "Pour retirer des Stella's, passe par une sanction" });
      const left = envelopeLeft(req.user.id); if (n > left) return res.status(400).json({ error: `Il te reste ${left} Stella's à donner ce mois-ci` }); }
    if (Math.abs(n) > 5000) return res.status(400).json({ error: "Montant trop élevé" });
    const done = tx(uid, n, "grant", n > 0 ? `Coup de pouce de ${req.user.username}` : `Retrait par ${req.user.username}`, why, `grant:${uid}:${now()}`, req.user.id);
    log(req.user.id, "a", `**${req.user.username}** a ${n > 0 ? "donné" : "retiré"} **${Math.abs(done)} Stella's** à **${user(uid).username}**`, why);
    res.json({ ok: true, amount: done });
  });
  app.post("/api/admin/stellas/jokers/:id/cancel", auth, admin, staff, (req, res) => {
    const j = db.prepare("SELECT * FROM stella_jokers WHERE id = ? AND cancelled_by IS NULL").get(+req.params.id); if (!j) return res.status(404).json({ error: "Joker introuvable" });
    db.prepare("UPDATE stella_jokers SET cancelled_by = ? WHERE id = ?").run(req.user.id, j.id);
    db.prepare("UPDATE sanction_props SET status = 'open' WHERE source_key = ? AND status = 'ignored'").run(j.source_key);
    log(req.user.id, "a", `**${req.user.username}** a annulé un joker retard de **${user(j.user_id).username}**`, "Le retard repasse dans les sanctions à traiter");
    res.json({ ok: true });
  });
  app.get("/api/admin/stellas/log", auth, admin, staff, (req, res) => {
    res.json(db.prepare("SELECT t.id, t.amount, t.kind, t.label, t.sub, t.at, u.username FROM stella_tx t JOIN users u ON u.id = t.user_id WHERE t.amount <> 0 ORDER BY t.at DESC, t.id DESC LIMIT 120").all());
  });
  app.get("/api/admin/stellas/requests", auth, admin, staff, (req, res) => {
    res.json(db.prepare("SELECT r.*, u.username FROM stella_requests r JOIN users u ON u.id = r.user_id ORDER BY r.created_at DESC LIMIT 60").all().map(reqRow));
  });
  app.get("/api/admin/stellas/config", auth, admin, staff, (req, res) => {
    const C = CFG(), sold = Object.fromEntries(db.prepare("SELECT substr(ref, 5, instr(substr(ref, 5), ':') - 1) id, COUNT(*) n FROM stella_tx WHERE kind = 'buy' GROUP BY id").all().map(r => [r.id, r.n]));
    res.json({ ...C, items: items().map(i => ({ ...i, sold: sold[i.id] || 0 })), defaults: RULES });
  });
  app.put("/api/admin/stellas/config", auth, admin, founder, (req, res) => {
    const b = req.body || {}, cur = CFG(), out = { open: cur.open, cap: cur.cap, budget: cur.budget, envelope: cur.envelope, rules: { ...cur.rules }, items: { ...cur.items } };
    if (b.open !== undefined) out.open = !!b.open;
    for (const k of ["cap", "budget", "envelope"]) if (b[k] !== undefined) { const v = Math.round(+b[k]); if (!(v >= 0 && v <= 100000)) return res.status(400).json({ error: "Valeur invalide" }); out[k] = v; }
    if (b.rules) for (const [k, v] of Object.entries(b.rules)) if (k in RULES) { const n = Math.round(+v); if (!(n >= 0 && n <= 10000)) return res.status(400).json({ error: "Valeur invalide" }); out.rules[k] = n; }
    if (b.items) for (const [k, v] of Object.entries(b.items)) if (ITEMS.some(i => i.id === k)) { const o = { ...(out.items[k] || {}) };
      if (v.price !== undefined) { const n = Math.round(+v.price); if (!(n >= 1 && n <= 100000)) return res.status(400).json({ error: "Prix invalide" }); o.price = n; }
      if (v.active !== undefined) o.active = !!v.active; out.items[k] = o; }
    setSet("stellas", JSON.stringify(out));
    log(req.user.id, "a", `**${req.user.username}** a modifié les réglages des Stella's`, "");
    res.json({ ok: true });
  });

  // pour l'accueil et le menu
  return { balance, looksOf, meState };
};
