// Radovin árfigyelő – ShopRenter adapter teszt.
// Fixture-alapú (guide §18): a valódi Veritas/Borkell HTML-ekből vett minta
// alapján ellenőrzi, hogy a kártya-nyerő a nevet+árat+URL-t helyesen adja,
// és a matcher nem enged hamis párt.

const test = require('node:test');
const assert = require('node:assert');
const { sorok, kartyaSor, tisztitNev, shoprenter } = require('../lib/shoprenter.js');
const { szigor } = require('../lib/matricas.js');

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

test('shoprenter: a szigor() fajta-gátja 12 years ↔ Double Cask miatt NEM ad hamis párt az 1. passzban', () => {
  const katalogus = sorok(WHISKY_CARDS, SHOP);
  const termek = {
    id: 'macallan-12-double-cask', nev: 'Macallan 12 Years Double Cask 0,7l',
    marka: 'Macallan', meret: '0,7 l', fajta: '12 years Double Cask',
  };
  // A belső fajta-szó („12 years Double Cask”) NEM szerepel a Veritas nevében
  // („Macallan 12 Double Cask 0,7l”), ezért az 1. passz becsületesen no_match-et ad –
  // nem hamis árat. Ezt a kétmenetes per-shop alias oldja fel az alábbi tesztben.
  const tal = szigor(katalogus, termek);
  assert.strictEqual(tal, null, 'a fajta-gát őszintén elutasít: nem hamis pár (12 years vs Double Cask)');
});

test('shoprenter: per-shop elfogadott alias bekapcsolásával a Macallan 12 PONTOS párt ad (2. passz)', () => {
  const termek = {
    id: 'macallan-12-double-cask', nev: 'Macallan 12 Years Double Cask 0,7l',
    marka: 'Macallan', meret: '0,7 l', fajta: '12 years Double Cask',
    shop_azonositas: {
      veritas: {
        elfogadott_tetel_aliasok: ['Double Cask'],
        ellenorzott_nev: 'Macallan 12 Double Cask 0,7l | Veritas Online Store',
        ellenorizve: '2026-08-30',
        ellenorzes_modja: 'manual',
      },
    },
  };
  // ÉLETBEN nem katalógust adunk át: a shoprenter() maga húzza le, de itt fixture-HTML-lel
  // tesszük determinisztikussá a kategória-nyerő függvényét (a katalógus = WHISKY_CARDS).
  // Hívd a szigor()-t közvetlenül két-passz szerint (u.a., ahogy a shoprenter() teszi).
  const katalogus = sorok(WHISKY_CARDS, SHOP);
  const aliasok = termek.shop_azonositas.veritas.elfogadott_tetel_aliasok;
  const tal = szigor(katalogus, termek, { tetel_aliasok: aliasok });
  assert.ok(tal, 'a per-shop alias feloldja a fajta-gátat: van pontos Macallan találat');
  assert.ok(tal.nev.includes('Macallan'), 'a találat a Macallan: ' + tal.nev);
  assert.strictEqual(tal.ar, 39000);
});

test('shoprenter: ALIAS NÉLKÜL a Double Black-hez nem ad hamis párt (never-false-price)', () => {
  const katalogus = sorok(WHISKY_CARDS, SHOP);
  const termek = { id: 'jw-black', nev: 'Johnnie Walker Black Label 1l', marka: 'Johnnie Walker', meret: '1 l', fajta: 'Black Label Triple Cask' };
  // Nincs shop_azonositas.veritas alias → a kétmenetes match is no_match marad.
  const tal = szigor(katalogus, termek, { tetel_aliasok: [] });
  assert.strictEqual(tal, null, 'nincs hamis párosítás a fixture-ben');
});

test('shoprenter: üres/rossz HTML esetén üres listát ad, nem hibát dob', () => {
  assert.deepStrictEqual(sorok('', SHOP), []);
  assert.deepStrictEqual(sorok('<html><body>nincs kártya</body></html>', SHOP), []);
});
