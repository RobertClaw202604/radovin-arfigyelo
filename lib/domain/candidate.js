// Radovin árfigyelő – egységes jelölt- (ajánlat-) kontraktus (guide §8, P0.4).
//
// Minden adapter (Shopify, WooCommerce, Borháló, headless, Radovin…) ugyanazt a
// CANDIDATE alakot adja vissza. A shop-specifikus nyers formák NEM szivároghatnak
// a matcherbe / rangsorolásba. Ez a modul normalizálja és validálja a jelöltet.

'use strict';

/**
 * Normalizált jelölt-objektum. Minden adapter ezt állítja elő.
 * @param {Object} input nyers adapter-specifikus bemenet
 * @returns {Object} normalizált candidate
 */
function candidate(input) {
  return {
    shopId: String(input.shopId),
    shopProductId: input.shopProductId == null ? null : String(input.shopProductId),
    variantId: input.variantId == null ? null : String(input.variantId),
    name: String(input.name || ''),
    url: String(input.url || ''),
    price: Number(input.price),
    currency: String(input.currency || '').toUpperCase(),
    volumeMl: input.volumeMl == null ? null : Number(input.volumeMl),
    packCount: input.packCount == null ? 1 : Number(input.packCount),
    packaging: input.packaging || null,
    structuredVintage: input.structuredVintage || null,
    availability: input.availability || 'unknown',
    extractor: String(input.extractor),
    fetchedAt: input.fetchedAt || new Date().toISOString(),
    evidence: input.evidence || {},
  };
}

/**
 * Normalizált ajánlat validálása. Hibákat ad vissza (tömb); üres = érvényes.
 * @param {Object} offer normalized candidate
 * @returns {string[]} hibakódok listája
 */
function validateOffer(offer) {
  const errors = [];
  if (!offer.name) errors.push('missing_name');
  if (!/^https:\/\//.test(offer.url || '')) errors.push('invalid_url');
  if (!Number.isFinite(offer.price) || offer.price <= 0) errors.push('invalid_price');
  if (offer.currency !== 'HUF') errors.push('unexpected_currency');
  if (!offer.extractor) errors.push('missing_extractor');
  if (!Number.isFinite(Date.parse(offer.fetchedAt))) errors.push('invalid_timestamp');
  return errors;
}

module.exports = { candidate, validateOffer };
