// Radovin árfigyelő – konfiguráció JSON-Schema validáció (guide §17, P0.5).
//
// Független, deklaratív séma-validáció a shopok.json és termekek.json fájlokon,
// a `config/schemas/*.schema.json` JSON-Schemák alapján (Ajv 2020-12).
// Kiegészítve cross-file ellenőrzéssel: a shop_azonositas kulcsainak létezniük
// kell a shopok.json-ban (guide: 'shop IDs in shop_azonositas must exist in shopok.json').
//
// Ami a séma-alapú validáción túl marad (aktív shop ismeretlen adaptere stb.),
// az a `lib/runtime/config.js` függvényben van; ez a script a sémákat futtatja.
//
// Használat: node scripts/validate-config.js  (vagy npm run validate)

const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file}: invalid JSON: ${error.message}`);
  }
}

function validateFile(dataPath, schemaPath) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(readJson(schemaPath));
  const data = readJson(dataPath);
  if (!validate(data)) {
    const details = validate.errors.map((error) =>
      `${error.instancePath || '/'} ${error.message}`
    ).join('\n');
    throw new Error(`${dataPath} failed schema validation:\n${details}`);
  }
  return data;
}

const root = path.resolve(__dirname, '..');
const shopok = validateFile(
  path.join(root, 'config/shopok.json'),
  path.join(root, 'config/schemas/shopok.schema.json')
);
const termekek = validateFile(
  path.join(root, 'config/termekek.json'),
  path.join(root, 'config/schemas/termekek.schema.json')
);

// --- Cross-file: shop_azonositas kulcsok a shopok.json-ban (guide §17) ---
const shopIds = new Set((shopok.shopok || []).map((s) => s.id));
const hibas = [];
for (const t of (termekek.termekek || [])) {
  const shopAz = t.shop_azonositas || {};
  for (const shopId of Object.keys(shopAz)) {
    if (!shopIds.has(shopId)) {
      hibas.push(`termék "${t.id}" shop_azonositas "${shopId}" nincs a shopok.json-ban`);
    }
  }
}
if (hibas.length) {
  throw new Error(`cross-file validáció hibás:\n${hibas.join('\n')}`);
}

console.log('Configuration is valid. (shopok + termekek séma + cross-file)');
