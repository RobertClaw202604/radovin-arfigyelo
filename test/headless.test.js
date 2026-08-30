// Radovin árfigyelő – headless adapter matcher-v2 integráció teszt.
//
// A headless() adapter a böngészővel kinyert {nev, ar, url} egyetlen jelöltként
// futtatja át a selectExactCandidate-on (a scraper-en át). Ezt a teszt azzal a
// mintával ellenőrzi: a headless találat CSAK akkor ad árat (matched), ha a
// matcher-v2 teljes identitás-egyezést + jóváhagyott referenciát lát. Azonos
// méretű, de MÁS tétel / jóváhagyás nélküli találat sosem ad árat (0 hamis ár).

const test = require('node:test');
const assert = require('node:assert');
const { selectExactCandidate } = require('../lib/domain/matcher-v2.js');
const { candidate } = require('../lib/domain/candidate.js');

function headlessJelolt(shopId, name, url, price) {
  return candidate({
    shopId, shopProductId: url, name, url,
    price, currency: 'HUF', extractor: 'headless', availability: 'in_stock',
  });
}

// Egy listás whisky-tétel (példa: ha valaha whisky kerülne a listára).
const WHISKY_TETEL = {
  id: 'pelda-johnnie-walker-black-label-40-0-7l',
  azonositas: {
    termekkategoria: 'whisky', gyarto: 'Johnnie Walker', marka_aliasok: ['Johnnie Walker'],
    tetel: 'Johnnie Walker Black Label 40% 0,7l', evjarat: null, evjarat_statusz: 'none',
    kiszereles_ml: 700, darab: 1, csomagolas: 'plain_bottle', puttony: null, penznem: 'HUF',
  },
  shop_azonositas: {
    italpark: {
      elfogadott_tetel_aliasok: ['Black Label'],
      url: 'https://www.italpark.hu/johnnie-walker-black-label',
      ellenorizve: '2026-08-30', ellenorzes_modja: 'manual',
    },
  },
};

test('headless: azonos tétel + jóváhagyott referencia → matched (helyes ár)', () => {
  const jelolt = headlessJelolt('italpark', 'Johnnie Walker Black Label 0,7l', 'https://www.italpark.hu/johnnie-walker-black-label', 12490);
  const d = selectExactCandidate([jelolt], WHISKY_TETEL, 'italpark');
  assert.equal(d.status, 'matched');
  assert.equal(d.selected.price, 12490);
});

test('headless: azonos MÉRETŰ, de MÁS tétel (Black vs Red) → SOHA nem ad árat', () => {
  // A headless kulcsszó-kiválasztása a Red Labelt hozta (azonos 0,7l), a tétele
  // Black Label. Méret egyezik, de a rossz tétel – matcher-v2 elutasítja.
  const red = headlessJelolt('italpark', 'Johnnie Walker Red Label 0,7l', 'https://www.italpark.hu/johnnie-walker-red-label', 8990);
  const d = selectExactCandidate([red], WHISKY_TETEL, 'italpark');
  assert.notEqual(d.status, 'matched');
  assert.equal(d.selected, null);
});

test('headless: jóváhagyott referencia NÉLKÜL sosem ad árat (needs_review, 0 hamis)', () => {
  const tetel = { ...WHISKY_TETEL, shop_azonositas: {} };
  const jelolt = headlessJelolt('italpark', 'Johnnie Walker Black Label 0,7l', 'https://www.italpark.hu/johnnie-walker-black-label', 12490);
  const d = selectExactCandidate([jelolt], tetel, 'italpark');
  assert.notEqual(d.status, 'matched');
  assert.equal(d.selected, null);
});

test('headless: szemantikailag pontosan ugyanaz a tétel, jóváhagyott URL-lel → matched', () => {
  // A size-check + URL egyezés is megvan, a név kis eltéréssel ("12yo" vs "12").
  const bp = {
    id: 'pelda-johnnie-walker-black-label-12-0-7l',
    azonositas: {
      termekkategoria: 'whisky', gyarto: 'Johnnie Walker', marka_aliasok: ['Johnnie Walker'],
      tetel: 'Johnnie Walker Black Label 12 40% 0,7l', evjarat: null, evjarat_statusz: 'none',
      kiszereles_ml: 700, darab: 1, csomagolas: 'plain_bottle', puttony: null, penznem: 'HUF',
    },
    shop_azonositas: {
      italpark: {
        elfogadott_tetel_aliasok: ['Black Label'],
        url: 'https://www.italpark.hu/johnnie-walker-black-label',
        ellenorizve: '2026-08-30', ellenorzes_modja: 'manual',
      },
    },
  };
  const jelolt = headlessJelolt('italpark', 'Johnnie Walker Black Label 12yo 0,7l', 'https://www.italpark.hu/johnnie-walker-black-label', 12490);
  const d = selectExactCandidate([jelolt], bp, 'italpark');
  assert.equal(d.status, 'matched');
  assert.equal(d.selected.price, 12490);
});
