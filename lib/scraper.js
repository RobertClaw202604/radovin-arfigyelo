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
const { borhalo } = require('./borhalo.js');
const { szigor } = require('./matricas.js');
const { RESULT_STATUS } = require('./domain/status.js');
const { candidate } = require('./domain/candidate.js');

// A legjobbTalat a szigorú matcherre hív; kompatibilitási csomagoló.
function legjobbTalalat(talalatok, termek) {
  return szigor(talalatok, termek);
}

const UA = 'RadovinArfigyelo/1.0 (+github.com/RobertClaw202604)';

// ---------- WooCommerce/JSON-LD adapter (Radovin, Winehub stb.) ----------
// A shop.kereso_url-ből keresi a termék-slugot, majd a termékoldal JSON-LD
// (`@type:Product`, `price`) mezőiből nyeri ki az árat.
async function woocommerce(termek, shop, cfg) {
  // Ha a terméknek van radovin_slug-ja, KÖZVETLENÜL a termékoldalról vesszük az árat
  // (nem a törékeny /?s= keresőn át) – pontosabb és gyorsabb.
  if (termek.radovin_slug) {
    const host = (shop.base_url || shop.kereso_url).replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
    const protocol = (shop.base_url || shop.kereso_url).startsWith('https') ? 'https' : 'http';
    const pu = `${protocol}://${host}/termek/${termek.radovin_slug}/`;
    const ph = await fetchTimeout(pu, cfg.timeout_sec * 1000, UA, 300);
    if (ph) {
      const ar = num(extrakcioJsonLd(ph, 'price'));
      const nev = extrakcioJsonLd(ph, 'name') || termek.radovin_slug;
      if (ar != null) {
        const talalat = { nev, ar, url: pu };
        return { ok: true, shop: shop.id, termek: termek.id, talalatok: [talalat], talalat };
      }
    }
  }
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

// ---------- Commit 4: explicit státusz-térkép + típusos jelölt-normalizáció ----------

// Hibaüzenet → RESULT_STATUS térkép (source failure vs no exact match szétválasztása).
function statusFromHiba(hiba) {
  if (!hiba) return RESULT_STATUS.NO_EXACT_MATCH;
  const h = String(hiba).toLowerCase();
  if (h.includes('blocked')) return RESULT_STATUS.BLOCKED;
  if (h.includes('timeout') || h.includes('timed out') || h.includes('időtúllép')) return RESULT_STATUS.TIMEOUT;
  if (h.includes('parse') || h.includes('nonexact') || h.includes('hiba')) return RESULT_STATUS.PARSE_ERROR;
  if (h.includes('adapter')) return RESULT_STATUS.CONFIG_ERROR;
  return RESULT_STATUS.SOURCE_UNAVAILABLE;
}

// Adapter-eredmény (hiba/talalat megléte) → explicit statusz.
// kulcsszabály: ha VAN találat+ár, akkor matched; ha NINCS, nézzük, technikai kudarc-e
// (source_unavailable) vagy valódi no_exact_match. így a UI sosem értelmezi a
// technikai hibát piaci tényként.
function stateFromResult(r) {
  if (!r) return RESULT_STATUS.SOURCE_UNAVAILABLE;
  if (r.status) return r.status; // adapter már explicit státuszt adott
  if (r.ok === false || r.hiba) return statusFromHiba(r.hiba);
  if (r.talalat && r.talalat.ar != null) return RESULT_STATUS.MATCHED;
  return RESULT_STATUS.NO_EXACT_MATCH;
}

// A nyers talalatlista → típusos candidate-normalizáció (Commit 4).
// A legacy {nev, ar, url} alakból épít Candidate-t; a matcherhez NEM nyúl hozzá.
function normalizeCandidates(r, shop, termek) {
  const candidates = [];
  if (!r || !Array.isArray(r.talalatok)) return candidates;
  for (const t of r.talalatok) {
    if (!(t && t.url && t.ar != null)) continue;
    try {
      candidates.push(candidate({
        shopId: shop.id,
        name: t.nev || termek.nev,
        url: t.url,
        price: t.ar,
        currency: 'HUF',
        extractor: shop.adapter || 'unknown',
      }));
    } catch {
      // érvénytelen jelöltet nem szúrunk be
    }
  }
  return candidates;
}

module.exports = {
  run: async function (termek, shop, cfg, katalogusCache) {
    try {
      if (shop.statusz === 'blocked') {
        return { ok: false, shop: shop.id, termek: termek.id, hiba: 'blocked_bot_vedett', talalat: null, status: RESULT_STATUS.BLOCKED };
      }
      let res;
      switch (shop.adapter) {
        case 'woocommerce':
          res = await woocommerce(termek, shop, cfg);
          break;
        case 'html-simon':
          res = await htmlSimples(termek, shop, cfg);
          break;
        case 'headless':
          res = await headless(termek, shop, cfg);
          break;
        case 'borhalo':
          res = await borhalo(termek, shop, cfg);
          break;
        case 'katlistas':
        case 'shopify':
        case 'woocommerce-api':
          res = await katlistas(termek, shop, cfg, katalogusCache);
          break;
        default:
          return { ok: false, shop: shop.id, termek: termek.id, hiba: 'nincs_adapter', talalat: null, status: RESULT_STATUS.CONFIG_ERROR };
      }
      // Commit 4: explicit státusz + típusos jelöltek. A legacy mezőket érintetlenül
      // hagyjuk (a matcher / run.js kompatibilitás miatt), csak kiegészítjük őket.
      return {
        ...res,
        status: stateFromResult(res),
        candidates: normalizeCandidates(res, shop, termek),
      };
    } catch (e) {
      return { ok: false, shop: shop.id, termek: termek.id, hiba: 'hiba:' + (e.message || 'ismeretlen'), talalat: null, status: RESULT_STATUS.PARSE_ERROR };
    }
  },
  // teszt-helperek
  _test: { stateFromResult, normalizeCandidates, statusFromHiba },
};
