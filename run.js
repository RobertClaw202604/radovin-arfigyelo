#!/usr/bin/env node
// Radovin árfigyelő – fő futtató script (tranzakciós, Commit 5 / P0.5)
//
// Használat: node run.js
//
// TRANZAKCIÓS PUBLIKÁLÁS (guide §14-15, Commit 5):
//  1. Gyártási zár (production lock) – egyszerre csak egy futás.
//  2. Konfig-validáció (fail-fast).
//  3. Teljes crawl a memóriában; NEM történik append a hálózati munka közben.
//  4. Minőségi kapu (quality-gate) az előző futás alapján.
//  5. Ha a kapu NEM teljesül → karantén, az utolsó jó snapshot érintetlen; kilép hibával.
//  6. Ha teljesül → atomi írás (latest.json, elozmeny.json, health.json + JSONL export).
// A cél: egy hálózati adapter-törés SOHA ne váltsa fel a megbízható árakat.

const fs = require('fs');
const path = require('path');
const scraper = require('./lib/scraper.js');
const { pozicio } = require('./lib/pozicio.js');
const termekgyujto = require('./lib/termekgyujto.js');
const configModul = require('./lib/runtime/config.js');
const { withProductionLock } = require('./lib/runtime/lock.js');
const { writeJsonAtomic } = require('./lib/runtime/atomic.js');
const { mapLimit } = require('./lib/runtime/concurrency.js');
const { closeBrowser } = require('./lib/runtime/browser-pool.js');
const { qualityGate } = require('./lib/pipeline/quality-gate.js');
const { buildHealth } = require('./lib/pipeline/health.js');
const { log } = require('./lib/runtime/logger.js');

const DIR = __dirname;
const DATA_DIR = path.join(DIR, 'data');
const RUNTIME_DIR = path.join(DIR, 'runtime');
const QUARANTINE_DIR = path.join(RUNTIME_DIR, 'quarantine');
const PUBLIC_DIR = path.join(DIR, 'public-data');

const JSONL = path.join(DATA_DIR, 'arak.jsonl');
const LATO = path.join(DATA_DIR, 'legutobbi.json');
const ELOZMENY = path.join(DATA_DIR, 'elozmeny.json');
const HEALTH = path.join(PUBLIC_DIR, 'health.json');
const PUBLIC_LATEST = path.join(PUBLIC_DIR, 'latest.json');

async function crawlEgesz(betoltottCfg, katalogusosCachel, nyersShopCfg) {
  // Belső crawl: mindent a memóriában gyűjt; a kiírás kizárólag a publikálóban történik.
  const elozetes = betoltottCfg;
  const shopok = elozetes.shopok;
  const termekek = elozetes.termekek;
  const futasIdeje = new Date().toISOString();
  const futasId = Date.now();
  // Commit 6: futás-szintű katalógus-gyorsítótár (shop.id -> teljes katalógus),
  // hogy a katlistas adapter MINDEN termék helyett csak egyszer töltsön le shoponként.
  const katlistasKatalogCache = new Map();

  const activeShops = shopok.filter((s) => s.statusz === 'active');
  const pendingShops = shopok.filter((s) => s.statusz === 'pending' || s.statusz === 'blocked');
  const eredmenyek = [];

  for (const termek of termekek) {
    if (termek.aktiv === false) {
      log('skip_inactive', { termek_id: termek.id, oka: termek.szuneteltetes_oka || 'nincs_ok' });
      continue;
    }
    const termekArak = [];
    const gyujtendo = [];
    // Commit 6: shop-loop korlátos párhuzamossággal (2 egyidejű shop) + katalógus-gyorsítótár.
    // A worker az eredeti hívási szerződést őrzi: scraper.run(termek, shop, nyersShopCfg, katlistasCache).
    const shopEredmenyek = await mapLimit(activeShops, 2, async (shop) => {
      const r = await scraper.run(termek, shop, nyersShopCfg, katlistasKatalogCache);
      return { shop, r };
    });
    for (const { shop, r } of shopEredmenyek) {
      const forras = shop.tipus === 'sajat' ? 'radovin' : 'konkurencia';
      if (r && Array.isArray(r.talalatok)) {
        const katalogusos = ['borhalo', 'katlistas', 'shopify', 'woocommerce-api'].includes(shop.adapter);
        const marVolt = katalogusosCachel.get(shop.id) === true;
        for (const t of r.talalatok) {
          if (!(t && t.url && t.ar != null)) continue;
          if (katalogusos) {
            if (marVolt && !(r.talalat && r.talalat.url === t.url)) continue;
          }
          gyujtendo.push({
            url: t.url, nev: t.nev || null, ar: t.ar, shop: shop.id,
            termek_id: termek.id, tipus: forras, megjegyzes: 'aktív találat (' + (shop.adapter || '') + ')',
          });
        }
        if (katalogusos) katalogusosCachel.set(shop.id, true);
      }

      if (r && r.talalat && r.talalat.ar != null) {
        termekArak.push({
          shop: shop.id, shop_nev: shop.nev, tipus: forras, ar: r.talalat.ar,
          nev: r.talalat.nev, url: r.talalat.url, megjegyzes: r.talalat.megjegyzes || null, hiba: r.hiba || null,
          status: r.status || 'matched', candidates: r.candidates || [],
        });
      } else if (r) {
        termekArak.push({
          shop: shop.id, shop_nev: shop.nev, tipus: forras, ar: null, nev: null,
          url: null, megjegyzes: null, hiba: r.hiba || 'nincs_talalat',
          status: r.status || 'source_unavailable', candidates: r.candidates || [],
        });
      }
    }

    const p = pozicio(termekArak);
    const gyujtesSzam = termekgyujto.mentes(gyujtendo) || 0;
    const konkurensAllapot = pendingShops.map((s) => ({ shop: s.id, nev: s.nev, statusz: s.statusz }));

    eredmenyek.push({
      futas_id: futasId, ido: futasIdeje, termek_id: termek.id, termek_nev: termek.nev,
      meret: termek.meret,
      pozicio: { darab: p.darab, min: p.min, max: p.max, median: p.median, radovin_ar: p.radovin_ar, rank: p.rank, rank_jelolo: p.rank_jelolo },
      arak: termekArak, gyujtes_szam: gyujtesSzam, konkurens_allapot: konkurensAllapot,
    });

    log('item_done', { termek_id: termek.id, rank: p.rank_jelolo, radovin: p.radovin_ar, min: p.min, max: p.max, darab: p.darab });
  }

  return { futasId, futasIdeje, eredmenyek, activeShops, pendingShops, termekekszam: eredmenyek.length };
}

// --- Publikálás: csak a minőségi kapu teljesülése után, atomi írással ---
function publikalo(run, regiek, health) {
  const futasId = run.futasId;
  const futasIdeje = run.futasIdeje;
  const eredmenyek = run.eredmenyek;

  // 1) JSONL export (kompatibilitás: az append-only naplónak megf elelő alak).
  const jsonl = eredmenyek.map((s) => JSON.stringify(s)).join('\n');

  // 2) legutóbbi összesítés a webes nézethez.
  const lato = { futas_id: futasId, ido: futasIdeje, termekekszam: eredmenyek.length, eredmenyek };

  // 3) előzmény-index (termék → futás idejei).
  const elozmeny = (regiek && regiek.lato && Array.isArray(regiek.lato.eredmenyek)) ? {} : {};
  if (regiek && regiek.elozmeny) {
    Object.assign(elozmeny, regiek.elozmeny);
  }
  for (const e of eredmenyek) {
    if (!elozmeny[e.termek_id]) elozmeny[e.termek_id] = [];
    elozmeny[e.termek_id].push({ futas_id: e.futas_id, ido: e.ido, rank: e.pozicio.rank_jelolo, radovin_ar: e.pozicio.radovin_ar, median: e.pozicio.median });
  }

  // A kiírások atomiak: a célfájl csak teljes hálózati+publikálási munka után cserélődik.
  return Promise.all([
    writeJsonAtomic(JSONL, jsonl + (jsonl ? '\n' : '')),
    writeJsonAtomic(LATO, lato),
    writeJsonAtomic(ELOZMENY, elozmeny),
    writeJsonAtomic(HEALTH, health),
    writeJsonAtomic(PUBLIC_LATEST, lato),
  ]);
}

(async () => {
  const futasKezdet = Date.now();

  await withProductionLock(DIR, async () => {
    log('run_start', { at: new Date(futasKezdet).toISOString() });

    // Kimeneti könyvtárak biztosítása (data, runtime, public-data), hogy az atomi
    // publikálás SOHA ne fusson hiányzó célmappába (ENOENT).
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    await fs.promises.mkdir(RUNTIME_DIR, { recursive: true });
    await fs.promises.mkdir(PUBLIC_DIR, { recursive: true });

    // Konfig-validáció (fail-fast) – P0.
    const elozetes = configModul.betoltEgesz();
    // A nyers (validálatlan) shopok.json, ahogy az eredeti run.js adta a scrapernek.
    const nyersShopCfg = JSON.parse(fs.readFileSync(path.join(DIR, 'config/shopok.json'), 'utf8'));
    const katalogusosCachel = new Map();

    // Előző futás betöltése a kapuhoz (ha van).
    let regiek = null;
    if (fs.existsSync(LATO)) {
      try { regiek = { lato: JSON.parse(fs.readFileSync(LATO, 'utf8')) }; } catch { regiek = null; }
    }
    if (fs.existsSync(ELOZMENY)) {
      try { regiek = { ...(regiek || {}), elozmeny: JSON.parse(fs.readFileSync(ELOZMENY, 'utf8')) }; } catch { /* ignore */ }
    }
    const regiEredmenyek = (regiek && regiek.lato && regiek.lato.eredmenyek) || [];

    // Crawl (memóriában; nincs append hálózati munka közben).
    const run = await crawlEgesz(elozetes, katalogusosCachel, nyersShopCfg);
    const duration = Date.now() - futasKezdet;

    // Minőségi kapu az előző futás alapján.
    const gate = qualityGate({ eredmenyek: run.eredmenyek, products_expected: run.termekekszam, started_at: run.futasIdeje }, regiEredmenyek);
    if (!gate.ok) {
      // Karantén: az utolsó jó snapshot ÉRINTETLEN marad.
      await fs.promises.mkdir(QUARANTINE_DIR, { recursive: true });
      const qFile = path.join(QUARANTINE_DIR, `run-${run.futasId}.quarantine.json`);
      await writeJsonAtomic(qFile, {
        run_id: String(run.futasId), started_at: run.futasIdeje, duration_ms: duration,
        status: 'quarantined', errors: gate.errors, warnings: gate.warnings,
        product_count: run.eredmenyek.length,
      });
      log('run_quarantined', { futas_id: run.futasId, errors: gate.errors });
      for (const e of gate.errors) { log('gate_error', { code: e.code, detail: e }); }
      console.error(`KARANTÉN: a futás #${run.futasId} nem teljesítette a minőségi kaput (${gate.errors.length} hiba). Az utolsó jó snapshot érintetlen marad.`);
      console.error(gate.errors.map((e) => e.code).join(', '));
      throw new Error(`quality gate failed (${gate.errors.length} errors)`);
    }

    // A kapu teljesült → egészségkártya + atomi publikálás.
    const competitorMatches = run.eredmenyek.reduce((n, item) => n + item.arak.filter((a) => a.tipus === 'konkurencia' && a.ar != null).length, 0);
    const health = buildHealth({ ...run, run_id: String(run.futasId), duration_ms: duration, finished_at: new Date().toISOString(), active_shops: run.activeShops.map((s) => s.id) }, {
      status: 'healthy', warnings: gate.warnings, baselineMatched: gate.baselineMatched, competitorMatches,
    });

    await publikalo(run, regiek, health);
    for (const w of gate.warnings) { log('gate_warning', { code: w.code, detail: w }); }

    log('run_complete', { futas_id: run.futasId, duration_ms: duration, termekekszam: run.termekekszam, warnings: gate.warnings.length });
    console.log(`\nKész: ${run.termekekszam} termék, futás #${run.futasId} (${run.futasIdeje}), ${duration} ms, ${gate.warnings.length} figyelmeztetés`);
  });
})().then(
  () => closeBrowser().then(() => process.exit(0)),
  (e) => closeBrowser().then(() => { console.error('HIBA:', e && e.message); process.exit(1); })
);
