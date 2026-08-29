// Radovin árfigyelő – Borháló adapter (headless NÉLKÜL).
//
// A Borháló (borhalo.hu) termékkártyái a nyers HTML-ben a GA4 `data-gt-params`
// (dataLayer) JSON-jében tartalmazzák a termékNEVET és az ÁRAT (item_name + price),
// a kategórialistákon pedig `?limit=100&page=N` lapozással jönnek ki.
// A laptól a sima GET is visszaadja ezt a JSON-t, ezért headless NÉLKÜL kinyerhető.
//
// Fontos: a base_url NEM www-s verzió (https://borhalo.hu), mert a www-ról a
// pezsgők/párlatok kategóriák 301-et adnak. A www→non-www átirányítás a fetch
// redirect:'follow'-jával megoldódik, ezért a base_url-t www nélkül adjuk meg.
//
// A kinyert {nev, ar} listát a szigorú matcherrel (márka + kiszerelés + puttony)
// szűrjük a legjobb pontos találatra.

const { num } = require('./utils.js');
const { szigor } = require('./matricas.js');

// Futás-szintű cache: a Borháló katalógusát futásonként egyszer töltjük le,
// nem termékenként (különben 13 termék × ~14 oldal ismételt fetch pazarló).
let katalogusCache = null;
let katalogusCacheKulcs = '';

function cacheKulcs(shop) {
  return (shop.base_url || '') + '|' + (shop.kategoria_slugek || []).join(',') + '|' + (shop.kategoria_max_lap || 12);
}

// Kinyeri az {nev, ar, url} párokat a Borháló HTML-jéből a termékkártyákból.
// Minden kártya egyetlen <a> elem: `data-gt-params` (GA4 JSON: item_name + price)
// és a `href=/termek/{slug}` EGYÜTT van rajta → a link a név-slug (azonos marad,
// ha az ár változik), így a termék-URL pontosan kinyerhető.
function sorokGt(html) {
  const out = [];
  // Egy kártya: <a ... data-gt-params="{...item_name:...price:...}" ... href=/termek/...>
  const kartyare = /data-gt-params=\"([^\"]*)\"[^>]*href=\/termek\/([a-z0-9.\\'%-]+)/gi;
  let m;
  while ((m = kartyare.exec(html)) !== null) {
    let params = m[1];
    // HTML-entitások visszaalakítása (a data-gt-params &quot;-vel escapelt)
    params = params.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
    const nevM = params.match(/\"item_name\"\s*:\s*\"([^\"]+)\"/);
    const arM = params.match(/\"price\"\s*:\s*([0-9]+)/);
    const nev = nevM ? nevM[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) : null;
    const ar = arM ? parseInt(arM[1], 10) : null;
    const slug = m[2];
    if (nev && ar > 0 && slug) {
      out.push({ nev, ar, url: 'https://borhalo.hu/termek/' + slug });
    }
  }
  return out;
}

// Egy kategórialista végiglapozása (futásonként egyszer, cache-elve).
async function kategoriaTele(shop, cfg) {
  const kulcs = cacheKulcs(shop);
  if (katalogusCache && katalogusCacheKulcs === kulcs) {
    return katalogusCache;
  }
  const katLista = (shop.kategoria_slugek || []).length
    ? shop.kategoria_slugek
    : (shop.kategoria_kereso_slugek || ['borok-2']);
  const osszes = [];
  for (const kat of katLista) {
    for (let page = 1; page <= (shop.kategoria_max_lap || 12); page++) {
      const url = `${shop.base_url}/termekeink/${kat}?limit=100&page=${page}`;
      let r;
      try {
        r = await fetch(url, {
          headers: { 'User-Agent': cfg.ua || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'Accept-Language': 'hu-HU' },
          signal: AbortSignal.timeout((cfg.timeout_sec || 25) * 1000),
          redirect: 'follow',
        });
      } catch (e) {
        break; // átirányítás-loop / hálózati hiba → hagyjuk ezt a kategóriát
      }
      if (!r.ok) break;
      const html = await r.text();
      const sorok = sorokGt(html);
      if (!sorok.length) break; // utolsó lap / üres
      osszes.push(...sorok);
      if (sorok.length < 100) break; // nincs több oldal
    }
  }
  // dedup (név+ár alapján) + cache futás-szinten
  const vegso = [...new Map(osszes.map((x) => [x.nev + '|' + x.ar, x])).values()];
  katalogusCache = vegso;
  katalogusCacheKulcs = kulcs;
  return vegso;
}

async function borhalo(termek, shop, cfg) {
  try {
    const katalogus = await kategoriaTele(shop, cfg);
    if (!katalogus.length) return { ok: false, shop: shop.id, termek: termek.id, hiba: 'ures_katalogus', talalat: null, talalatok: [] };
    const tal = szigor(katalogus, termek);
    // A teljes kinyert katalógust is továbbadjuk a termékgyűjtőnek (név+ár+url),
    // hogy minden konkrét termék megmaradjon, akkor is ha nem párosítható.
    if (!tal) return { ok: false, shop: shop.id, termek: termek.id, hiba: 'nincs_pontos_talalat', talalat: null, talalatok: katalogus };
    return {
      ok: true,
      shop: shop.id,
      termek: termek.id,
      talalat: { nev: tal.nev, ar: tal.ar, url: tal.url || shop.base_url, megjegyzes: 'via Borháló katalógus (GA4)' },
      talalatok: katalogus,
    };
  } catch (e) {
    return { ok: false, shop: shop.id, termek: termek.id, hiba: 'borhalo_hiba:' + (e.message || '').slice(0, 80), talalat: null, talalatok: [] };
  }
}

module.exports = { borhalo };
