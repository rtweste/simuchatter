// Garde-fou du disque (volume Railway) : la base et ses sauvegardes de nuit vivent sur le même volume.
// Quand il manque de place, on libère d'abord les fichiers temporaires, puis les plus vieilles sauvegardes automatiques.
const fs = require("fs"), path = require("path");
const MB = 1024 * 1024;
const NAME = /^stellads-(\d{4}-\d{2}-\d{2})-(\d{4})(-manuelle)?\.db$/;
const free = dir => { try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch (e) { return Infinity; } };
const size = f => { try { return fs.statSync(f).size; } catch (e) { return 0; } };
const rm = (f, why) => { try { const n = size(f); fs.unlinkSync(f); console.log(`disque : supprimé ${path.basename(f)} (${Math.round(n / MB)} Mo, ${why})`); return n; } catch (e) { return 0; } };
// place à garder libre : 1,5 fois la base (pour une sauvegarde) + 200 Mo de marge
const need = dbPath => size(dbPath) * 1.5 + 200 * MB;
function backups(dir) {
  try { return fs.readdirSync(dir).filter(f => NAME.test(f)).map(f => ({ f: path.join(dir, f), manual: /-manuelle\.db$/.test(f), at: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => a.at - b.at); } catch (e) { return []; }
}
// libère de la place jusqu'à avoir « want » octets libres ; renvoie true si c'est bon
function make(dbPath, want) {
  const data = path.dirname(dbPath), dir = path.join(data, "backups");
  // 1. fichiers temporaires (sauvegarde ou archive interrompue)
  try { fs.readdirSync(dir).filter(f => /\.part$|^\.archive-.*\.db$/.test(f)).forEach(f => rm(path.join(dir, f), "fichier temporaire")); } catch (e) {}
  if (free(data) >= want) return true;
  // 2. copies faites avant une restauration : on garde la plus récente
  try { fs.readdirSync(dir).filter(f => /^avant-restauration-\d+\.db$/.test(f)).sort().slice(0, -1).forEach(f => rm(path.join(dir, f), "ancienne copie avant restauration")); } catch (e) {}
  if (free(data) >= want) return true;
  // 3. sauvegardes automatiques, des plus vieilles aux plus récentes (on garde les 2 dernières), puis les manuelles (on garde la dernière)
  const auto = backups(dir).filter(b => !b.manual), man = backups(dir).filter(b => b.manual);
  for (const b of auto.slice(0, -2)) { if (free(data) >= want) return true; rm(b.f, "vieille sauvegarde automatique"); }
  for (const b of man.slice(0, -1)) { if (free(data) >= want) return true; rm(b.f, "vieille sauvegarde manuelle"); }
  return free(data) >= want;
}
module.exports = {
  free, need, make,
  boot(dbPath) { const data = path.dirname(dbPath); fs.mkdirSync(path.join(data, "backups"), { recursive: true });
    const f0 = free(data); const ok = make(dbPath, need(dbPath)); const f1 = free(data);
    console.log(`disque : ${Math.round(f1 / MB)} Mo libres${f1 !== f0 ? ` (avant : ${Math.round(f0 / MB)} Mo)` : ""}${ok ? "" : " · TOUJOURS PRESQUE PLEIN"}`); },
};
