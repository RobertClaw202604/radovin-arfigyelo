#!/usr/bin/env node
// Radovin árfigyelő – fő futtató script
// Használat: node run.js
// Minden futás: lekéri a termékárakat minden shopból, elmenti data/arak.jsonl-be (append-only),
// és frissíti data/legutobbi.json + data/elozmeny.json állapotot a webes nézethez.

const fs = require('fs');
const path = require('path');
const scraper = require('./lib/scraper.js');
const { pozicio } = require('./lib/pozicio.js');
const termekgyujto = require('./lib/termekgyujto.js');

const DIR = __dirname;
const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'config/shopok.json'), 'utf8'));
const termekek = JSON.parse(fs.readFileSync(path.join(DIR, 'config/termekek.json'), 'utf8')).termekek;

const DATA_DIR = path.join(DIR, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const JSONL = path.join(DATA_DIR, 'arak.jsonl');
const LATO = path.join(DATA_DIR, 'legutobbi.json');
const ELOZMENY = path.join(DATA_DIR, 'elozmeny.json');

(async () => {
  const futasId = Date.now();
  const futasIdeje = new Date(futasId).toISOString();
  const activeShops = cfg.shopok.filter((s) => s.statusz === 'active');
  const pendingShops = cfg.shopok.filter((s) => s.statusz === 'pending' || s.statusz === 'blocked');
  const eredmenyek = [];
  // Katalógusos shopok teljes listájának futás-szintű dedup-ja (shoponként egyszer),
  // hogy a JSONL ne duplikálódjon 13×-osan ugyanazzal a shop-katalógussal.
  const katalogusosCachel = new Map();

  for (const termek of termekek) {
    const termekArak = [];
    const gyujtendo = []; // termékgyűjtő: minden élő talalat (URL-kulcsú idősorba)
    for (const shop of activeShops) {
      const r = await scraper.run(termek, shop, cfg);

      // TERMÉKGYŰJTŐ (Szabolcs): minden konkrét, élő talalat mentése – a katalógus-
      // egyezéstől FÜGGETLENÜL (akkor is, ha nem párosítható). A link azonos marad,
      // ha az ár változik is; a kulcs az URL. Ez a crawl/matcher logikát NEM érinti.
      // A katalógusos shopok teljes listáját SHOPONKÉNT egyszer mentjük (nem tételenként,
      // hogy ne duplikálódjon a JSONL), a tételhez tartozó találatot pedig mindig.
      const forras = shop.tipus === 'sajat' ? 'radovin' : 'konkurencia';
      if (r && Array.isArray(r.talalatok)) {
        const katalogusos = ['borhalo', 'katlistas', 'shopify', 'woocommerce-api'].includes(shop.adapter);
        const marVolt = katalogusosCachel.get(shop.id) === true;
        for (const t of r.talalatok) {
          if (!(t && t.url && t.ar != null)) continue;
          // Katalógusos shop: teljes listát csak az első érintkezésnél mentjük,
          // utána már csak a tételhez párosuló legjobb találatot (elkerüljük a
          // 13× duplikációt a JSONL-ben).
          if (katalogusos) {
            if (marVolt && !(r.talalat && r.talalat.url === t.url)) continue;
          }
          gyujtendo.push({
            url: t.url,
            nev: t.nev || null,
            ar: t.ar,
            shop: shop.id,
            termek_id: termek.id,
            tipus: forras,
            megjegyzes: 'aktív találat (' + (shop.adapter || '') + ')',
          });
        }
        if (katalogusos) katalogusosCachel.set(shop.id, true);
      }

      if (r && r.talalat && r.talalat.ar != null) {
        termekArak.push({
          shop: shop.id,
          shop_nev: shop.nev,
          tipus: shop.tipus === 'sajat' ? 'radovin' : 'konkurencia',
          ar: r.talalat.ar,
          nev: r.talalat.nev,
          url: r.talalat.url,
          megjegyzes: r.talalat.megjegyzes || null,
          hiba: r.hiba || null,
        });
      } else if (r) {
        termekArak.push({
          shop: shop.id,
          shop_nev: shop.nev,
          tipus: shop.tipus === 'sajat' ? 'radovin' : 'konkurencia',
          ar: null,
          nev: null,
          url: null,
          megjegyzes: null,
          hiba: r.hiba || 'nincs_talalat',
        });
      }
    }

    // A pozícióba csak az active (validált) árak kerülnek. A pending/blocked
    // szhopok külön, „fejlesztés alatt” jelzéssel szerepelnek, nem számolnak bele.
    const p = pozicio(termekArak);

    // Termékgyűjtő: minden élő, konkrét talalat URL-kulcsú idősorba mentése.
    const gyujtesSzam = termekgyujto.mentes(gyujtendo) || 0;

    const konkurensAllapot = pendingShops.map((s) => ({
      shop: s.id,
      nev: s.nev,
      statusz: s.statusz,
    }));
    const sor = {
      futas_id: futasId,
      ido: futasIdeje,
      termek_id: termek.id,
      termek_nev: termek.nev,
      meret: termek.meret,
      pozicio: {
        darab: p.darab,
        min: p.min,
        max: p.max,
        median: p.median,
        radovin_ar: p.radovin_ar,
        rank: p.rank,
        rank_jelolo: p.rank_jelolo,
      },
      arak: termekArak,
      gyujtes_szam: gyujtesSzam,
      konkurens_allapot: konkurensAllapot,
    };
    eredmenyek.push(sor);

    // append-only napló
    fs.appendFileSync(JSONL, JSON.stringify(sor) + '\n');

    console.log(`[${termek.id}] rank=${p.rank_jelolo} radovin=${p.radovin_ar}Ft min=${p.min} max=${p.max} (${p.darab} ár)`);
  }

  // legutóbbi összesítés a webes nézethez
  fs.writeFileSync(LATO, JSON.stringify({ futas_id: futasId, ido: futasIdeje, termekekszam: eredmenyek.length, eredmenyek }, null, 2));

  // előzmény-index (termék → futás idejei) a historikus visszanézéshez
  let elozmeny = {};
  if (fs.existsSync(ELOZMENY)) {
    try { elozmeny = JSON.parse(fs.readFileSync(ELOZMENY, 'utf8')); } catch { elozmeny = {}; }
  }
  for (const e of eredmenyek) {
    if (!elozmeny[e.termek_id]) elozmeny[e.termek_id] = [];
    elozmeny[e.termek_id].push({ futas_id: e.futas_id, ido: e.ido, rank: e.pozicio.rank_jelolo, radovin_ar: e.pozicio.radovin_ar, median: e.pozicio.median });
  }
  fs.writeFileSync(ELOZMENY, JSON.stringify(elozmeny, null, 2));

  console.log(`\nKész: ${eredmenyek.length} termék, futás #${futasId} (${futasIdeje})`);
})().catch((e) => {
  console.error('HIBA:', e);
  process.exit(1);
});
