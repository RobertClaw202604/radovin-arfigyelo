// Radovin árfigyelő – termékgyűjtő (URL-alapú idősor).
//
// Szabolcs kérése (2026-08-29): ha bármelyik módszerrel konkrét eredményt kapunk egy
// termékre, annak MINDEN megtalált adatát – név, weblink, ár (dátummal) – el kell menteni,
// AKKOR IS, ha nem párosítható a katalógus egyik tételével sem. A termék linkje azonos
// marad, ha az ár változik is → ezért az idősor KULCSA az URL (nem a név, nem a termék-id).
//
// Ez a modul NEM befolyásolja a crawl/matcher fejlesztést: csak egy kötelező mentési réteg,
// amely minden élő talalatot elment az URL-kulcsú, dátumozott idősorba.

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const DATA_DIR = path.join(DIR, '..', 'data');
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

// Egy élő talalat mentése az URL-kulcsú idősorba.
// `betelek`: { url, nev, ar, shop, termek_id, tipus } és opcionális `katalogus_tetel_illeszkedik`.
function mentes(betelek) {
  if (!Array.isArray(betelek) || !betelek.length) return;
  const ido = new Date().toISOString();
  const sorok = betelek.filter((t) => t && t.url && t.ar != null);
  if (!sorok.length) return;

  const index = beolvasIndex();
  const ujSzam = [];
  for (const t of sorok) {
    const kulcs = urlKulcs(t.url);
    if (!kulcs) continue;
    const rekord = {
      url: kulcs,
      nev: t.nev || null,
      ar: t.ar,
      ido,
      shop: t.shop || null,
      termek_id: t.termek_id || null,
      tipus: t.tipus || null,
      megjegyzes: t.megjegyzes || null,
    };
    fs.appendFileSync(JSONL, JSON.stringify(rekord) + '\n');
    ujSzam.push(rekord);

    if (!index[kulcs]) index[kulcs] = [];
    index[kulcs].push({ ar: t.ar, ido, nev: t.nev || null, shop: t.shop || null });
    // Csak az utolsó N ár marad az indexben (memory-light; a teljes sor a JSONL-ben van).
    if (index[kulcs].length > 500) index[kulcs] = index[kulcs].slice(-500);
  }
  fs.writeFileSync(INDEX, JSON.stringify(index, null, 2) + '\n');
  return ujSzam.length;
}

module.exports = { urlKulcs, mentes, beolvasIndex };
