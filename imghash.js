// Empreinte des captures de vente : identique (octet pour octet) ou très ressemblante (même image recompressée, redimensionnée ou un peu rognée)
const crypto = require("crypto");
let jpeg = null, PNG = null;
try { jpeg = require("jpeg-js"); } catch (e) {}
try { PNG = require("pngjs").PNG; } catch (e) {}

const N = 64, K = 16;   // pHash : image réduite à 64×64, 16×16 basses fréquences = 255 bits
const COS = Array.from({ length: K }, (_, u) => Float64Array.from({ length: N }, (_, x) => Math.cos((2 * x + 1) * u * Math.PI / (2 * N))));

function decode(buf, mime) {
  try {
    if (/png/.test(mime) && PNG) { const p = PNG.sync.read(buf); return { w: p.width, h: p.height, d: p.data }; }
    if (/jpe?g/.test(mime) && jpeg) { const j = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 512, formatAsRGBA: true }); return { w: j.width, h: j.height, d: j.data }; }
  } catch (e) {}
  return null;   // webp, heic… : seule la comparaison exacte s'applique
}
// niveaux de gris réduits par moyenne exacte de zones (insensible à la taille et à la compression)
function shrink(img) {
  const { w, h, d } = img, g = new Float64Array(N * N), cnt = new Float64Array(N * N);
  for (let y = 0; y < h; y++) { const gy = Math.min(N - 1, Math.floor(y * N / h)) * N;
    for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, k = gy + Math.min(N - 1, Math.floor(x * N / w)); g[k] += d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114; cnt[k]++; } }
  for (let k = 0; k < g.length; k++) g[k] = cnt[k] ? g[k] / cnt[k] : 0;
  return g;
}
function phash(g) {
  const C = [];
  for (let u = 0; u < K; u++) for (let v = 0; v < K; v++) { let s = 0; const cu = COS[u], cv = COS[v];
    for (let y = 0; y < N; y++) { let r = 0; for (let x = 0; x < N; x++) r += g[y * N + x] * cv[x]; s += r * cu[y]; } C.push(s); }
  const ac = C.slice(1), med = [...ac].sort((a, b) => a - b)[Math.floor(ac.length / 2)];
  const bits = ac.map(x => x > med ? 1 : 0).concat([0]);   // 256 bits
  let hex = ""; for (let i = 0; i < 256; i += 4) hex += (bits[i] * 8 + bits[i + 1] * 4 + bits[i + 2] * 2 + bits[i + 3]).toString(16);
  return hex;
}
function fingerprint(buf, mime) {
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  const img = decode(buf, mime || "");
  return { sha, phash: img && img.w >= 20 && img.h >= 20 ? phash(shrink(img)) : null, ratio: img ? Math.round(img.w / img.h * 100) / 100 : null };
}
// vérification fine (pour les cas proches) : compare les deux images zone par zone à plus haute définition.
// Deux captures de la même conversation avec un autre message ou un autre prix diffèrent sur des lignes entières ;
// la même capture recompressée ou reprise (heure de la barre d'état) ne diffère presque nulle part.
function grid(img, GW, GH) {
  const { w, h, d } = img, g = new Float64Array(GW * GH), cnt = new Float64Array(GW * GH);
  for (let y = 0; y < h; y++) { const gy = Math.min(GH - 1, Math.floor(y * GH / h)) * GW;
    for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, k = gy + Math.min(GW - 1, Math.floor(x * GW / w)); g[k] += d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114; cnt[k]++; } }
  for (let k = 0; k < g.length; k++) g[k] = cnt[k] ? g[k] / cnt[k] : 0;
  return g;
}
function fineDiff(bufA, mimeA, bufB, mimeB) {
  const a = decode(bufA, mimeA || ""), b = decode(bufB, mimeB || ""); if (!a || !b) return null;
  const GW = 140, GH = Math.max(60, Math.min(400, Math.round(GW * a.h / a.w)));
  const ga = grid(a, GW, GH), gb = grid(b, GW, GH);
  // on ignore la barre d'état (heure, batterie) : les 4 % du haut
  const skip = Math.ceil(GH * .04) * GW; let bad = 0, n = 0;
  for (let k = skip; k < ga.length; k++) { n++; if (Math.abs(ga[k] - gb[k]) > 28) bad++; }
  return n ? bad / n : null;
}
const POP = Array.from({ length: 16 }, (_, i) => (i & 1) + ((i >> 1) & 1) + ((i >> 2) & 1) + ((i >> 3) & 1));
function distance(a, b) { if (!a || !b || a.length !== b.length) return 999; let n = 0; for (let i = 0; i < a.length; i++) n += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)]; return n; }
module.exports = { fingerprint, distance, fineDiff, CLOSE: 32, FINE: .003 };
