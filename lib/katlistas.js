// Radovin árfigyelő – katalóguslista-alapú (headless NÉLKÜLI) adapter.
//
// Sok shop (Shopify: /products.json, WooCommerce: /wp-json/wc/store/products)
// a teljes katalógusát nyilvános JSON-endpointon adja ki, pontos árakkal.
// Ebből a mi oldalunkon, a szigorú matcherrel (márka + kiszerelés + puttony)
// választjuk ki a legjobb találatot – így NINCS függés a shop esetlegesen
// JS/robotvédett kereső-endpointjától, és nem függünk headless böngészőtől sem.
//
// Repertoár-elem: a legrobusztusabb mód a pontos konkurens-árra.

const { norm, kertLiter, puttony } = require('./matricas.js');
const { selectExactCandidate } = require('./domain/matcher-v2.js');
const { candidate } = require('./domain/candidate.js');

// Egy lap lekérése JSON-endpointról. tipus: 'shopify' | 'woocommerce'
async function lapLekerese(base, tipus, page, cfg) {
  const url = tipus === 'shopify'
    ? `${base}/products.json?limit=250&page=${page}`
    : `${base}/wp-json/wc/store/products?per_page=100&page=${page}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': cfg.ua || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'Accept': 'application/json' },
    signal: AbortSignal.timeout((cfg.timeout_sec || 25) * 1000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// Típus-specifikus "termék + ár + név" normá értékére alakítás.
// A Shopify /products.json `handle` mezeje csak a slug – a teljes termékoldal
// URL `https://<shop>/products/<handle>`. A shop domainje a base_url-ből jön.
function sorShopify(p, base) {
  const v = (p.variants && p.variants[0]) || {};
  const host = String(base || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const handle = p.handle || '';
  return {
    nev: p.title || '',
    ar: parseFloat(v.price),
    url: handle ? ('https://' + host + '/products/' + handle) : base,
  };
}

function sorWoo(p) {
  const pr = (p.prices && p.prices.price) || null;
  let ar = typeof pr === 'string' ? parseFloat(pr) : pr;
  if (ar === null || ar === undefined) ar = parseFloat(p.prices && p.prices.regular_price);
  return { nev: p.name || '', ar: isNaN(ar) ? null : ar, url: p.permalink || '' };
}

// Teljes katalógus letöltése (oldalpáklévően)
async function teljesKatalogus(shop, cfg) {
  const tipus = shop.adapter === 'shopify' ? 'shopify' : 'woocommerce';
  const osszes = [];
  let page = 1;
  let lap = await lapLekerese(shop.base_url, tipus, page, cfg);
  for (;;) {
    const sorok = (tipus === 'shopify' ? (lap.products || lap) : (Array.isArray(lap) ? lap : (lap.products || [])));
    const formazott = tipus === 'shopify' ? sorok.map((s) => sorShopify(s, shop.base_url)) : sorok.map(sorWoo);
    osszes.push(...formazott);
    const maxPage = (tipus === 'shopify')
      ? Math.ceil((lap.produits_total || osszes.length + 250) / 250)
      : ((lap.headers && lap.headers['x-wp-totalpages']) ? parseInt(lap.headers['x-wp-totalpages'], 10) : undefined);
    // Shopify-nál a products.json nem ad össz-számot; ciklizunk amíg van következő oldal
    const hasMore = (tipus === 'shopify')
      ? (formazott.length === 250)
      : (page < (maxPage || page));
    if (!hasMore || page > 20) break;
    page += 1;
    lap = await lapLekerese(shop.base_url, tipus, page, cfg);
  }
  return osszes;
}

async function katlistas(termek, shop, cfg, katalogusCache) {
  try {
    // Commit 6: shop-first – ha van futás-szintű katalógus-gyorsítótár, és ebből a
    // shopból MÁR lekérdeztük a teljes katalógust, ne töltsük le újra termékenként.
    let katalogus = null;
    if (katalogusCache && katalogusCache.has && katalogusCache.has(shop.id)) {
      katalogus = katalogusCache.get(shop.id);
    } else {
      katalogus = await teljesKatalogus(shop, cfg);
      if (katalogusCache && katalogusCache.set) katalogusCache.set(shop.id, katalogus);
    }
    if (!katalogus || !katalogus.length) return { ok: false, shop: shop.id, termek: termek.id, hiba: 'ures_katalogus', talalat: null, talalatok: [] };

    // KIMENETI MATCHER: strict matcher-v2 (Szabolcs „csak a pontosan egyező borok").
    // A legacy szigor() (márka + kiszerelés + puttony) helyett a típusos
    // `selectExactCandidate` dönt, mely kizárólag a MINDEN kötelező kapun (márka,
    // tétel/változat, évjárat, kiszerelés, darab, csomagolás, puttony, pénznem,
    // jóváhagyott referencia) átjutott jelöltet adja MATCHED-ként. Minden más
    // (no_exact_match / needs_review / ambiguous_match / mapping_drift) NEM termel árat.
    // Lásd: lib/domain/matcher-v2.js + RADOVIN_SYSTEM_IMPROVEMENT_GUIDE.md §7.
    const jeloltek = katalogus.map((row) => candidate({
      shopId: shop.id,
      shopProductId: row.url, // a katalógus-tétel URL-je (a jóváhagyott azonosító a shop_azonositas-ban)
      name: row.nev,
      url: row.url && /^https?:\/\//.test(row.url) ? row.url : shop.base_url,
      price: row.ar,
      currency: 'HUF',
      extractor: shop.adapter || 'katlistas',
      availability: 'in_stock',
    }));
    const elbiralas = selectExactCandidate(jeloltek, termek, shop.id);

    if (elbiralas.status === 'matched' && elbiralas.selected) {
      const tal = elbiralas.selected;
      return {
        ok: true,
        shop: shop.id,
        termek: termek.id,
        talalat: { nev: tal.name || tal.nev, ar: tal.price, url: tal.url || shop.base_url, megjegyzes: 'via katalóguslista (' + shop.adapter + ', strict matcher-v2)' },
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
    return { ok: false, shop: shop.id, termek: termek.id, hiba: 'katalógus_hiba:' + (e.message || '').slice(0, 80), talalat: null, talalatok: [] };
  }
}

module.exports = { katlistas, teljesKatalogus };
