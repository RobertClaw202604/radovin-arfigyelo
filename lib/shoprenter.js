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

const { szigor } = require('./matricas.js');

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
      osszes.push(...kartyaSorok);
      if (kartyaSorok.length < 40) break; // nincs több oldal (40/oldal)
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
    // Kétmenetes match (guide §6/Commit 3 „human approval record” + §7 never-false-price):
    //  1. passz: a meglévő, megbízható szigor() (márka + pontos fajta + évjárat + puttony).
    //  2. passz: ha nincs találat, de a termék rendelkezik PER-SHOP jóváhagyott tétel-aliasokkal
    //     (`termek.shop_azonositas[shop.id].elfogadott_tetel_aliasok`), akkor azokkal – a fajta-gát
    //     enyhítése, de a márka + HARD kiszerelés + évjárat + puttony gátak MEGŐRIZVE – szigorúan.
    //   Alias hiányában NEM keresünk laza párt: a találat would-be no_match marad.
    let tal = szigor(katalogus, termek);
    if (!tal) {
      const shopAz = termek.shop_azonositas && termek.shop_azonositas[shop.id];
      const aliasok = (shopAz && Array.isArray(shopAz.elfogadott_tetel_aliasok))
        ? shopAz.elfogadott_tetel_aliasok
        : null;
      if (aliasok && aliasok.length) {
        tal = szigor(katalogus, termek, { tetel_aliasok: aliasok });
      }
    }
    // A teljes kinyert katalógust is továbbadjuk a termékgyűjtőnek (név+ár+url),
    // hogy minden konkrét termék megmaradjon, akkor is ha nem párosítható.
    if (!tal) {
      return { ok: false, shop: shop.id, termek: termek.id, hiba: 'nincs_pontos_talalat', talalat: null, talalatok: katalogus };
    }
    return {
      ok: true,
      shop: shop.id,
      termek: termek.id,
      talalat: { nev: tal.nev, ar: tal.ar, url: tal.url || shop.base_url, megjegyzes: 'via ShopRenter katalógus (statikus HTML)' },
      talalatok: katalogus,
    };
  } catch (e) {
    return { ok: false, shop: shop.id, termek: termek.id, hiba: 'shoprenter_hiba:' + (e.message || '').slice(0, 80), talalat: null, talalatok: [] };
  }
}

module.exports = { shoprenter, sorok, kartyaSor, tisztitNev };
