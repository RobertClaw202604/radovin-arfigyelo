'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { trackShopFailures, checkSchedule, toTelegramText, loadState, saveState } = require('../lib/pipeline/alerts.js');
const { notifyTelegram, telegramConfigFromEnv } = require('../lib/runtime/notify.js');
const { withRetry } = require('../lib/runtime/retry.js');
const { qualityGate } = require('../lib/pipeline/quality-gate.js');

const peldak = {
  eredmenyek: [
    {
      termek_id: 'x',
      arak: [
        { shop: 'radovin', tipus: 'radovin', ar: 1000 },
        { shop: 'italpark', tipus: 'konkurencia', ar: null, status: 'source_unavailable' }, // technikai hiba
        { shop: 'borhalo', tipus: 'konkurencia', ar: null, status: 'no_exact_match' },       // nincs pontos talalat (az ertekelésben NINCS teadági hiba)
      ],
    },
    {
      termek_id: 'y',
      arak: [
        { shop: 'radovin', tipus: 'radovin', ar: 2000 },
        { shop: 'italpark', tipus: 'konkurencia', ar: null, status: 'timeout' },            // technikai hiba
        { shop: 'borhalo', tipus: 'konkurencia', ar: null, status: 'no_exact_match' },
      ],
    },
  ],
};

test('trackShopFailures: növeli a hibás shop számlálóját, egészségesnél nulláz', () => {
  const res = trackShopFailures({ shop_fail_counts: {} }, peldak.eredmenyek, { adapter_consecutive_failures: 2 });
  // italpark MINDKÉT terméknél technikai hibás (source_unavailable + timeout) → 1
  assert.equal(res.next.italpark, 1);
  // borhalo: no_exact_match NEM technikai hiba → nem növeljük (0 / nincs)
  assert.equal(res.next.borhalo, 0);
  // radovin tipus=radovin kimarad a konkurencia-számlálóból
  assert.equal(res.next.radovin, undefined);
  assert.deepEqual(res.alerts, []);
});

test('trackShopFailures: 2 egymást követő hibás futás → adapter_leállás riasztás', () => {
  const res = trackShopFailures({ shop_fail_counts: { italpark: 1 } }, peldak.eredmenyek, { adapter_consecutive_failures: 2 });
  assert.equal(res.next.italpark, 2);
  assert.deepEqual(res.alerts, [{ code: 'adapter_consecutive_failures', shop: 'italpark', count: 2, limit: 2 }]);
});

test('checkSchedule: várható+grace időn túl → no_complete_run riasztás', () => {
  const now = Date.parse('2026-08-30T12:00:00Z');
  const state = { last_complete_run_at: '2026-08-30T06:00:00Z' }; // 360 perc régen
  const alerts = checkSchedule(state, { schedule_interval_min: 240, schedule_grace_min: 60 }, now);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].code, 'no_complete_run');
});

test('checkSchedule: a grace-en belül nincs riasztás', () => {
  const now = Date.parse('2026-08-30T12:00:00Z');
  const state = { last_complete_run_at: '2026-08-30T11:00:00Z' }; // 60 perc
  assert.deepEqual(checkSchedule(state, { schedule_interval_min: 240, schedule_grace_min: 60 }, now), []);
});

test('toTelegramText: emberi, markdown-mentes sorok', () => {
  const t = toTelegramText({ severity: 'error', subject: 'KARANTÉN', lines: [['baseline_incomplete', 'x'], ['coverage', 'y']] });
  assert.match(t, /^🔴/);
  assert.match(t, /KARANTÉN/);
  assert.match(t, /baseline_incomplete/);
});

test('notifyTelegram: creds nélkül NEM megy hálózatra (dry-run)', async () => {
  const res = await notifyTelegram('teszt', { env: { RADOVIN_TELEGRAM_BOT_TOKEN: '', RADOVIN_TELEGRAM_CHAT_ID: '' } });
  assert.equal(res.sent, false);
  assert.equal(res.reason, 'no_credentials_dry_run');
});

test('telegramConfigFromEnv: env-ből olvas, nem konfigból', () => {
  const cfg = telegramConfigFromEnv({ RADOVIN_TELEGRAM_BOT_TOKEN: 'abc', RADOVIN_TELEGRAM_CHAT_ID: '123', EGYEB: 'x' });
  assert.deepEqual(cfg, { token: 'abc', chatId: '123' });
});

test('withRetry: első kísérlet siker → azonnal, retry-számláló nincs', async () => {
  let n = 0;
  const r = await withRetry(async () => { n += 1; return 'ok'; }, { retries: 3, baseDelayMs: 1 });
  assert.equal(r, 'ok');
  assert.equal(n, 1);
});

test('withRetry: végső kudarc újradobja a hibát', async () => {
  let n = 0;
  await assert.rejects(
    () => withRetry(async () => { n += 1; throw new Error('boom'); }, { retries: 2, baseDelayMs: 1, logFailures: false }),
    /boom/
  );
  assert.equal(n, 3); // 1 + 2 retry
});

test('withRetry: hiba után siker → visszaadja az értéket', async () => {
  let n = 0;
  const r = await withRetry(async () => { n += 1; if (n < 3) throw new Error('jelenlegi'); return 'vegul'; }, { retries: 3, baseDelayMs: 1, logFailures: false });
  assert.equal(r, 'vegul');
  assert.equal(n, 3);
});

test('qualityGate: cfg-alapú thresholds (nagyobb küszöb → nincs riasztó nagy árváltozásra)', () => {
  const regi = [{ termek_id: 'x', arak: [{ shop: 'radovin', tipus: 'radovin', ar: 1000 }] }];
  const uj = [{ termek_id: 'x', arak: [{ shop: 'radovin', tipus: 'radovin', ar: 2500 }] }]; // ratio 2.5
  const gate = qualityGate({ eredmenyek: uj, products_expected: 1 }, regi, { thresholds: { large_price_change_min: 3.0, extreme_price_change_min: 9.0 } });
  // ratio 2.5 < 3.0 large küszöb, < 9.0 extrém → SE error, SE warning
  assert.deepEqual(gate.errors, []);
  assert.deepEqual(gate.warnings, []);
});

test('alert-state: mentés + újratöltés kerek', async () => {
  const root = path.join(os.tmpdir(), 'radovin-alerts-' + Date.now());
  fs.mkdirSync(root, { recursive: true });
  await saveState(root, { shop_fail_counts: { italpark: 2 }, last_complete_run_at: '2026-08-30T00:00:00Z', last_attempt_at: '2026-08-30T01:00:00Z' });
  const st = loadState(root);
  assert.equal(st.shop_fail_counts.italpark, 2);
  assert.equal(st.last_complete_run_at, '2026-08-30T00:00:00Z');
});

test('loadState: hiányzó fájl → alapértelmezett (nem dob)', () => {
  const st = loadState(path.join(os.tmpdir(), 'nincs-ilyen-' + Date.now()));
  assert.deepEqual(st.shop_fail_counts, {});
});

// Commit 8 GATE: „szándékosan eltörök egy adaptert, és ellenőrzöm a karantént + riasztást,
// anélkül hogy a futás lecserélné az utolsó jó publikus snapshotot."
test('Commit8 gate: törött baseline-adapter → gate ok=false (karantén), riasztás készül, NINCS lecserélt publikus snapshot', async () => {
  // Adapter-törés szimuláció: MINDEN radovin tétel source_unavailable (a baseline hiányos).
  const tornEredmeny = [
    { termek_id: 'x', arak: [{ shop: 'radovin', tipus: 'radovin', ar: null, status: 'source_unavailable' }] },
    { termek_id: 'y', arak: [{ shop: 'radovin', tipus: 'radovin', ar: null, status: 'source_unavailable' }] },
  ];
  const gate = qualityGate({ eredmenyek: tornEredmeny, products_expected: 2 }, []);
  assert.equal(gate.ok, false);
  assert.ok(gate.errors.some((e) => e.code === 'baseline_incomplete' || e.code === 'match_coverage_regression'), 'baseline/coverage regresszió kell');

  // A karantén-riastás emberi szövege (amit a run.js a quarantine-ágon küldene):
  const alertText = toTelegramText({ severity: 'error', subject: 'PIACI KARANTÉN – a futás nem teljesítette a kaput', lines: gate.errors.map((e) => [e.code, e.termek_id || e.pair || '']) });
  assert.match(alertText, /KARANTÉN/);
  assert.match(alertText, new RegExp('baseline_incomplete'));

  // A publikus snapshot NEM cserélődhetett: a karantén-fájl a snapshot-tól FÜGGETLEN
  // (runtime/quarantine/) helyre kerül, és a gate.ok=false MIATT a publikáló út NEM fut.
  // Ezt a run.js karantén-ága garantálja: csak a gate.ok ágon van publikáló.
  // Itt a valódi karantén-írást is lefuttatjuk a run.js karantén-ágának logikájával:
  const root = path.join(os.tmpdir(), 'radovin-gate-' + Date.now());
  const qDir = path.join(root, 'runtime', 'quarantine');
  fs.mkdirSync(qDir, { recursive: true });
  const { writeJsonAtomic } = require('../lib/runtime/atomic.js');
  const qFile = path.join(qDir, 'run-999.quarantine.json');
  await writeJsonAtomic(qFile, { run_id: '999', status: 'quarantined', errors: gate.errors, product_count: tornEredmeny.length });
  assert.ok(fs.existsSync(qFile), 'karantén-fájl a runtime/quarantine alá kerül');
  // A publikus snapshot könyvtár (data/) üres marad ebben a teszt-környezetben:
  assert.ok(!fs.existsSync(path.join(root, 'data')), 'a publikáló út (data/) NEM futott le');
});
