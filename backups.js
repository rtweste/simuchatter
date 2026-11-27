// Sauvegardes : copie propre de la base chaque nuit (sans couper le site), rotation automatique,
// téléchargement par le fondateur (une sauvegarde ou une archive complète base + fichiers), rappel hebdomadaire.
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

module.exports = function mount(app, db, auth, admin, { dbPath, notify, gest }) {
  const DATA = path.dirname(dbPath), DIR = path.join(DATA, "backups");
  fs.mkdirSync(DIR, { recursive: true });
  const FMT = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
  const PZ = (ms = Date.now()) => { const p = Object.fromEntries(FMT.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}${p.minute}`, h: +p.hour, wd: p.weekday }; };
  const getSet = k => { const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(k); return r ? r.value : null; };
  const setSet = (k, v) => db.prepare("INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, String(v));
  const log = (...a) => { try { gest.log(...a); } catch (e) {} };
  const NAME = /^stellads-(\d{4}-\d{2}-\d{2})-(\d{4})(-manuelle)?\.db$/;

  function list() {
    return fs.readdirSync(DIR).filter(f => NAME.test(f)).map(f => { const m = f.match(NAME), st = fs.statSync(path.join(DIR, f));
      return { file: f, date: m[1], time: m[2].slice(0, 2) + ":" + m[2].slice(2), manual: !!m[3], size: st.size, at: st.mtimeMs }; }).sort((a, b) => b.at - a.at);
  }
  // copie cohérente de la base, même pendant que le site tourne
  const guard = require("./disk-guard");
  function snapshot(manual) {
    // pas assez de place pour une copie de la base : on libère les plus vieilles sauvegardes, sinon on n'en fait pas (le site ne doit jamais remplir son disque)
    if (!guard.make(dbPath, guard.need(dbPath))) throw new Error("disque presque plein : sauvegarde annulée, télécharge les sauvegardes puis agrandis le volume");
    const t = PZ(), file = `stellads-${t.date}-${t.hm}${manual ? "-manuelle" : ""}.db`, full = path.join(DIR, file), tmp = full + ".part";
    try { fs.unlinkSync(tmp); } catch (e) {}
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    fs.renameSync(tmp, full);
    rotate();
    return file;
  }
  // on garde : les 5 dernières nuits, une par semaine sur 4 semaines, les 3 dernières manuelles (toutes sur le même disque que la base)
  function rotate() {
    const all = list(), keep = new Set(), weeks = new Set();
    all.filter(b => !b.manual).forEach((b, i) => { if (i < 5) keep.add(b.file);
      const d = new Date(b.date + "T12:00:00Z"), wk = Math.floor((d.getTime() / 864e5 + 3) / 7);
      if (Date.now() - b.at < 4 * 7 * 864e5 && !weeks.has(wk)) { weeks.add(wk); keep.add(b.file); } });
    all.filter(b => b.manual).slice(0, 3).forEach(b => keep.add(b.file));
    all.forEach(b => { if (!keep.has(b.file)) try { fs.unlinkSync(path.join(DIR, b.file)); } catch (e) {} });
  }
  // sauvegarde de nuit (à partir de 4 h, une fois par jour) et rappel du lundi
  function tick() {
    const t = PZ();
    try {
      if (t.h >= 4 && !list().some(b => !b.manual && b.date === t.date) && getSet("backup_skip") !== t.date) {
        try { const f = snapshot(false); console.log("sauvegarde", f); } catch (e) { setSet("backup_skip", t.date); throw e; } }
    } catch (e) { console.error("sauvegarde", e.message); }
    try {
      if (t.wd.startsWith("lun") && t.h >= 10 && getSet("backup_reminder") !== t.date && notify && notify.pushMany) {
        setSet("backup_reminder", t.date);
        const ids = db.prepare("SELECT id FROM users WHERE role = 'admin' AND grade = 'founder' AND active = 1").all().map(r => r.id);
        if (ids.length) notify.pushMany(ids, "announce", { title: "Ta sauvegarde de la semaine", body: "Télécharge une copie du site sur ton ordinateur : Réglages fondateur → Sauvegardes", url: "/fondateur#sauvegardes", tag: "backup-" + t.date });
      }
    } catch (e) { console.error("rappel sauvegarde", e.message); }
  }
  setTimeout(tick, 30e3); setInterval(tick, 10 * 60e3).unref();

  const founder = (req, res, next) => req.user.rk === "founder" ? next() : res.status(403).json({ error: "Réservé au fondateur" });
  app.get("/api/admin/backups", auth, admin, founder, (req, res) => {
    const dataSize = (() => { let n = 0; const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name);
      if (f.isDirectory()) { if (p !== DIR) walk(p); } else try { n += fs.statSync(p).size; } catch (e) {} } }; try { walk(DATA); } catch (e) {} return n; })();
    res.json({ list: list(), dataSize, keep: "5 dernières nuits, 1 par semaine sur 4 semaines, 3 manuelles", free: guard.free(DATA) });
  });
  app.post("/api/admin/backups", auth, admin, founder, (req, res) => {
    try { const f = snapshot(true); log(req.user.id, "a", `**${req.user.username}** a fait une sauvegarde manuelle`, f); res.json({ ok: true, file: f, list: list() }); }
    catch (e) { res.status(500).json({ error: "Sauvegarde impossible : " + e.message }); }
  });
  app.get("/api/admin/backups/file/:f", auth, admin, founder, (req, res) => {
    const f = String(req.params.f); if (!NAME.test(f) || !fs.existsSync(path.join(DIR, f))) return res.status(404).json({ error: "Sauvegarde introuvable" });
    log(req.user.id, "a", `**${req.user.username}** a téléchargé une sauvegarde`, f);
    res.download(path.join(DIR, f), f);
  });
  // archive complète : une copie fraîche de la base + tous les fichiers (captures, chat, photos), sans les anciennes sauvegardes
  app.get("/api/admin/backups/full", auth, admin, founder, (req, res) => {
    const t = PZ(), snap = path.join(DIR, `.archive-${Date.now()}.db`);
    try { db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`); } catch (e) { return res.status(500).json({ error: "Archive impossible : " + e.message }); }
    const base = path.basename(dbPath), name = `stellads-complet-${t.date}-${t.hm}.tar.gz`;
    res.setHeader("Content-Type", "application/gzip"); res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    const tar = spawn("tar", ["-cz", "-C", DATA, "--exclude=./backups", `--exclude=./${base}`, `--exclude=./${base}-wal`, `--exclude=./${base}-shm`, ".",
      "-C", DIR, "--transform", `s|^${path.basename(snap)}$|${base}|`, path.basename(snap)]);
    tar.stdout.pipe(res);
    const done = () => { try { fs.unlinkSync(snap); } catch (e) {} };
    tar.on("close", done); tar.on("error", e => { done(); if (!res.headersSent) res.status(500).end(); else res.end(); });
    req.on("close", () => { try { tar.kill(); } catch (e) {} });
    log(req.user.id, "a", `**${req.user.username}** a téléchargé l'archive complète du site`, name);
  });
  return { snapshot, list };
};
