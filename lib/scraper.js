// Radovin árfigyelő – scraper könyvtár
// Per-shop adapterekkel: lekéri a terméket a shop keresőjén, kinyeri az árat, normalizál.
// Radovin: WooCommerce JSON-LD (stabil). Konkurensek: szövegkörnyezet-alapú, legjobb erőfeszítés.

const { num } = require('./utils.js');
const { fetchTimeout } = require('./utils.js');
const { headless } = require('./headless.js');

const UA = 'RadovinArfigyelo/1.0 (+github.com/RobertClaw202604)';

// ---------- WooCommerce/JSON-LD adapter (Radovin, Winehub stb.) ----------
// Az adapter shop-agnosztikus: a shop.kereso_url-ből keresi a termék-slugot,
// majd a termékoldal JSON-LD (`@type:Product`, `price`) mezőiből nyeri ki az árat.
async function woocommerce(termek, shop, cfg) {
  const q = encodeURIComponent(termek.radovin_kereso || termek.nev);
  const searchUrl = shop.kereso_url.replace('{q}', q);
  const html = await fetchTimeout(searchUrl, cfg.timeout_sec * 1000, UA);
  if (!html) return { ok: false, shop: shop.id, hiba: 'kereso_nem_elerheto' };

  // A termék-URL mintája a shop domainjéhez képest (pl. radovin.hu/termek/..., winehub.hu/termek/...)
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

// Ékezet-mentesített lowercase összehasonlításhoz segéd
function norm(s) {
  return (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

// Találat mérete literben (a termék nevéből / méret mezőjéből)
function talalatLiter(n) {
  const m = n.replace(/\s/g, '');
  if (/magnum|double.*magnum/.test(m)) return m.includes('double') ? 3 : 1.5;
  // 0,04l | 0,75l | 075l | 75cl | 05l | 1l | 1,5l
  const lit = m.match(/(\d)[,.]?(\d{1,2})?l/);
  if (lit) {
    if (!lit[2]) return parseFloat(lit[1]); // pl. 1l
    if (lit[1] === '0') return parseFloat('0.' + lit[2]); // pl. 0,75
    if (lit[2].length === 1) return parseFloat(lit[1] + '.' + lit[2]); // pl. 1,5
    return parseFloat(lit[1] + '.' + lit[2]); // pl. 0,75
  }
  const cl = m.match(/(\d+)cl/);
  if (cl) return parseFloat(cl[1]) / 100;
  return null;
}

// A kért méret literben a meret mezőből (pl. '0,75 l' -> 0.75)
function kertLiter(meret) {
  const m = (meret || '').replace(/\s/g, '').replace(',', '.');
  if (m.includes('cl')) { const v = m.match(/(\d+)\.?\d*cl/); if (v) return parseFloat(v[1]) / 100; }
  const v = m.match(/(\d+\.?\d*)l/);
  return v ? parseFloat(v[1]) : null;
}

// Megadott-e puttony-szam a névben, es ha igen, pontosan egyezzen
function puttony(n) {
  const m = n.match(/(\d)\s*puttonyos/);
  return m ? parseInt(m[1], 10) : null;
}

function legjobbTalalat(talalatok, termek) {
  if (!talalatok.length) return null;
  const kulcsszavak = termek.nev.toLowerCase().split(/[^a-z0-9éáíóöőúüűãæëç]+/).filter((w) => w.length > 2);
  const markaNorm = norm(termek.marka);
  const kertPuttony = puttony(norm(termek.nev));
  const kL = kertLiter(termek.meret);

  let best = null;
  let bestScore = -Infinity;
  for (const t of talalatok) {
    const nyers = norm(t.nev);
    const n = nyers.replace(/\s/g, '');
    let score = 0;

    // Márka-követelmény: ha van márka, és nincs benne a találatban, a találat érvénytelen.
    if (markaNorm && !n.includes(markaNorm.replace(/\s/g, ''))) continue;

    for (const k of kulcsszavak) if (n.includes(k)) score++;

    // Puttonyos-egyezés: ha a keresett név puttony-számot tartalmaz, a találat pontos egyezés nélkül
    // erosen buntetett (5 puttonyos <> 6 puttonyos).
    const tPuttony = puttony(n);
    if (kertPuttony != null && tPuttony != null) {
      score += (kertPuttony === tPuttony) ? 3 : -5;
    }

    // Méret-egyezés: ha van kért méret es a talalatnak is van merete, az elteres modulo
    // (a 0.04l-es minta vs 0.5/0.75l nem elfogadható párositas).
    const tL = talalatLiter(nyers);
    if (kL != null && tL != null && kL > 0) {
      const kulonbseg = Math.abs(kL - tL);
      if (kulonbseg < 0.05) score += 2;
      else if (kulonbseg < 0.2) score += 0;
      else score -= 4; // pl. 0.04 vs 0.5, 0.75 vs 1.5
    }

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
          return await woocommerce(termek, shop, cfg);
        case 'html-simon':
          return await htmlSimples(termek, shop, cfg);
        case 'headless':
          return await headless(termek, shop, cfg);
        default:
          return { ok: false, shop: shop.id, termek: termek.id, hiba: 'nincs_adapter', talalat: null };
      }
    } catch (e) {
      return { ok: false, shop: shop.id, termek: termek.id, hiba: 'hiba:' + (e.message || 'ismeretlen'), talalat: null };
    }
  },
};
