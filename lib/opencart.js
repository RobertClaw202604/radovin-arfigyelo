// Radovin árfigyelő – OpenCart platform adapter (headless NÉLKÜL).
//
// A Borkell (borkell.hu) OpenCart-alapú bolt, a „ishi” témával. A kategória- és
// borászata-oldalak (`/{seo-slug}?page=N`) statikus HTML-ben listázzák a termékeket:
//   <div class="product-layout ...">
//     ... <h4><a href="https://borkell.hu/<slug>">TERMÉKNÉV</a></h4>
//     ... <p class="price"> 4&nbsp;990 Ft </p>
// ...minden sima GET-tel. Így NEM kell headless böngésző.
//
// A Borkell katalógusa borászatokra (márkákra) van szervezve: `/boraszatok/magyar/<slug>`
// (magyar pincészetek) és `/boraszatok/kulfoldi/<slug>` (külföldi), plusz átfogó
// kategóriák (`/borok`, `/pezsgok`, stb.). A konfig `kategoria_slugek` listája határozza
// meg, mely oldalakat lapozzuk végig. Az árfigyelő a saját 58-termékes listájánk
// („több boltban kapható tételek”) szempontjából a borászat-oldalak a leghasznosabbak,
// mert márkánként adják az összes tételt.
//
// Ez a guide §10 adapterrendje szerinti 3. szint (statikus HTML / data-attribútum),
// nem headless. A kinyert {nev, ar, url} listát a strict matcher-v2-vel szűrjük a
// pontos (jóváhagyott) találatra – soha nem hamis ár.

const { selectExactCandidate } = require('./domain/matcher-v2.js');
const { candidate } = require('./domain/candidate.js');

// Futás-szintű cache: a katalógust futásonként egyszer töltjük le.
let katalogusCache = null;
let katalogusCacheKulcs = '';

function cacheKulcs(shop) {
  return (shop.base_url || '') + '|' + (shop.kategoria_slugek || []).join(',') + '|' + (shop.kategoria_max_lap || 15);
}

// HTML-entitások visszaalakítása a nyers szövegből (OpenCart &nbsp;-t és más
// entitásokat is használ az árakban/nevekben).
function dekodol(szov) {
  return String(szov || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&ndash;/g, '–')
    .replace(/&eacute;/g, 'é').replace(/&aacute;/g, 'á').replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó').replace(/&ouml;/g, 'ö')
    .replace(/&uacute;/g, 'ú').replace(/&uuml;/g, 'ü')
    .replace(/&plusmn;/g, '±');
}

// Egy terméklayout-blokkból kinyeri a {nev, ar, url} hármast.
// OpenCart (ishi) struktúra:
//   <div class="product-layout product-grid ...">
//     <div class="product-thumb transition">
//       <div class="image"><a href="https://borkell.hu/<slug>"><img ...></a></div>
//       <div class="caption">
//         <h4><a href="https://borkell.hu/<slug>">TERMÉKNÉV</a></h4>
//         <p class="description">...</p>
//         <p class="price"> 4&nbsp;990 Ft </p>
//       </div>
//       ...
function layoutSor(seg, shop) {
  // URL: a termék-oldal SEO-URL-je (a név h4-linkelésével azonos)
  const urlM = seg.match(/href="(https?:\/\/(?:[^\/]+\/)?[a-z0-9][a-z0-9-_]*(?:\/[a-z0-9][a-z0-9-_]*)*)"/i);
  // Terméknév: a h4 tartalmazza a pontos nevet
  const nameM = seg.match(/<h4><a[^>]*>([\s\S]*?)<\/a><\/h4>/i);
  const nev = nameM ? dekodol(nameM[1]).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
  // Ár: a `<p class="price">` blokkból (az OpenCart az árat &nbsp;-vel írja, ezért
  // előbb dekódolunk, hogy a „4 990” / „4290” egész számként legyen kinyerhető).
  const priceM = seg.match(/<p class="price">([\s\S]*?)<\/p>/i);
  const arSzov = priceM ? dekodol(priceM[1]).replace(/<[^>]+>/g, ' ') : '';
  const arM = arSzov.match(/(\d[\d\s.,]*)\s*Ft/);
  const ar = arM ? parseInt(arM[1].replace(/[\s.,\u00a0]/g, ''), 10) : null;
  if (nev && urlM && ar > 0) {
    return { nev, ar, url: urlM[1] };
  }
  return null;
}

// Kinyeri az {nev, ar, url} párokat egy OpenCart lista HTML-jéből.
function sorok(html, shop) {
  const out = [];
  const parts = String(html).split(/<div class="product-layout/i);
  for (let i = 1; i < parts.length; i++) {
    const sor = layoutSor(parts[i], shop);
    if (sor) out.push(sor);
  }
  return out;
}

// ASCII-ra tisztított User-Agent (a fetch ByteString-je miatt kötelező).
function asciiUa(raw) {
  return String(raw || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]/g, '');
}

async function kategoriaTele(shop, cfg) {
  const kulcs = cacheKulcs(shop);
  if (katalogusCache && katalogusCacheKulcs === kulcs) return katalogusCache;
  const ua = asciiUa(cfg.ua);
  const katLista = (shop.kategoria_slugek || []).length ? shop.kategoria_slugek : ['/borok'];
  const perLap = shop.kategoria_max_lap || 15;
  const osszes = [];
  for (const kat of katLista) {
    for (let page = 1; page <= perLap; page++) {
      const url = `${shop.base_url}${/^\//.test(kat) ? kat : '/' + kat}?page=${page}`;
      let r;
      try {
        r = await fetch(url, {
          headers: { 'User-Agent': ua, 'Accept-Language': 'hu-HU' },
          signal: AbortSignal.timeout((cfg.timeout_sec || 25) * 1000),
          redirect: 'follow',
        });
      } catch (e) { break; }
      if (!r.ok) break;
      const html = await r.text();
      const kartya = sorok(html, shop);
      if (!kartya.length) break;
      const uj = kartya.filter((x) => !osszes.some((o) => o.url === x.url));
      osszes.push(...uj);
      if (kartya.length < perLap) break; // utolsó oldal
    }
  }
  const vegso = [...new Map(osszes.map((x) => [x.url, x])).values()];
  katalogusCache = vegso;
  katalogusCacheKulcs = kulcs;
  return vegso;
}

async function opencart(termek, shop, cfg) {
  try {
    const katalogus = await kategoriaTele(shop, cfg);
    if (!katalogus.length) {
      return { ok: false, shop: shop.id, termek: termek.id, hiba: 'ures_katalogus', talalat: null, talalatok: [] };
    }

    // KIMENETI MATCHER: strict matcher-v2 (csak a pontosan egyező, jóváhagyott bor).
    const jeloltek = katalogus.map((row) => candidate({
      shopId: shop.id,
      shopProductId: row.url,
      name: row.nev,
      url: row.url,
      price: row.ar,
      currency: 'HUF',
      extractor: 'opencart',
      availability: 'in_stock',
    }));
    const elbiralas = selectExactCandidate(jeloltek, termek, shop.id);

    if (elbiralas.status === 'matched' && elbiralas.selected) {
      const tal = elbiralas.selected;
      return {
        ok: true,
        shop: shop.id,
        termek: termek.id,
        talalat: { nev: tal.name || tal.nev, ar: tal.price, url: tal.url || shop.base_url, megjegyzes: 'via OpenCart katalógus (statikus HTML, strict matcher-v2)' },
        talalatok: katalogus,
      };
    }
    return {
      ok: false,
      shop: shop.id,
      termek: termek.id,
      hiba: elbiralas.status === 'needs_review' ? 'nincs_jovahagyott_referencia' : 'nincs_pontos_talalat',
      talalat: null,
      talalatok: katalogus,
      matcher: { status: elbiralas.status },
    };
  } catch (e) {
    return { ok: false, shop: shop.id, termek: termek.id, hiba: 'opencart_hiba:' + (e.message || '').slice(0, 80), talalat: null, talalatok: [] };
  }
}

module.exports = { opencart, sorok, layoutSor, dekodol };
