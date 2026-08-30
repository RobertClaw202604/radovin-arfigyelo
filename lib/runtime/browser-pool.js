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
let inditasFolyamatban = null; // Promise, hogy konkurrens getSharedBrowser egyetlen launch-ot várjon

async function nyitoBongeszo() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=hu-HU'],
  });
}

/**
 * Biztonságos ellenőrzés: valódi, élő, használható Puppeteer Browser-e a bongeszo?
 * A korábbi hiba ("bongeszo.isConnected is not a function") abból jött, hogy a
 * `bongeszo` modul-szintű változó nem feltétlenül valódi Browser (pl. felülíródott,
 * lezárt referenda, vagy nem-referencia). Soha nem támaszkodunk a tartalmára
 * ellenőrzés nélkül.
 */
function egeszsegesBongeszo() {
  return !!bongeszo && typeof bongeszo.isConnected === 'function' && bongeszo.isConnected();
}

/**
 * Megosztott böngésző beszerzése (egyszer indít, újrahasznál).
 * Konkurencia-biztos: amíg egy launch fut, a többi hívó ugyanazt a Promise-t várja,
 * így NEM indítunk egyszerre több böngészőt.
 */
async function getSharedBrowser() {
  if (egeszsegesBongeszo()) return bongeszo;

  // Ha épp indítunk, arra várunk (nincs második launch).
  if (inditasFolyamatban) return inditasFolyamatban;

  inditasFolyamatban = (async () => {
    // Beleérkezhetett érvényes böngésző közben; használjuk, ne indítsunk újat.
    if (egeszsegesBongeszo()) return bongeszo;
    try {
      bongeszo = await nyitoBongeszo();
      foglalva = false;
      return bongeszo;
    } finally {
      inditasFolyamatban = null;
    }
  })();

  return inditasFolyamatban;
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
  inditasFolyamatban = null;
}

// belső teszt / egyéb használathoz
function _resetForTest() {
  bongeszo = null;
  foglalva = false;
  inditasFolyamatban = null;
}

module.exports = {
  getSharedBrowser,
  closeBrowser,
  nyitoBongeszo,
  CHROME,
  _resetForTest,
  get _foglalva() { return foglalva; },
};
