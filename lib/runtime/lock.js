// Radovin árfigyelő – gyártási (production) zár (guide §14, P0.5, Commit 5).
//
// Biztosítja, hogy egyszerre CSAK egy futás/konfig-írás fusson. A scheduler
// önmagában nem elég: egy kézi node run.js átfedhet egy ütemezett futással.
// A zár a `runtime/` mappán van; ha egy másik folyamat éppen fut, a bejövő folyamat
// azonnal elbukik (retries: 0), nem vár és nem lép egymásra.

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
    stale: 60 * 60 * 1000,
    retries: 0,
  });
  try {
    return await work();
  } finally {
    await release();
  }
}

module.exports = { withProductionLock };
