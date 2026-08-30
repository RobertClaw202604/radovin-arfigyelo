// Radovin árfigyelő – health.json összeállító (guide §20, P1.6, Commit 8).
//
// Kompakt állapotkártya a publikus oldalhoz: utolsó kísérlet, utolsó teljes futás,
// státusz, aktív termékek, baseline/konkurencia lefedettség, shop-státuszok,
// figyelmeztetések. Ez a webes nézet "milyen friss és megbízható az adat" jelzője.

'use strict';

const { RESULT_STATUS } = require('../domain/status');

/**
 * Shop-státusz térkép a futás `eredmenyek[]`-ból.
 * @param {Array} eredmenyek
 * @returns {Object} shop → { status, candidates, duration_ms? }
 */
function shopStatusMap(eredmenyek) {
  const map = {};
  for (const item of eredmenyek || []) {
    for (const a of item.arak || []) {
      if (!map[a.shop]) {
        map[a.shop] = { status: 'ok', candidates: 0, failed_products: 0 };
      }
      map[a.shop].candidates += 1;
      if (a.ar == null && a.hiba) {
        // hiba → az adott tételnél nem jött le adat; jelezzük, ha minden tételnél
        // kudarc volt, az adapter leállására utal.
        map[a.shop].failed_products += 1;
      }
    }
  }
  return map;
}

/**
 * Kompakt health objektum.
 * @param {Object} run a befejezett futás
 * @param {Object} opts { status, warnings } pl. quarantined/healthy
 * @returns {Object}
 */
function buildHealth(run, opts = {}) {
  const eredmenyek = Array.isArray(run.eredmenyek) ? run.eredmenyek : [];
  const shops = shopStatusMap(eredmenyek);
  // Ha egy shop a futásban szuneteltetett / nem volt elérhető, markoljuk meg.
  const activeShops = run.active_shops || [];

  // Státusz: a kapu alapján dől el (healthy / quarantined). Ha a futás nem futott le, failed.
  const status = opts.status || (opts.quarantined ? 'quarantined' : 'healthy');

  return {
    last_attempt_at: run.started_at || null,
    last_complete_run_at: run.finished_at || null,
    last_complete_run_id: run.run_id || null,
    status,
    duration_ms: run.duration_ms != null ? run.duration_ms : null,
    active_products: run.products_expected != null ? run.products_expected : eredmenyek.length,
    baseline_matches: opts.baselineMatched != null ? opts.baselineMatched : null,
    competitor_matches: opts.competitorMatches != null ? opts.competitorMatches : null,
    shops: Object.fromEntries(
      Object.entries(shops).map(([id, s]) => [
        id,
        { status: s.failed_products >= (s.candidates || 1) ? 'error_or_no_data' : 'ok', candidates: s.candidates },
      ])
    ),
    warnings: opts.warnings ? opts.warnings.length : 0,
  };
}

module.exports = { buildHealth, shopStatusMap };
