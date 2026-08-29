// Radovin árfigyelő – konfig-validáció egységtesztek (Commit 1 / P0)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const configModul = require('../lib/runtime/config.js');

// Az ACTUAL confignak érvényesnek kell lennie (a repo pillanatnyi állapota).
// Ennek el kell telnie ahhoz, hogy a futás elindulhasson.
test('a valódi config érvényes (shopok + termekek)', () => {
  const r = configModul.betoltEgesz();
  assert.ok(Array.isArray(r.shopok) && r.shopok.length > 0, 'van shop');
  assert.ok(Array.isArray(r.termekek) && r.termekek.length > 0, 'van termék');
  const aktivShop = r.shopok.filter((s) => s.statusz === 'active').length;
  const aktivTermek = r.termekek.filter((t) => t.aktiv !== false).length;
  assert.ok(aktivShop >= 5, 'legalább 5 aktív shop');
  assert.ok(aktivTermek >= 30, 'legalább 30 aktív termék');
});

test('duplikált shop-id hibát okoz', () => {
  const rossz = {
    shopok: [
      { id: 'radovin', nev: 'A', tipus: 'sajat', statusz: 'active', adapter: 'woocommerce', base_url: 'https://radovin.hu' },
      { id: 'radovin', nev: 'B', tipus: 'konkurencia', statusz: 'pending', adapter: 'headless', base_url: 'https://x.hu' },
    ],
  };
  assert.throws(() => configModul.ellenorizShopok(rossz), /Duplikált shop-id/);
});

test('aktív shop ismeretlen adapterrel hibát okoz', () => {
  const rossz = {
    shopok: [
      { id: 'x', nev: 'X', tipus: 'konkurencia', statusz: 'active', adapter: 'nemletzik', base_url: 'https://x.hu' },
    ],
  };
  assert.throws(() => configModul.ellenorizShopok(rossz), /Ismeretlen adapter/);
});

test('blocked/pending shop ismeretlen (tervezett) adaptere NEM okoz hibát', () => {
  const jo = {
    shopok: [
      { id: 'x', nev: 'X', tipus: 'konkurencia', statusz: 'blocked', adapter: 'headless-kell', base_url: 'https://x.hu' },
    ],
  };
  const r = configModul.ellenorizShopok(jo);
  assert.equal(r.length, 1);
});

test('hiányzó kötelező termék-mező hibát okoz', () => {
  const rossz = {
    termekek: [
      { id: 't1', nev: 'Valami', marka: 'M' }, // nincs tipus, meret
    ],
  };
  assert.throws(() => configModul.ellenorizTermekek(rossz), /Érvénytelen termék/);
});

test('érvénytelen azonositas blokk hibát okoz (ha jelen van)', () => {
  const rossz = {
    termekek: [
      { id: 't1', nev: 'N', marka: 'M', tipus: 'bor', meret: '0,75 l', azonositas: { termekkategoria: 'bor' } }, // hiányzik marka_aliasok, tetel
    ],
  };
  assert.throws(() => configModul.ellenorizTermekek(rossz), /azonositas/);
});

test('érvényes azonositas blokk átmegy', () => {
  const jo = {
    termekek: [
      {
        id: 't1', nev: 'Bock Oro 2022', marka: 'Bock', tipus: 'bor', meret: '0,75 l',
        azonositas: { termekkategoria: 'vörösbor', marka_aliasok: ['bock'], tetel: 'Oro', kiszereles_ml: 750, darab: 1, csomagolas: 'palack', penznem: 'HUF' },
      },
    ],
  };
  const r = configModul.ellenorizTermekek(jo);
  assert.equal(r.length, 1);
});
