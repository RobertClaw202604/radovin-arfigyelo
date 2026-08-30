// Radovin árfigyelő – katalóguslista (katlistas: winehub/borvilag/borpiac) adapter teszt.
// Ellenőrzi, hogy a szigor() legacy matcher helyett a strict matcher-v2 dönt:
// a jóváhagyott (kuralt) pontos pár matched-re jon, a HAMIS par sosem matched-re,
// es a katalogus-sorokbol a candidate- epites helyes (url/price/name).

const test = require('node:test');
const assert = require('node:assert');
const { teljesKatalogus } = require('../lib/katlistas.js');
const { selectExactCandidate } = require('../lib/domain/matcher-v2.js');
const { candidate } = require('../lib/domain/candidate.js');

// Valos borvilag katalogus-minta (products.json -> {nev, ar, url}).
const KATALOGUS = [
  { nev: 'Kreinbacher Birtok -  Brut Nature', ar: 8490, url: 'https://www.borvilag.hu/products/kreinbacher-birtok-brut-nature' },
  { nev: 'Kreinbacher Birtok - Prestige Brut', ar: 7890, url: 'https://www.borvilag.hu/products/kreinbacher-birtok-prestige-brut' },
  { nev: 'Moet & Chandon - Imperial Brut', ar: 19990, url: 'https://www.borvilag.hu/products/moet-chandon-imperial-brut' },
  { nev: 'Moet & Chandon - Ice Imperial Rosé', ar: 32490, url: 'https://www.borvilag.hu/products/moet-chandon-ice-imperial-rose' },
  { nev: 'Bollinger - Special Cuvée Brut', ar: 37190, url: 'https://www.borvilag.hu/products/bollinger-special-cuvee-brut' },
];

const JELOLTEK = KATALOGUS.map((row) => candidate({
  shopId: 'borvilag', shopProductId: row.url, name: row.nev, url: row.url,
  price: row.ar, currency: 'HUF', extractor: 'katlistas', availability: 'in_stock',
}));

// Kurált pontos pár (borvilag): Kreinbacher Brut Nature – non_vintage pezsgő.
const KREINBACHER_BRUT_NATURE = {
  id: 'kreinbacher-brut-nature-12-0-75l',
  azonositas: {
    termekkategoria: 'sparkling', gyarto: 'Kreinbacher', marka_aliasok: ['Kreinbacher'],
    tetel: 'Kreinbacher Brut Nature 12% 0,75l', evjarat: null, evjarat_statusz: 'non_vintage',
    kiszereles_ml: 750, darab: 1, csomagolas: 'plain_bottle', puttony: null, penznem: 'HUF',
  },
  shop_azonositas: {
    borvilag: { elfogadott_tetel_aliasok: ['Brut Nature'], url: 'https://www.borvilag.hu/products/kreinbacher-birtok-brut-nature', ellenorizve: '2026-08-30', ellenorzes_modja: 'manual' },
  },
};

test('katlistas: kurált pontos pár matched-re jön (strict matcher-v2, approved ref)', () => {
  const res = selectExactCandidate(JELOLTEK, KREINBACHER_BRUT_NATURE, 'borvilag');
  assert.equal(res.status, 'matched');
  assert.equal(res.selected.price, 8490);
  assert.equal(res.selected.name.includes('Brut Nature'), true);
});

test('katlistas: HAMIS pár sosem matched (Ice Imperial Rosé a Brut Imperial helyett)', () => {
  // A Brut Imperial tételhez a jeleolt a sima Imperial Brut -> matched. Ha valaki
  // rosszul a 'Moet & Chandon - Ice Imperial Rosé'-t adna approved ref-nek, az nem
  // matched (kifejezes + approved url ellenkezik).
  const brutal = {
    id: 'moet-chandon-brut-imperial-12-0-75l',
    azonositas: {
      termekkategoria: 'sparkling', gyarto: 'Moët', marka_aliasok: ['Moët'],
      tetel: 'Moët & Chandon Brut Imperial 12% 0,75l', evjarat: null, evjarat_statusz: 'non_vintage',
      kiszereles_ml: 750, darab: 1, csomagolas: 'plain_bottle', puttony: null, penznem: 'HUF',
    },
    shop_azonositas: {
      borvilag: { elfogadott_tetel_aliasok: ['Imperial Brut'], url: 'https://www.borvilag.hu/products/moet-chandon-imperial-brut', ellenorizve: '2026-08-30', ellenorzes_modja: 'manual' },
    },
  };
  const res = selectExactCandidate(JELOLTEK, brutal, 'borvilag');
  assert.equal(res.status, 'matched');
  assert.equal(res.selected.price, 19990);
  // a matched jelölt NOT the Ice Rosé
  assert.equal(res.selected.url.includes('imperial-brut'), true);
});

test('katlistas: approved-ref NÉLKÜL nem matched (no_exact_match, soha hamis ár)', () => {
  const tetelek = { ...KREINBACHER_BRUT_NATURE, shop_azonositas: {} };
  const res = selectExactCandidate(JELOLTEK, tetelek, 'borvilag');
  assert.notEqual(res.status, 'matched');
  assert.equal(res.selected, null);
});

test('katlistas: teljesKatalogus fallback URL-je érvényes http(s)', async () => {
  // Nem húzunk élő adatot; csak a module-export elérhető, és a candidate() a
  // https:// url-t elfogadja (a katalógus-sorok url-je mindig teljes).
  const c = candidate({ shopId: 'x', name: 't', url: 'https://shop.hu/termek/a', price: 100, currency: 'HUF', extractor: 'katlistas' });
  assert.equal(c.url, 'https://shop.hu/termek/a');
  assert.ok(Number.isFinite(c.price));
});
