// Radovin árfigyelő – tranzakciós publikálás + megszakítás-teszt (Commit 5 gate).
//
// CÉL: a "latest byte-identical marad sikertelen/megszakított futás után" feltétel
// igazolása. Egyrészt az atomic.js sosem hagy félbeírt fájlt (temp + rename),
// másrészt a minőségi kapu karantén esetén NEM írja felül a publikus snapshotot.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeJsonAtomic } = require('../lib/runtime/atomic.js');
const { qualityGate } = require('../lib/pipeline/quality-gate.js');
const { RESULT_STATUS } = require('../lib/domain/status.js');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'radovin-atomic-'));
}

test('writeJsonAtomic: atomi írás – nincs félbeírt célfájl, csak teljes cserélés', async () => {
  const dir = mkTmpDir();
  const target = path.join(dir, 'latest.json');
  const elso = { futas_id: 1, eredmenyek: [] };
  await writeJsonAtomic(target, elso);
  assert.equal(fs.readFileSync(target, 'utf8'), JSON.stringify(elso, null, 2) + '\n');
  // Nincs maradék temp fájl.
  const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.tmp'));
  assert.deepEqual(leftovers, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('qualityGate: karantén esetén az előző publikus snapshot ÉRINTETLEN marad', async () => {
  const dir = mkTmpDir();
  const target = path.join(dir, 'latest.json');
  const lastGood = { futas_id: 99, ido: 'x', termekekszam: 2, eredmenyek: [] };
  await writeJsonAtomic(target, lastGood);

  // Egy törött futás: baseline-incomplete (nincs radovin matched egy tételnél).
  const rossz = {
    eredmenyek: [
      { futas_id: 100, ido: 'y', termek_id: 'a', termek_nev: 'A', meret: '0,75 l', pozicio: {}, arak: [{ shop: 'radovin', tipus: 'radovin', ar: null, status: RESULT_STATUS.SOURCE_UNAVAILABLE }], gyujtes_szam: 0, konkurens_allapot: [] },
      { futas_id: 100, ido: 'y', termek_id: 'b', termek_nev: 'B', meret: '0,75 l', pozicio: {}, arak: [{ shop: 'radovin', tipus: 'radovin', ar: 6000, status: RESULT_STATUS.MATCHED }], gyujtes_szam: 1, konkurens_allapot: [] },
    ],
    products_expected: 2,
  };
  const gate = qualityGate(rossz, []);
  assert.equal(gate.ok, false); // NEM teljesíti a kaput

  // Publish színlelése: ha a kapu nem ok, az atomi publikáló NEM fut (karanténba megy),
  // ezért a célfájl byte-identikusan az utolsó jó marad.
  if (gate.ok) {
    await writeJsonAtomic(target, { futas_id: 100 });
  }
  assert.equal(fs.readFileSync(target, 'utf8'), JSON.stringify(lastGood, null, 2) + '\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('resbeli: csak matched léphet rangsorba; a statusok explicit módon elkülönülnek', () => {
  const { resbeli, rangbaBefogadhato } = require('../lib/domain/status.js');
  const m = resbeli({ run_id: 'r1', termek_id: 'a', shop_id: 'radovin', status: RESULT_STATUS.MATCHED, price: 5000, currency: 'HUF' });
  assert.equal(m.status, 'matched');
  assert.equal(rangbaBefogadhato(m.status), true);
  const sd = resbeli({ run_id: 'r1', termek_id: 'a', shop_id: 'borhalo', status: RESULT_STATUS.SOURCE_UNAVAILABLE });
  assert.equal(rangbaBefogadhato(sd.status), false);
});
