// Radovin árfigyelő – explicit eredmény-státusz szókincs (guide §9).
//
// A bizonytalan null/flag helyett minden tétel×shop eredmény pontos típusú státuszt
// kap. Kizárólag a 'matched' státusz léphet be a pozícióba/rangsorolásba. Ez
// elválasztja a „ez a shop valóban nem árulja” (no_exact_match) tényt attól, hogy
// „a scraper/adapter nem tudta lehozni” (source_unavailable / timeout / blocked…),
// hogy a felhasználó SOHA ne értelmezze a technikai hibát piaci tényként.

'use strict';

const RESULT_STATUS = Object.freeze({
  MATCHED: 'matched',
  NO_EXACT_MATCH: 'no_exact_match',
  AMBIGUOUS_MATCH: 'ambiguous_match',
  MAPPING_DRIFT: 'mapping_drift',
  NEEDS_REVIEW: 'needs_review',
  OUT_OF_STOCK: 'out_of_stock',
  SOURCE_UNAVAILABLE: 'source_unavailable',
  TIMEOUT: 'timeout',
  BLOCKED: 'blocked',
  PARSE_ERROR: 'parse_error',
  INVALID_PRICE: 'invalid_price',
  CONFIG_ERROR: 'config_error',
});

/**
 * Minimal egy tétel×shop eredmény alakja (guide §9).
 * Csak MATCHED szerepelhet rangsorolásban.
 * @param {Object} r
 * @returns {Object} res
 */
function resbeli(r) {
  return {
    run_id: r.run_id || null,
    termek_id: r.termek_id || null,
    shop_id: r.shop_id || null,
    status: r.status || RESULT_STATUS.SOURCE_UNAVAILABLE,
    price: r.price == null ? null : Number(r.price),
    currency: r.currency || null,
    source_product_key: r.source_product_key || null,
    url: r.url || null,
    fetched_at: r.fetched_at || null,
    extractor: r.extractor || null,
    match_evidence: r.match_evidence || {},
    error: r.error || null,
  };
}

/**
 * Bejuthat-e a rangsorolásba (guide: 'Only matched observations enter ranking').
 * @param {string} status
 * @returns {boolean}
 */
function rangbaBefogadhato(status) {
  return status === RESULT_STATUS.MATCHED;
}

module.exports = { RESULT_STATUS, resbeli, rangbaBefogadhato };
