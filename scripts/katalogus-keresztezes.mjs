#!/usr/bin/env node
// Radovin árfigyelő – katalógus-keresztező.
//
// Cél: data-driven módon kiválasztani azokat a Radovin-termékeket, amelyek
// TÉNYLEG több konkurens boltban is megtalálhatók (így valódi árösszehasonlítás
// jöhet létre). A rendszer célja a konkurens árak ismerete + szükség esetén
// árcsökkentés – ehhez olyan tételek kellenek, amik több boltban is kaphatók.
//
// Működés:
//   1. Letölti a Radovin saját katalógusát (WooCommerce /wp-json/wc/store/products)
//   2. Letölti a konkurens boltok teljes katalógusát:
//        - Borvilág  (Shopify     /products.json)
//        - Borpiac   (WooCommerce /wp-json/wc/store/products)
//        - Winehub   (WooCommerce /wp-json/wc/store/products)
//   3. A Radovin-tételt akkor jelöli több-árasnak, ha ≥2 konkurens boltban is
//      megtalálható (név-norma → fuzzy/prefix egyezés, kiszerelés-érzékeny).
//   4. Kibocsát egy rangsort: minél több boltban van, annál jobb.
//
// CI-biztos: csak nyilvános katalógus-endpointok, headless NÉLKÜL, nem „éles" run.

import { norm } from '../lib/matricas.js';

const UA = 'RadovinArfigyelo/1.0 (+https://github.com/RobertClaw202604)';
const cfg = { ua: UA, timeout_sec: 25 };

const SHOPOK = [
  { id: 'radovin', tipus: 'woocommerce', base: 'https://radovin.hu' },
  { id: 'borvilag', tipus: 'shopify', base: 'https://www.borvilag.hu' },
  { id: 'borpiac', tipus: 'woocommerce', base: 'https://www.borpiac.hu' },
  { id: 'winehub', tipus: 'woocommerce', base: 'https://winehub.hu' },
  // a Borháló dataLayer-alapú (GA4), külön függvénnyel; ide csak a konfig
  { id: 'borhalo', tipus: 'borhalo', base: 'https://borhalo.hu', kategoria_slugek: ['borok-2', 'pezsgok-6', 'parlatok-8'], kategoria_max_lap: 12 },
];

async function lapLekerese(base, tipus, page) {
  const url = tipus === 'shopify'
    ? `${base}/products.json?limit=250&page=${page}`
    : `${base}/wp-json/wc/store/products?per_page=100&page=${page}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

function sorShopify(p, base) {
  const v = (p.variants && p.variants[0]) || {};
  const host = String(base || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const handle = p.handle || '';
  return { nev: p.title || '', ar: parseFloat(v.price), url: handle ? ('https://' + host + '/products/' + handle) : base };
}

function sorWoo(p) {
  const pr = (p.prices && p.prices.price) || null;
  let ar = typeof pr === 'string' ? parseFloat(pr) : pr;
  if (ar === null || ar === undefined) ar = parseFloat(p.prices && p.prices.regular_price);
  return { nev: p.name || '', ar: isNaN(ar) ? null : ar, url: p.permalink || '' };
}

// Borháló: a termékkártyák a GA4 dataLayer JSON-ben tartalmazzák a nevet+árat,
// a kategórialistákon ?limit=100&page=N lapozással. A minta a lib/borhalo.js-éből.
function borhaloSorokGt(html) {
  const out = [];
  const kartyare = /data-gt-params="([^"]*)"[^>]*href=\/termek\/([a-z0-9.'%-]+)/gi;
  let m;
  while ((m = kartyare.exec(html)) !== null) {
    let params = m[1];
    params = params.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
    const nevM = params.match(/"item_name"\s*:\s*"([^"]+)"/);
    const arM = params.match(/"price"\s*:\s*([0-9]+)/);
    const nev = nevM ? nevM[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) : null;
    const ar = arM ? parseInt(arM[1], 10) : null;
    const slug = m[2];
    if (nev && ar > 0 && slug) {
      out.push({ nev, ar, url: 'https://borhalo.hu/termek/' + slug });
    }
  }
  return out;
}

async function borhaloKatalogus(shop) {
  const osszes = [];
  for (const kat of shop.kategoria_slugek) {
    for (let page = 1; page <= shop.kategoria_max_lap; page++) {
      const url = `${shop.base}/termekeink/${kat}?limit=100&page=${page}`;
      let r;
      try {
        r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'hu-HU' }, signal: AbortSignal.timeout(25000), redirect: 'follow' });
      } catch (e) { break; }
      if (!r.ok) break;
      const html = await r.text();
      const sorok = borhaloSorokGt(html);
      if (!sorok.length) break;
      osszes.push(...sorok);
      if (sorok.length < 100) break;
    }
  }
  return [...new Map(osszes.map((x) => [x.nev + '|' + x.ar, x])).values()];
}

const CACHE_FIJL = '/tmp/radovin-katalogusok.json';

async function teljesKatalogus(shop) {
  if (shop.tipus === 'borhalo') return borhaloKatalogus(shop);
  const tipus = shop.tipus;
  const osszes = [];
  let page = 1;
  let lap = await lapLekerese(shop.base, tipus, page);
  for (;;) {
    if (tipus === 'shopify') {
      const sorok = lap.products || lap;
      osszes.push(...sorok.map((s) => sorShopify(s, shop.base)));
      if (sorok.length !== 250 || page > 20) break;
    } else {
      const sorok = Array.isArray(lap) ? lap : (lap.products || []);
      osszes.push(...sorok.map(sorWoo));
      if (!Array.isArray(lap)) break; // nem oldalpáklévő
      if (sorok.length !== 100) break;
      if (page > 50) break;
    }
    page += 1;
    lap = await lapLekerese(shop.base, tipus, page);
  }
  return osszes;
}

// Norma-egyezés: a nev-normát (matricas.norm) használjuk, és a légyszerelés-eltérést
// toleráljuk (0,7 vs 1l) – a cél a „védjegy + fajta" azonosítása, nem a pontos méret.
//
// FONTOS (2026-08-30): ez a függvény KONZISZTENS legyen a scraper szigor() matcherével
// (lib/matricas.js), különben olyan „több boltban kapható" tételeket listáz, amelyeket a
// valódi futás elutasít (no_exact_match) → hamis 1-1 árak. A korábbi verzió túl laza volt:
// a 0,04 l mini-mintát és az ELTÉRŐ márkát is elfogadta (pl. „Cruxx Szilva pálinka" ~
// „Márton és Lányai Szilva pálinka 0,04 l"), ami a 442-es lista nagy részét hamissá tette.
function egyezik(radovinNev, konkurensNev) {
  const rn = norm(radovinNev || '');
  const kn = norm(konkurensNev || '');
  if (!rn || !kn) return false;

  // A Radovin-tétel márka-néven az ELSŐ szó (pl. Cruxx, Zimek, Fenegyerek). A szigor()
  // matcher a márkát KOTELEZŐ egyezésnek veszi: a találat nevében szerepelnie kell.
  const markaRadovin = norm((radovinNev || '').split(' ')[0]);
  if (markaRadovin && markaRadovin.length >= 3 && !kn.includes(markaRadovin)) return false;

  // A kiszerelés-számok (0,7 / 1 / 0,75 / ml / l) kiszűrése → védjegy+fajta alap
  const tolkek = (s) => s.replace(/\b(0\,\s?[0-9]+|\d+,\s?\d+|\d+)\s*(l|ml|liter|literes)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const rnTol = tolkek(rn);
  const knTol = tolkek(kn);
  if (!rnTol) return false;

  // KISZERELÉS-ellenőrzés TÖMÉNY italoknál: a 0,04 l mini-minta (40 ml) vs 0,5 l
  // NEM ugyanaz a termék – még akkor sem, ha a név szavai nagyrészt fedik egymást.
  // A szigor() a méret-eltérést bünteti (<0.2l diff); mi itt durván kizárjuk a >2x eltérést.
  const lRadovin = kertLiterFn(radovinNev);
  const lKonkurens = kertLiterFn(konkurensNev);
  if (lRadovin != null && lKonkurens != null) {
    if (lRadovin < 0.2 && Math.abs(lRadovin - lKonkurens) > 0.01) return false; // mini-minta méret-eltérés
    if (Math.abs(lRadovin - lKonkurens) / Math.min(lRadovin, lKonkurens) > 2) return false; // arányosan >2x eltérés
  }

  // Teljes egyezés (méret nélkül)
  if (rnTol === knTol) return true;
  // A radovin (méret nélküli) normáltja része a konkurensének – csak akkor, ha a
  // konkurens név a márkát is tartalmazza (fent már ellenőriztük).
  if (knTol.includes(rnTol)) return true;
  if (rnTol.includes(knTol)) return true;
  // Jelentős átfedés: védjegy/fajta szavak → 75% szükséges (szigorúbb, mint korábban)
  const rnSzavak = rnTol.split(/\s+/).filter((w) => w.length >= 4);
  if (rnSzavak.length === 0) return false;
  const talalt = rnSzavak.filter((w) => knTol.includes(w)).length;
  return talalt / rnSzavak.length >= 0.75;
}

// liter-kinyerès (a matricas.kertLiter mintájára), a fenti kiszerelés-ellenőrzéshez
function kertLiterFn(s) {
  const m = (s || '').replace(/\s/g, '').replace(',', '.');
  const v = m.match(/(\d+\.?\d*)l/);
  return v ? parseFloat(v[1]) : null;
}

(async () => {
  console.log('Katalógusok letöltése…');
  const katalogusok = {};
  // Fájl-cache: ha van /tmp-ben, azt használjuk (a letöltés újbóli mellőzésére)
  let cacheVolt = false;
  const fs = await import('node:fs');
  if (fs.existsSync(CACHE_FIJL)) {
    try {
      const mentett = JSON.parse(fs.readFileSync(CACHE_FIJL, 'utf8'));
      // cache-t csak frissen használjuk (24h-nál nem régebbi)
      const kor = Date.now() - (mentett.ido || 0);
      if (kor < 86400000) {
        for (const s of SHOPOK) katalogusok[s.id] = mentett[s.id] || [];
        cacheVolt = true;
        console.log('  (cache-ből: ' + SHOPOK.map((s) => s.id + ':' + katalogusok[s.id].length).join(', ') + ')');
      }
    } catch (e) { /* cache hibás → újratöltés */ }
  }
  if (!cacheVolt) {
    for (const s of SHOPOK) {
      try {
        const kat = await teljesKatalogus(s);
        katalogusok[s.id] = kat;
        console.log(`  ${s.id}: ${kat.length} tétel`);
      } catch (e) {
        console.log(`  ${s.id}: HIBÁS (${e.message})`);
        katalogusok[s.id] = [];
      }
    }
    try { fs.writeFileSync(CACHE_FIJL, JSON.stringify({ ido: Date.now(), ...katalogusok })); } catch (e) {}
  }

  const radovin = katalogusok['radovin'] || [];
  const konkurensek = ['borvilag', 'borpiac', 'winehub', 'borhalo'];
  console.log('');

  const rangsor = [];
  for (const r of radovin) {
    const holVan = [];
    const arak = {};
    for (const kId of konkurensek) {
      const kat = katalogusok[kId] || [];
      const talalat = kat.find((x) => egyezik(r.nev, x.nev));
      if (talalat && talalat.ar != null) {
        holVan.push(kId);
        arak[kId] = talalat.ar;
      }
    }
    rangsor.push({ nev: r.nev, ar: r.ar, arRadovin: r.ar, hanyBolt: holVan.length, holVan, arak });
  }

  // Csak a ≥2 boltban lévők, ár szerint növekvő (olcsóbb előre)
  const tobbAr = rangsor.filter((x) => x.hanyBolt >= 2);
  const egyAr = rangsor.filter((x) => x.hanyBolt === 1);

  console.log(`Radovin katalógus: ${radovin.length} tétel`);
  console.log(`  • ${tobbAr.length} tétel van ≥2 konkurens boltban  ★ (ezek kellenek)`);
  console.log(`  • ${egyAr.length} tétel van pont 1 boltban`);
  console.log(`  • ${rangsor.length - tobbAr.length - egyAr.length} tétel sehol`);
  console.log('');

  // Rendezzük a legtöbb bolt szerint, majd ár
  tobbAr.sort((a, b) => (b.hanyBolt - a.hanyBolt) || (a.arRadovin - b.arRadovin));

  // Mentsük a rangsort fájlba (a kurált kiválasztáshoz)
  try {
    const fsj = await import('node:fs');
    const kim = tobbAr.map((x) => ({ kot: x.hanyBolt, nev: x.nev, ar: x.arRadovin, arak: x.arak }));
    fsj.writeFileSync('/tmp/radovin-tobbboltu.json', JSON.stringify(kim, null, 1));
    const kimegy = egyAr.map((x) => ({ kot: 1, nev: x.nev, ar: x.arRadovin, arak: x.arak, hol: x.holVan[0] }));
    fsj.writeFileSync('/tmp/radovin-egybolt.json', JSON.stringify(kimegy, null, 1));
    console.log('(rangsor fájlba mentve: /tmp/radovin-tobbboltu.json, /tmp/radovin-egybolt.json)');
  } catch (e) {}

  console.log('=== TOP: ≥2 boltban lévő tételek (rendezve: bolt-szám, majd ár) ===');
  tobbAr.slice(0, 120).forEach((x) => {
    console.log(`${x.hanyBolt}x | ${x.nev} | Radovina: ${x.arRadovin} Ft | konk: ` + konkurensek.map((k) => (x.arak[k] ? k + ':' + x.arak[k] : '')).join(' ').trim());
  });

  console.log('');
  console.log('=== 1 boltban lévők (gyorsan elérhető bővítés) – első 40 ===');
  egyAr.sort((a, b) => (b.arRadovin - a.arRadovin));
  egyAr.slice(0, 40).forEach((x) => console.log(`1x | ${x.nev} | Radovina: ${x.arRadovin} Ft | ${x.holVan[0]}`));

  // === TÖMÉNY ITALOK szétválogatása (kurrens tömény italok, amiket Szabolcs kért) ===
  const tomanyMinta = /whisky|whiskey|gin|rum|vodka|tequila|palinka|cognac|borpalat|pálinka|pallinka|abszint|mezé|mez\b|amarula|baileys|lik\b|likor|pálinka|mez\b/i;
  const tomany = rangsor.filter((x) => tomanyMinta.test(x.nev));
  const tomanyTobb = tomany.filter((x) => x.hanyBolt >= 2);
  const tomanyEgy = tomany.filter((x) => x.hanyBolt === 1);
  console.log('');
  console.log('=== TÖMÉNY ITALOK (≥2 boltban) – rendezve bolt-szám+ár ===');
  tomanyTobb.sort((a, b) => (b.hanyBolt - a.hanyBolt) || (a.arRadovin - b.arRadovin));
  tomanyTobb.forEach((x) => console.log(`${x.hanyBolt}x | ${x.nev} | Radovina: ${x.arRadovin} Ft | konk: ` + konkurensek.map((k) => (x.arak[k] ? k + ':' + x.arak[k] : '')).join(' ').trim()));
  console.log('');
  console.log('=== TÖMÉNY ITALOK (1 boltban) – a népszerűek, amiket érdemes igazolni ===');
  tomanyEgy.sort((a, b) => (b.hanyBolt || 0) - (a.hanyBolt || 0) || (a.arRadovin - b.arRadovin));
  tomanyEgy.slice(0, 25).forEach((x) => console.log(`1x | ${x.nev} | Radovina: ${x.arRadovin} Ft | ${x.holVan[0]}`));
})();
