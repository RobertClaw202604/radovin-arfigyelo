#!/usr/bin/env node
/**
 * gen-termekek-100.mjs
 * --------------------
 * A kurált 100-as lista (/tmp/radovin-100.json, a katalogus-keresztezes.mjs
 * kimenetéből kurálva) alapján schema-konform `config/termekek.json` javaslatot
 * generál.
 *
 * MŰKÖDÉS:
 *  - Minden kurált tételhez TELJES aktív termékbejegyzést épít (a termekek
 *    schema aktív ága megköveteli az `azonositas` objektumot + `radovin_kereso`-t
 *    + `shop_azonositas.radovin`-t), a kurált név-struktúrából megbízhatóan
 *    levezetve a típus/évjárat/méret/puttony mezőket.
 *  - Az EREDETI termekek.json-t NEM módosítja; a javaslatot egy KIÍRÁSI útra
 *    adja ki (alapértelmezés: STDOUT / opcionálisan --out fájlba).
 *  - Infó-megőrzés: ha egy kurált tétel NÉV-ALAPÚ pontos egyezést talál egy
 *    meglévő (aktív) bejegyzéssel, a meglévő tételt változtatás nélkül örökli
 *    (az azonositas/shop_azonositas részletes identitása megmarad). Csak akkor
 *    generál újat, ha nincs pontos név-egyezés.
 *
 * Használat:
 *   node scripts/gen-termekek-100.mjs            # stdout-ra, validator-ellenőrzéssel
 *   node scripts/gen-termekek-100.mjs --out /tmp/termekek-100-draft.json
 *
 * CI-biztonság: nem ír semmit a repo-ba; a javasolt kimenet felülvizsgálat után
 * kézzel/scripttel kerül a config-ba.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = '/tmp/radovin-100.json'; // {sp, borok, termelek:[{kot,ar,nev}]}
const OLD = ROOT + 'config/termekek.json';
const TODAY = new Date().toISOString().slice(0, 10);

const kur = JSON.parse(readFileSync(SRC, 'utf8'));
const old = JSON.parse(readFileSync(OLD, 'utf8'));
const oldAkt = old.termekek; // teljes (aktív + inaktív) meglévő lista

// ---------- segédfüggvények ----------
const norm = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/[^a-z0-9]+/g, ' ');

function slugify(name) {
  return norm(name)
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join('-');
}

function slugifyId(name) {
  return norm(name).trim().replace(/\s+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function parseMeret(nev) {
  const m = String(nev).toLowerCase();
  // 0,75 l ; 0,5 l ; 0,7 l ; 1 l ; 0,375 l ; 0,35 l ; 0,05 l ; 0,05l
  const mm = m.match(/(\d)[,.](\d+)\s?l\b/) || m.match(/(\d+)\s?l\b/);
  if (!mm) return { meret: '0,75 l', ml: 750, darab: 1 };
  const lit =
    mm[1] !== undefined && mm[2] !== undefined
      ? parseFloat(`${mm[1]}.${mm[2]}`)
      : parseFloat(mm[1]);
  return { meret: `${String(lit).replace('.', ',')} l`, ml: Math.round(lit * 1000), darab: 1 };
}

const SPIRIT_RE =
  /pálinka|pallinka|palinka|gin|rum|vodka|tequila|whisky|whiskey|lik.r|amaro|cognac|armagnac|grappa|absint|brandy|borovicka|slivovic|mez/i;
const SPARKLING_RE =
  /pezsg|brut|prosecco|cava|champagne|pet[- ]nat|carassia|gran reserva/i;

function kategoria(nev, tipus) {
  const n = String(nev || '') + ' ' + String(tipus || '');
  if (SPIRIT_RE.test(n)) return 'spirit';
  if (SPARKLING_RE.test(n)) return 'sparkling';
  return 'wine';
}

function evjaratInfo(nev) {
  // 5 puttonyos / 6 puttonyos / Late Harvest / évjárat (YYYY)
  let puttony = null;
  const pm = String(nev).match(/(\d)\s*puttony/i);
  if (pm) puttony = parseInt(pm[1], 10);
  const em = String(nev).match(/\b(19\d\d|20\d\d)\b/);
  let evj = null;
  if (em) evj = parseInt(em[1], 10);
  let statusz;
  if (evj) statusz = 'vintage';
  else if (/non[- ]vintage|brut|extra dry|late harvest|szamorodni/i.test(String(nev)))
    statusz = 'non_vintage';
  else statusz = 'unknown';
  return { evj, statusz, puttony };
}

function gyartoFromMarka(marka) {
  return marka || null;
}

function csomagolas(nev) {
  if (/\bset\b/i.test(String(nev))) return 'set';
  if (/gift|ajándék/i.test(String(nev))) return 'gift_box';
  return 'plain_bottle';
}

/// A Radovin-keresésre használható rövid kulcs a teljes névből (legfontosabb 2-3
/// token, elhagyva a %/méret/évjárat technikai részeket).
function radovinKereso(nev) {
  let n = String(nev)
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    // évjárat (pl. 2024, 2017)
    .replace(/\b(19\d\d|20\d\d)\b/g, ' ')
    // szeszkoncentráció (pl. 40%, 43%, 12,5%) — a % után NINCS szóhatár-igény (space koveti)
    .replace(/\b\d+[.,]?\d*\s?%/g, ' ')
    // kiszerelés (pl. 0,35l | 0,7 l | 1l | 0,375l)
    .replace(/\b\d+[.,]?\d*\s?l\b/gi, ' ')
    // puttony-szám jelölés (pl. "6 puttonyos" -> "puttonyos")
    .replace(/\b\d+\s+puttony(?:os)?\b/gi, 'puttonyos')
    .replace(/\s+/g, ' ')
    .trim();
  return n;
}

function buildShopAzonositas(eredetiNev, kereso, teljesNev) {
  return {
    radovin: {
      elfogadott_tetel_aliasok: [kereso, teljesNev, eredetiNev].filter(Boolean),
      ellenorzott_nev: kereso,
      ellenorizve: TODAY,
      ellenorzes_modja: 'auto_migracio_legacy',
      megjegyzes:
        'Generált név-alapú azonosítás (kurált 100-as lista). Az approved shop_product_id/URL NINCS beállítva; a matcher-v2 konzervatív (needs_review). Frissítendő élő Radovin-lekérdezés után.',
    },
  };
}

// ---------- generálás ----------
const out = [];
const visited = new Set();

for (const r of kur.termelek) {
  const nev = String(r.nev).replace(/&#8217;/g, "'").replace(/&#8220;|&#8221;/g, '"');

  // (1) Pontos név-egyezés egy meglévő aktív bejegyzéssel -> örököljük változatlanul
  const exactOld = oldAkt.find(
    (x) => norm(x.nev) === norm(nev) || norm(x.radovin_kereso || '') === norm(r.nev)
  );
  if (exactOld && !visited.has(exactOld.id)) {
    visited.add(exactOld.id);
    out.push(exactOld);
    continue;
  }

  // (2) Egyébként újat generálunk
  const { meret, ml, darab } = parseMeret(nev);
  const marka = String(nev).split(' ')[0];
  const tipusGuess = kategoria(nev, '');
  const tipus = tipusGuess === 'spirit' ? 'tömény' : tipusGuess === 'sparkling' ? 'pezsgő' : 'bor';
  const { evj, statusz, puttony } = evjaratInfo(nev);
  const kereso = radovinKereso(nev);

  const p = {
    id: slugifyId(r.nev),
    nev,
    marka,
    tipus,
    meret,
    evjarat: evj,
    radovin_kereso: kereso,
    aktiv: true,
    azonositas: {
      termekkategoria: tipusGuess,
      gyarto: gyartoFromMarka(marka),
      marka_aliasok: [marka].filter(Boolean),
      tetel: nev,
      evjarat: evj,
      evjarat_statusz: statusz,
      kiszereles_ml: ml,
      darab,
      csomagolas: csomagolas(nev),
      puttony,
      penznem: 'HUF',
    },
    shop_azonositas: buildShopAzonositas(r.nev, kereso, nev),
  };
  if (!visited.has(p.id)) {
    visited.add(p.id);
    out.push(p);
  }
}

// ---------- kimeneti csomag ----------
const meta = {
  verzio: '2.0.0',
  frissitve: TODAY,
  datum_forma: 'ISO-8601 (UTC)',
  penznem: 'HUF',
  modell_verzio: '2.0.0',
  forras: 'kurált 100-as lista (katalogus-keresztezes.mjs kimenet)',
  megjegyzes:
    '100, több-boltban kapható tétel. Az eredeti termekek.json érintetlen; a swap backup-pal történik.',
};
const csomag = { meta, termekek: out };

// ---------- stdout / --out ----------
const outIdx = process.argv.indexOf('--out');
const toFile = outIdx >= 0 ? process.argv[outIdx + 1] : null;
const json = JSON.stringify(csomag, null, 2) + '\n';
if (toFile) writeFileSync(toFile, json);
else process.stdout.write(json);

console.error(
  `[gen-termekek-100] bejegyzés: ${out.length} | (meglévő átörökítve: ${
    out.filter((x) => oldAkt.some((o) => o.id === x.id)).length
  })`
);
