#!/usr/bin/env node
// Radovin árfigyelő – fő futtató script
// Használat: node run.js
// Minden futás: lekéri a termékárakat minden shopból, elmenti data/arak.jsonl-be (append-only),
// és frissíti data/legutobbi.json + data/elozmeny.json állapotot a webes nézethez.

const fs = require('fs');
const path = require('path');
const scraper = require('./lib/scraper.js');
const { pozicio } = require('./lib/pozicio.js');

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

  for (const termek of termekek) {
    const termekArak = [];
    for (const shop of activeShops) {
      const r = await scraper.run(termek, shop, cfg);
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
