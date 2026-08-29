// Radovin árfigyelő – scraper könyvtár
// Per-shop adapterekkel: lekéri a terméket a shop keresőjén, kinyeri az árat, normalizál.
// Radovin: WooCommerce JSON-LD (stabil). Konkurensek: szövegkörnyezet-alapú, legjobb erőfeszítés.

const { num } = require('./utils.js');
const { fetchTimeout } = require('./utils.js');

const UA = 'RadovinArfigyelo/1.0 (+github.com/RobertClaw202604)';

// ---------- Radovin (WooCommerce, JSON-LD) ----------
async function radovin(termek, shop, cfg) {
  const q = encodeURIComponent(termek.radovin_kereso || termek.nev);
  const searchUrl = shop.kereso_url.replace('{q}', q);
  const html = await fetchTimeout(searchUrl, cfg.timeout_sec * 1000, UA);
  if (!html) return { ok: false, shop: shop.id, hiba: 'kereso_nem_elerheto' };

  const slugs = [...html.matchAll(/radovin\.hu\/termek\/([a-z0-9-]+)/g)]
    .map((m) => m[1])
    .filter((s, i, a) => a.indexOf(s) === i);

  const talalatok = [];
  for (const slug of slugs.slice(0, 5)) {
    const pu = `https://radovin.hu/termek/${slug}/`;
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

// ---------- Általános HTML adapter (konkurensek) ----------
// A termék nevét tartalmazó szövegkörnyezetben keressük az árat, nem az egész oldalról.
async function htmlSimples(termek, shop, cfg) {
  const q = encodeURIComponent(termek.radovin_kereso || termek.nev);
  const searchUrl = shop.kereso_url.replace('{q}', q);
  const html = await fetchTimeout(searchUrl, cfg.timeout_sec * 1000, UA);
  if (!html) return { ok: false, shop: shop.id, hiba: 'kereso_nem_elerheto' };

  // Kulcsszavak a találat szűréséhez
  const kulcsszavak = (termek.nev + ' ' + (termek.marka || '')).toLowerCase()
    .split(/[^a-z0-9éáíóöőúüűãæëç]+/).filter((w) => w.length > 2);

  // 1) JSON-LD termékadatok (a legszabatosabb)
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

  // legjobb JSON-LD találat kulcsszó-egyezéssel
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

  // 2) Szövegkörnyezet-alapú: keressünk minden Ftot, és a terméknevet tartalmazó blokk közelében az árat
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
      bestCtx = {
        nev: nevMr ? nevMr[1].trim() : termek.nev,
        ar,
        url: searchUrl,
        forras: 'kontextus',
      };
    }
  }
  if (bestCtx) {
    return { ok: true, shop: shop.id, termek: termek.id, talalatok: [], talalat: bestCtx };
  }

  // 3) Nincs megbízható találat
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

function legjobbTalalat(talalatok, termek) {
  if (!talalatok.length) return null;
  const kulcsszavak = termek.nev.toLowerCase().split(/[^a-z0-9éáíóöőúüűãæëç]+/).filter((w) => w.length > 2);
  let best = null;
  let bestScore = 0;
  for (const t of talalatok) {
    const n = (t.nev || '').toLowerCase();
    let score = 0;
    for (const k of kulcsszavak) if (n.includes(k)) score++;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
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
          return await radovin(termek, shop, cfg);
        case 'html-simon':
          return await htmlSimples(termek, shop, cfg);
        default:
          return { ok: false, shop: shop.id, termek: termek.id, hiba: 'nincs_adapter', talalat: null };
      }
    } catch (e) {
      return { ok: false, shop: shop.id, termek: termek.id, hiba: 'hiba:' + (e.message || 'ismeretlen'), talalat: null };
    }
  },
};
