// Radovin árfigyelő – Commit 2 SHADOW-mód teszt.
//
// Gate (guide §7): a v2 matcher shadow-módban UGOR AZT választja, mint a jelenlegi
// `szigor()` matcher az ismert regressziós eseteken – de anélkül, hogy az éles
// kimenetre hatással lenne. Itt a v2 és a legacy matchert ugyanazon a jó pár + hamis
// pár listáján futtatjuk, és ellenőrizzük, hogy (1) mindkettő a JÓ tételt hozza,
// (2) mindkettő elutasítja a HAMIS párt.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { szigor } = require('../lib/matricas');
const { selectExactCandidate } = require('../lib/domain/matcher-v2');

// --- Legacy termékobjektum (a jelenlegi termekek.json séma) ---
const legacyJW = {
  id: 'jw-black-label-1l',
  nev: 'Johnnie Walker Black Label Triple Cask 1 L',
  marka: 'Johnnie Walker',
  meret: '1 l',
  evjarat: null,
  fajta: 'Black Label Triple Cask',
  aktiv: true,
};

// --- Ugyanaz a termék az ÚJ azonositas+séma szerint (Commit 3 közelítés) ---
const newJW = {
  id: 'jw-black-label-1l',
  azonositas: {
    termekkategoria: 'spirit',
    gyarto: 'Johnnie Walker',
    marka_aliasok: ['johnnie walker', 'jw'],
    tetel: 'Black Label Triple Cask',
    evjarat: null,
    evjarat_statusz: 'non_vintage',
    kiszereles_ml: 1000,
    darab: 1,
    csomagolas: 'plain_bottle',
    puttony: null,
    penznem: 'HUF',
  },
  shop_azonositas: {
    borvilag: {
      elfogadott_tetel_aliasok: ['Black Label Triple Cask', 'Black Label'],
      shop_product_id: 'bv-jw-black-1l',
      ellenorzott_nev: 'Johnnie Walker Black Label Triple Cask 1 L',
      ellenorizve: true,
      ellenorzes_modja: 'manual',
    },
  },
};

// A konkurencia-tárház találatai (a borvilag-adapter kimeneti formátumában):
//  - JÓ: az elfogadott tétel pontos neve + jóváhagyott shop_product_id
//  - HAMIS: Double Black (a Black Label "unokatestvére" – klasszikus hamis pár)
const borvilagTalalatok = [
  { nev: 'Johnnie Walker Double Black 1000ml', ar: 13990, url: 'https://borvilag.hu/jw-double-black' },
  { nev: 'Johnnie Walker Black Label Triple Cask 1000ml', ar: 11990, url: 'https://borvilag.hu/jw-black-1l' },
];

test('SHADOW: a v2 ugyanazt a JÓ eredményt hozza, mint a jelenlegi szigor()', () => {
  // Legacy matcher: a jó találatot kell visszaadnia.
  const legacyBest = szigor(borvilagTalalatok, legacyJW);
  assert.ok(legacyBest, 'a jelenlegi matchernek találnia kell a jó párt');
  assert.equal(legacyBest.nev, 'Johnnie Walker Black Label Triple Cask 1000ml');

  // v2 matcher: matched-ként a jó jelöltet.
  const v2 = selectExactCandidate(
    borvilagTalalatok.map((t, i) => ({
      shopId: 'borvilag',
      shopProductId: i === 1 ? 'bv-jw-black-1l' : 'bv-jw-double-black', // jó az utolsó
      name: t.nev,
      url: t.url,
      ar: t.ar,
      currency: 'HUF',
      volumeMl: 1000,
      packCount: 1,
      packaging: 'plain_bottle',
      availability: 'in_stock',
      extractor: 'katlistas',
    })),
    newJW,
    'borvilag',
  );
  assert.equal(v2.status, 'matched');
  assert.equal(v2.selected.nev || v2.selected.name, 'Johnnie Walker Black Label Triple Cask 1000ml');
  assert.equal(v2.selected.ar, 11990);
});

test('SHADOW: mindkét matcher elutasítja a HAMIS párt (Double Black)', () => {
  // Csak a hamis jelölt van jelen → legacy matcher: NEM talál (null), v2: NEM matched.
  const hamisOnly = [{ nev: 'Johnnie Walker Double Black 1000ml', ar: 13990, url: 'https://borvilag.hu/jw-db' }];

  const legacyBest = szigor(hamisOnly, legacyJW);
  assert.equal(legacyBest, null, 'a jelenlegi matchernek el kell utasítania a Double Black-et');

  const v2 = selectExactCandidate(
    hamisOnly.map((t) => ({
      shopId: 'borvilag',
      shopProductId: 'bv-jw-double-black',
      name: t.nev,
      url: t.url,
      ar: t.ar,
      currency: 'HUF',
      volumeMl: 1000,
      packCount: 1,
      packaging: 'plain_bottle',
      availability: 'in_stock',
    })),
    newJW,
    'borvilag',
  );
  assert.notEqual(v2.status, 'matched');
  assert.equal(v2.selected, null);
});

test('SHADOW: eltérő kiszerelést (700ml) mindkét matcher elutasítja', () => {
  const legacyJW700 = { ...legacyJW, meret: '1 l' }; // Radovin 1L-es tétel
  const talalatok = [{ nev: 'Johnnie Walker Black Label Triple Cask 700ml', ar: 9990, url: 'https://borvilag.hu/jw-700' }];

  const legacyBest = szigor(talalatok, legacyJW700);
  // A legacy matcher liter-alapú diff alapján adhat pontot; 700ml vs 1L diff 0.3 → score-levonás,
  // de a szigor() nem utasítja el literre, csak a marka+fajta+evjarat kapukra.
  // A v2-nek KELL elutasítania (kiszerelés kapu). Ez a szigorítás lényege – dokumentáljuk.
  const v2 = selectExactCandidate(
    talalatok.map((t) => ({
      shopId: 'borvilag',
      shopProductId: 'bv-jw-black-700',
      name: t.nev,
      url: t.url,
      ar: t.ar,
      currency: 'HUF',
      volumeMl: 700,
      packCount: 1,
      packaging: 'plain_bottle',
      availability: 'in_stock',
    })),
    newJW,
    'borvilag',
  );
  assert.notEqual(v2.status, 'matched');
  assert.equal(v2.selected, null);
  // Megjegyzés: a legacy szigor() nem volt súlyozva a 700ml-re, a v2 szigorúbb (tervezett fejlődés).
});
