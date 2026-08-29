// Radovin árfigyelő – Matcher v2 (Commit 2 / P0.3).
//
// Szigorú, típusos identitás-illesztő. A pontszám KIZÁRÓLAG a már minden kötelező
// kapun átment jelölteket rangsorolja – SOHA nem kompenzál egy elbukott kapuért
// (márka, tétel/változat, évjárat, kiszerelés ml, darabszám, csomagolás, puttony,
// pénznem, készlet).
//
// Referencia: RADOVIN_SYSTEM_IMPROVEMENT_GUIDE.md §7 (P0.3) + §6 (P0.2 identitás).
// A `product.azonositas`-objektum a Commit 3-ban kerül a termékekre; itt tiszta,
// determinisztikus függvényként működik, hogy shadow-módban (Commit 2) tesztelhető
// legyen a jelenlegi matcherrel együtt.

'use strict';

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function phrasePresent(text, phrase) {
  const haystack = ` ${normalizeText(text)} `;
  const needle = ` ${normalizeText(phrase)} `;
  return needle.trim().length > 0 && haystack.includes(needle);
}

function firstFinite(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function extractVolumeMl(text) {
  const value = String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/,/g, '.')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
  const matches = [...value.matchAll(/(?:^|\s)(\d+(?:\.\d+)?)\s*(ml|cl|l)(?:\s|$)/g)];
  if (matches.length !== 1) return null;

  const amount = Number(matches[0][1]);
  const unit = matches[0][2];
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (unit === 'ml') return Math.round(amount);
  if (unit === 'cl') return Math.round(amount * 10);
  return Math.round(amount * 1000);
}

function extractPackCount(text) {
  const value = String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/,/g, '.')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
  const match = value.match(/(?:^|\s)(\d{1,2})\s*x\s*\d+(?:\.\d+)?\s*(?:ml|cl|l)(?:\s|$)/);
  return match ? Number(match[1]) : 1;
}

function extractYears(text) {
  return new Set(String(text || '').match(/\b(?:19|20)\d{2}\b/g) || []);
}

function packagingFrom(text) {
  const value = normalizeText(text);
  const giftTerms = ['gift box', 'gift boxed', 'diszdoboz', 'diszdobozos', 'box set'];
  return giftTerms.some((term) => phrasePresent(value, term)) ? 'gift_box' : 'plain_bottle';
}

function aliasesFor(product, shopId) {
  const shop = product.shop_azonositas?.[shopId];
  const aliases = shop?.elfogadott_tetel_aliasok;
  if (Array.isArray(aliases) && aliases.length) return aliases;
  return product.azonositas?.tetel ? [product.azonositas.tetel] : [];
}

function normalizedUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.href;
  } catch {
    return null;
  }
}

function approvedReferenceMatches(candidate, product, shopId) {
  const mapping = product.shop_azonositas?.[shopId];
  if (!mapping) return false;

  if (mapping.shop_product_id != null) {
    return String(candidate.shopProductId) === String(mapping.shop_product_id) &&
      (mapping.variant_id == null || String(candidate.variantId) === String(mapping.variant_id));
  }

  if (mapping.url && candidate.url) {
    return normalizedUrl(mapping.url) === normalizedUrl(candidate.url);
  }

  if (mapping.ellenorzott_nev) {
    return normalizeText(candidate.name || candidate.nev) === normalizeText(mapping.ellenorzott_nev);
  }
  return false;
}

function evaluateCandidate(candidate, product, shopId) {
  const identity = product.azonositas;
  if (!identity) return { accepted: false, code: 'missing_product_identity' };

  const name = String(candidate.name || candidate.nev || '');
  if (!name) return { accepted: false, code: 'missing_candidate_name' };

  const currency = String(candidate.currency || candidate.penznem || '').toUpperCase();
  if (currency !== identity.penznem) {
    return { accepted: false, code: 'currency_mismatch', detail: { expected: identity.penznem, actual: currency || null } };
  }

  const brandAliases = identity.marka_aliasok || [];
  if (!brandAliases.length || !brandAliases.some((alias) => phrasePresent(name, alias))) {
    return { accepted: false, code: 'brand_mismatch' };
  }

  const expressionAliases = aliasesFor(product, shopId);
  if (!expressionAliases.length || !expressionAliases.some((alias) => phrasePresent(name, alias))) {
    return { accepted: false, code: 'expression_mismatch', detail: { expectedAny: expressionAliases } };
  }

  const expectedVintage = identity.evjarat ?? null;
  if (identity.evjarat_statusz === 'unknown') return { accepted: false, code: 'unknown_expected_vintage' };
  if (expectedVintage != null) {
    const years = extractYears(candidate.structuredVintage || name);
    if (!years.has(String(expectedVintage))) {
      return { accepted: false, code: 'vintage_mismatch', detail: { expected: expectedVintage, actual: [...years] } };
    }
  }

  const expectedMl = Number(identity.kiszereles_ml);
  const actualMl = firstFinite(candidate.volumeMl, candidate.kiszereles_ml, extractVolumeMl(name));
  if (!Number.isFinite(expectedMl) || actualMl == null) {
    return { accepted: false, code: 'unknown_volume', detail: { expected: expectedMl || null, actual: actualMl } };
  }
  if (Math.abs(expectedMl - actualMl) > 5) {
    return { accepted: false, code: 'volume_mismatch', detail: { expected: expectedMl, actual: actualMl } };
  }

  const expectedPack = Number(identity.darab || 1);
  const actualPack = firstFinite(candidate.packCount, candidate.darab, extractPackCount(name));
  if (actualPack !== expectedPack) {
    return { accepted: false, code: 'pack_count_mismatch', detail: { expected: expectedPack, actual: actualPack } };
  }

  const expectedPackaging = identity.csomagolas || 'plain_bottle';
  const actualPackaging = candidate.packaging || packagingFrom(name);
  if (actualPackaging !== expectedPackaging) {
    return { accepted: false, code: 'packaging_mismatch', detail: { expected: expectedPackaging, actual: actualPackaging } };
  }

  if (identity.puttony != null) {
    const normalized = normalizeText(name);
    const puttonyPattern = new RegExp(`(?:^|\\s)${identity.puttony}\\s*puttony(?:os)?(?:\\s|$)`);
    if (!puttonyPattern.test(normalized)) {
      return { accepted: false, code: 'puttony_mismatch' };
    }
  }

  if (candidate.availability === 'out_of_stock') return { accepted: false, code: 'out_of_stock' };

  if (!approvedReferenceMatches(candidate, product, shopId)) {
    return { accepted: false, code: 'unapproved_candidate' };
  }

  let score = 0;
  score += brandAliases.filter((alias) => phrasePresent(name, alias)).length * 2;
  score += expressionAliases.filter((alias) => phrasePresent(name, alias)).length * 4;
  if (candidate.shopProductId && candidate.shopProductId === product.shop_azonositas?.[shopId]?.shop_product_id) {
    score += 100;
  }

  return {
    accepted: true,
    code: 'exact_candidate',
    score,
    evidence: { name, volumeMl: actualMl, packCount: actualPack, packaging: actualPackaging, currency },
  };
}

function selectExactCandidate(candidates, product, shopId) {
  const evaluated = candidates.map((candidate) => ({ candidate, decision: evaluateCandidate(candidate, product, shopId) }));

  const accepted = evaluated
    .filter((entry) => entry.decision.accepted)
    .sort((a, b) => b.decision.score - a.decision.score);

  if (accepted.length === 0) {
    const approvedButChanged = evaluated.some(
      (entry) => approvedReferenceMatches(entry.candidate, product, shopId) && !entry.decision.accepted,
    );
    if (approvedButChanged) {
      return { status: 'mapping_drift', selected: null, evaluated };
    }
    const hasProposal = evaluated.some((entry) => entry.decision.code === 'unapproved_candidate');
    return {
      status: hasProposal ? 'needs_review' : 'no_exact_match',
      selected: null,
      evaluated,
    };
  }

  if (accepted.length > 1 && accepted[0].decision.score === accepted[1].decision.score) {
    return { status: 'ambiguous_match', selected: null, evaluated };
  }

  return { status: 'matched', selected: accepted[0].candidate, evaluated };
}

module.exports = {
  normalizeText,
  phrasePresent,
  extractVolumeMl,
  extractPackCount,
  extractYears,
  packagingFrom,
  aliasesFor,
  normalizedUrl,
  approvedReferenceMatches,
  evaluateCandidate,
  selectExactCandidate,
};
