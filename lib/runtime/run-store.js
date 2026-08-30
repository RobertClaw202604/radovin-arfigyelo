// Radovin árfigyelő – kanonikus run-tároló (guide §21, Commit 7).
//
// A kanonikus (forrás) futástörténet IMMUTABLE, futásonkénti fájlokban él a
// runtime/runs/ alatt – a Pages/git repón KÍVÜL (runtime/ gitignore-olt). Ez az
// egyetlen hiteles forrás, amiből az összes publikus kimenet újjáépíthető.
//
// A run-fájl CSAK a minőségi kapu teljesülése után, atomi módon jön létre
// (writeJsonAtomic) – egy megszakadt/karantén futás SOHA nem ír kanonikus sort.

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { writeJsonAtomic } = require('./atomic.js');
const { log } = require('./logger.js');

/** runtime/runs/ könyvtár a projekt gyökeréből. */
function runsDir(repoRoot) {
  return path.join(repoRoot, 'runtime', 'runs');
}

function runFilePath(repoRoot, runId) {
  return path.join(runsDir(repoRoot), `${runId}.json`);
}

/** Kanonikus run-fájl atomi mentése. */
async function saveRun(repoRoot, run) {
  await fs.mkdir(runsDir(repoRoot), { recursive: true });
  await writeJsonAtomic(runFilePath(repoRoot, run.futasId), run);
  return runFilePath(repoRoot, run.futasId);
}

/** Az összes kanonikus run-fájl beolvasása (legújabb elöl). */
async function loadAllRuns(repoRoot) {
  const dir = runsDir(repoRoot);
  let files;
  try {
    files = await fs.readdir(dir);
  } catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
  files = files.filter((f) => f.endsWith('.json'));
  const runs = [];
  for (const f of files) {
    try {
      const data = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
      if (data && data.futasId != null) runs.push(data);
    } catch { /* sérült fájl kihagyása: a kanonikusból nem veszünk el, csak jelezzük */ }
  }
  // A kanonikus run a futás idejét `futasIdeje` (ISO) mezőben tárolja – az `ido`
  // csak a web-eredmenyekben/legutobbi-ben van. A fajta-hiba miatt (ido undefined a
  // run-objektumban) az rendezés sosem mûködött; javítottuk: futasIdeje, fallback futasId.
  runs.sort((a, b) => {
    const ta = new Date(a.futasIdeje || 0).getTime() || a.futasId || 0;
    const tb = new Date(b.futasIdeje || 0).getTime() || b.futasId || 0;
    return tb - ta;
  });
  return runs;
}

module.exports = { runsDir, runFilePath, saveRun, loadAllRuns };
