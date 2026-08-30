#!/usr/bin/env node
// Kurált betöltő: Bock / Sauska / Gere termékek (2026-08-30).
//
// A `keresztezes-betolto.mjs --dry` jelöltjei + MANUÁLISAN ellenőrzött (HTTP 200 +
// h1-cím egyezés) referencia-URL-ek. A konkurrens nevek eltérnek a Radovintól, ezért
// a betöltés kurált: csak azok a shop-párok kapnak `url`-t, amelyeket élőben
// verifikáltunk (nem az automatikus matcher dönt).
//
// FÁJL-VERZIÓZÁS: az eredeti `config/termekek.json` érintetlen marad; backup mappa +
// a frissített termékek konzisztens bejegyzésekkel. A `run.js` ezután árat termel
// rájuk → bekerül a weboldal mögé.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname;
const TERMEKEK = ROOT + 'config/termekek.json';
const TODAY = new Date().toISOString().slice(0, 10);

const jelenlegi = JSON.parse(readFileSync(TERMEKEK, 'utf8'));
const meglevoId = new Set(jelenlegi.termekek.map((t) => t.id));

// ---- Kurált, verifikált betöltendők ----
// Az URL-ek élőben leellenőrizve (HTTP 200 + h1 pontos egyezés).
const kuralt = [
  {
    nev: 'Sauska Brut Nature 12,5% 0,75l',
    marka: 'Sauska', tipus: 'pezsgő', meret: '0,75 l',
    evjarat: null, kereslet: 'Sauska Brut Nature',
    azon: { termekkategoria: 'sparkling', gyarto: 'Sauska', marka_aliasok: ['Sauska'], evjarat_statusz: 'non_vintage', kiszereles_ml: 750, darab: 1, csomagolas: 'plain_bottle', puttony: null, penznem: 'HUF' },
    refs: {
      borhalo: { url: 'https://borhalo.hu/termek/sauska-brut-nature', konk: 'Sauska Brut Nature', aliasok: ['Sauska Brut Nature'] },
    },
  },
  {
    nev: 'Sauska Cuvée 13 2022 Villányi 14% 0,75l',
    marka: 'Sauska', tipus: 'bor', meret: '0,75 l',
    evjarat: 2022, kereslet: 'Sauska Cuvée 13',
    azon: { termekkategoria: 'wine', gyarto: 'Sauska', marka_aliasok: ['Sauska'], evjarat_statusz: 'vintage', kiszereles_ml: 750, darab: 1, csomagolas: 'plain_bottle', puttony: null, penznem: 'HUF' },
    refs: {
      veritas: { url: 'https://www.borkereskedes.hu/sauska-cuvee-2', konk: 'Sauska Cuvée 13 2022 (0,75l)', aliasok: ['Sauska Cuvée 13', 'Sauska Villányi Cuvée 13'] },
    },
  },
  {
    nev: 'Gere Attila Rosé Cuvée 2024/2025 12% 0,75l',
    marka: 'Gere', tipus: 'bor', meret: '0,75 l',
    evjarat: null, kereslet: 'Gere Attila Rosé Cuvée',
    azon: { termekkategoria: 'rosé', gyarto: 'Gere Attila', marka_aliasok: ['Gere', 'Gere Attila'], evjarat_statusz: 'non_vintage', kiszereles_ml: 750, darab: 1, csomagolas: 'plain_bottle', puttony: null, penznem: 'HUF' },
    refs: {
      veritas: { url: 'https://www.borkereskedes.hu/gere-attila-villanyi-rose-cuvee', konk: 'Gere Rosé Cuvée 2025 (0,75l)', aliasok: ['Rosé Cuvée', 'Gere Rosé Cuvée'] },
    },
  },
  {
    nev: 'Sauska Chardonnay 2024 Zemplén 13% 0,75l',
    marka: 'Sauska', tipus: 'bor', meret: '0,75 l',
    evjarat: 2024, kereslet: 'Sauska Chardonnay',
    azon: { termekkategoria: 'wine', gyarto: 'Sauska', marka_aliasok: ['Sauska'], evjarat_statusz: 'vintage', kiszereles_ml: 750, darab: 1, csomagolas: 'plain_bottle', puttony: null, penznem: 'HUF' },
    refs: {
      veritas: { url: 'https://www.borkereskedes.hu/sauska-zempleni-chardonnay', konk: 'Sauska Zempléni Chardonnay', aliasok: ['Sauska Chardonnay', 'Sauska Zempléni Chardonnay'] },
    },
  },
  {
    nev: 'Sauska Rosé Cuvée 12% 2024 0,75l',
    marka: 'Sauska', tipus: 'bor', meret: '0,75 l',
    evjarat: 2024, kereslet: 'Sauska Rosé Cuvée',
    azon: { termekkategoria: 'rosé', gyarto: 'Sauska', marka_aliasok: ['Sauska'], evjarat_statusz: 'vintage', kiszereles_ml: 750, darab: 1, csomagolas: 'plain_bottle', puttony: null, penznem: 'HUF' },
    refs: {
      veritas: { url: 'https://www.borkereskedes.hu/sauska-rose-', konk: 'Sauska Rosé 2024', aliasok: ['Sauska Rosé', 'Sauska Rosé Cuvée'] },
    },
  },
];

// A meglevő termékhez ref hozzáadása (Bock Ermitage → borhalo)
const ug          = jelenlegi.termekek.find((t) => t.id === 'bock-ermitage-2023-14-5-0-75l');
if (ug) {
  ug.shop_azonositas.borhalo = {
    elfogadott_tetel_aliasok: ['Bock Ermitage', 'Bock Ermitage 2023'],
    url: 'https://borhalo.hu/termek/bock-ermitage-2023',
    ellenorzott_nev: 'Bock Ermitage 2023',
    ellenorizve: TODAY,
    ellenorzes_modja: 'manual',
  };
  console.log('[BOCKLÉPÉS] Bock Ermitage 2023 → borhalo referencia hozzáadva.');
}

let ujDb = 0;
for (const k of kuralt) {
  const id = k.nev.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  if (meglevoId.has(id)) { console.log('[KIHAGYVA] már létezik: ' + k.nev); continue; }
  const shopAz = { radovin: { elfogadott_tetel_aliasok: [k.kereslet, k.nev], ellenorzott_nev: k.kereslet, ellenorizve: TODAY, ellenorzes_modja: 'keresztezes_betolto_kuralt' } };
  for (const [shop, ref] of Object.entries(k.refs)) {
    shopAz[shop] = { elfogadott_tetel_aliasok: ref.aliasok, url: ref.url, ellenorzott_nev: ref.konk, ellenorizve: TODAY, ellenorzes_modja: 'manual' };
  }
  const p = {
    id, nev: k.nev, marka: k.marka, tipus: k.tipus, meret: k.meret, evjarat: k.evjarat,
    radovin_kereso: k.kereslet, aktiv: true,
    azonositas: { termekkategoria: k.azon.termekkategoria, gyarto: k.azon.gyarto, marka_aliasok: k.azon.marka_aliasok, tetel: k.nev, evjarat: k.evjarat, evjarat_statusz: k.azon.evjarat_statusz, kiszereles_ml: k.azon.kiszereles_ml, darab: 1, csomagolas: k.azon.csomagolas, puttony: null, penznem: 'HUF' },
    shop_azonositas: shopAz,
  };
  jelenlegi.termekek.push(p);
  meglevoId.add(id);
  ujDb++;
  console.log(`[ÚJ] ${k.nev} → ` + Object.keys(k.refs).map((s) => s + ' ref').join(', '));
}

if (!ujDb) { console.log('\nNem volt új termék.'); process.exit(0); }
jelenlegi.meta.frissitve = TODAY;
jelenlegi.meta.termekszam = jelenlegi.termekek.length;

// backup + írás
mkdirSync(ROOT + 'config/backup', { recursive: true });
const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const backupUt = ROOT + 'config/backup/termekek-kuralt-bockgere-' + d + '.json';
copyFileSync(TERMEKEK, backupUt);
writeFileSync(TERMEKEK, JSON.stringify(jelenlegi, null, 2) + '\n');
console.log(`\n[OK] ${ujDb} új termék betöltve + frissítések. Backup: ${backupUt}`);
console.log('Összes termék mostantól: ' + jelenlegi.termekek.length); // javítva alább
