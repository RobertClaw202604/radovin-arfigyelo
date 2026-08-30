// Radovin árfigyelő – atomi (tranzakciós) JSON-írás (guide §14, P0.5, Commit 5).
//
// Egy fájl írása temp-fájlba + fs.sync + atomi rename, hogy SOHA ne szakadjon félbe
// (SIGKILL/áramkimaradás esetén se maradjon csonka célfájl). A publikált snapshot
// csak akkor cserélődik, ha már teljesen ki van írva.

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * Atomi JSON-írás: temp fájl (csak olvasható tulajdonos: 0o600) + rename.
 * @param {string} targetPath cél fájlút
 * @param {*} value JSON-szerializálható érték
 * @returns {Promise<void>}
 */
async function writeJsonAtomic(targetPath, value) {
  const directory = path.dirname(targetPath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(targetPath)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );

  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  await fs.rename(temporary, targetPath);
}

/**
 * Atomi SZÖVEG-írás (JSONL / nyers exportokhoz): a `text`-et szó szerint írja ki,
 * NEM JSON.stringify-olja újra (a writeJsonAtomic JSONL-hez nem jó, mert elmenekíti
 * a sorvégeket). Temp + fs.sync + atomi rename.
 * @param {string} targetPath cél fájlút
 * @param {string} text nyers szöveg
 * @returns {Promise<void>}
 */
async function writeTextAtomic(targetPath, text) {
  const directory = path.dirname(targetPath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    '.' + path.basename(targetPath) + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp'
  );

  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(String(text), 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  await fs.rename(temporary, targetPath);
}

module.exports = { writeJsonAtomic, writeTextAtomic };
