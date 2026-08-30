// Radovin árfigyelő – Unas platform adapter (headless NÉLKÜL).
//
// A Benebor (beneborshop.hu) Unas felületén a kategóri-200 oldalak (`/<kategoria>`)
// statikus HTML-ben renderelik a termékkártyákat: minden kártya tartalmazza a
// termékNEVET (aria-label="...termék: <NÉV>"), az ÁRAT (`price-gross`) és a TELJES
// termék-URL-t (href), sima GET-tel. Így NEM kell headless böngésző; a szigorú
// matcherrel (márka + kiszerelés + puttony + évjárat + jóváhagyott referencia)
// szelektáljuk a pontos találatot.
//
// Ez a guide §10 adapterrendje szerinti 3. szint (statikus HTML / data-attribútum).
// A lapozás Unas-stílusú: `/<slug>,N` (nem `?page=`).
//
// Csak a márkanevét használjuk a strict matcher-v2-re – soha nem adunk hamis árat.

const { selectExactCandidate } = require('./domain/matcher-v2.js');
const { candidate } = require('./domain/candidate.js');

// Húzzuk be a közös asciiUa-t/entitás-dekódolást, de ne függjünk a shoprenter implementációtól.
function asciiUa(raw) {
  return String(raw || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // ékezet levágása
    .replace(/[^\x00-\x7F]/g, '');   // maradék nem-ASCII kidobása
}

function dekodolTxt(s) {
  return String(s || '')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&ndash;/g, '–')
    .replace(/&eacute;/g, 'é').replace(/&aacute;/g, 'á').replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó').replace(/&ouml;/g, 'ö').replace(/&otilde;/g, 'õ')
    .replace(/&uacute;/g, 'ú').replace(/&uuml;/g, 'ü').replace(/&oelig;/g, 'œ')
    .replace(/&plusmn;/g, '±')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// Futás-szintű cache: a katalógust futásonként egyszer töltjük le, nem termékenként.
let katalogusCache = null;
let katalogusCacheKulcs = '';

function cacheKulcs(shop) {
  return (shop.base_url || '') + '|' + (shop.kategoria_slugek || []).join(',') + '|' + (shop.kategoria_max_lap || 12);
}

// Egy termékkártya-szegmensből kinyeri a {nev, ar, url} hármast (Unas).
// A kártya szerkezete (Unas, pl. Benebor):
//   <div ... id="page_artlist_artlist_<sku>" ...>
//     <div class="product__inner" role="group" aria-label="1. termék:<NÉV>">
//       ... <a href="https://beneborshop.hu/<slug>">
//       ... <span class="product__price-base-value"><span class='price-gross'>6 600 Ft</span>
function kartyaSor(seg, shop) {
  // URL: a kártya-konténerben az első teljes termék-URL hivatkozás (pl. .../Vesztergombi-Rose-rose).
  // A fejléc-beneborshop.hu/<kategoria>-linkek a konténer ELŐTT vannak, így a regex a termék-linket kapja.
  const urlM = seg.match(/href="(https:\/\/[^"\s]+\/[A-Za-z0-9\u00C0-\u017F][A-Za-z0-9\u00C0-\u017F-]*)"/i);
  const url = urlM ? urlM[1] : null;
  // Név: az aria-label="...termék: <NÉV>" (az Unas kártya így adja a valódi terméknevet).
  const nameM = seg.match(/(?:aria-label="[^"]*?termék:\s*)([^"]{2,140}?)\s*"/i);
  const nev = nameM ? dekodolTxt(nameM[1]) : null;
  // Ár: az első price-gross (szám) + price-currency („ Ft”) minta:
  //   <span id='...' class='...price-gross'>3 000</span><span class='price-currency'> Ft</span>
  const arM = seg.match(/price-gross['"]?[^>]*>\s*([0-9][0-9\s.]+?)\s*<\/span>\s*<span[^>]*class=['"]price-currency['"][^>]*>\s*Ft/i);
  const ar = arM ? parseInt(arM[1].replace(/[\s.]/g, ''), 10) : null;
  if (nev && url && ar > 0) {
    return { nev, ar, url };
  }
  return null;
}

// Kinyeri az {nev, ar, url} párokat egy Unas kategórialista HTML-jéből.
function sorok(html, shop) {
  const out = [];
  // A termékkártyákat a `page_artlist_artlist_<sku>` konténer nyitójánál vágjuk szét — ez a teljes
  // kártyát (névtől az árig) tartalmazza; a `product__inner` csak a név része (az ár külön blokkban van).
  const parts = String(html).split(/id="page_artlist_artlist_\d+"/i);
  for (let i = 1; i < parts.length; i++) {
    const sor = kartyaSor(parts[i], shop);
    if (sor) out.push(sor);
  }
  return out;
}

// Végiglapozza a konfigurált kategóriákat (futásonként egyszer, cache-elve).
// Az Unas lapozás `/<slug>,N` alakú (nem `?page=`). A leállás az éppeni oldalméretet figyeli
// (akárcsak a shoprenter: amíg egy lap tele van, lapozunk; máskülönben ez az utolsó oldal).
async function kategoriaTele(shop, cfg) {
  const kulcs = cacheKulcs(shop);
  if (katalogusCache && katalogusCacheKulcs === kulcs) {
    return katalogusCache;
  }
  const ua = asciiUa(cfg.ua);
  const katLista = (shop.kategoria_slugek || []).length
    ? shop.kategoria_slugek
    : ['Vesztergombi-Pinceszet'];
  const osszes = [];
  for (const kat of katLista) {
    const katClean = kat.replace(/^\/+/, '');
    let lapMeret = null;
    for (let page = 1; page <= (shop.kategoria_max_lap || 20); page++) {
      const url = page === 1
        ? `${shop.base_url}/${katClean}`
        : `${shop.base_url}/${katClean},${page}`;
      let r;
      try {
        r = await fetch(url, {
          headers: { 'User-Agent': ua, 'Accept-Language': 'hu-HU' },
          signal: AbortSignal.timeout((cfg.timeout_sec || 25) * 1000),
          redirect: 'follow',
        });
      } catch (e) {
        break; // hálózati hiba → hagyjuk ezt a kategóriát
      }
      if (!r.ok) break;
      const html = await r.text();
      const kartyaSorok = sorok(html, shop);
      if (!kartyaSorok.length) break; // utolsó lap / üres
      if (lapMeret === null) lapMeret = kartyaSorok.length;
      // MINDIG betesszük az éppeni lapot (így az utolsó RÉSZLÉGES oldal sem vész el),
      // majd csak utána döntünk a továbblépésről (a megfigyelt oldalméret alapján).
      osszes.push(...kartyaSorok);
      if (kartyaSorok.length < lapMeret) break;
    }
  }
  // dedup (url + ár + név) + cache futás-szinten
  const vegso = [...new Map(osszes.map((x) => [x.url, x])).values()];
  katalogusCache = vegso;
  katalogusCacheKulcs = kulcs;
  return vegso;
}

async function unas(termek, shop, cfg) {
  try {
    const katalogus = await kategoriaTele(shop, cfg);
    if (!katalogus.length) {
      return { ok: false, shop: shop.id, termek: termek.id, hiba: 'ures_katalogus', talalat: null, talalatok: [] };
    }

    // KIMENETI MATCHER: strict matcher-v2 (csak a pontosan egyező borok adnak árat).
    const jeloltek = katalogus.map((row) => candidate({
      shopId: shop.id,
      shopProductId: row.url, // a termék URL-je (a jóváhagyott azonosító a shop_azonositas-ban)
      name: row.nev,
      url: row.url,
      price: row.ar,
      currency: 'HUF',
      extractor: 'unas',
      availability: 'in_stock',
    }));
    const elbiralas = selectExactCandidate(jeloltek, termek, shop.id);

    if (elbiralas.status === 'matched' && elbiralas.selected) {
      const tal = elbiralas.selected;
      return {
        ok: true,
        shop: shop.id,
        termek: termek.id,
        talalat: { nev: tal.name || tal.nev, ar: tal.price, url: tal.url || shop.base_url, megjegyzes: 'via Unas katalógus (statikus HTML, strict matcher-v2)' },
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
    return { ok: false, shop: shop.id, termek: termek.id, hiba: 'unas_hiba:' + (e.message || '').slice(0, 80), talalat: null, talalatok: [] };
  }
}

module.exports = { unas, sorok, kartyaSor, kategoriaTele };
