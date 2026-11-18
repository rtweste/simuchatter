// Catégories de vente (choisies par le chatter à la déclaration) et délai avant « déclarée en retard »
// Stockées dans les réglages de l'agence (settings.agency → saleCats, lateHours)
const DEFAULT_CATS = [
  { k: "lingerie", l: "Lingerie", u: "photo", min: null },
  { k: "nudes", l: "Nudes", u: "photo", min: null },
  { k: "vnude", l: "Vidéo nude", u: "video", min: null },
  { k: "vmasturb", l: "Vidéo Masturbation", u: "video", min: null },
  { k: "sextape", l: "Sextape", u: "video", min: null },
  { k: "cam", l: "Cam", u: "min", min: null },
  { k: "snap", l: "Session Snap", u: "min", min: null },
  { k: "autre", l: "Autre", u: null, min: null }
];
const UNITS = ["photo", "video", "min"];
const DEFAULT_LATE = 48;

const agencyOf = db => { try { return JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'agency'").get() || {}).value || "{}"); } catch (e) { return {}; } };
const cats = db => { const a = agencyOf(db); return Array.isArray(a.saleCats) && a.saleCats.length ? a.saleCats : DEFAULT_CATS; };
const lateHours = db => { const v = Number(agencyOf(db).lateHours); return Number.isFinite(v) && v > 0 ? v : DEFAULT_LATE; };

// nettoie la liste envoyée par les réglages ; lève une erreur lisible si invalide
function clean(list) {
  if (!Array.isArray(list) || !list.length) throw new Error("Garde au moins une catégorie de vente");
  if (list.length > 30) throw new Error("30 catégories au maximum");
  const seen = new Set();
  return list.map(c => {
    const l = String(c.l || "").trim().slice(0, 40); if (!l) throw new Error("Chaque catégorie doit avoir un nom");
    let k = String(c.k || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
    if (!k || seen.has(k)) k = "c" + Math.random().toString(36).slice(2, 8);
    seen.add(k);
    const u = UNITS.includes(c.u) ? c.u : null;
    let min = c.min === null || c.min === undefined || c.min === "" ? null : Number(String(c.min).replace(",", "."));
    if (min !== null && !(Number.isFinite(min) && min >= 0 && min <= 10000)) throw new Error(`Prix minimum invalide pour « ${l} »`);
    if (min === 0) min = null;
    return { k, l, u, min };
  });
}

module.exports = { DEFAULT_CATS, DEFAULT_LATE, UNITS, cats, lateHours, clean };
