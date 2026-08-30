// Radovin árfigyelő – candidate kontraktus + eredmény-státusz tesztek (guide §8, §9).

const test = require('node:test');
const assert = require('node:assert/strict');
const { candidate, validateOffer } = require('../lib/domain/candidate');
const { RESULT_STATUS, resbeli, rangbaBefogadhato } = require('../lib/domain/status');

test('candidate() normalizálja az adapter-specifikus alakot', () => {
  const c = candidate({
    shopId: 'borvilag',
    shopProductId: 12345,
    variantId: 'id-7',
    name: '  Teszt Whisky 0.7 l  ',
    url: 'https://borvilag.hu/termek/teszt',
    price: '17990',
    currency: 'huf',
    extractor: 'shopify-products-json-v2',
  });
  assert.equal(c.shopId, 'borvilag');
  assert.equal(c.shopProductId, '12345'); // stringgé normalizálva
  assert.equal(c.variantId, 'id-7');
  assert.equal(c.price, 17990);
  assert.equal(c.currency, 'HUF'); // felső indexes
  assert.equal(c.packCount, 1); // default
  assert.equal(c.availability, 'unknown'); // default
});

test('validateOffer elfogad egy érvényes ajánlatot', () => {
  const c = candidate({
    shopId: 'x', name: 'Érvényes bor', url: 'https://x.hu/t', price: 4990,
    currency: 'HUF', extractor: 'teszt', fetchedAt: '2026-08-29T12:00:00Z',
  });
  assert.deepEqual(validateOffer(c), []);
});

test('validateOffer jelzi a hiányzó nevet, érvénytelen URL-t, árat, pénznemet, extractort, időpontot', () => {
  const c = candidate({
    shopId: 'x', name: '', url: 'ftp://rossz', price: 0, currency: 'EUR',
    extractor: '', fetchedAt: 'nem-dátum',
  });
  const hibak = validateOffer(c);
  assert.ok(hibak.includes('missing_name'));
  assert.ok(hibak.includes('invalid_url'));
  assert.ok(hibak.includes('invalid_price'));
  assert.ok(hibak.includes('unexpected_currency'));
  assert.ok(hibak.includes('missing_extractor'));
  assert.ok(hibak.includes('invalid_timestamp'));
});

test('RESULT_STATUS szókincs kötelező értékeket tartalmaz', () => {
  assert.equal(RESULT_STATUS.MATCHED, 'matched');
  assert.equal(RESULT_STATUS.NO_EXACT_MATCH, 'no_exact_match');
  assert.equal(RESULT_STATUS.AMBIGUOUS_MATCH, 'ambiguous_match');
  assert.equal(RESULT_STATUS.MAPPING_DRIFT, 'mapping_drift');
  assert.equal(RESULT_STATUS.NEEDS_REVIEW, 'needs_review');
  assert.equal(RESULT_STATUS.SOURCE_UNAVAILABLE, 'source_unavailable');
  assert.equal(RESULT_STATUS.TIMEOUT, 'timeout');
  assert.equal(RESULT_STATUS.BLOCKED, 'blocked');
});

test('resbeli() minimális eredmény-alakot ad ki', () => {
  const r = resbeli({
    run_id: '1', termek_id: 'a', shop_id: 'b', status: RESULT_STATUS.MATCHED,
    price: '17990', currency: 'HUF', source_product_key: 'b:123', url: 'https://x',
    fetched_at: '2026-08-29T12:00:00Z', extractor: 'shopify', match_evidence: { m: 1 }, error: null,
  });
  assert.equal(r.status, 'matched');
  assert.equal(r.price, 17990);
});

test('rangbaBefogadhato: csak matched', () => {
  assert.equal(rangbaBefogadhato(RESULT_STATUS.MATCHED), true);
  assert.equal(rangbaBefogadhato(RESULT_STATUS.NO_EXACT_MATCH), false);
  assert.equal(rangbaBefogadhato(RESULT_STATUS.SOURCE_UNAVAILABLE), false);
  assert.equal(rangbaBefogadhato(RESULT_STATUS.AMBIGUOUS_MATCH), false);
  assert.equal(rangbaBefogadhato(RESULT_STATUS.NEEDS_REVIEW), false);
});
