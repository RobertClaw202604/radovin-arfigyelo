// Radovin árfigyelő – monitoring/riasztás motor (guide §20, P1.6, Commit 8).
//
// A Commit 8 feladata: a meglévő minőségi kapu (quality-gate) meglévő hibáiból/figyelmeztetéseiből
// RIASZTÁSOKAT képez, és csak „akcióképes" feltételeken szólal meg (guide §20):
//   - publikálás karanténba került (baseline incomplete / coverage regression / extrém árváltozás);
//   - egy korábban egészséges adapter egymást követő N futáson át hibázik;
//   - lefedettség a küszöb alá esik (ezt már a gate is error-ként adja, itt riasztás lesz belőle);
//   - nincs teljes futás a várható üteme szerinti + grace időn belül.
//
// A riasztási küszöbök NEM örök konstansok (guide §13): a config/alerts.json validált értékeiből
// jönnek. A Telegram hitelesítési adatai CSAK env-ből (RADOVIN_TELEGRAM_BOT_TOKEN / _CHAT_ID),
// soha nem konfigból / gitből (guide §20). Ha nincs token, a motort teszt-/dry-run üzemmódban
// lehet futtatni (nem küld hálózatot).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { writeJsonAtomic } = require('./../runtime/atomic.js');

const DEFAULT_STATE = { shop_fail_counts: {}, last_complete_run_at: null, last_attempt_at: null };

function statePath(rootDir) {
  return path.join(rootDir, 'runtime', 'alert-state.json');
}

function loadState(rootDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(rootDir), 'utf8'));
    return {
      shop_fail_counts: parsed.shop_fail_counts || {},
      last_complete_run_at: parsed.last_complete_run_at || null,
      last_attempt_at: parsed.last_attempt_at || null,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function saveState(rootDir, state) {
  await writeJsonAtomic(statePath(rootDir), {
    shop_fail_counts: state.shop_fail_counts || {},
    last_complete_run_at: state.last_complete_run_at || null,
    last_attempt_at: state.last_attempt_at || null,
  });
}

/**
 * Hány egymást követő futás óta hibázik egy-egy shop (adapter) a minőségi
 * kapu szempontjából?  → „egészséges adapter meghalt" riasztás (guide: 2 futás).
 * A számlálót a futás végén a run-eredményekkel frissítjük: ha egy shop árai
 * megegyeznek a korábbival, nullázzuk, ha mind hibásak, növeljük.
 *
 * @param {Object} prevState { shop_fail_counts }
 * @param {Array} eredmenyek a futás eredmenyei
 * @returns {Object} { next: {}, alerts: [] }
 */
function trackShopFailures(prevState, eredmenyek, thresholds) {
  const limit = (thresholds && thresholds.adapter_consecutive_failures) || 2;
  const next = Object.assign({}, prevState.shop_fail_counts || {});
  const alerts = [];
  const shopProblemas = {};
  const shopOsszes = {};

  for (const item of eredmenyek || []) {
    for (const a of item.arak || []) {
      if (a.tipus !== 'konkurencia') continue;
      shopOsszes[a.shop] = (shopOsszes[a.shop] || 0) + 1;
      // hibásnak számít: TECHNIKAI kudarc (source_unavailable / timeout / blocked / config_error).
      // A no_exact_match NEM adapter-hiba (a termék valóban nincs) – a Commit 4/5 státusz-szemantika.
      const hibas =
        a.status === 'source_unavailable' ||
        a.status === 'timeout' ||
        a.status === 'blocked' ||
        a.status === 'config_error' ||
        a.status === 'parse_error';
      if (hibas) shopProblemas[a.shop] = (shopProblemas[a.shop] || 0) + 1;
    }
  }

  for (const shop of Object.keys(shopOsszes)) {
    const total = shopOsszes[shop];
    const probas = shopProblemas[shop] || 0;
    // Ha MINDEN tétel hibás az adott shopnál → adapter-szintű leállásnak tekintjük.
    if (probas >= total && total > 0) {
      next[shop] = (next[shop] || 0) + 1;
      if (next[shop] >= limit) {
        alerts.push({ code: 'adapter_consecutive_failures', shop, count: next[shop], limit });
      }
    } else {
      next[shop] = 0; // legalább egy jó ár → egészségesnek tekintjük, nullázzuk.
    }
  }

  return { next, alerts };
}

/**
 * „Nincs teljes futás a várható + grace időn belül" ellenőrzés.
 * @param {Object} state { last_complete_run_at, last_attempt_at }
 * @param {Object} thresholds { schedule_interval_min, schedule_grace_min }
 * @param {number} now epoch ms (alapértelmezés Date.now())
 * @returns {Array} alerts ({ code: 'no_complete_run' , last_complete_run_at, elapsed_min })
 */
function checkSchedule(state, thresholds, now) {
  const nowMs = now || Date.now();
  const alerts = [];
  const last = state.last_complete_run_at ? new Date(state.last_complete_run_at).getTime() : null;
  if (!last) return alerts; // még sose volt (első telepítés) – nincs hivatkozási alap.
  const intervalMin = (thresholds && thresholds.schedule_interval_min) || 240;
  const graceMin = (thresholds && thresholds.schedule_grace_min) || 60;
  const elapsedMin = (nowMs - last) / 60000;
  if (elapsedMin > intervalMin + graceMin) {
    alerts.push({
      code: 'no_complete_run',
      last_complete_run_at: state.last_complete_run_at,
      elapsed_min: Math.round(elapsedMin),
      threshold_min: intervalMin + graceMin,
    });
  }
  return alerts;
}

/**
 * Emberi olvasású Telegram (markdown-mentes) riasztásüzenet egy eseményhalmazból.
 * @param {Object} o { severity, subject, lines[] }
 * @returns {string}
 */
function toTelegramText(o) {
  const sev = o.severity === 'error' ? '🔴' : o.severity === 'warning' ? '🟠' : 'ℹ️';
  const head = `${sev} ARworks Radovin – ${o.subject}`;
  const body = (o.lines || [])
    .map((l) => (Array.isArray(l) ? ` • ${l.join(' · ')}` : ` • ${l}`))
    .join('\n');
  return body ? `${head}\n${body}` : head;
}

module.exports = { loadState, saveState, trackShopFailures, checkSchedule, toTelegramText, DEFAULT_STATE };
