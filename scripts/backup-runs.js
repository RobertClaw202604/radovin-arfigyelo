#!/usr/bin/env node
// Radovin árfigyelő – kanonikus futások független mentése (guide §21, Commit 7).
//
// A guide leszögezi: „Back up the canonical runtime store independently from git.
// A Pages deployment publication artifact, not a backup.” Ez a script a kanonikus
// runtime/runs/*.json fájlokat a repón kívüli könyvtárba másolja, dátummal ellátva,
// és forgatja (a legrégebbi mentési könyvtárakat törli a NmegeTARTJS szám alapján).
//
// Használat: node scripts/backup-runs.js [--keep N] [--dest /abs/path]
//   --keep N   : mennyi dátumozott mentést tartson (alap: 7)
//   --dest P   : mentési célkönyvtár (alap: ../radovin-backup a projekt mappája mellé)

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runsDir } = require('../lib/runtime/run-store.js');

const DIR = path.join(__dirname, '..');
const RUNS = runsDir(DIR);

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return def;
}

async function main() {
  const keep = parseInt(arg('keep', '7'), 10) || 7;
  const dest = path.resolve(arg('dest', path.join(DIR, '..', 'radovin-backup')));
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const target = path.join(dest, day);

  await fs.promises.mkdir(target, { recursive: true });

  let files = [];
  try { files = await fs.promises.readdir(RUNS); } catch { /* nincs runs */ }
  files = files.filter((f) => f.endsWith('.json'));

  let count = 0;
  for (const f of files) {
    const src = path.join(RUNS, f);
    const dst = path.join(target, f);
    if (await fs.promises.stat(src).then((s) => s.isFile()).catch(() => false)) {
      await fs.promises.copyFile(src, dst);
      count++;
    }
  }

  // Forgatás: a legrégebbi mentési napokat töröljük, ha túl sok van.
  let days = [];
  try { days = (await fs.promises.readdir(dest)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort(); } catch {}
  const surplus = days.length - keep;
  for (let i = 0; i < surplus; i++) {
    await fs.promises.rm(path.join(dest, days[i]), { recursive: true, force: true });
  }

  console.log(`BACKUP OK: ${count} kanonikus run → ${target} (tarolva ${Math.min(days.length, keep)} nap, törölve ${Math.max(surplus, 0)})`);
}

main().catch((e) => { console.error('BACKUP HIBA:', e.message); process.exit(1); });
