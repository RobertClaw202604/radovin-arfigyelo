// Radovin árfigyelő – Commit 2 regressziós tesztek (matcher v2).
//
// Cél: a LESSONS.md-ben dokumentált ISMERT hamis-pár-csapdák mindegyike permanens
// regressziós tesztté válik. A `selectExactCandidate` soha nem ad `matched`-et és
// árat olyan trükkös jelöltre, amit a tényleges termék nem valós.
//
// A tesztek tiszta szintetikus termék-identitással dolgoznak (azonositas + a Commit 3
// shop_azonositas kellékei), ahogy a guide §7 shadow-módban megköveteli.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeText,
  phrasePresent,
  extractVolumeMl,
  extractPackCount,
  extractYears,
  packagingFrom,
  evaluateCandidate,
  selectExactCandidate,
} = require('../lib/domain/matcher-v2');

// ---- Segéd: egy typikus tömény (whisky) identitás, shop-mappeléssel ----
// A guide §6 struktúrája: `azonositas` (kötelező mezők) + `shop_azonositas` (shop-map)
// mindkettő a termékobjektumon.
function whiskyIdentity(overrides = {}) {
  const { shop_azonositas, ...azOverrides } = overrides;
  return {
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
      ...azOverrides,
    },
    shop_azonositas: {
      borvilag: {
        elfogadott_tetel_aliasok: ['Black Label Triple Cask', 'Black Label'],
        shop_product_id: 'bv-jw-black-1l',
        ellenorzott_nev: 'Johnnie Walker Black Label Triple Cask 1 L',
        ellenorizve: true,
        ellenorzes_modja: 'manual',
      },
      winehub: {
        elfogadott_tetel_aliasok: ['Black Label'],
        url: 'https://winehub.hu/termek/jw-black-1l',
        ellenorzott_nev: 'Johnnie Walker Black Label 1L',
        ellenorizve: true,
        ellenorzes_modja: 'manual',
      },
      ...(shop_azonositas || {}),
    },
  };
}

function cand(overrides = {}) {
  return {
    shopId: 'borvilag',
    shopProductId: 'bv-jw-black-1l',
    name: 'Johnnie Walker Black Label Triple Cask 1000ml',
    url: 'https://borvilag.hu/termek/jw-black-1l',
    ar: 11990,
    currency: 'HUF',
    volumeMl: 1000,
    packCount: 1,
    packaging: 'plain_bottle',
    structuredVintage: null,
    availability: 'in_stock',
    extractor: 'katlistas',
    fetchedAt: '2026-08-29T00:00:00Z',
    ...overrides,
  };
}

function shopOk(c) {
  // jóváhagyott shop_product_id egyezik a borvilag mappinggal → approved
  return { ...c, shopId: 'borvilag' };
}

// ===================== UNIT: normalizeText / phrasePresent =====================
test('normalizeText: ékezet + ampersand + központozás', () => {
  assert.equal(normalizeText(' Tokaji Aszú 5 puttonyos! '), 'tokaji aszu 5 puttonyos');
  assert.equal(normalizeText('Bott & Kulcsár'), 'bott and kulcsar');
});

test('phrasePresent: szó-határos', () => {
  assert.equal(phrasePresent('Johnnie Walker Black Label', 'black label'), true);
  assert.equal(phrasePresent('Johnnie Walker Black Label', 'black'), true);
});

// ===================== UNIT: méret / csomag / pakk =====================
test('extractVolumeMl: ml / cl / l', () => {
  assert.equal(extractVolumeMl('1000 ml'), 1000);
  assert.equal(extractVolumeMl('70 cl'), 700);
  assert.equal(extractVolumeMl('0,7 l'), 700);
  assert.equal(extractVolumeMl('750'), null); // nincs mértékegység → nem 1 pontos találat
});

test('extractPackCount: díszdoboz 6x / plain 1', () => {
  assert.equal(extractPackCount('6 x 0,75 l'), 6);
  assert.equal(extractPackCount('0,75 l'), 1);
});

test('extractYears + packagingFrom', () => {
  assert.deepEqual([...extractYears('Bock Cuvée 2022')], ['2022']);
  assert.equal(packagingFrom('díszdobozos ajándékcsomag'), 'gift_box');
  assert.equal(packagingFrom('Johnnie Walker Black Label 1L'), 'plain_bottle');
});

// ===================== EREDMÉNYHELYES MEGFELELÉS =====================
test('TÖKÉLETES pár → matched', () => {
  const product = whiskyIdentity();
  const result = selectExactCandidate([shopOk(cand())], product, 'borvilag');
  assert.equal(result.status, 'matched');
  assert.equal(result.selected.ar, 11990);
});

test('approved URL-egyezés (winehub) → matched', () => {
  const product = whiskyIdentity();
  const c = cand({ shopId: 'winehub', shopProductId: null, url: 'https://winehub.hu/termek/jw-black-1l' });
  const result = selectExactCandidate([c], product, 'winehub');
  assert.equal(result.status, 'matched');
});

// ===================== HAMIS PÁR-CSAPDÁK (LESSONS.md) — SOHA NEM matched =====================
test('HAMIS PÁR: Black Label vs Double Black (tétel-eltérés)', () => {
  const product = whiskyIdentity();
  const c = shopOk(cand({ name: 'Johnnie Walker Double Black 1000ml', shopProductId: 'bv-jw-double-black' }));
  const result = selectExactCandidate([c], product, 'borvilag');
  assert.equal(result.status, 'no_exact_match'); // expression + approved eltér → nincs találat
  assert.equal(result.selected, null);
});

test('HAMIS PÁR: eltérő kiszerelés 700ml vs 1000ml (más termék a shopban)', () => {
  const product = whiskyIdentity();
  const c = shopOk(cand({ name: 'Johnnie Walker Black Label Triple Cask 700ml', volumeMl: 700, shopProductId: 'bv-jw-black-700-new' }));
  const result = selectExactCandidate([c], product, 'borvilag');
  assert.equal(result.status, 'no_exact_match'); // volume kapu → nem azonos termék
  assert.equal(result.selected, null);
});

function shirazIdentity() {
  return {
    id: 'ket-ha-shiraz-2021',
    azonositas: {
      termekkategoria: 'wine',
      gyarto: '2HA',
      marka_aliasok: ['2ha', 'ket ha'],
      tetel: 'Shiraz',
      evjarat: 2021,
      evjarat_statusz: 'vintage',
      kiszereles_ml: 750,
      darab: 1,
      csomagolas: 'plain_bottle',
      puttony: null,
      penznem: 'HUF',
    },
    shop_azonositas: {
      borvilag: {
        elfogadott_tetel_aliasok: ['Shiraz'],
        shop_product_id: 'bv-2ha-shiraz',
        ellenorzott_nev: '2HA Shiraz 2021',
        ellenorizve: true,
        ellenorzes_modja: 'manual',
      },
    },
  };
}

test('HAMIS PÁR: eltérő évjárat (2020 nem a jóváhagyott 2021)', () => {
  const product = shirazIdentity();
  const c = cand({
    name: '2HA Shiraz 2020',
    shopId: 'borvilag',
    shopProductId: 'bv-2ha-shiraz-2020', // más termék a shopban
    structuredVintage: '2020',
    volumeMl: 750,
  });
  const result = selectExactCandidate([c], product, 'borvilag');
  assert.equal(result.status, 'no_exact_match'); // vintage kapu
  assert.equal(result.selected, null);
});

function polRogerIdentity() {
  return {
    id: 'pol-roger-brut-reserve',
    azonositas: {
      termekkategoria: 'sparkling',
      gyarto: 'Pol Roger',
      marka_aliasok: ['pol roger'],
      tetel: 'Brut Réserve',
      evjarat: null,
      evjarat_statusz: 'non_vintage',
      kiszereles_ml: 750,
      darab: 1,
      csomagolas: 'plain_bottle',
      puttony: null,
      penznem: 'HUF',
    },
    shop_azonositas: {
      borvilag: {
        elfogadott_tetel_aliasok: ['Brut Réserve'],
        shop_product_id: 'bv-pol-roger',
        ellenorzott_nev: 'Pol Roger Brut Réserve',
        ellenorizve: true,
        ellenorzes_modja: 'manual',
      },
    },
  };
}

test('HAMIS PÁR: díszdobozos (gift) vs sima palack (Pol Roger tanulság)', () => {
  const product = polRogerIdentity();
  const c = cand({
    name: 'Pol Roger Brut Réserve díszdobozos',
    shopId: 'borvilag',
    shopProductId: 'bv-pol-roger-gift', // más termék: díszdobozos kiadás
    packaging: 'gift_box',
    volumeMl: 750,
  });
  const result = selectExactCandidate([c], product, 'borvilag');
  assert.equal(result.status, 'no_exact_match'); // csomagolás kapu
  assert.equal(result.selected, null);
});

function aszuIdentity() {
  return {
    id: 'tokaji-aszu-5puttonyos',
    azonositas: {
      termekkategoria: 'wine',
      gyarto: 'Tokaji',
      marka_aliasok: ['tokaji'],
      tetel: 'Tokaji Aszú',
      evjarat: null,
      evjarat_statusz: 'non_vintage',
      kiszereles_ml: 500,
      darab: 1,
      csomagolas: 'plain_bottle',
      puttony: 5,
      penznem: 'HUF',
    },
    shop_azonositas: {
      borvilag: {
        elfogadott_tetel_aliasok: ['Tokaji Aszú'],
        shop_product_id: 'bv-aszu-5',
        ellenorzott_nev: 'Tokaji Aszú 5 puttonyos',
        ellenorizve: true,
        ellenorzes_modja: 'manual',
      },
    },
  };
}

test('HAMIS PÁR: puttony 5 vs 6 (más termék a shopban)', () => {
  const product = aszuIdentity();
  const c = cand({
    name: 'Tokaji Aszú 6 puttonyos',
    shopId: 'borvilag',
    shopProductId: 'bv-aszu-6', // 6 puttonyos kiadás
    volumeMl: 500,
  });
  const result = selectExactCandidate([c], product, 'borvilag');
  assert.equal(result.status, 'no_exact_match'); // puttony kapu
  assert.equal(result.selected, null);
});

test('HAMIS PÁR: eltérő pénznem (más termék a shopban)', () => {
  const product = whiskyIdentity();
  const c = shopOk(cand({ currency: 'EUR', shopProductId: 'bv-jw-eur' }));
  const result = selectExactCandidate([c], product, 'borvilag');
  assert.equal(result.status, 'no_exact_match'); // currency kapu
  assert.equal(result.selected, null);
});

test('HAMIS PÁR: out of stock sosem matched', () => {
  const product = whiskyIdentity();
  const c = shopOk(cand({ availability: 'out_of_stock', shopProductId: 'bv-jw-oos' }));
  const result = selectExactCandidate([c], product, 'borvilag');
  assert.equal(result.status, 'no_exact_match'); // készlet kapu
  assert.equal(result.selected, null);
});

// ===================== AMBIGUOUS / NEEDS_REVIEW / MAPPING_DRIFT =====================
test('KÉT egyforma jó jelölt → ambiguous_match (soha nem auto-döntünk)', () => {
  // Name-alapú jóváhagyás: KÉT különböző URL, de mindkettő ellenorzött névvel egyezik.
  // Bármelyik lehet a jó tétel → a pontszám egyenlő → ambiguous, nincs ár.
  const product = {
    id: 'jw-black-label-1l',
    azonositas: {
      termekkategoria: 'spirit',
      gyarto: 'Johnnie Walker',
      marka_aliasok: ['johnnie walker'],
      tetel: 'Black Label',
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
        elfogadott_tetel_aliasok: ['Black Label'],
        ellenorzott_nev: 'Johnnie Walker Black Label 1L', // nincs shop_product_id, nincs url
        ellenorizve: true,
        ellenorzes_modja: 'manual',
      },
    },
  };
  const base = {
    shopId: 'borvilag',
    name: 'Johnnie Walker Black Label 1L', // mindkettő egyezik az ellenorzott névvel
    ar: 11990,
    currency: 'HUF',
    volumeMl: 1000,
    packCount: 1,
    packaging: 'plain_bottle',
    availability: 'in_stock',
    extractor: 'katlistas',
    fetchedAt: '2026-08-29T00:00:00Z',
  };
  const a = { ...base, url: 'https://borvilag.hu/jw-a' };
  const b = { ...base, url: 'https://borvilag.hu/jw-b', ar: 11990 };
  const result = selectExactCandidate([a, b], product, 'borvilag');
  assert.equal(result.status, 'ambiguous_match');
  assert.equal(result.selected, null);
});

test('Jóváhagyott referencia megvan, de a jelölt már NEM illik → mapping_drift', () => {
  const product = whiskyIdentity();
  const c = shopOk(cand({ name: 'Johnnie Walker RED Label 1000ml', shopProductId: 'bv-jw-black-1l' }));
  const result = selectExactCandidate([c], product, 'borvilag');
  assert.equal(result.status, 'mapping_drift');
});

test('Nincs jóváhagyva, de minden kapu stimmel → needs_review', () => {
  const product = whiskyIdentity();
  const c = shopOk(cand({ shopProductId: 'bv-jw-black-new-id' })); // minden kapu ok, DE nincs jóváhagyott ref
  const result = selectExactCandidate([c], product, 'borvilag');
  assert.equal(result.status, 'needs_review');
});

test('Teljesen üres jelöltlista → no_exact_match', () => {
  const product = whiskyIdentity();
  const result = selectExactCandidate([], product, 'borvilag');
  assert.equal(result.status, 'no_exact_match');
});

// ===================== UNIT: evaluateCandidate rész-kódok =====================
test('evaluateCandidate: hiányzó identitás → missing_product_identity', () => {
  const decision = evaluateCandidate(cand(), {}, 'borvilag');
  assert.equal(decision.code, 'missing_product_identity');
  assert.equal(decision.accepted, false);
});

test('evaluateCandidate: brand hiányos → brand_mismatch', () => {
  const product = {
    azonositas: { ...whiskyIdentity().azonositas, marka_aliasok: ['glenfiddich'] },
    shop_azonositas: whiskyIdentity().shop_azonositas,
  };
  const decision = evaluateCandidate(shopOk(cand()), product, 'borvilag');
  assert.equal(decision.code, 'brand_mismatch');
});

test('evaluateCandidate: tétel eltér → expression_mismatch', () => {
  const base = whiskyIdentity();
  const product = {
    azonositas: { ...base.azonositas, tetel: 'Blue Label' },
    shop_azonositas: {
      borvilag: {
        ...base.shop_azonositas.borvilag,
        elfogadott_tetel_aliasok: ['Blue Label'], // a shop is a Blue Label-t használja
      },
    },
  };
  const decision = evaluateCandidate(shopOk(cand()), product, 'borvilag');
  assert.equal(decision.code, 'expression_mismatch'); // jelölt Black Label → nem illik
});
