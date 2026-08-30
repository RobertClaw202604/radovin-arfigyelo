// Radovin árfigyelő – OpenCart (Borkell) adapter teszt.
// Fixture-alapú (guide §18): valódi Borkell borászata-oldalak termék-layoutjaiból
// vett minta alapján ellenőrzi, hogy a sorok-nyerő a nevet+árat+URL-t helyesen adja,
// és a strict matcher-v2 nem enged hamis párt. A Borkell OpenCart ("ishi" téma):
//   <div class="product-layout ..."><div class="product-thumb transition">
//     <h4><a href="https://borkell.hu/<slug>">TERMÉKNÉV</a></h4>
//     <p class="price"> 4&nbsp;990 Ft </p>

const test = require('node:test');
const assert = require('node:assert');
const { sorok, layoutSor, dekodol } = require('../lib/opencart.js');
const { selectExactCandidate } = require('../lib/domain/matcher-v2.js');
const { candidate } = require('../lib/domain/candidate.js');

const SHOP = { id: 'borkell', base_url: 'https://borkell.hu' };

// Valódi Borkell /boraszatok/magyar/zelna-boraszat termék-layout darabja (~struktúra)
const ZELNA_LAYOUTS = `
<div class="product-layout product-grid col-6 col-sm-6 col-md-4 col-lg-4 col-xl-3">
  <div class="product-thumb transition">
    <div class="image"><a href="https://borkell.hu/boraszatok/magyar/zelna-boraszat/barka-voros-cuvee"><img ...></a></div>
    <div class="caption">
      <h4><a href="https://borkell.hu/boraszatok/magyar/zelna-boraszat/barka-voros-cuvee">Zelna – Bárka vörös cuvée 2023</a></h4>
      <p class="description">...</p>
      <p class="price"> 4&nbsp;290 Ft </p>
    </div>
  </div>
</div>
<div class="product-layout product-grid col-6 col-sm-6 col-md-4 col-lg-4 col-xl-3">
  <div class="product-thumb transition">
    <div class="image"><a href="https://borkell.hu/boraszatok/magyar/zelna-boraszat/zelna-balaton-olaszrizling"><img ...></a></div>
    <div class="caption">
      <h4><a href="https://borkell.hu/boraszatok/magyar/zelna-boraszat/zelna-balaton-olaszrizling">Zelna – Olaszrizling BIO 2025</a></h4>
      <p class="description">...</p>
      <p class="price"> 2&nbsp;990 Ft </p>
    </div>
  </div>
</div>
<div class="product-layout product-grid col-6 col-sm-6 col-md-4 col-lg-4 col-xl-3">
  <div class="product-thumb transition">
    <div class="image"><a href="https://borkell.hu/boraszatok/magyar/zelna-boraszat/penke-pinot-gris"><img ...></a></div>
    <div class="caption">
      <h4><a href="https://borkell.hu/boraszatok/magyar/zelna-boraszat/penke-pinot-gris">Zelna – Penke Pinot gris (Szürkebarát) 2023</a></h4>
      <p class="description">...</p>
      <p class="price"> 3&nbsp;490 Ft </p>
    </div>
  </div>
</div>
`;

// Valódi Borkell /boraszatok/magyar/kovacs-nimrod (a "Grand Bleu" a mi termékünk)
const KOVACS_LAYOUTS = `
<div class="product-layout product-grid col-6">
  <div class="product-thumb transition">
    <div class="image"><a href="https://borkell.hu/boraszatok/magyar/kovacs-nimrod/kovacs-nimrod-grand-bleu"><img ...></a></div>
    <div class="caption">
      <h4><a href="https://borkell.hu/boraszatok/magyar/kovacs-nimrod/kovacs-nimrod-grand-bleu">Kovács Nimród - Grand Bleu 2017</a></h4>
      <p class="description">...</p>
      <p class="price"> 17&nbsp;990 Ft </p>
    </div>
  </div>
</div>
<div class="product-layout product-grid col-6">
  <div class="product-thumb transition">
    <div class="image"><a href="https://borkell.hu/boraszatok/magyar/kovacs-nimrod/kovacs-nimrod-777-pinot-noir"><img ...></a></div>
    <div class="caption">
      <h4><a href="https://borkell.hu/boraszatok/magyar/kovacs-nimrod/kovacs-nimrod-777-pinot-noir">Kovács Nimród - 777 Pinot noir 2023</a></h4>
      <p class="description">...</p>
      <p class="price"> 5&nbsp;990 Ft </p>
    </div>
  </div>
</div>
`;

test('opencart: dekodol visszaalakítja az &nbsp; és ékezetes entitásokat', () => {
  assert.strictEqual(dekodol('4&nbsp;990 Ft'), '4 990 Ft');
  assert.strictEqual(dekodol('Vörös &amp; Fehér &eacute;s'), 'Vörös & Fehér és');
});

test('opencart: sorok kinyeri a név+ár+URL hármast (Zelna)', () => {
  const s = sorok(ZELNA_LAYOUTS, SHOP);
  assert.ok(s.length >= 3, 'legalább 3 sort kinyer, kapott: ' + s.length);
  const barka = s.find((x) => x.url.includes('barka-voros-cuvee'));
  assert.ok(barka, 'Bárka találati sor megvan');
  assert.strictEqual(barka.ar, 4290);
  assert.ok(/Bárka vörös cuvée 2023/i.test(barka.nev), 'Bárka név: ' + barka.nev);
  const olasz = s.find((x) => x.url.includes('zelna-balaton-olaszrizling'));
  assert.ok(olasz, 'Olaszrizling sor megvan');
  assert.strictEqual(olasz.ar, 2990);
  assert.ok(/Olaszrizling BIO 2025/i.test(olasz.nev), 'Olaszrizling név: ' + olasz.nev);
});

test('opencart: strict matcher-v2 PONTOS párt ad jóváhagyott referenciával (Kovács Grand Bleu)', () => {
  const termek = {
    id: 'kovacs-nimrod-grand-bleu-2017-13-5-0-75l',
    azonositas: {
      termekkategoria: 'wine', gyarto: 'Kovács', marka_aliasok: ['Kovács'],
      tetel: 'Kovács Nimród Grand Bleu 2017 13,5% 0,75l', evjarat: 2017, evjarat_statusz: 'vintage',
      kiszereles_ml: 750, darab: 1, csomagolas: 'plain_bottle', puttony: null, penznem: 'HUF',
    },
    shop_azonositas: {
      borkell: {
        elfogadott_tetel_aliasok: ['Grand Bleu'],
        url: 'https://borkell.hu/boraszatok/magyar/kovacs-nimrod/kovacs-nimrod-grand-bleu',
        ellenorzott_nev: 'Kovács Nimród - Grand Bleu 2017',
        ellenorizve: '2026-08-30', ellenorzes_modja: 'manual',
      },
    },
  };
  const katalogus = sorok(KOVACS_LAYOUTS, SHOP);
  const jeloltek = katalogus.map((row) => candidate({
    shopId: 'borkell', shopProductId: row.url, name: row.nev, url: row.url,
    price: row.ar, currency: 'HUF', extractor: 'opencart', availability: 'in_stock',
  }));
  const res = selectExactCandidate(jeloltek, termek, 'borkell');
  assert.equal(res.status, 'matched', 'jóváhagyott referenciával MATCHED kell, kapott: ' + res.status);
  assert.equal(res.selected.price, 17990);
});

test('opencart: strict matcher-v2 elutasítja a hamis pár (777 Pinot noir a Grand Bleu helyett)', () => {
  // A Borkell "777 Pinot noir 2023"-ja rokon, de NEM a Grand Bleu 2017.
  // Nincs jóváhagyott referencia hozzá → NEM matched (no_exact_match).
  const termek = {
    id: 'kovacs-nimrod-grand-bleu-2017-13-5-0-75l',
    azonositas: {
      termekkategoria: 'wine', gyarto: 'Kovács', marka_aliasok: ['Kovács'],
      tetel: 'Kovács Nimród Grand Bleu 2017 13,5% 0,75l', evjarat: 2017, evjarat_statusz: 'vintage',
      kiszereles_ml: 750, darab: 1, csomagolas: 'plain_bottle', puttony: null, penznem: 'HUF',
    },
    // NINCS borkell reference
    shop_azonositas: {},
  };
  // csak a 777 van a katalógusban
  const jeloltek = [candidate({
    shopId: 'borkell', shopProductId: '/kovacs-nimrod-777-pinot-noir', name: 'Kovács Nimród - 777 Pinot noir 2023',
    url: 'https://borkell.hu/boraszatok/magyar/kovacs-nimrod/kovacs-nimrod-777-pinot-noir', price: 5990, currency: 'HUF',
    extractor: 'opencart', availability: 'in_stock',
  })];
  const res = selectExactCandidate(jeloltek, termek, 'borkell');
  assert.notEqual(res.status, 'matched', 'a 777 a Grand Bleu helyett soha nem matched');
  assert.equal(res.selected, null);
});
