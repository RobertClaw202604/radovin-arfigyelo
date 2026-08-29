// Radovin árfigyelő – scraper könyvtár
// Per-shop adapterekkel: lekéri a terméket a shop keresőjén, kinyeri az árat, normalizál.
//
// Adapterrepertoár (kinyerési módok):
//   - woocommerce   : WooCommerce JSON-LD (`/?s=` kereső + termékoldal JSON-LD price) – Radovin, Winehub
//   - katlistas     : teljes katalóguslista nyilvános JSON-endpointról (Shopify /products.json,
//                     WooCommerce /wp-json/wc/store/products) + szigorú matcher – Borvilag, Borpiac
//   - shopify       : azonos a katlistas-szal (shopify tipus)
//   - html-simon    : HTML szövegkörnyezet-alapú (megtartva, de kevésbé megbízható)
//   - headless      : böngészős (Puppeteer-core) a JS/AJAX-shopokhoz – Italpark, Veritas (validálás alatt)

const { num, fetchTimeout } = require('./utils.js');
const { headless } = require('./headless.js');
const { katlistas } = require('./katlistas.js');
const { szigor } = require('./matricas.js');

// A legjobbTalat a szigorú matcherre hív; kompatibilitási csomagoló.
function legjobbTalalat(talalatok, termek) {
  return szigor(talalatok, termek);
}

const UA = 'RadovinArfigyelo/1.0 (+github.com/RobertClaw202604)';

// ---------- WooCommerce/JSON-LD adapter (Radovin, Winehub stb.) ----------
// A shop.kereso_url-ből keresi a termék-slugot, majd a termékoldal JSON-LD
// (`@type:Product`, `price`) mezőiből nyeri ki az árat.
async function woocommerce(termek, shop, cfg) {
  const q = encodeURIComponent(termek.radovin_kereso || termek.nev);
  const searchUrl = shop.kereso_url.replace('{q}', q);
  const html = await fetchTimeout(searchUrl, cfg.timeout_sec * 1000, UA);
  if (!html) return { ok: false, shop: shop.id, hiba: 'kereso_nem_elerheto' };

  const host = (shop.base_url || shop.kereso_url).replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
  const escHost = host.replace(/\./g, '\\.');
  const slugRegex = new RegExp(escHost + '\\/termek\\/([a-z0-9-]+)', 'g');
  const slugs = [...html.matchAll(slugRegex)]
    .map((m) => m[1])
    .filter((s, i, a) => a.indexOf(s) === i);

  const protocol = (shop.base_url || shop.kereso_url).startsWith('https') ? 'https' : 'http';
  const talalatok = [];
  for (const slug of slugs.slice(0, 5)) {
    const pu = `${protocol}://${host}/termek/${slug}/`;
    const ph = await fetchTimeout(pu, cfg.timeout_sec * 1000, UA, 300);
    if (!ph) continue;
    const price = extrakcioJsonLd(ph, 'price');
    const nev = extrakcioJsonLd(ph, 'name') || slug;
    if (price != null) {
      talalatok.push({ nev, ar: num(price), url: pu });
    }
    await sleep(cfg.kesleltetes_ms);
  }

  const best = legjobbTalalat(talalatok, termek);
  return { ok: true, shop: shop.id, termek: termek.id, talalatok, talalat: best };
}

// ---------- Általános HTML adapter (konkurensek, kevésbé megbízható) ----------
async function htmlSimples(termek, shop, cfg) {
  const q = encodeURIComponent(termek.radovin_kereso || termek.nev);
  const searchUrl = shop.kereso_url.replace('{q}', q);
  const html = await fetchTimeout(searchUrl, cfg.timeout_sec * 1000, UA);
  if (!html) return { ok: false, shop: shop.id, hiba: 'kereso_nem_elerheto' };

  const kulcsszavak = (termek.nev + ' ' + (termek.marka || '')).toLowerCase()
    .split(/[^a-z0-9éáíóöőúüűãæëç]+/).filter((w) => w.length > 2);

  // JSON-LD találatok
  const ldTermekek = [];
  const ldRegex = /"@type"\s*:\s*"Product"[\s\S]{0,5000}?("name"\s*:\s*"[^"]*"[\s\S]{0,1200}?"price"\s*:\s*"?[0-9.,]+"?)/g;
  let m;
  while ((m = ldRegex.exec(html)) !== null) {
    const nevMr = m[1].match(/"name"\s*:\s*"([^"]*)"/);
    const arMr = m[1].match(/"price"\s*:\s*"?([0-9.,]+)"?/);
    const nev = nevMr ? nevMr[1] : '';
    const ar = arMr ? num(arMr[1]) : null;
    if (ar != null) ldTermekek.push({ nev, ar, url: searchUrl, forras: 'JSON-LD' });
  }

  let bestLd = null, bestLdScore = 0;
  for (const t of ldTermekek) {
    const n = (t.nev || '').toLowerCase();
    let s = 0;
    for (const k of kulcsszavak) if (n.includes(k)) s++;
    if (s > bestLdScore) { bestLdScore = s; bestLd = t; }
  }
  if (bestLd && bestLdScore >= 1) {
    return { ok: true, shop: shop.id, termek: termek.id, talalatok: ldTermekek, talalat: bestLd };
  }

  // Szövegkörnyezet-alapú
  const blokkok = html.split(/<li[\s>]|<article[\s>]|<div class="product|<div class="termek/i);
  let bestCtx = null, bestCtxScore = 0;
  for (const blokk of blokkok) {
    const bl = blokk.toLowerCase();
    let s = 0;
    for (const k of kulcsszavak) if (bl.includes(k)) s++;
    if (s <= 0) continue;
    const arMr = blokk.match(/([0-9][0-9\s.]{2,9})\s*Ft/i);
    const ar = arMr ? num(arMr[1]) : null;
    if (ar != null && s > bestCtxScore) {
      bestCtxScore = s;
      const nevMr = blokk.match(/<h[1-6][^>]*>([^<]{3,90})<\/h[1-6]>/i) ||
                    blokk.match(/<a[^>]*>([^<]{3,90})<\/a>/i);
      bestCtx = { nev: nevMr ? nevMr[1].trim() : termek.nev, ar, url: searchUrl, forras: 'kontextus' };
    }
  }
  if (bestCtx) {
    return { ok: true, shop: shop.id, termek: termek.id, talalatok: [], talalat: bestCtx };
  }

  return { ok: true, shop: shop.id, termek: termek.id, talalatok: [], talalat: null };
}

// ---------- Segédek ----------
function extrakcioJsonLd(html, kulcs) {
  const m = html.match(new RegExp(`"@type":"Product"[\\s\\S]{0,4000}?"${kulcs}":"?([^",}]+)"?`, 'i'));
  if (!m) return null;
  const raw = m[1];
  try {
    return JSON.parse('"' + raw + '"');
  } catch {
    return raw.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  run: async function (termek, shop, cfg) {
    try {
      if (shop.statusz === 'blocked') {
        return { ok: false, shop: shop.id, termek: termek.id, hiba: 'blocked_bot_vedett', talalat: null };
      }
      switch (shop.adapter) {
        case 'woocommerce':
          return await woocommerce(termek, shop, cfg);
        case 'html-simon':
          return await htmlSimples(termek, shop, cfg);
        case 'headless':
          return await headless(termek, shop, cfg);
        case 'katlistas':
        case 'shopify':
        case 'woocommerce-api':
          return await katlistas(termek, shop, cfg);
        default:
          return { ok: false, shop: shop.id, termek: termek.id, hiba: 'nincs_adapter', talalat: null };
      }
    } catch (e) {
      return { ok: false, shop: shop.id, termek: termek.id, hiba: 'hiba:' + (e.message || 'ismeretlen'), talalat: null };
    }
  },
};
