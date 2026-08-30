// Radovin árfigyelő – futás-minőségi kapu (guide §15, P0.6, Commit 5).
//
// A minőségi kapu a publikálás ELŐTT fut: ha nem teljesül, a futás karanténba
// kerül, és az UTOLSÓ JÓ publikus snapshot érintetlen marad. Így egy törött
// adapter vagy masszív parse-törés SOHA nem váltja fel a megbízható árakat egy
// „friss, de hamis” állapottal.
//
// A jelenlegi architektúra tétel-először (item-first); ez a kapu a kész futás
// `eredmenyek[]` tömbjét vizsgálja, amelyre a run.js épül.

'use strict';

const { RESULT_STATUS } = require('../domain/status');

/**
 * A futás áraiból a Radovin-baseline státuszát és a matched árakat gyűjti ki.
 * @param {Array} eredmenyek run.eredmenyek
 */
function collectBaselineFailures(eredmenyek) {
  const baselineFailures = [];
  let baselineMatched = 0;
  let totalProducts = 0;
  for (const item of eredmenyek) {
    totalProducts += 1;
    const radovin = (item.arak || []).find((a) => a.shop === 'radovin' && a.tipus === 'radovin');
    // Commit 4: a matched-et a már explicit statusból olvassuk ki, nem találgatunk.
    const matched = radovin && (radovin.status === RESULT_STATUS.MATCHED || (radovin.ar != null && Number.isFinite(radovin.ar)));
    if (matched) {
      baselineMatched += 1;
    } else {
      baselineFailures.push({
        termek_id: item.termek_id,
        status: radovin && radovin.status ? radovin.status : RESULT_STATUS.NO_EXACT_MATCH,
      });
    }
  }
  return { baselineFailures, baselineMatched, totalProducts };
}

/**
 * Az `eredmenyek` matched árainak száma (Radovin nélkül) + az összes matched ár.
 * @param {Array} eredmenyek
 */
function countStatus(eredmenyek, shopTipus) {
  let count = 0;
  for (const item of eredmenyek) {
    for (const a of item.arak || []) {
      if (a.tipus !== shopTipus) continue;
      if (a.ar != null && a.hiba == null) count += 1;
    }
  }
  return count;
}

/**
 * Két futás matched árainak tétel×shop szintű összehasonlítása.
 * Stabil kulcs: termek_id + shop.
 * @returns {Array<{temek_id, shop, honnan, hova, ratio}>}
 */
function compareMatchedPrices(eredmenyek, regiek) {
  const changes = [];
  const regiMap = new Map();
  for (const item of regiek || []) {
    for (const a of item.arak || []) {
      if (a.ar == null) continue;
      regiMap.set(`${item.termek_id}|${a.shop}`, { price: a.ar, tipus: a.tipus });
    }
  }
  for (const item of eredmenyek) {
    for (const a of item.arak || []) {
      if (a.ar == null) continue;
      const regi = regiMap.get(`${item.termek_id}|${a.shop}`);
      if (!regi || regi.price <= 0) continue;
      const ratio = a.ar / regi.price;
      if (!Number.isFinite(ratio)) continue;
      changes.push({
        termek_id: item.termek_id,
        shop: a.shop,
        honnan: regi.price,
        hova: a.ar,
        ratio: ratio,
        tipus: a.tipus,
      });
    }
  }
  return changes;
}

/**
 * Minőségi kapu. Ha NEM ok, a publikus snapshot nem cserélődhet.
 * Szigorú hibák (ok=false) → karantén. Figyelmeztetések külön listán.
 *
 * @param {Object} run a befejezett futás ({ eredmenyek, products_expected, started_at })
 * @param {Object} previousRun az előző futás eredmenyek tömbje (vagy üres tömb)
 * @param {Object} options { baselineShopId, minBaselineRatio }
 */
function qualityGate(run, previousRun = [], options = {}) {
  const errors = [];
  const warnings = [];
  const baselineShopId = options.baselineShopId || 'radovin';

  const eredmenyek = Array.isArray(run.eredmenyek) ? run.eredmenyek : [];
  const productsExpected = run.products_expected != null ? run.products_expected : eredmenyek.length;

  // 1) Teljes terméklefedettség.
  if (eredmenyek.length !== productsExpected) {
    errors.push({ code: 'product_count_mismatch', got: eredmenyek.length, expected: productsExpected });
  }

  // 2) Radovin-baseline teljesség: minden aktív tételhez kell matched Radovin-ár.
  const { baselineFailures, baselineMatched, totalProducts } = collectBaselineFailures(eredmenyek);
  if (baselineFailures.length) {
    errors.push({ code: 'baseline_incomplete', items: baselineFailures });
  }

  // 3) Matched árak érvényessége (pozitív, véges, HUF).
  for (const item of eredmenyek) {
    for (const a of item.arak || []) {
      if (a.ar == null) continue;
      if (!Number.isFinite(a.ar) || a.ar <= 0) {
        errors.push({ code: 'invalid_matched_price', pair: `${item.termek_id}:${a.shop}`, price: a.ar });
      }
    }
  }

  // 4) Katalógus/lefedettség regresszió: a konkurencia-matched árak ne zuhanjanak
  //    az előző futás 75%-a alá (adapter-törés vs piaci tény megkülönböztetése).
  const previousCompetitor = countStatus(Array.isArray(previousRun) ? previousRun : [], 'konkurencia');
  const currentCompetitor = countStatus(eredmenyek, 'konkurencia');
  if (previousCompetitor > 0 && currentCompetitor < previousCompetitor * 0.75) {
    errors.push({
      code: 'match_coverage_regression',
      previous: previousCompetitor,
      current: currentCompetitor,
      tipus: 'konkurencia',
    });
  }

  // 5) Nagy/extrém árváltozások (tétel×shop stabil kulccsal).
  const regiek = Array.isArray(previousRun) ? previousRun : [];
  for (const change of compareMatchedPrices(eredmenyek, regiek)) {
    if (change.ratio >= 5 || change.ratio <= 0.2) {
      errors.push({ code: 'extreme_price_change_requires_review', ...change });
    } else if (change.ratio >= 2 || change.ratio <= 0.5) {
      warnings.push({ code: 'large_price_change', ...change });
    }
  }

  return { ok: errors.length === 0, errors, warnings, baselineMatched, totalProducts };
}

module.exports = { qualityGate, collectBaselineFailures, compareMatchedPrices };
