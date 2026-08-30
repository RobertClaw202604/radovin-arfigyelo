// Radovin árfigyelő – JSON-Schema validációs regressziós tesztek (guide §17).
// Nem élő shopokat hívunk: a sémafájlok és a validate-config script viselkedését
// teszteljük tiszta, szanitizált fixture-okon és a valódi konfigon.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TERMEKEK_SCHEMA = path.join(ROOT, 'config/schemas/termekek.schema.json');
const SHOPOK_SCHEMA = path.join(ROOT, 'config/schemas/shopok.schema.json');

const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

function compile(schemaPath) {
  return ajv.compile(JSON.parse(fs.readFileSync(schemaPath, 'utf8')));
}
const termekekValidate = compile(TERMEKEK_SCHEMA);
const shopokValidate = compile(SHOPOK_SCHEMA);

function termek(overrides = {}) {
  return {
    id: 'x-teszt',
    nev: 'Teszt bor',
    marka: 'Teszt',
    tipus: 'bor',
    meret: '0,75 l',
    evjarat: null,
    radovin_kereso: 'Teszt bor',
    azonositas: {
      termekkategoria: 'wine',
      gyarto: 'Teszt',
      marka_aliasok: ['Teszt'],
      tetel: 'Teszt bor',
      evjarat: 2021,
      evjarat_statusz: 'vintage',
      kiszereles_ml: 750,
      darab: 1,
      csomagolas: 'plain_bottle',
      puttony: null,
      penznem: 'HUF',
    },
    shop_azonositas: { radovin: { ellenorzott_nev: 'Teszt bor 0.75 l' } },
    ...overrides,
  };
}

test('a valódi termekek.json átmegy a séma-validáción', () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/termekek.json'), 'utf8'));
  assert.equal(termekekValidate(data), true, JSON.stringify(termekekValidate.errors, null, 2));
});

test('a valódi shopok.json átmegy a séma-validáción', () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/shopok.json'), 'utf8'));
  assert.equal(shopokValidate(data), true, JSON.stringify(shopokValidate.errors, null, 2));
});

test('aktív termék hiányzó azonositas → érvénytelen', () => {
  const bad = termek({ azonositas: undefined });
  assert.equal(termekekValidate({ termekek: [bad] }), false);
});

test('aktív termék radovin_slug ÉS radovin_kereso nélkül → érvénytelen', () => {
  const bad = termek({ radovin_slug: undefined, radovin_kereso: undefined });
  assert.equal(termekekValidate({ termekek: [bad] }), false);
});

test('aktív termék akár slug-gal, akár keresővel is érvényes', () => {
  const slug = termek({ radovin_kereso: undefined, radovin_slug: 'teszt-bor-075l' });
  const kereso = termek({ radovin_slug: undefined, radovin_kereso: 'Teszt bor' });
  assert.equal(termekekValidate({ termekek: [slug] }), true);
  assert.equal(termekekValidate({ termekek: [kereso] }), true);
});

test('hiányzó aktiv mező = aktív (régi konvenció), nem igényel szuneteltetes_oka-t', () => {
  const implicit = termek();
  assert.equal(implicit.aktiv, undefined);
  assert.equal(termekekValidate({ termekek: [implicit] }), true);
});

test('kifejezetten aktiv:false → szuneteltetes_oka kötelező', () => {
  const bad = termek({ aktiv: false, szuneteltetes_oka: undefined });
  assert.equal(termekekValidate({ termekek: [bad] }), false);
  const ok = termek({ aktiv: false, szuneteltetes_oka: 'Inaktív teszt-ok' });
  assert.equal(termekekValidate({ termekek: [ok] }), true);
});

test('evjarat_statusz vintage → egész évjárat kötelező', () => {
  const bad = termek({ azonositas: { ...termek().azonositas, evjarat_statusz: 'vintage', evjarat: null } });
  assert.equal(termekekValidate({ termekek: [bad] }), false);
});

test('evjarat_statusz non_vintage → evjarat null', () => {
  const bad = termek({ azonositas: { ...termek().azonositas, evjarat_statusz: 'non_vintage', evjarat: 2021 } });
  assert.equal(termekekValidate({ termekek: [bad] }), false);
  const ok = termek({ azonositas: { ...termek().azonositas, evjarat_statusz: 'non_vintage', evjarat: null } });
  assert.equal(termekekValidate({ termekek: [ok] }), true);
});

test('ismeretlen termekkategoria → érvénytelen', () => {
  const bad = termek({ azonositas: { ...termek().azonositas, termekkategoria: 'bor' } });
  assert.equal(termekekValidate({ termekek: [bad] }), false);
});

test('nem HUF pénznem → érvénytelen', () => {
  const bad = termek({ azonositas: { ...termek().azonositas, penznem: 'EUR' } });
  assert.equal(termekekValidate({ termekek: [bad] }), false);
});

test('validate-config script élőben lefut és kilép 0-val', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/validate-config.js')], { encoding: 'utf8' });
  assert.match(out, /Configuration is valid/);
});

test('cross-file: shop_azonositas ismeretlen shop-id → hibát dob', () => {
  // A cross-file ellenőrzés a validate-config scriptben van; itt a valódi konfig
  // shop-id-jait ellenőrizzük direktben a shopok.json-ból.
  const shopok = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/shopok.json'), 'utf8'));
  const termekek = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/termekek.json'), 'utf8'));
  const shopIds = new Set(shopok.shopok.map((s) => s.id));
  const foo = [];
  for (const t of termekek.termekek) {
    for (const sid of Object.keys(t.shop_azonositas || {})) {
      if (!shopIds.has(sid)) foo.push(`${t.id}:${sid}`);
    }
  }
  assert.deepEqual(foo, []);
});
