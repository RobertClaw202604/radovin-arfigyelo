// Radovin árfigyelő – Unas adapter teszt (Benebor).
// Fixture-alapú (guide §18): a valódi Benebor HTML-ekből vett minta alapján ellenőrzi,
// hogy a kártya-nyerő a nevet+árat+URL-t helyesen adja (Unas aria-label + price-gross),
// a lapozás `/<slug>,N` formátuma működik, és a matcher nem enged hamis párt.

const test = require('node:test');
const assert = require('node:assert');
const { sorok, kategoriaTele } = require('../lib/unas.js');
const { selectExactCandidate } = require('../lib/domain/matcher-v2.js');
const { candidate } = require('../lib/domain/candidate.js');

const SHOP = { id: 'benebor', base_url: 'https://beneborshop.hu' };

// Valódi Benebor /Vesztergombi-Pinceszet kártya-struktúra (a név aria-label-ben, az ár
// price-gross + price-currency-ben, az URL href-ben). A konténer a page_artlist_artlist_<sku>.
const CARDS = `
<div id="page_artlist_artlist_60001" data-sku="60001">
  <div class="product__inner" role="group" aria-label="1. termék:  Vesztergombi St László Bikavér prémium száraz szekszárdi vörösbor - Díjnyertes bor">
    <a href="https://beneborshop.hu/Vesztergombi-St-Laszlo-Bikaver-Dijnyertes-bor">kép</a>
    <span class="product__price-base-value"><span class='price-gross-format'><span id='price_net_brutto_artlist_60001' class='price_net_brutto_artlist_60001 price-gross'>6 500</span><span class='price-currency'> Ft</span></span></span>
  </div>
</div>
<div id="page_artlist_artlist_60002" data-sku="60002">
  <div class="product__inner" role="group" aria-label="2. termék:  Vesztergombi Rose rosé">
    <a href="https://beneborshop.hu/Vesztergombi-Rose-rose">kép</a>
    <span class="product__price-base-value"><span class='price-gross-format'><span id='price_net_brutto_artlist_60002' class='price_net_brutto_artlist_60002 price-gross'>2 300</span><span class='price-currency'> Ft</span></span></span>
  </div>
</div>
<div id="page_artlist_artlist_60003" data-sku="60003">
  <div class="product__inner" role="group" aria-label="3. termék:  Vesztergombi Bodzás dűlőszelektált Cabernet Sauvignon prémium száraz szekszárdi vörösbor">
    <a href="https://beneborshop.hu/Vesztergombi-Bodzas-duloszelektalt-Cabernet-Sauvig">kép</a>
    <span class="product__price-base-value"><span class='price-gross-format'><span id='price_net_brutto_artlist_60003' class='price_net_brutto_artlist_60003 price-gross'>9 800</span><span class='price-currency'> Ft</span></span></span>
  </div>
</div>
<div id="page_artlist_artlist_60004" data-sku="60004">
  <div class="product__inner" role="group" aria-label="4. termék:  Vesztergombi Vintage prémium száraz szekszárdi vörösbor">
    <a href="https://beneborshop.hu/Vesztergombi-Vintage-premium-szaraz-szekszardi-vor">kép</a>
    <span class="product__price-base-value"><span class='price-gross-format'><span id='price_net_brutto_artlist_60004' class='price_net_brutto_artlist_60004 price-gross'>9 800</span><span class='price-currency'> Ft</span></span></span>
  </div>
</div>
`;

// Egy 12 elemből álló lap generáló (a 2. oldal már csak pl. 2 újat ad, amit meg kell tartani).
const kartya = (i, nev, slug, ar) => `
<div id="page_artlist_artlist_${60000 + i}" data-sku="${60000 + i}">
  <div class="product__inner" role="group" aria-label="${i}. termék:  ${nev}">
    <a href="https://beneborshop.hu/${slug}">kép</a>
    <span><span class='price-gross'>${ar}</span><span class='price-currency'> Ft</span></span>
  </div>
</div>`;

test('unas: sorok kinyeri a nev+ár+URL hármast a kártyákból', () => {
  const s = sorok(CARDS, SHOP);
  assert.strictEqual(s.length, 4, '4 kártya kinyerve, kapott: ' + s.length);
  const bik = s.find((x) => x.url.includes('Bikaver'));
  assert.ok(bik, 'St László Bikavér kártya megvan');
  assert.strictEqual(bik.ar, 6500);
  assert.ok(/St László Bikavér/.test(bik.nev), 'St László név: ' + bik.nev);
  const rose = s.find((x) => x.url.includes('Rose-rose'));
  assert.strictEqual(rose.ar, 2300);
  assert.ok(/Rose rosé/.test(rose.nev), 'Rose név: ' + rose.nev);
});

test('unas: string matcher pontos párt matched-re hoz (approved reference)', () => {
  const termek = {
    id: 'vesztergombi-st-laszlo-bikaver-2021-14-0-75l',
    azonositas: {
      termekkategoria: 'wine', gyarto: 'Vesztergombi', marka_aliasok: ['Vesztergombi'],
      tetel: 'Vesztergombi St. László Bikavér 2021 14% 0,75l', evjarat: 2021, evjarat_statusz: 'vintage',
      kiszereles_ml: 750, darab: 1, csomagolas: 'plain_bottle', puttony: null, penznem: 'HUF',
    },
    shop_azonositas: {
      benebor: {
        elfogadott_tetel_aliasok: ['St László Bikavér'],
        url: 'https://beneborshop.hu/Vesztergombi-St-Laszlo-Bikaver-Dijnyertes-bor',
        ellenorizve: '2026-08-30', ellenorzes_modja: 'manual',
      },
    },
  };
  const s = sorok(CARDS, SHOP);
  const jeloltek = s.map((row) => candidate({
    shopId: 'benebor', shopProductId: row.url, name: row.nev, url: row.url,
    price: row.ar, currency: 'HUF', extractor: 'unas', availability: 'in_stock',
  }));
  const res = selectExactCandidate(jeloltek, termek, 'benebor');
  assert.equal(res.status, 'matched', 'St László Bikavér -> matched, kapott: ' + res.status);
  assert.equal(res.selected.price, 6500);
});

test('unas: HAMIS pár sosem matched (St László Bikavér vs Rose rosé)', () => {
  // Ha a Rosé kártyát próbáljuk a St László Bikavérhez párosítani, a strict matcher
  // nem enged hamis árat (bár approved reference van, az alias nem egyezik a kártyanevvel).
  const termek = {
    id: 'vesztergombi-st-laszlo-bikaver-2021-14-0-75l',
    azonositas: {
      termekkategoria: 'wine', gyarto: 'Vesztergombi', marka_aliasok: ['Vesztergombi'],
      tetel: 'Vesztergombi St. László Bikavér 2021 14% 0,75l', evjarat: 2021, evjarat_statusz: 'vintage',
      kiszereles_ml: 750, darab: 1, csomagolas: 'plain_bottle', puttony: null, penznem: 'HUF',
    },
    shop_azonositas: {
      benebor: {
        // rossz, nem disambiguáló alias – a Rose rosé-ra illik, de a Bikavér-kártyára NEM
        elfogadott_tetel_aliasok: ['Rose rosé'],
        url: 'https://beneborshop.hu/Vesztergombi-St-Laszlo-Bikaver-Dijnyertes-bor',
        ellenorizve: '2026-08-30', ellenorzes_modja: 'manual',
      },
    },
  };
  const s = sorok(CARDS, SHOP);
  const jeloltek = s.map((row) => candidate({
    shopId: 'benebor', shopProductId: row.url, name: row.nev, url: row.url,
    price: row.ar, currency: 'HUF', extractor: 'unas', availability: 'in_stock',
  }));
  const res = selectExactCandidate(jeloltek, termek, 'benebor');
  assert.notEqual(res.status, 'matched', 'a rosé a bikavér helyett soha nem matched');
  assert.equal(res.selected, null);
});

test('unas: kategoriaTele megtartja az utolsó RÉSZLÉGES lapot is (/,N lapozás)', async () => {
  // 1. lap: 12 tele; 2. lap (`,2`): 2 új (részleges); 3. lap (`,3`): üres.
  const hivasok = [];
  const eredeti = global.fetch;
  global.fetch = async (url) => {
    hivasok.push(String(url));
    const m = String(url).split('/').pop(); // pl. "Vesztergombi-Pinceszet", "Vesztergombi-Pinceszet,2"
    const page = m.includes(',') ? parseInt(m.split(',')[1], 10) : 1;
    if (page > 2) return { ok: true, text: async () => '<html><body>üres</body></html>' };
    let html = '';
    if (page === 1) {
      for (let i = 1; i <= 12; i++) html += kartya(i, 'Vesztergombi Test ' + i, 'Vesztergombi-Test-' + i, 1000 + i);
    } else {
      // 2. lap csak 2 újat ad (részleges) – ezek NEM veszhetnek el
      html += kartya(13, 'Vesztergombi Bodzás dűlőszelektált Cabernet Sauvignon prémium száraz szekszárdi vörösbor', 'Vesztergombi-Bodzas-duloszelektalt-Cabernet-Sauvig', 9800);
      html += kartya(14, 'Vesztergombi Kadarka', 'Vesztergombi-Kadarka', 2970);
    }
    return { ok: true, text: async () => html };
  };
  try {
    const kat = await kategoriaTele({ id: 'benebor', base_url: 'https://beneborshop.hu', kategoria_slugek: ['Vesztergombi-Pinceszet'], kategoria_max_lap: 10 }, { ua: 'Mozilla/5.0', timeout_sec: 10 });
    // 12 (1. lap) + 2 (részleges 2. lap) = 14; a részleges oldal NEM vész el
    assert.strictEqual(kat.length, 14, 'a részleges utolsó oldal 2 tételét is meg kell tartani, kapott: ' + kat.length);
    assert.ok(kat.some((x) => x.url.includes('Bodzas')), 'Bodzás megvan a részleges lapról');
    assert.ok(kat.some((x) => x.url.includes('Kadarka')), 'Kadarka megvan a részleges lapról');
  } finally {
    global.fetch = eredeti;
  }
});
