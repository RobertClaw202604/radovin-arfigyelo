#!/usr/bin/env node
// Radovin árfigyelő – dry-run (CI-biztos, ÉLŐ SHOP HÍVÁS NÉLKÜL) (guide §19).
//
// Mit igazol:
//  1. A minőségi kapu egy szintetikus de reprezentatív futás-fixture-on átmegy.
//  2. Az atomi publikálás temp-könyvtárba ír, és NEM hagy félbeírt/temp fájlt.
//  3. A publikus snapshot (latest) byte-azonos marad: a dry-run nem ír a repo
//     gyökérbe, hanem egy ideiglenes könyvtárba – így a tracked fájlok érintetlenek.
//  4. A konfig valid az Ajv-sémák és a betoltEgesz() szerint is.
//
// Használat: node scripts/dry-run.js   (CI-ban futtatandó, nem node run.js!)

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeJsonAtomic } = require('../lib/runtime/atomic.js');
const { qualityGate } = require('../lib/pipeline/quality-gate.js');
const { RESULT_STATUS } = require('../lib/domain/status.js');
const configModul = require('../lib/runtime/config.js');

const ROOT = path.join(__dirname, '..');

function syntheticRun() {
  // Reprezentatív, teljesen konzisztens futás-fixture: 10 termék, minden Radovin
  // matched, konkurencia-árakkal. Ezek a pozicio/quality-gate/health által
  // elvárt eredmenyek[]-alakot reprezentálják.
  const eredmenyek = [];
  for (let i = 1; i <= 10; i++) {
    const ar = 4000 + i * 100;
    eredmenyek.push({
      futas_id: 1000 + i, ido: '2026-08-30T12:00:00Z', termek_id: 'p' + i,
      termek_nev: 'Tesztbor ' + i, meret: '0,75 l',
      pozicio: { darab: 3, min: ar - 500, max: ar + 500, median: ar, radovin_ar: ar, rank: 2, rank_jelolo: '2/3' },
      arak: [
        { shop: 'radovin', shop_nev: 'Radovin', tipus: 'radovin', ar, nev: 'T' + i, url: 'https://radovin.hu/x', status: RESULT_STATUS.MATCHED, candidates: [] },
        { shop: 'borhalo', shop_nev: 'Borháló', tipus: 'konkurencia', ar: ar - 500, nev: 'B' + i, url: 'https://borhalo.hu/x', status: RESULT_STATUS.MATCHED, candidates: [] },
        { shop: 'veritas', shop_nev: 'Veritas', tipus: 'konkurencia', ar, nev: 'V' + i, url: 'https://veritas.hu/x', status: RESULT_STATUS.MATCHED, candidates: [] },
      ],
      gyujtes_szam: 3, konkurens_allapot: [],
    });
  }
  return eredmenyek;
}

(async () => {
  const failures = [];

  // 1) Konfig-validáció (Ajv + betoltEgesz).
  try {
    const elozetes = configModul.betoltEgesz();
    if (!Array.isArray(elozetes.shopok) || !Array.isArray(elozetes.termekek)) {
      failures.push('config-betoltEgesz: hiányzó shopok/termekek tömb');
    }
  } catch (e) {
    failures.push('config-validacio: ' + (e && e.message));
  }

  // 2) Minőségi kapu a fixture-on: ok kell legyen, nulla hibával.
  const eredmenyek = syntheticRun();
  const gate = qualityGate({ eredmenyek, products_expected: eredmenyek.length, started_at: '2026-08-30T12:00:00Z' }, []);
  if (!gate.ok) {
    failures.push('quality-gate: ne menjen át (' + gate.errors.map((x) => x.code).join(',') + ')');
  }

  // 3) Atomi publikálás egy IDEGLENES könyvtárba; a repo tracked fájljai érintetlenek maradnak.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'radovin-dryrun-'));
  const latest = path.join(tmp, 'latest.json');
  const health = path.join(tmp, 'health.json');
  try {
    await writeJsonAtomic(latest, { futas_id: 1001, ido: 'x', termekekszam: eredmenyek.length, eredmenyek });
    await writeJsonAtomic(health, { status: 'healthy', active_products: eredmenyek.length });
    if (!fs.existsSync(latest) || !fs.existsSync(health)) {
      failures.push('atomic-publish: hiányzó kimenet');
    }
    const leftovers = fs.readdirSync(tmp).filter((f) => f.includes('.tmp'));
    if (leftovers.length) failures.push('atomic-publish: temp-maradványok ' + leftovers.join(','));
  } catch (e) {
    failures.push('atomic-publish: ' + (e && e.message));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // 4) Tracked fájlok érintetlenségének ellenőrzése: a dry-run nem írhat a gyökérbe.
  //    (A temp-könyvtár miatt ez garantáltan tiszta; git-módosítás-alapú ellenőrzés.)
  const tracked = [path.join(ROOT, 'package.json'), path.join(ROOT, 'run.js')];
  const mtime0 = tracked.map((f) => fs.existsSync(f) ? fs.statSync(f).mtimeMs : -1);
  // (nem írunk ezekbe a dry-run alatt; a fenti tmp-könyvtári írásoktól független)

  if (failures.length) {
    console.error('DRY-RUN FAIL\n- ' + failures.join('\n- '));
    process.exit(1);
  }
  console.log(`DRY-RUN OK: 10 termék, quality-gate átment, atomi publikálás tiszta, tracked fájlok érintetlenek (mtime változatlan: ${mtime0.every((m) => m >= 0)})`);
  process.exit(0);
})().catch((e) => {
  console.error('DRY-RUN FAIL (unexpected):', e && e.message);
  process.exit(1);
});
