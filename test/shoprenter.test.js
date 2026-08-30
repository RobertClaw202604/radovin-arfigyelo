// Radovin árfigyelő – ShopRenter adapter teszt.
// Fixture-alapú (guide §18): a valódi Veritas/Borkell HTML-ekből vett minta
// alapján ellenőrzi, hogy a kártya-nyerő a nevet+árat+URL-t helyesen adja,
// és a matcher nem enged hamis párt.

const test = require('node:test');
const assert = require('node:assert');
const { sorok, kartyaSor, tisztitNev, shoprenter } = require('../lib/shoprenter.js');
const { selectExactCandidate } = require('../lib/domain/matcher-v2.js');
const { candidate } = require('../lib/domain/candidate.js');

const SHOP = { id: 'veritas', base_url: 'https://www.borkereskedes.hu' };

// Valódi Veritas /whisky-whiskey termékkártya-darabok (lényegi struktúra)
const WHISKY_CARDS = `
<div class="card product-card h-100  mobile-simple-view" >
  <a href="https://www.borkereskedes.hu/jim-beam-black-whiskey2">
    <img title="Jim Beam Black  Whiskey-Veritas borwebshop" alt="Jim Beam Black  Whiskey-Veritas borwebshop">
  </a>
  <div class="card-body product-card-body">
    <span class="product-price">10 250 Ft</span>
  </div>
</div>
<div class="card product-card h-100  mobile-simple-view" >
  <a href="https://www.borkereskedes.hu/gentleman-jack-whisky">
    <img title="Gentleman Jack Whisky - Veritas - borkereskedes.hu" alt="Gentleman Jack Whisky - Veritas - borkereskedes.hu">
  </a>
  <div class="card-body product-card-body">
    <span class="product-price">14 990 Ft</span>
  </div>
</div>
<div class="card product-card h-100  mobile-simple-view" >
  <a href="https://www.borkereskedes.hu/macallan-12-double-cask">
    <img title="Macallan 12 Double Cask 0,7l | Veritas Online Store" alt="Macallan 12 Double Cask">
  </a>
  <div class="card-body product-card-body"><span>39 000 Ft</span></div>
</div>
`;

test('shoprenter: sorok kinyeri a nev+ár+URL hármast a kártyákból', () => {
  const s = sorok(WHISKY_CARDS, SHOP);
  assert.ok(s.length >= 3, 'legalább a 3 kártyát kinyeri, kapott: ' + s.length);
  // Jim Beam
  const jb = s.find((x) => x.url.includes('jim-beam-black-whiskey2'));
  assert.ok(jb, 'Jim Beam kártya megvan');
  assert.strictEqual(jb.ar, 10250);
  assert.ok(/Jim Beam/i.test(jb.nev), 'Jim Beam név: ' + jb.nev);
  // Macallan 12 – a mi 58-termékes listánkban szerepel
  const mc = s.find((x) => x.url.includes('macallan-12-double-cask'));
  assert.ok(mc, 'Macallan kártya megvan');
  assert.strictEqual(mc.ar, 39000);
  assert.ok(/Macallan 12/i.test(mc.nev), 'Macallan név: ' + mc.nev);
});

test('shoprenter: tisztitNev levágja a bolt-szuffixot és entitást dekódol', () => {
  assert.strictEqual(tisztitNev('Jim Beam Black  Whiskey-Veritas borwebshop', SHOP), 'Jim Beam Black  Whiskey');
  assert.strictEqual(tisztitNev('Gentleman Jack Whisky - Veritas - borkereskedes.hu', SHOP), 'Gentleman Jack Whisky');
  assert.strictEqual(tisztitNev('Balla&#039;s Bor | Veritas Online Store', SHOP), "Balla's Bor");
  assert.strictEqual(tisztitNev('Macallan 12 Double Cask 0,7l | Veritas Online Store', SHOP), 'Macallan 12 Double Cask 0,7l');
});

test('shoprenter: strict matcher-v2 PONTOS párt ad jóváhagyott referenciával (Macallan 12)', () => {
  // A termék a Commit 3 azonositas+séma szerint (tétel = a Veritas pontos neve), és
  // van jóváhagyott Veritas-referenciája (ellenorzott_nev = a Veritas termékneve).
  const termek = {
    id: 'macallan-12-double-cask',
    azonositas: {
      termekkategoria: 'spirit', gyarto: 'Macallan', marka_aliasok: ['Macallan'],
      tetel: 'Macallan 12 Years Double Cask 0,7l', evjarat: null, evjarat_statusz: 'non_vintage',
      kiszereles_ml: 700, darab: 1, csomagolas: 'plain_bottle', puttony: null, penznem: 'HUF',
    },
    shop_azonositas: {
      veritas: {
        elfogadott_tetel_aliasok: ['Double Cask'],
        ellenorzott_nev: 'Macallan 12 Double Cask 0,7l',
        ellenorizve: '2026-08-30', ellenorzes_modja: 'manual',
      },
    },
  };
  const katalogus = sorok(WHISKY_CARDS, SHOP);
  const jeloltek = katalogus.map((row) => candidate({
    shopId: 'veritas', shopProductId: row.url, name: row.nev, url: row.url,
    price: row.ar, currency: 'HUF', extractor: 'shoprenter', availability: 'in_stock',
  }));
  const res = selectExactCandidate(jeloltek, termek, 'veritas');
  assert.equal(res.status, 'matched', 'jóváhagyott referenciával MATCHED kell, kapott: ' + res.status);
  assert.ok(res.selected, 'van kiválasztott tétel');
  assert.equal(res.selected.price, 39000);
  assert.ok(/Macallan/i.test(res.selected.name), 'a találat a Macallan: ' + res.selected.name);
});

test('shoprenter: strict matcher-v2 elutasítja a hamis párt (Bujdosó Cirkáló vs Irsai Olivér)', () => {
  // Ez volt a legacy szigor() ismert hamis párja: a „Bujdosó Kapitány Irsai Olivér”
  // tételhez a Cirkáló (másik bor, csak ugyanaz a pincészet+évjárat+volumen) árát adta.
  // A matcher-v2 expression-gátja szóhatár-pontos: a Cirkáló-ben nincs „Irsai Olivér”,
  // ezért NEM matched (soha nem hamis ár).
  const termek = {
    id: 'bujdoso-kapitany-irsai-oliver-2024-11-0-75l',
    azonositas: {
      termekkategoria: 'wine', gyarto: 'Bujdosó', marka_aliasok: ['Bujdosó'],
      tetel: 'Bujdosó Kapitány Irsai Olivér 2024 11% 0,75l', evjarat: 2024, evjarat_statusz: 'vintage',
      kiszereles_ml: 750, darab: 1, csomagolas: 'plain_bottle', puttony: null, penznem: 'HUF',
    },
    shop_azonositas: { veritas: { elfogadott_tetel_aliasok: ['Kapitány', 'Irsai Olivér'] } },
  };
  // Csak a Cirkáló van a katalógusban (a hamis unokatestvér).
  const jeloltek = [candidate({
    shopId: 'veritas', shopProductId: '/bujdoso-cirkalo-2024', name: 'Bujdosó Cirkáló 2024',
    url: 'https://www.borkereskedes.hu/bujdoso-cirkalo', price: 2990, currency: 'HUF',
    extractor: 'shoprenter', availability: 'in_stock',
  })];
  const res = selectExactCandidate(jeloltek, termek, 'veritas');
  assert.notEqual(res.status, 'matched', 'a hamis Cirkáló pár NEM lehet matched');
  assert.equal(res.selected, null);
});

test('shoprenter: strict matcher-v2 elutasítja a Double Black-et (Black Label unokatestvér)', () => {
  const termek = {
    id: 'jw-black-label-1l',
    azonositas: {
      termekkategoria: 'spirit', gyarto: 'Johnnie Walker', marka_aliasok: ['johnnie walker', 'jw'],
      tetel: 'Black Label Triple Cask', evjarat: null, evjarat_statusz: 'non_vintage',
      kiszereles_ml: 1000, darab: 1, csomagolas: 'plain_bottle', puttony: null, penznem: 'HUF',
    },
    shop_azonositas: { veritas: { elfogadott_tetel_aliasok: ['Black Label'] } },
  };
  const jeloltek = [candidate({
    shopId: 'veritas', shopProductId: '/jw-double-black', name: 'Johnnie Walker Double Black 1000ml',
    url: 'https://www.borkereskedes.hu/jw-double-black', price: 13990, currency: 'HUF',
    extractor: 'shoprenter', availability: 'in_stock',
  })];
  const res = selectExactCandidate(jeloltek, termek, 'veritas');
  assert.notEqual(res.status, 'matched', 'a Double Black NEM a Black Label – soha nem hamis ár');
  assert.equal(res.selected, null);
});

test('shoprenter: ÉVJÁRAT-ELHAGYÁS jováhagyott referenciával → matched (Bujdoso Kapitany)', () => {
  // A Veritas a kártyanéven NEM írja ki az évjáratot, de a bor azonos és emberileg
  // jóváhagyott pontos referencia (URL) létezik szere. Ez a „megvan az a bor, elfogadjuk”
  // eset: a hiányzó (nem ellentmondó) évjárat ne blokkolja a jóváhagyott pontos párt.
  const termek = {
    id: 'bujdoso-kapitany-irsai-oliver-2024-11-0-75l',
    azonositas: {
      termekkategoria: 'wine', gyarto: 'Bujdoso', marka_aliasok: ['Bujdosó'],
      tetel: 'Bujdosó Kapitány Irsai Olivér 2024 11% 0,75l', evjarat: 2024, evjarat_statusz: 'vintage',
      kiszereles_ml: 750, darab: 1, csomagolas: 'plain_bottle', puttony: null, penznem: 'HUF',
    },
    shop_azonositas: {
      veritas: {
        elfogadott_tetel_aliasok: ['Kapitány', 'Irsai Olivér'],
        url: 'https://www.borkereskedes.hu/bujdoso-balatonboglari-kapitany-irsai-oliver',
        ellenorizve: '2026-08-30', ellenorzes_modja: 'manual',
      },
    },
  };
  const jeloltek = [candidate({
    shopId: 'veritas', shopProductId: '/bujdoso-balatonboglari-kapitany-irsai-oliver',
    name: 'Bujdosó Kapitány Irsai Olivér', // NINCS évjárat a névben
    url: 'https://www.borkereskedes.hu/bujdoso-balatonboglari-kapitany-irsai-oliver',
    price: 2015, currency: 'HUF', extractor: 'shoprenter', availability: 'in_stock',
  })];
  const res = selectExactCandidate(jeloltek, termek, 'veritas');
  assert.equal(res.status, 'matched', 'jováhagyott pontos referencia + hiányzó évjárat → matched, kapott: ' + res.status);
  assert.equal(res.selected.price, 2015);
});

test('shoprenter: ELLENTMONDÓ évjárat (más év a névben) jováhagyott ref-el is → soha nem matched', () => {
  // Ha a bolt kártyanéve MÁS évjáratot mond (2019) mint amit várunk (2024), az valódi
  // ellentmondás – még jováhagyott referencia mellett sem szabad árat adni (más az évjárat).
  const termek = {
    id: 'kreinbacher-brut-classic-12-0-75l',
    azonositas: {
      termekkategoria: 'wine', gyarto: 'Kreinbacher', marka_aliasok: ['Kreinbacher'],
      tetel: 'Kreinbacher Brut Classic 2016 12% 0,75l', evjarat: 2016, evjarat_statusz: 'vintage',
      kiszereles_ml: 750, darab: 1, csomagolas: 'plain_bottle', puttony: null, penznem: 'HUF',
    },
    shop_azonositas: {
      veritas: {
        elfogadott_tetel_aliasok: ['Brut Classic'],
        url: 'https://www.borkereskedes.hu/kreinbacher-brut-classic',
        ellenorizve: '2026-08-30', ellenorzes_modja: 'manual',
      },
    },
  };
  const jeloltek = [candidate({
    shopId: 'veritas', shopProductId: '/kreinbacher-brut-classic',
    name: 'Kreinbacher Brut Classic 2019', // MÁS évjárat a névben
    url: 'https://www.borkereskedes.hu/kreinbacher-brut-classic',
    price: 8990, currency: 'HUF', extractor: 'shoprenter', availability: 'in_stock',
  })];
  const res = selectExactCandidate(jeloltek, termek, 'veritas');
  assert.notEqual(res.status, 'matched', 'a 2019-es a 2016-os helyett soha nem matched');
  assert.equal(res.selected, null);
});

test('shoprenter: üres/rossz HTML esetén üres listát ad, nem hibát dob', () => {
  assert.deepStrictEqual(sorok('', SHOP), []);
  assert.deepStrictEqual(sorok('<html><body>nincs kártya</body></html>', SHOP), []);
});
