#!/usr/bin/env node
// Radovin árfigyelő – publikus kimenetek újraépítése a kanonikus futásokból (guide §21, Commit 7).
//
// Commit 7 gate kritériuma: „published UI data is reproducible from canonical data”.
// A run MOSTANSÁG kizárólag runtime/runs/<id>.json (kanonikus, gitignore-olt) + a kompakt
// legutobbi/elozmeny/health fájlokat írja; a data/arak.jsonl és data/termekek.json/.jsonl
// IDŐSOR-EXPORTOT ez a script generálja a kanonikus futásokból – így a repó növekedése korlátos.
//
// Használat: node scripts/rebuild-public.js [--verify]
//   --verify : olvasási próba (CI-biztonságos; run nélküli repón is 0-val tér vissza).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadAllRuns } = require('../lib/runtime/run-store.js');
const { writeJsonAtomic, writeTextAtomic } = require('../lib/runtime/atomic.js');

const DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(DIR, 'data');
const LATO = path.join(DATA_DIR, 'legutobbi.json');
const ELOZMENY = path.join(DATA_DIR, 'elozmeny.json');
const AKAR_JSONL = path.join(DATA_DIR, 'arak.jsonl');       // per-termék flat export
const TERMEKEK_JSONL = path.join(DATA_DIR, 'termekek.jsonl'); // URL-kulcsú idősor-export
const TERMEKEK_INDEX = path.join(DATA_DIR, 'termekek.json');  // URL-kulcsú aktuális index

const VERIFY = process.argv.includes('--verify');

function urlKulcs(u) {
  if (!u) return null;
  let t = String(u).trim();
  try { t = new URL(t).pathname; } catch {}
  return t.replace(/\/+$/, '');
}

async function main() {
  const runs = await loadAllRuns(DIR);
  if (!runs.length) {
    if (VERIFY) { console.log('REBUILD-VERIFY OK: nincs kanonikus run (CI-safe).'); return; }
    console.error('Nincs kanonikus run-fájl a runtime/runs/ alatt – semmi újraépíthető.');
    process.exit(2);
  }
  const legutobbi = runs[0]; // legújabb (a loadAllRuns rendezte)

  if (VERIFY) {
    console.log(`REBUILD-VERIFY OK: ${runs.length} kanonikus run; legújabb #${legutobbi.futasId} (${legutobbi.futasIdeje || legutobbi.ido}), ${(legutobbi.eredmenyek || []).length} termék.`);
    return;
  }

  // 1) data/legutobbi.json – a legújabb run KOMPAKT web-snapshotja (UI ezt olvassa).
  //    A UI az index.html jelen-nézetben csak: arak[].{shop,shop_nev,ar,nev,hiba} +
  //    pozicio + konkurens_allapot[].nev mezőket használ. A nehéz `arak[].candidates`
  //    (matcher jelölt-dump URL-lel/névvel/árral) és a `url`/`megjegyzes`/`status`
  //    NEM kell a web-snapshotba – attól volt 79MB. A teljes candidate-dump a kanonikus
  //    run-ban marad (adata nem vész el), csak a web-snapshot készül kompaktra.
  const kompaktArak = (e) => (e && Array.isArray(e.arak) ? e.arak.map((a) => ({
    shop: a.shop || null, shop_nev: a.shop_nev || null, ar: a.ar != null ? a.ar : null,
    nev: a.nev || null, hiba: a.hiba || null,
  })) : []);
  const eredmenyekKom = (legutobbi.eredmenyek || []).map((e) => ({
    futas_id: e.futas_id, ido: e.ido, termek_id: e.termek_id,
    termek_nev: e.termek_nev, meret: e.meret || null, pozicio: e.pozicio || null,
    konkurens_allapot: (e.konkurens_allapot || []).map((s) => ({ nev: s.nev })),
    arak: kompaktArak(e),
  }));
  const lato = { futas_id: legutobbi.futasId, ido: legutobbi.futasIdeje || legutobbi.ido, termekekszam: eredmenyekKom.length, eredmenyek: eredmenyekKom };

  // 2) data/elozmeny.json – termék → futás-idők index (mindegyik runból).
  const elozmeny = {};
  for (const r of runs) {
    for (const e of (r.eredmenyek || [])) {
      if (!elozmeny[e.termek_id]) elozmeny[e.termek_id] = [];
      elozmeny[e.termek_id].push({ futas_id: e.futas_id, ido: e.ido, rank: e.pozicio && e.pozicio.rank_jelolo, radovin_ar: e.pozicio && e.pozicio.radovin_ar, median: e.pozicio && e.pozicio.median });
    }
  }

  // 3) data/arak.jsonl – per-termék flat export (korábban a futás írta, ma a rebuild-generálja).
  let arak = '';
  for (const r of runs) for (const e of (r.eredmenyek || [])) arak += JSON.stringify(e) + '\n';

  // 4) data/termekek.jsonl + .json – URL-kulcsú idősor a run STAGED megfigyeléseiből.
  //    (gyujtes_obszeracio a kanonikus futásba került; ha egy régi run-ból hiányzik,
  //    visszaesünk az eredmenyek.arak-ból nyert adatokra.)
  let kat = '';
  const index = {};
  for (const r of runs) {
    const obszer = (r.gyujtes_obszeracio || []);
    const forras = obszer.length ? obszer : r.eredmenyek.flatMap((e) =>
      (e.arak || []).filter((a) => a && a.url && a.ar != null).map((a) => ({
        url: a.url, nev: a.nev, ar: a.ar, shop: a.shop, termek_id: e.termek_id, tipus: a.tipus, megjegyzes: a.megjegyzes,
      })));
    for (const t of forras) {
      const kulcs = urlKulcs(t.url);
      if (!kulcs) continue;
      kat += JSON.stringify({ url: kulcs, nev: t.nev || null, ar: t.ar, ido: r.ido, shop: t.shop || null, termek_id: t.termek_id || null, tipus: t.tipus || null, megjegyzes: t.megjegyzes || null }) + '\n';
      if (!index[kulcs]) index[kulcs] = [];
      index[kulcs].push({ ar: t.ar, ido: r.ido, nev: t.nev || null, shop: t.shop || null });
      if (index[kulcs].length > 500) index[kulcs] = index[kulcs].slice(-500);
    }
  }

  await writeJsonAtomic(LATO, lato);
  await writeJsonAtomic(ELOZMENY, elozmeny);
  await writeTextAtomic(AKAR_JSONL, arak);
  await writeTextAtomic(TERMEKEK_JSONL, kat);
  await writeJsonAtomic(TERMEKEK_INDEX, index);

  console.log(`REBUILD OK: ${runs.length} kanonikus run → legutobbi.json, elozmeny.json, arak.jsonl, termekek.json/.jsonl.`);
}

main().catch((e) => { console.error('REBUILD HIBA:', e.message); process.exit(1); });
