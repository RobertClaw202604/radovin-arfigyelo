// Radovin árfigyelő – ShopRenter platform adapter (headless NÉLKÜL).
//
// A Veritas (borkereskedes.hu), Borkell (borkell.hu) és más magyar borkereskedők
// ShopRenter próbaként statikus HTML-ben renderelik a katalógusukat: a kategória-
// listákon (`/{kategoria}?page=N`) a termékkártyák (`<div class="card product-card">`)
// tartalmazzák a termékNEVET (title/alt), az ÁRAT (`... Ft`) és a TELJES termék-URL-t,
// mind sima GET-tel. Így NEM kell headless böngésző, a szigorú matcherrel (márka +
// kiszerelés + puttony + évjárat) szelektáljuk a pontos találatot.
//
// Ez a guide §10 adapterrendje szerinti 3. szint (statikus HTML / data-attribútum),
// nem a headless (4-5. szint). A korábbi `pending`/headless jelzés téves volt – a
// ShopRenter kategórialisták sima GET-tel is megbízható árt adnak.
//
// A kinyert {nev, ar, url} listát a szigorú matcherrel szűrjük a legjobb pontos
// találatra (azonos logika, mint a borhalo adapternél).

const { selectExactCandidate } = require('./domain/matcher-v2.js');
const { candidate } = require('./domain/candidate.js');

// Futás-szintű cache: a katalógust futásonként egyszer töltjük le, nem termékenként.
let katalogusCache = null;
let katalogusCacheKulcs = '';

function cacheKulcs(shop) {
  return (shop.base_url || '') + '|' + (shop.kategoria_slugek || []).join(',') + '|' + (shop.kategoria_max_lap || 12);
}

// HTML-entitás + shop-specifikus zaj visszaalakítása a terméknévből.
// A ShopRenter kártya-név végén gyakran a bolt neve/szuffix van (pl.
// „ | Veritas Online Store”, „-Whisky-Veritas Webshop”, „- borkereskedes.hu”),
// és &#039; / &quot; entitások – ezeket levágjuk/visszaalakítjuk, hogy a matcher
// pontosan illeszkedjen.
function tisztitNev(nyers, shop) {
  let nev = String(nyers || '');
  // entitások
  nev = nev
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&ndash;/g, '–')
    .replace(/&eacute;/g, 'é').replace(/&aacute;/g, 'á').replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó').replace(/&ouml;/g, 'ö').replace(/&otilde;/g, 'õ')
    .replace(/&uacute;/g, 'ú').replace(/&uuml;/g, 'ü').replace(/&oelig;/g, 'œ')
    .replace(/&plusmn;/g, '±');
  // A ShopRenter kártya-név végén a bolt-márka szuffix („ | Veritas Online Store”,
  // „-Whisky-Veritas Webshop”, „Jim Beam Black  Whiskey-Veritas borwebshop”,
  // „ - Veritas - borkereskedes.hu”). A márka-token (Veritas|borkereskedes|borwebshop|
  // Webshop|Online Store|Online Kert) sosem része a terméknévnek, ezért az ELSŐ
  // márka-token jelentésénél az az elõtte álló utolsó elválasztótól (|, –, - ) vágunk,
  // hogy a valódi terméknevet megtartsuk.
  const BRAND = /(?:Veritas|borkereskedes|borwebshop|Webshop|Online\s?Store|Online\s?Kert)/i;
  const m = nev.match(BRAND);
  if (m) {
    const idx = m.index;
    const cut = [nev.lastIndexOf('|', idx), nev.lastIndexOf('–', idx), nev.lastIndexOf('- ', idx)]
      .reduce((a, b) => Math.max(a, b), -1);
    nev = cut >= 0 ? nev.slice(0, cut) : nev.slice(0, idx);
  }
  // maradék szélek takarítása
  return nev.replace(/[\s|–-]+$/g, '').trim();
}

// Egy termékkártyából kinyeri a {nev, ar, url} hármast.
// A kártya szerkezete (ShopRenter, pl. Veritas):
//   <div class="card product-card h-100 ...">
//     <a href="https://www.borkereskedes.hu/<slug>" ...>
//       <img ... title="<TERMÉKNÉV> | borkereskedes.hu" alt="...">
//     </a>
//     ... <span class="price">...<N> Ft</span>
function kartyaSor(seg, shop) {
  const urlM = seg.match(/href="(https:\/\/[^"]+\/(?:termek\/)?[a-z0-9-]+)"/i);
  const url = urlM ? urlM[1] : null;
  // terméknév: először a title/alt (a kép/tartalom attribútuma), ami a valódi nevet adja
  const nameM = seg.match(/(?:title|alt)="([^"]{3,110})"/);
  const nev = nameM ? tisztitNev(nameM[1], shop) : null;
  // ár: az első „<szám> Ft” minta a kártyán (lehet akciós + rendes ár – az első a legrelevánsabb)
  const arM = seg.match(/([0-9][0-9\s.]{2,9})\s*Ft/i);
  const ar = arM ? parseInt(arM[1].replace(/[\s.]/g, ''), 10) : null;
  if (nev && url && ar > 0) {
    return { nev, ar, url };
  }
  return null;
}

// Kinyeri az {nev, ar, url} párokat egy kategórialista HTML-jéből.
function sorok(html, shop) {
  const out = [];
  // A termékkártyákat a nyitó `<div class="card product-card"-en` vágjuk szét.
  // (A product-card osztály a kártyán belül is többször szerepel, ezért a
  // szétvágás után minden szegmens egy-egy kártya body-ját adja.)
  const parts = String(html).split(/<div class="card product-card/i);
  for (let i = 1; i < parts.length; i++) {
    const sor = kartyaSor(parts[i], shop);
    if (sor) out.push(sor);
  }
  return out;
}

// Végiglapozza a konfigurált kategóriákat (futásonként egyszer, cache-elve).
// Biztonsági: a User-Agent HTTP fejlécnek ASCII-nak (/Latin-1) kell lennie.
// Ha egy shop-konfig UA-ja ékezetes karaktert tartalmaz (pl. ő, á), a fetch hibát dob;
// transliteráljuk, hogy az adapter mindig érvényes fejlécet küldjön.
function asciiUa(raw) {
  return String(raw || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // ékezet levágása
    .replace(/[^\x00-\x7F]/g, '');   // bármilyen maradék nem-ASCII kidobása
}

async function kategoriaTele(shop, cfg) {
  const kulcs = cacheKulcs(shop);
  if (katalogusCache && katalogusCacheKulcs === kulcs) {
    return katalogusCache;
  }
  const ua = asciiUa(cfg.ua);
  const katLista = (shop.kategoria_slugek || []).length
    ? shop.kategoria_slugek
    : ['borok/magyar-borok'];
  const osszes = [];
  for (const kat of katLista) {
    let lapMeret = null; // a kategória tényleges oldalmérete (első lappal derül ki)
    for (let page = 1; page <= (shop.kategoria_max_lap || 10); page++) {
      const url = `${shop.base_url}/${kat.replace(/^\/+/, '')}?page=${page}`;
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
      // majd csak utána döntünk a továbblépésről: ha a megfigyelt oldalméret alatt van
      // (azaz nem tele), ez az utolsó oldal. Régen fix 40/oldal volt feltételezve,
      // ami a kisebb (pl. 12/lap) ShopRenter-boltoknál az 1. oldal után megállt.
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

async function shoprenter(termek, shop, cfg) {
  try {
    const katalogus = await kategoriaTele(shop, cfg);
    if (!katalogus.length) {
      return { ok: false, shop: shop.id, termek: termek.id, hiba: 'ures_katalogus', talalat: null, talalatok: [] };
    }

    // KIMENETI MATCHER: strict matcher-v2 (Szabolcs „csak a pontosan egyező borok").
    // A legacy szigor() helyett a típusos `selectExactCandidate` dönt, mely kizárólag a
    // MINDEN kötelező kapun (márka, tétel/változat, évjárat, kiszerelés, darab, csomagolás,
    // puttony, pénznem, jóváhagyott referencia) átjutott jelöltet adja MATCHED-ként. Minden
    // más (no_exact_match / needs_review / ambiguous_match / mapping_drift) NEM termel árat.
    // Lásd: lib/domain/matcher-v2.js + RADOVIN_SYSTEM_IMPROVEMENT_GUIDE.md §7.
    const jeloltek = katalogus.map((row) => candidate({
      shopId: shop.id,
      shopProductId: row.url, // a ShopRenter tételelem URL-je (a jóváhagyott azonosító a shop_azonositas-ban)
      name: row.nev,
      url: row.url,
      price: row.ar,
      currency: 'HUF',
      extractor: 'shoprenter',
      availability: 'in_stock',
    }));
    const elbiralas = selectExactCandidate(jeloltek, termek, shop.id);

    if (elbiralas.status === 'matched' && elbiralas.selected) {
      const tal = elbiralas.selected;
      return {
        ok: true,
        shop: shop.id,
        termek: termek.id,
        talalat: { nev: tal.name || tal.nev, ar: tal.price, url: tal.url || shop.base_url, megjegyzes: 'via ShopRenter katalógus (statikus HTML, strict matcher-v2)' },
        talalatok: katalogus,
      };
    }

    // Nincs PONTOS (jóváhagyott/érvényes) találat → NEM adunk árat (never-false-price).
    // A teljes kinyert katalógust azért továbbadjuk, hogy minden konkrét termék megmaradjon.
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
    return { ok: false, shop: shop.id, termek: termek.id, hiba: 'shoprenter_hiba:' + (e.message || '').slice(0, 80), talalat: null, talalatok: [] };
  }
}

module.exports = { shoprenter, sorok, kartyaSor, tisztitNev, kategoriaTele };
