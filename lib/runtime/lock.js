// Radovin árfigyelő – gyártási (production) zár (guide §14, P0.5, Commit 5).
//
// Biztosítja, hogy egyszerre CSAK egy futás/konfig-írás fusson. A scheduler
// önmagában nem elég: egy kézi node run.js átfedhet egy ütemezett futással.
// A zár a `runtime/` mappán van; ha egy másik folyamat ÉPPEN fut (élő, friss
// mtime-jel), a bejövő folyamat gyorsan elbukik (fail-fast, pár retry).
//
// Commit 8 „scheduler lock behavior": egy ELHALT (crashed) futás zára ne blokkolja
// a következő futtatást akár egy óráig. A proper-lockfile a staleness-t a lock
// mtime-jából állapítja meg, és egy ÉLŐ birtokos rendszeresen frissíti azt –
// ezért egy kicsi `stale` ablak + pár probálkozás biztonságosan visszavonja az
// elhalt lockot, miközben egy valódi egyidejű futás (frissebb mtime) továbbra is
// blokkol. (A live run eltarthat 10+ percig is – a proper-lockfile ilyenkor maga
// tartja frissen a mtime-ot, tehát a rövid stale nem okoz hamis visszavételt.)

'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const lockfile = require('proper-lockfile');

/**
 * Előre haladó process-lock: a munka közben a LOCK érvényes, utána mindig feloldva.
 * @param {string} repoRoot gyökérkönyvtár (a `runtime/` alá kerül a lock target)
 * @param {Function} work async munka
 * @returns {Promise<*>}
 */
async function withProductionLock(repoRoot, work) {
  const lockTarget = path.join(repoRoot, 'runtime');
  await fs.mkdir(lockTarget, { recursive: true });
  const release = await lockfile.lock(lockTarget, {
    realpath: false,
    // 90s stale + rövid retry-sor: elhalt PID zára gyorsan visszavonható,
    // élő (mtime-frissítő) egyidejű futás viszont fail-fast blokkol.
    stale: 90 * 1000,
    retries: { retries: 2, factor: 2, minTimeout: 500, maxTimeout: 2000 },
  });
  try {
    return await work();
  } finally {
    await release();
  }
}

module.exports = { withProductionLock };
