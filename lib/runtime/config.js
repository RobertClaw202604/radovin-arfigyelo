// Radovin árfigyelő – konfiguráció-validáció (Commit 1 / P0 + Commit 3 azonositas).
//
// Cél: a shopok és termékek konfigurációját betöltéskor ellenőrizni, hogy a
// futás SOHA ne induljon el rossz/„üres” konfiggal (pl. hiányzó meret, ismeretlen
// adapter, érvénytelen pénznem). Ha a konfig érvénytelen, a futás azonnal megáll,
// ahelyett hogy hamis / hiányos összehasonlítást generálna.
//
// Referencia: RADOVIN_SYSTEM_IMPROVEMENT_GUIDE.md – P0 (config validation),
// §6 (azonositas identitás-séma, Commit 3), §26 (config mezők), §11 (QA checklist).

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const DIR = __dirname;
const CONFIG_DIR = path.join(DIR, '..', '..', 'config');

const ISMERETT_ADAPTEREK = [
  'woocommerce',
  'woocommerce-api',
  'katlistas',
  'shopify',
  'borhalo',
  'headless',
  'html-simon',
];
const STATUSZOK = ['active', 'pending', 'blocked'];
const TIPUSOK = ['sajat', 'konkurencia'];
const EVJARAT_STATUSZOK = ['vintage', 'non_vintage', 'unknown'];

// --- Shop konfig séma ---
const shopSchema = {
  type: 'object',
  required: ['id', 'nev', 'tipus', 'statusz', 'adapter'],
  additionalProperties: true,
  properties: {
    id: { type: 'string', minLength: 1 },
    nev: { type: 'string', minLength: 1 },
    tipus: { enum: TIPUSOK },
    statusz: { enum: STATUSZOK },
    adapter: { type: 'string' },
    base_url: { type: 'string' },
  },
};

// --- Termék identitás séma (guide §6, Commit 3) ---
// Az "evjarat_statusz" értékei: vintage / non_vintage / unknown.
// - vintage      : van pontos évjárat (pl. "Bock Chardonnay 2025")
// - non_vintage  : nincs évjárat, MEGERŐSÍTETTEN nem évjáratos (pezsgő, whisky, gin, rum)
// - unknown      : nem tudjuk – SOHA nem auto-matchel.
const azonositasSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['termekkategoria', 'marka_aliasok', 'tetel'],
  properties: {
    termekkategoria: { type: 'string', minLength: 1 },
    // gyarto: pincészet/termelő a bornál; generikus tételnél (pl. "tokaji aszú") null lehet.
    gyarto: { type: ['string', 'null'] },
    marka_aliasok: { type: 'array', items: { type: 'string' }, minLength: 1 },
    tetel: { type: 'string', minLength: 1 },
    evjarat: { type: ['number', 'null'] },
    evjarat_statusz: { enum: EVJARAT_STATUSZOK },
    kiszereles_ml: { type: 'number', minimum: 1 },
    darab: { type: 'integer', minimum: 1 },
    csomagolas: { type: 'string' },
    puttony: { type: ['number', 'null'] },
    penznem: { type: 'string', minLength: 1 },
  },
};

const shopAzonositasSchema = {
  type: 'object',
  additionalProperties: true, // shop-id → per-shop azonosítási adatok (a konkurens neve/megjegyzés)
};

// --- Termék konfig séma ---
const termekSchema = {
  type: 'object',
  required: ['id', 'nev', 'marka', 'tipus', 'meret'],
  additionalProperties: true, // a legacy mezők (fajta, evjarat, radovin_slug…) megmaradnak rollback célból
  properties: {
    id: { type: 'string', minLength: 1 },
    nev: { type: 'string', minLength: 1 },
    marka: { type: 'string', minLength: 1 },
    tipus: { type: 'string', minLength: 1 },
    meret: { type: 'string', minLength: 1 },
    aktiv: { type: 'boolean' },
    azonositas: azonositasSchema,
    shop_azonositas: shopAzonositasSchema,
  },
};

const ajv = new Ajv({ allErrors: true, strict: false });
const shopVal = ajv.compile(shopSchema);
const termekVal = ajv.compile(termekSchema);

// Egy `adat` objektum hibáinak emberi olvasású listája.
function hibak2szoveg(valid, errors) {
  if (valid) return [];
  return (errors || []).map((e) => `${e.instancePath || '/'} ${e.message || ''}`.trim());
}

// Shop-konfiguráció validálása. Hiba → dob. Visszaad: a shopok listája.
function ellenorizShopok(cfg) {
  const shopok = (cfg && Array.isArray(cfg.shopok)) ? cfg.shopok : [];
  if (!shopok.length) throw new Error('Invalid shopok.json: nincs "shopok" tömb.');
  const idSet = new Set();
  for (const s of shopok) {
    const ok = shopVal(s);
    if (!ok) {
      const h = hibak2szoveg(ok, shopVal.errors);
      throw new Error(`Érvénytelen shop (${s && s.id}): ${h.join('; ')}`);
    }
    if (idSet.has(s.id)) throw new Error(`Duplikált shop-id: ${s.id}`);
    idSet.add(s.id);
    // Only ACTIVE shops actually run – their adapter must be a known/implemented one.
    // Blocked/pending shops are not executed, so their `adapter` field may hold a
    // future/planned adapter name (e.g. "headless-kell") without failing the run.
    if (s.statusz === 'active' && !ISMERETT_ADAPTEREK.includes(s.adapter)) {
      throw new Error(`Ismeretlen adapter a(z) "${s.id}" ACTIVE shopnál: ${s.adapter}`);
    }
  }
  return shopok;
}

// Termék-konfig validálása. Hiba → dob. Visszaad: a termékek listája.
function ellenorizTermekek(cfg) {
  const termekek = (cfg && Array.isArray(cfg.termekek)) ? cfg.termekek : [];
  if (!termekek.length) throw new Error('Invalid termekek.json: nincs "termekek" tömb.');
  const idSet = new Set();
  for (const t of termekek) {
    const ok = termekVal(t);
    if (!ok) {
      const h = hibak2szoveg(ok, termekVal.errors);
      throw new Error(`Érvénytelen termék (${t && t.id}): ${h.join('; ')}`);
    }
    if (idSet.has(t.id)) throw new Error(`Duplikált termék-id: ${t.id}`);
    idSet.add(t.id);

    // Ha az `azonositas` blokk jelen van, annak szigorúan a Commit 3 sémának kell
    // megfelelnie (additionalProperties:false → tiltott mező = hiba).
    if (t.azonositas !== undefined && !ajv.validate(azonositasSchema, t.azonositas)) {
      const h = hibak2szoveg(true, ajv.errors);
      throw new Error(`Érvénytelen azonositas a(z) "${t.id}" terméknél: ${h.join('; ')}`);
    }
  }
  return termekek;
}

// A config mappából betölti és validálja mindkét konfigurációt.
function betoltEgesz() {
  const shopokRaw = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'shopok.json'), 'utf8'));
  const termekekRaw = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'termekek.json'), 'utf8'));
  const shopok = ellenorizShopok(shopokRaw);
  const termekek = ellenorizTermekek(termekekRaw);
  return { shopok, termekek };
}

module.exports = {
  ellenorizShopok,
  ellenorizTermekek,
  betoltEgesz,
  azonositasSchema,
  shopAzonositasSchema,
  EVJARAT_STATUSZOK,
};
