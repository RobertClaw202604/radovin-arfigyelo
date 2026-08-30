// Radovin árfigyelő – termékgyűjtő (URL-alapú idősor).
//
// Szabolcs kérése (2026-08-29): ha bármelyik módszerrel konkrét eredményt kapunk egy
// termékre, annak MINDEN megtalált adatát – név, weblink, ár (dátummal) – el kell menteni,
// AKKOR IS, ha nem párosítható a katalógus egyik tételével sem. A termék linkje azonos
// marad, ha az ár változik is → ezért az idősor KULCSA az URL (nem a név, nem a termék-id).
//
// Ez a modul NEM befolyásolja a crawl/matcher fejlesztést: csak egy kötelező mentési réteg,
// amely minden élő talalatot elment az URL-kulcsú, dátumozott idősorba.
//
// Commit 7 (guide §21): a kiírás NEM történik a hálózati munka közben. A crawl csak
// MEMÓRIÁBAN gyűjt (`gyujtEmerge()`), a tényleges fájlírás kizárólag a minőségi kapu
// teljesülése UTÁN, atomi/append írásokkal történik (`flushStaged()`). Így egy megszakadt
// vagy karantén futás SOHA nem szennyezi az idősorát / nem növeli a data/ repót.

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const DATA_DIR = process.env.RADOVIN_DATA_DIR || path.join(DIR, '..', 'data');
const JSONL = path.join(DATA_DIR, 'termekek.jsonl');   // append-only idősor
const INDEX = path.join(DATA_DIR, 'termekek.json');    // URL-alapú aktuális index

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Normá URL kulcs: levágjuk a trailing slash-t és a query-t, hogy azonos termék
// (árváltozáskor is) ugyanahhoz a kulcshoz fűződjön.
function urlKulcs(u) {
  if (!u) return null;
  let t = String(u).trim();
  try { t = new URL(t).pathname; } catch {}
  return t.replace(/\/+$/, '');
}

// Index betöltése (URL → sorozat). Szemetes-olvasásból biztonságosan.
function beolvasIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX, 'utf8')); }
  catch { return {}; }
}

// ---- Commit 7: memóriabeli (staged) gyűjtés, hogy a crawl közben NE írjunk fájlt ----
let STAGED = []; // { url, nev, ar, shop, termek_id, tipus, megjegyzes }

// Egy élő talalat ÉLŐBENI (crawl közbeni) gyűjtése MEMÓRIÁBA – nem ír diszkre.
// `betelek`: { url, nev, ar, shop, termek_id, tipus } és opcionális `katalogus_tetel_illeszkedik`.
// Visszaadja a feldolgozott (fájlba kerülő) találatok számát a run összesítéséhez.
function gyujtEmerge(betelek) {
  if (!Array.isArray(betelek) || !betelek.length) return 0;
  const sorok = betelek.filter((t) => t && t.url && t.ar != null);
  if (!sorok.length) return 0;
  for (const t of sorok) {
    const kulcs = urlKulcs(t.url);
    if (!kulcs) continue;
    STAGED.push({
      url: kulcs,
      nev: t.nev || null,
      ar: t.ar,
      shop: t.shop || null,
      termek_id: t.termek_id || null,
      tipus: t.tipus || null,
      megjegyzes: t.megjegyzes || null,
    });
  }
  return sorok.length;
}

// A stagelt találatok TÉNYLEGES kiírása (a minőségi kapu UTÁN, tranzakciósan):
//  - append a data/termekek.jsonl idősorba;
//  - aktuális index frissítése data/termekek.json-ben (atomi célfájl-csere).
// Visszaadja a mentett sorok számát.
function flushStaged() {
  if (!STAGED.length) return 0;
  const ido = new Date().toISOString();
  const index = beolvasIndex();
  let sor = '';
  const tetelek = STAGED;
  for (const t of tetelek) {
    const kulcs = t.url;
    sor += JSON.stringify({
      url: kulcs, nev: t.nev, ar: t.ar, ido, shop: t.shop, termek_id: t.termek_id, tipus: t.tipus, megjegyzes: t.megjegyzes,
    }) + '\n';
    if (!index[kulcs]) index[kulcs] = [];
    index[kulcs].push({ ar: t.ar, ido, nev: t.nev, shop: t.shop });
    // Csak az utolsó N ár marad az indexben (memory-light; a teljes sor a JSONL-ben van).
    if (index[kulcs].length > 500) index[kulcs] = index[kulcs].slice(-500);
  }
  fs.appendFileSync(JSONL, sor);
  // Atomi index-csere, hogy soha ne maradjon félig írt termekek.json.
  const tmp = INDEX + '.flush.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2) + '\n');
  fs.renameSync(tmp, INDEX);
  STAGED = [];
  return tetelek.length;
}

// Megmaradt stagelt elemek törlése (karantén / kilépés esetén).
function discardStaged() {
  const n = STAGED.length;
  STAGED = [];
  return n;
}

// A jelenleg stagelt elemek másolata (a kanonikus futásba mentés céljából).
function getStaged() {
  return STAGED.map((t) => ({ ...t }));
}

// Kompatibilitási réteg: a régi `mentes()` most gyűjt + azonnal flush-ol (a run.js
// már nem használja a crawl közben; csak külső hívók / tesztek miatt marad).
function mentes(betelek) {
  gyujtEmerge(betelek);
  return flushStaged();
}

module.exports = { urlKulcs, mentes, beolvasIndex, gyujtEmerge, flushStaged, discardStaged, getStaged };
