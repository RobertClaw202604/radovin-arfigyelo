// Radovin árfigyelő – headless (böngészős) adapter a JS-renderelt / AJAX-os shopokhoz.
// A Veritas, Italpark, Borháló, Bortársaság többsége nem ad megbízható árat sima GET-re,
// mert a kereső és/vagy az ár JS-sel / AJAX-szal töltődik be. Ez az adapter Puppeteer-core-
// val (a rendszer Chrome headless-jével) megvárja az oldalbetöltést, kinyeri az első
// termék-URL-t, majd a termékoldalról az árat (JSON-LD / itemprop / selector).

const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function nyitoBongeszo() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=hu-HU'],
  });
}

// Ár kinyerése egy termékoldal text-tartalmából vagy attribútumából.
// Először a szabatos mezőket nézzük: JSON-LD price, itemprop=price, majd selectorok.
async function arKinyeresOldalrol(page, shop) {
  // 1) JSON-LD `@type":"Product" ... "price":N`
  const jsonLdAr = await page.evaluate(() => {
    const re = /"@type"\s*:\s*"Product"[\s\S]{0,5000}?"price"\s*:\s*"?([0-9][0-9.,]*)"?/i;
    const scripts = Array.from(document.querySelectorAll('script[type*="application/ld+json"]'));
    for (const s of scripts) {
      const m = s.textContent.match(re);
      if (m) return m[1];
    }
    return null;
  });
  if (jsonLdAr) {
    try { return { ar: parseFloat(jsonLdAr.replace(',', '.')), mod: 'jsonld' }; } catch {}
  }

  // 2) itemprop="price" content="..."
  const itemprop = await page.evaluate(() => {
    const el = document.querySelector('[itemprop="price"]');
    return el ? (el.getAttribute('content') || el.textContent) : null;
  });
  if (itemprop) {
    const n = parseFloat(String(itemprop).replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, ''));
    if (!isNaN(n)) return { ar: n, mod: 'itemprop' };
  }

  // 3) shop-specifikus selector (ha meg van adva) – pl. .price-act, .product-price--special
  if (shop.ar_selector) {
    const val = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? el.textContent : null;
    }, shop.ar_selector);
    if (val) {
      const n = parseFloat(String(val).replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, ''));
      if (!isNaN(n) && n > 0) return { ar: n, mod: 'selector:' + shop.ar_selector };
    }
  }

  return null;
}

// Az első termék-URL kinyerése a találati oldalról, a termék nevének megfelelően.
async function elsoTermekUrl(page, shop, termek) {
  const kulcsszavak = (termek.nev + ' ' + (termek.marka || '')).toLowerCase()
    .split(/[^a-z0-9éáíóöőúüű]+/).filter((w) => w.length > 2);

  // A teljes találati DOM-ból kiszedjük a termék-kártyákat, és kiválasztjuk a
  // név szerint legjobban illeszkedőt. Így nem csapunk be egy kategoriát / első találatot.
  const kartyaHref = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? el.href : null;
  }, shop.termek_selector);

  // Próba 1: shop-specifikus kártya-link, szöveg alapján szűrve (ha van ilyen selector)
  if (shop.termek_kartya_selector) {
    const val = await page.evaluate((sel, kk) => {
      const kartyak = Array.from(document.querySelectorAll(sel));
      let best = null; let bestScore = 0;
      for (const k of kartyak) {
        const txt = (k.textContent || '').toLowerCase();
        let score = 0;
        for (const kw of kk) if (txt.includes(kw)) score++;
        if (score > bestScore) { bestScore = score; best = k; }
      }
      if (bestScore === 0) return null;
      const a = best.querySelector('a[href]');
      return a ? a.href : best.href || null;
    }, shop.termek_kartya_selector, kulcsszavak);
    if (val) return val;
  }

  // Próba 2: ha van shop-specifikus termék-selector, de szöveg nélkül, csak akkor
  // használjuk, ha az adott selector valódi termékoldalra mutat (ne kategoriára).
  if (kartyaHref) {
    const link = kartyaHref;
    const lekulcsszavak = kulcsszavak;
    // Ha a link kategoriara utal (-rendeles vege, -hu vege, nem termekslug), nem fogadjuk el.
    const vegen = link.replace(/\/+$/, '').split('/').pop() || '';
    const kategoriaJel = /-(rendeles|kereses|webshop)$/.test(vegen) || !link.includes('/');
    if (!kategoriaJel) return link;
  }

  // Próba 3: JSON-LD Product URL
  const jsonLdUrl = await page.evaluate(() => {
    const m = document.documentElement.outerHTML.match(/"@type"\s*:\s*"Product"[\s\S]{0,8000}?"url"\s*:\s*"([^"]+)"/i);
    return m ? m[1] : null;
  });
  if (jsonLdUrl) return jsonLdUrl;

  // Próba 4: az oldal szövegében keressük a terméknévhez illő linket (legjobb egyezés)
  const html = await page.content();
  const osszesLink = Array.from(html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]{0,120}?)<\/a>/gi));
  let bestLink = null; let bestScore = 0;
  for (const m of osszesLink) {
    const href = m[1]; const txt = m[2].replace(/<[^>]+>/g, '').toLowerCase();
    let score = 0;
    for (const kw of kulcsszavak) if (txt.includes(kw)) score++;
    if (score > bestScore) { bestScore = score; bestLink = href; }
  }
  if (bestLink && bestScore >= 1) {
    return bestLink.startsWith('http') ? bestLink : ((shop.base_url || '').replace(/\/$/, '') + bestLink);
  }

  return null;
}

async function headless(termek, shop, cfg) {
  let bongeszo = null;
  try {
    bongeszo = await nyitoBongeszo();
    const page = await bongeszo.newPage();
    await page.setUserAgent(UA);
    await page.setDefaultTimeout((cfg.timeout_sec || 25) * 1000);
    await page.setViewport({ width: 1280, height: 900 });

    const q = encodeURIComponent(termek.radovin_kereso || termek.nev);
    // A kereséshez a shop (a) kereső-URL-t használ, vagy (b) ha van kategoria_url,
    // a MÁRKA szerinti kategóriaoldalt (pl. Italpark: https://x/{marka}-bor), mert
    // ezeknél a shopoknál a sima kereső JS/robotvédelem miatt nem hoz találatot.
    let searchUrl = shop.kereso_url.replace('{q}', q);
    if (shop.kategoria_url && termek.marka) {
      const markaSlug = termek.marka.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      searchUrl = shop.kategoria_url.replace('{marka}', markaSlug);
    }

    // Kereső-oldal: megvárjuk a hálózati csendet (AJAX-eredmények is betöltődnek).
    try {
      await page.goto(searchUrl, { waitUntil: 'networkidle0', timeout: (cfg.timeout_sec || 25) * 1000 });
    } catch {
      // networkidle sokszor sosem jön (pl. folyamatos telemetria); domcontentloaded-re hátrálunk
      try { await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: (cfg.timeout_sec || 25) * 1000 }); }
      catch (e) { return { ok: false, shop: shop.id, termek: termek.id, hiba: 'betoltes_hiba:' + (e.message||'').slice(0,80), talalat: null }; }
    }
    await sleep(cfg.kesleltetes_ms || 1200); // pár mp a JS-eredményre

    let termekUrl = await elsoTermekUrl(page, shop, termek);
    if (!termekUrl && shop.kereso_talalat_regex) {
      const html = await page.content();
      const m = html.match(shop.kereso_talalat_regex);
      if (m) termekUrl = m[1].startsWith('http') ? m[1] : ((shop.base_url||'').replace(/\/$/,'') + m[1]);
    }

    if (!termekUrl) {
      return { ok: false, shop: shop.id, termek: termek.id, hiba: 'nincs_talalat_kereso_oldalon', talalat: null };
    }

    // Termékoldal
    try { await page.goto(termekUrl, { waitUntil: 'networkidle0', timeout: (cfg.timeout_sec || 25) * 1000 }); }
    catch { try { await page.goto(termekUrl, { waitUntil: 'domcontentloaded', timeout: (cfg.timeout_sec || 25) * 1000 }); } catch (e) { return { ok: false, shop: shop.id, termek: termek.id, hiba: 'termekoldal_hiba', talalat: null }; } }
    await sleep(cfg.kesleltetes_ms || 800);

    const nev = (await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return h1 ? h1.textContent.trim() : null;
    })) || termekUrl.split('/').filter(Boolean).pop();

    const arEr = await arKinyeresOldalrol(page, shop);
    if (!arEr || arEr.ar == null || arEr.ar <= 0) {
      return { ok: false, shop: shop.id, termek: termek.id, hiba: 'nincs_ar_a_termekoldalon', talalat: null };
    }

    return {
      ok: true,
      shop: shop.id,
      termek: termek.id,
      talalat: { nev, ar: arEr.ar, url: termekUrl, megjegyzes: 'via böngésző (' + arEr.mod + ')' },
    };
  } catch (e) {
    return { ok: false, shop: shop.id, termek: termek.id, hiba: 'headless_hiba:' + (e.message || '').slice(0, 80), talalat: null };
  } finally {
    if (bongeszo) { try { await bongeszo.close(); } catch {} }
  }
}

module.exports = { headless };
