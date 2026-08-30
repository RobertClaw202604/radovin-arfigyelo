// Radovin árfigyelő – minőségi kapu + health tesztek (guide §15, §20).
// Tiszta fixture-ok: NINCS élő shop hívás. A kapu egy befejezett futás
// `eredmenyek[]` alakját vizsgálja.

const test = require('node:test');
const assert = require('node:assert/strict');
const { qualityGate } = require('../lib/pipeline/quality-gate');
const { buildHealth } = require('../lib/pipeline/health');

function arak(szor) {
  const base = [
    { shop: 'radovin', shop_nev: 'Radovin', tipus: 'radovin', ar: 5000, nev: 'B', url: 'u', megjegyzes: null, hiba: null },
    { shop: 'borhalo', shop_nev: 'Borháló', tipus: 'konkurencia', ar: 4900, nev: 'B', url: 'u', megjegyzes: null, hiba: null },
  ];
  return base.map((x) => ({ ...x, ar: szor ? Math.round(x.ar * szor) : x.ar }));
}

function run(overrides = {}) {
  return {
    eredmenyek: [
      { futas_id: 1, ido: '2026-08-29T12:00:00Z', termek_id: 'a', termek_nev: 'A', meret: '0,75 l', pozicio: {}, arak: arak(1), gyujtes_szam: 2, konkurens_allapot: [] },
      { futas_id: 1, ido: '2026-08-29T12:00:00Z', termek_id: 'b', termek_nev: 'B', meret: '0,75 l', pozicio: {}, arak: [{ shop: 'radovin', shop_nev: 'Radovin', tipus: 'radovin', ar: 6000, nev: 'B2', url: 'u2', megjegyzes: null, hiba: null }], gyujtes_szam: 1, konkurens_allapot: [] },
    ],
    products_expected: 2,
    started_at: '2026-08-29T12:00:00Z',
    ...overrides,
  };
}

test('teljes, konzisztens futás átmegy a kapun', () => {
  const gate = qualityGate(run(), []);
  assert.equal(gate.ok, true);
  assert.deepEqual(gate.errors, []);
});

test('hiányzó Radovin-baseline (no_exact_match / failure) → baseline_incomplete hiba', () => {
  const rossz = run({
    eredmenyek: [
      { futas_id: 1, ido: '2026-08-29T12:00:00Z', termek_id: 'a', termek_nev: 'A', meret: '0,75 l', pozicio: {}, arak: [{ shop: 'radovin', tipus: 'radovin', ar: null, hiba: 'nincs_talalat' }], gyujtes_szam: 0, konkurens_allapot: [] },
      { futas_id: 1, ido: '2026-08-29T12:00:00Z', termek_id: 'b', termek_nev: 'B', meret: '0,75 l', pozicio: {}, arak: [{ shop: 'radovin', tipus: 'radovin', ar: 6000 }], gyujtes_szam: 1, konkurens_allapot: [] },
    ],
    products_expected: 2,
  });
  const gate = qualityGate(rossz, []);
  assert.equal(gate.ok, false);
  assert.ok(gate.errors.some((e) => e.code === 'baseline_incomplete'));
});

test('termékszám-eltérés → product_count_mismatch hiba', () => {
  const g = qualityGate({ eredmenyek: run().eredmenyek.slice(0, 1), products_expected: 3 }, []);
  assert.ok(g.errors.some((e) => e.code === 'product_count_mismatch'));
});

test('matched ár nem pozitív/véges → invalid_matched_price hiba', () => {
  const rossz = run();
  rossz.eredmenyek[0].arak[0].ar = -5;
  const g = qualityGate(rossz, []);
  assert.ok(g.errors.some((e) => e.code === 'invalid_matched_price'));
});

test('konkurencia-lefedettség 75% alá esik az előzőhöz képest → match_coverage_regression', () => {
  const elozo = run(); // 1 konkurencia matched
  const most = run({
    eredmenyek: [
      { futas_id: 2, ido: '2026-08-29T13:00:00Z', termek_id: 'a', termek_nev: 'A', meret: '0,75 l', pozicio: {}, arak: [arak(1)[0]], gyujtes_szam: 0, konkurens_allapot: [] },
      { futas_id: 2, ido: '2026-08-29T13:00:00Z', termek_id: 'b', termek_nev: 'B', meret: '0,75 l', pozicio: {}, arak: [arak(1)[0]], gyujtes_szam: 0, konkurens_allapot: [] },
    ],
  });
  const g = qualityGate(most, elozo.eredmenyek);
  assert.ok(g.errors.some((e) => e.code === 'match_coverage_regression'));
});

test('extrém árváltozás (>5×) → extreme_price_change_requires_review; nagy (>2×) → csak figyelmeztetés', () => {
  const elozo = run();
  const most = run({
    eredmenyek: [
      { futas_id: 2, ido: '2026-08-29T13:00:00Z', termek_id: 'a', termek_nev: 'A', meret: '0,75 l', pozicio: {}, arak: arak(8), gyujtes_szam: 2, konkurens_allapot: [] }, // 5000→40000 = 8×
      run().eredmenyek[1],
    ],
  });
  const g = qualityGate(most, elozo.eredmenyek);
  assert.ok(g.errors.some((e) => e.code === 'extreme_price_change_requires_review'));
});

test('buildHealth kompakt állapotkártyát ad', () => {
  const r = run();
  const h = buildHealth({ ...r, run_id: 'x', duration_ms: 1000, finished_at: '2026-08-29T12:01:00Z', active_shops: ['radovin', 'borhalo'] }, { status: 'healthy', baselineMatched: 2, competitorMatches: 1 });
  assert.equal(h.status, 'healthy');
  assert.equal(h.active_products, 2);
  assert.equal(h.baseline_matches, 2);
  assert.equal(h.shops.radovin.status, 'ok');
});
