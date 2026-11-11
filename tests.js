// Tests d'aptitude des élèves : débit de connexion (mesuré avec le serveur StellADS) et vitesse de frappe.
const crypto = require("crypto");

module.exports = function mount(app, db, auth, admin, { gest }) {
  db.exec(`CREATE TABLE IF NOT EXISTS skill_tests (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, score REAL NOT NULL, data TEXT, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS skill_tests_user ON skill_tests(user_id, kind, at);`);
  const BLOCK = crypto.randomBytes(1 << 20);   // 1 Mo de données aléatoires (incompressibles)
  const MAX = 64 << 20;
  const log = (...a) => { try { gest.log(...a); } catch (e) {} };
  const noStore = res => res.set({ "Cache-Control": "no-store, no-transform", Pragma: "no-cache" });

  app.get("/api/speed/ping", auth, (req, res) => { noStore(res); res.json({ t: Date.now() }); });
  app.get("/api/speed/down", auth, (req, res) => {
    const total = Math.max(1 << 16, Math.min(MAX, parseInt(req.query.bytes, 10) || (8 << 20)));
    noStore(res); res.set({ "Content-Type": "application/octet-stream", "Content-Length": total, "Content-Encoding": "identity" });
    let sent = 0, closed = false; req.on("close", () => closed = true);
    const pump = () => { while (!closed && sent < total) { const n = Math.min(BLOCK.length, total - sent); sent += n; if (!res.write(n === BLOCK.length ? BLOCK : BLOCK.subarray(0, n))) return res.once("drain", pump); } if (!closed) res.end(); };
    pump();
  });
  app.post("/api/speed/up", auth, (req, res) => {
    let n = 0; noStore(res);
    req.on("data", c => { n += c.length; if (n > MAX) req.destroy(); });
    req.on("end", () => res.json({ bytes: n })); req.on("error", () => {});
  });

  const save = (uid, kind, score, data) => db.prepare("INSERT INTO skill_tests (user_id, kind, score, data, at) VALUES (?,?,?,?,?)").run(uid, kind, score, JSON.stringify(data), Date.now()).lastInsertRowid;
  const num = (v, lo, hi) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : null; };
  app.post("/api/tests/speed", auth, (req, res) => {
    const b = req.body || {}, down = num(b.down, 0, 10000), up = num(b.up, 0, 10000), ping = num(b.ping, 0, 10000), jitter = num(b.jitter, 0, 10000);
    if (down === null || up === null || ping === null) return res.status(400).json({ error: "Résultat invalide" });
    const prev = db.prepare("SELECT MAX(score) s FROM skill_tests WHERE user_id = ? AND kind = 'speed'").get(req.user.id).s;
    save(req.user.id, "speed", Math.round(down * 10) / 10, { down, up, ping, jitter, ua: String(req.headers["user-agent"] || "").slice(0, 160) });
    if (req.user.role === "trainee") log(req.user.id, "a", `**${req.user.username}** a fait le test de connexion`, `${Math.round(down)} Mb/s en réception · ${Math.round(up)} Mb/s en envoi · ping ${Math.round(ping)} ms`);
    res.json({ ok: true, best: Math.max(prev || 0, down), record: down > (prev || 0) });
  });
  app.post("/api/tests/typing", auth, (req, res) => {
    const b = req.body || {}, wpm = num(b.wpm, 0, 250), acc = num(b.acc, 0, 100), dur = num(b.dur, 5, 600);
    if (wpm === null || acc === null || dur === null) return res.status(400).json({ error: "Résultat invalide" });
    const prev = db.prepare("SELECT MAX(score) s FROM skill_tests WHERE user_id = ? AND kind = 'typing' AND json_extract(data, '$.acc') >= 90").get(req.user.id).s;
    save(req.user.id, "typing", Math.round(wpm), { wpm, acc, dur, chars: num(b.chars, 0, 1e5), errors: num(b.errors, 0, 1e5), series: (Array.isArray(b.series) ? b.series : []).slice(0, 60).map(x => num(x, 0, 400)) });
    if (req.user.role === "trainee") log(req.user.id, "a", `**${req.user.username}** a fait le test de frappe`, `${Math.round(wpm)} mots/min · ${Math.round(acc)} % de précision`);
    res.json({ ok: true, best: acc >= 90 ? Math.max(prev || 0, wpm) : prev, record: acc >= 90 && wpm > (prev || 0) });
  });
  const view = uid => {
    const rows = db.prepare("SELECT kind, score, data, at FROM skill_tests WHERE user_id = ? ORDER BY at DESC LIMIT 40").all(uid).map(r => ({ kind: r.kind, score: r.score, at: r.at, ...JSON.parse(r.data || "{}") }));
    const t = gest.agency().training, sp = rows.filter(r => r.kind === "speed"), ty = rows.filter(r => r.kind === "typing");
    return { speed: { last: sp[0] || null, best: sp.reduce((m, r) => !m || r.score > m.score ? r : m, null), n: sp.length, min: t.speed.v, on: t.speed.on },
      typing: { last: ty[0] || null, best: ty.filter(r => r.acc >= 90).reduce((m, r) => !m || r.score > m.score ? r : m, null), n: ty.length, min: t.typing.v, on: t.typing.on }, history: rows.slice(0, 12) };
  };
  app.get("/api/tests/me", auth, (req, res) => res.json(view(req.user.id)));
  app.get("/api/admin/tests/:id", auth, admin, (req, res) => res.json(view(+req.params.id)));
};
