// Radovin árfigyelő – Commit 4: adapter-eredmény státusz-normalizáció és típusos jelöltek.
// Fixture-alapú; az adapterek legacy {talalatok, talalat} alakjából vezeti le az
// explicit státuszt (source failure vs no exact match) és a Candidate-tömböt.

const test = require('node:test');
const assert = require('node:assert/strict');
const scraper = require('../lib/scraper.js');
const { RESULT_STATUS } = require('../lib/domain/status.js');

const { stateFromResult, normalizeCandidates, statusFromHiba } = scraper._test;
const SHOP = { id: 'borhalo', adapter: 'borhalo', nev: 'Borháló' };
const TERMEK = { id: 'x', nev: 'Tokaji 5 puttonyos', radovin_kereso: 'tokaji' };

test('hiba nélküli találat → matched', () => {
  const r = { ok: true, talalat: { nev: 'B', ar: 5000, url: 'https://x.hu/p' } };
  assert.equal(stateFromResult(r), RESULT_STATUS.MATCHED);
});

test('ok, de nincs találat → no_exact_match (piaci tény, nem hiba)', () => {
  const r = { ok: true, talalat: null, talalatok: [] };
  assert.equal(stateFromResult(r), RESULT_STATUS.NO_EXACT_MATCH);
});

test('blocked shop → blocked', () => {
  assert.equal(statusFromHiba('blocked_bot_vedett'), RESULT_STATUS.BLOCKED);
});

test('kereso_nem_elerheto hiba → source_unavailable (technikai kudarc, NEM no_exact_match)', () => {
  const r = { ok: false, hiba: 'kereso_nem_elerheto', talalat: null };
  assert.equal(stateFromResult(r), RESULT_STATUS.SOURCE_UNAVAILABLE);
});

test('timeout hiba → timeout státusz', () => {
  assert.equal(statusFromHiba('request timed out'), RESULT_STATUS.TIMEOUT);
});

test('parse/egyéb hiba → parse_error / source_unavailable, sosem matched', () => {
  assert.equal(statusFromHiba('parse failed'), RESULT_STATUS.PARSE_ERROR);
  const r = { ok: false, hiba: 'hiba: valami', talalat: null };
  assert.equal(stateFromResult(r), RESULT_STATUS.PARSE_ERROR);
});

test('nincs_adapter → config_error', () => {
  assert.equal(statusFromHiba('nincs_adapter'), RESULT_STATUS.CONFIG_ERROR);
});

test('normalizeCandidates: legacy talalatlista → típusos Candidate (HUF, URL, ár)', () => {
  const r = { talalatok: [
    { nev: 'Tokaji 5 puttonyos', ar: 4900, url: 'https://borhalo.hu/p1' },
    { nev: 'Tokaji 5 puttonyos 0,75l', ar: 5100, url: 'https://borhalo.hu/p2' },
  ] };
  const cands = normalizeCandidates(r, SHOP, TERMEK);
  assert.equal(cands.length, 2);
  const c = cands[0];
  assert.equal(c.shopId, 'borhalo');
  assert.equal(c.currency, 'HUF');
  assert.equal(c.price, 4900);
  assert.equal(c.extractor, 'borhalo');
  assert.ok(/^https:\/\//.test(c.url));
});

test('normalizeCandidates: érvénytelen (ár nélküli / URL nélküli) jelölteket eldobja', () => {
  const r = { talalatok: [
    { nev: 'Nincs ár', url: 'https://x.hu/a' },        // ar hiányzik
    { nev: 'Nincs url', ar: 1000 },                      // url hiányzik
    { ar: 2000, url: 'https://x.hu/b' },                 // neve sincs (név fallback termek.nev)
    { nev: 'OK', ar: 3000, url: 'https://x.hu/c' },
  ] };
  const cands = normalizeCandidates(r, SHOP, TERMEK);
  assert.equal(cands.length, 2); // csak a név-fallbackes és a teljes
});

test('adiagnosztika: matched jelölt a rangsorba befogadható, source_unavailable NEM', () => {
  const { rangbaBefogadhato } = require('../lib/domain/status.js');
  assert.equal(rangbaBefogadhato(RESULT_STATUS.MATCHED), true);
  assert.equal(rangbaBefogadhato(RESULT_STATUS.SOURCE_UNAVAILABLE), false);
  assert.equal(rangbaBefogadhato(RESULT_STATUS.NO_EXACT_MATCH), false);
});
