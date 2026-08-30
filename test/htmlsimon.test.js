// Radovin árfigyelő – html-simon (Borbáró, WordPress ?s=) adapter matcher-v2 teszt.
//
// Az htmlSimples adapter a JSON-LD/szövegkörnyezet találatait típusos candidate-ként
// futtatja át a selectExactCandidate-on (a scraper-en át) – CSAK teljes identitás +
// jóváhagyott referencia ad árat. A legacy kulcsszó-"legjobb egyezés" nem találhat ki
// márka-rokon árat. Ez a teszt a html-simon jelölt-mintán ellenőrzi ezt.

const test = require('node:test');
const assert = require('node:assert');
const { selectExactCandidate } = require('../lib/domain/matcher-v2.js');
const { candidate } = require('../lib/domain/candidate.js');

function simonJelolt(name, url, price) {
  return candidate({
    shopId: 'borbaro', shopProductId: url, name, url,
    price, currency: 'HUF', extractor: 'html-simon', availability: 'in_stock',
  });
}

const LISTAR_BOR = {
  id: 'pelda-gere-attila-kopar-2021-14-0-75l',
  azonositas: {
    termekkategoria: 'red', gyarto: 'Gere', marka_aliasok: ['Gere'],
    tetel: 'Gere Attila Kopar 2021 14% 0,75l', evjarat: '2021', evjarat_statusz: 'known',
    kiszereles_ml: 750, darab: 1, csomagolas: 'plain_bottle', puttony: null, penznem: 'HUF',
  },
  shop_azonositas: {
    borbaro: {
      elfogadott_tetel_aliasok: ['Kopar'],
      url: 'https://www.borbaro.hu/termek/gere-attila-kopar-2021',
      ellenorizve: '2026-08-30', ellenorzes_modja: 'manual',
    },
  },
};

test('html-simon: azonos tétel + jóváhagyott referencia → matched (helyes ár)', () => {
  const j = simonJelolt('Gere Attila Kopar 2021', 'https://www.borbaro.hu/termek/gere-attila-kopar-2021', 8990);
  const d = selectExactCandidate([j], LISTAR_BOR, 'borbaro');
  assert.equal(d.status, 'matched');
  assert.equal(d.selected.price, 8990);
});

test('html-simon: márka-ROKON tétel (Kopár helyett más Gere) → SOHA nem ad árat', () => {
  // A ?s= kereső a "Kopár"-ra a Gere "Kékfrankos"-t hozta (ugyanaz a pince, más tétel).
  const rokon = simonJelolt('Gere Attila Kékfrankos 2021', 'https://www.borbaro.hu/termek/gere-attila-kekfrankos-2021', 7490);
  const d = selectExactCandidate([rokon], LISTAR_BOR, 'borbaro');
  assert.notEqual(d.status, 'matched');
  assert.equal(d.selected, null);
});

test('html-simon: jóváhagyott referencia NÉLKÜL sosem ad árat (needs_review, 0 hamis)', () => {
  const tetel = { ...LISTAR_BOR, shop_azonositas: {} };
  const j = simonJelolt('Gere Attila Kopar 2021', 'https://www.borbaro.hu/termek/gere-attila-kopar-2021', 8990);
  const d = selectExactCandidate([j], tetel, 'borbaro');
  assert.notEqual(d.status, 'matched');
  assert.equal(d.selected, null);
});

test('html-simon: TÖBB jelölt, egy sem approved → no_exact_match (nem ragad meg rokon árat)', () => {
  const jeloltek = [
    simonJelolt('Gere Attila Kékfrankos 2021', 'https://www.borbaro.hu/termek/gere-attila-kekfrankos-2021', 7490),
    simonJelolt('Gere Attila Zweigelt 2021', 'https://www.borbaro.hu/termek/gere-attila-zweigelt-2021', 6990),
  ];
  const d = selectExactCandidate(jeloltek, LISTAR_BOR, 'borbaro');
  assert.notEqual(d.status, 'matched');
  assert.equal(d.selected, null);
});
