// Radovin árfigyelő – megosztott (single-instance) headless böngésző (guide §13, Commit 6).
//
// Jelenlegi probléma: a headless adapter ÉPENKÉNT indít + zár egy Chrome-ot
// MINDEN termék×shop hívásnál, ami tucatnyi böngészőfolyamatot és 10+ percet eredményez.
// Ez a modul egyetlen, újrahasználható böngészőt biztosít az egész futásra; a run.js
// zárja le a folyamat végén (finally blokkban). Így nincs ellenőrizetlen böngésző,
// és a runtime drámaian csökken.

'use strict';

const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let bongeszo = null;
let foglalva = false;

async function nyitoBongeszo() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=hu-HU'],
  });
}

/**
 * Megosztott böngésző beszerzése (egyszer indít, újrahasznál).
 * `closeBrowser()`-t a futás végén hívjuk; innentől újra indítható.
 */
async function getSharedBrowser() {
  if (bongeszo && bongeszo.isConnected()) return bongeszo;
  bongeszo = await nyitoBongeszo();
  foglalva = false;
  return bongeszo;
}

/**
 * Böngésző lezárása (futás végén / hiba esetén). SOHA nem hagyjuk meg őrizetlenül.
 */
async function closeBrowser() {
  if (bongeszo) {
    try { await bongeszo.close(); } catch { /* már zárva */ }
    bongeszo = null;
    foglalva = false;
  }
}

// belső teszt / egyéb használathoz
function _resetForTest() {
  bongeszo = null;
  foglalva = false;
}

module.exports = {
  getSharedBrowser,
  closeBrowser,
  nyitoBongeszo,
  CHROME,
  _resetForTest,
  get _foglalva() { return foglalva; },
};
