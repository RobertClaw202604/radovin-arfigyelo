// Radovin árfigyelő – Commit 7: storage/publication split.
//  - run-store: kanonikus futások mentése/olvasása (runtime/runs/), atomian.
//  - termekgyujto staging: crawl közben NEM ír fájlt, flush után igen.
//  - rebuild: publikus kimenetek újraépíthetők a kanonikus futásokból.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { saveRun, loadAllRuns } = require('../lib/runtime/run-store.js');
const { writeTextAtomic } = require('../lib/runtime/atomic.js');

test.after(() => { delete process.env.RADOVIN_DATA_DIR; });

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'radovin-c7-'));
}

test('run-store: száve ír + betölti a kanonikus futást, sorrend legújabb elöl', async () => {
  const root = tmpdir();
  const r1 = { futasId: 1, ido: '2026-08-30T00:00:00Z', eredmenyek: [{ termek_id: 'a', ar: 100 }] };
  const r2 = { futasId: 2, ido: '2026-08-30T01:00:00Z', eredmenyek: [{ termek_id: 'b', ar: 200 }] };
  await saveRun(root, r1);
  await saveRun(root, r2);

  const all = await loadAllRuns(root);
  assert.equal(all.length, 2);
  assert.equal(all[0].futasId, 2); // legújabb elöl
  assert.equal(all[1].futasId, 1);
});

test('run-store: üres / hiányzó runtime/runs mappa esetén []-t ad', async () => {
  const root = path.join(os.tmpdir(), 'no-such-dir-' + Date.now());
  const all = await loadAllRuns(root);
  assert.deepEqual(all, []);
});

test('writeTextAtomic: nem elmenekíti a sorvégeket (JSONL-hez jó)', async () => {
  const root = tmpdir();
  const f = path.join(root, 'x.jsonl');
  await writeTextAtomic(f, '{\"a\":1}\n{\"a\":2}\n');
  const s = fs.readFileSync(f, 'utf8');
  assert.equal(s.split('\n').filter(Boolean).length, 2);
  assert.equal(s, '{\"a\":1}\n{\"a\":2}\n');
  // ne maradjon temp fájl
  const files = fs.readdirSync(root).filter((x) => x !== 'x.jsonl');
  assert.equal(files.filter((x) => x.includes('.tmp')).length, 0);
});

test('termekgyujto: gyujtEmerge NEM ír diszkre, flushStaged utána igen', async () => {
  const root = tmpdir();
  delete require.cache[require.resolve('../lib/termekgyujto.js')];
  process.env.RADOVIN_DATA_DIR = root;
  const m2 = require('../lib/termekgyujto.js');

  const jsonlPath = path.join(root, 'termekek.jsonl');
  const idxPath = path.join(root, 'termekek.json');

  // gyujtEmerge: nem hoz létre fájlt
  const gy = m2.gyujtEmerge([{ url: 'https://x.hu/bor', ar: 9990, nev: 'Bor', shop: 'x', termek_id: 't1', tipus: 'konkurencia' }]);
  assert.equal(gy, 1);
  assert.equal(fs.existsSync(jsonlPath), false, 'gyujtEmerge nem írhat jsonl-t');
  assert.equal(fs.existsSync(idxPath), false, 'gyujtEmerge nem írhat indexet');

  // flushStaged: append + atomi index
  const n = m2.flushStaged();
  assert.equal(n, 1);
  assert.equal(fs.existsSync(jsonlPath), true);
  assert.equal(fs.existsSync(idxPath), true);
  const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  assert.ok(idx['/bor'], 'index kulcsa a normalizált URL-path');
});

test('termekgyujto: discardStaged törli a megmaradt elemeket (karantén eset)', () => {
  const root = tmpdir();
  process.env.RADOVIN_DATA_DIR = root;
  delete require.cache[require.resolve('../lib/termekgyujto.js')];
  const m = require('../lib/termekgyujto.js');
  m.gyujtEmerge([{ url: 'https://x.hu/a', ar: 1 }]);
  const dropped = m.discardStaged();
  assert.equal(dropped, 1);
  // flush üres staged-del → 0
  assert.equal(m.flushStaged(), 0);
});

test('run-store + rebuild: a legújabb run reprodukálja a publikus snapshotot (paritás)', async () => {
  const root = tmpdir();
  const run = {
    futasId: 77, ido: '2026-08-30T02:00:00Z', termekekszam: 1,
    eredmenyek: [{
      termek_id: 't1', termek_nev: 'Teszt bor', ido: '2026-08-30T02:00:00Z',
      pozicio: { darab: 2, min: 9990, max: 10990, median: 10490, radovin_ar: 10990, rank: '1/2' },
      arak: [{ shop: 'radovin', tipus: 'radovin', ar: 10990, url: 'https://radovin/teszt', status: 'matched' }],
    }],
  };
  await saveRun(root, run);

  const runs = await loadAllRuns(root);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].futasId, 77);
  assert.equal(runs[0].eredmenyek[0].arak[0].ar, 10990);
});
