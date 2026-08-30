#!/usr/bin/env node
/**
 * keresztezes-betolto.mjs
 * -----------------------
 * FIX, megismételhető termék-betöltő folyamat (Szabolcs kérése, 2026-08-30).
 *
 * CÉL: Egy megadott márka / borászat / termék-lista Radovin-tételeihez megkeresi,
 * MELYIK konkurrens webshopban érhetők el (az ÖSSZES éles shopban), és azokat
 * JÓVÁHAGYOTT referencia-URL-lel betölti a `config/termekek.json`-ba.
 * Utána a szokásos `run.js` már árat termel rájuk → bekerül a weboldal mögé.
 *
 * INPUT (a parancssorból):
 *   node scripts/keresztezes-betolto.mjs --markak "bock,sauska,gere"
 *   node scripts/keresztezes-betolto.mjs --list /tmp/sajat-lista.json   # [{nev, ar?}]
 *
 * OPIONOK:
 *   --dry          NE írjon a config-ba; csak mutassa, mit töltene be (ALAPÉRTELMEZÉS)
 *   --commit       Ténylegesen backup + swap a config/termekek.json-ba
 *   --shopok "id1,id2"   Korlátozás (alapból: minden aktív shop)
 *
 * FIX FOLYAMAT (Szabolcs kérése, 2026-08-30):
 *   A keresés MINDIG minden éles shopra fut le (veritas, borhalo, benebor, winehub,
 *   borvilag, borpiac, borkell, borvalogatas). A script KIJELÖLT-et (jelölt-listát)
 *   ad minden termékre: {shop, konkurencia-név, ár, URL}. Tekintettel arra, hogy a
 *   konkurrens nevek eltérnek, a BETÖLTÉS kurált/emberileg átnézett lépéssel történik
 *   (a script az automatikus döntést csak a nagyon egyértelmű esetekre bízza; a
 *   bizonytalanokat külön listázza). A --commit a megadott jelöltekből a kurált
 *   kiválasztást tölti be.
 *
 * BIZTONSÁG (fájl-verziózás szabály):
 *   - Az eredeti termekek.json ÉRINTETLEN marad; egyszeri backup + swap.
 *   - Csak a BIZTOS találatok (név + ár + url alapján) kapnak referencia-URL-t.
 *   - A kétértelmű/hamis találatokat NEM tölti be; külön listázza ellenőrzésre.
 *
 * A bevált minta: ez a katalogus-keresztezes.mjs (matcher) felépítését követi,
 * kiegészítve a gen-termekek-100.mjs schema-konform termék-definíciójával és a
 * konkurencia referencia-URL-ekkel (shop_azonositas.<shop>.url).
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname;
const TERMEKEK = ROOT + 'config/termekek.json';
const SHOPOK = ROOT + 'config/shopok.json';

// ---- CLI -------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const MARKAK = (arg('--markak') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const LISTA = arg('--list');
const COMMIT = flag('--commit');
const DRY = !COMMIT;
const SHOPKORLAT = arg('--shopok');

if (!MARKAK.length && !LISTA) {
  console.error('Használat: node scripts/keresztezes-betolto.mjs --markak "bock,sauska,gere" [--commit]');
  process.exit(2);
}

const UA = 'RadovinArfigyelo/1.0 (+https://github.com/RobertClaw202604)';
const cfg = { ua: UA, timeout_sec: 30 };

// ---- Norma-egyezés (azonos a katalogus-keresztezes.mjs bevált matcherével) ----
import { norm } from '../lib/matricas.js';
// liter-kinyerès (a matricas.kertLiter mintájára)
function kertLiterFn(s) {
  const m = (s || '').replace(/\s/g, '').replace(',', '.');
  const v = m.match(/(\d+\.?\d*)l/);
  return v ? parseFloat(v[1]) : null;
}
const tolKek = (s) => (s || '').replace(/\b(0\,\s?[0-9]+|\d+,\s?\d+|\d+)\s*(l|ml|liter|literes)\b/gi, ' ').replace(/\s+/g, ' ').trim();
function egyezik(radovinNev, konkurensNev) {
  const rn = norm(radovinNev || ''), kn = norm(konkurensNev || '');
  if (!rn || !kn) return false;
  const markaRadovin = norm((radovinNev || '').split(' ')[0]);
  if (markaRadovin && markaRadovin.length >= 3 && !kn.includes(markaRadovin)) return false;
  const rnTol = tolKek(rn), knTol = tolKek(kn);
  if (!rnTol) return false;
  const lR = kertLiterFn(radovinNev), lK = kertLiterFn(konkurensNev);
  if (lR != null && lK != null) {
    if (lR < 0.2 && Math.abs(lR - lK) > 0.01) return false;
    if (Math.abs(lR - lK) / Math.min(lR, lK) > 2) return false;
  }
  if (rnTol === knTol) return true;
  if (knTol.includes(rnTol)) return true;
  if (rnTol.includes(knTol)) return true;
  const rw = rnTol.split(/\s+/).filter((w) => w.length >= 4);
  if (!rw.length) return false;
  const t = rw.filter((w) => knTol.includes(w)).length;
  return t / rw.length >= 0.75;
}

// ---- Radovin-katalógus ----
async function radovinKatalogus() {
  const all = [];
  for (let page = 1; page <= 40; page++) {
    const r = await fetch('https://radovin.hu/wp-json/wc/store/products?per_page=100&page=' + page, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) break;
    const j = await r.json();
    if (!j.length) break;
    all.push(...j);
    if (j.length < 100) break;
  }
  return all.map((p) => ({
    nev: (p.name || '').replace(/&#8220;|&#8221;/g, '"').replace(/&#038;|&amp;/g, '&').trim(),
    ar: Number(((p.prices && p.prices.price) || 0)),
    url: p.permalink || '',
  }));
}

// ---- Shop katalógus-fetch (minden aktív shop, ugyanaz mint a run.js adapterei) ----
async function shopKatalogus(shop) {
  try {
    switch (shop.adapter) {
      case 'shopify': {
        return await import('../lib/katlistas.js').then((m) => m.teljesKatalogus(shop, cfg));
      }
      case 'katlistas':
      case 'woocommerce-api': {
        return await woocommerceTeljes(shop.base_url);
      }
      case 'borhalo': return await import('../lib/borhalo.js').then((m) => m.kategoriaTele(shop, cfg));
      case 'shoprenter': return await import('../lib/shoprenter.js').then((m) => m.kategoriaTele(shop, cfg));
      case 'unas': return await import('../lib/unas.js').then((m) => m.kategoriaTele(shop, cfg));
      case 'opencart': {
        return await opencartTeljes(shop);
      }
      default: return { hiba: 'nincs_fetch:' + shop.adapter };
    }
  } catch (e) { return { hiba: e.message || String(e) }; }
}
async function woocommerceTeljes(base) {
  const osszes = [];
  for (let page = 1; page <= 40; page++) {
    const r = await fetch(`${base}/wp-json/wc/store/products?per_page=100&page=${page}`, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) break;
    const totalPages = Number(r.headers.get('x-wp-totalpages')) || page;
    const j = await r.json();
    if (!j.length) break;
    for (const p of j) {
      let ar = Number(p.prices?.price);
      if (isNaN(ar)) ar = Number(p.prices?.regular_price);
      if (isNaN(ar)) ar = null;
      osszes.push({ nev: p.name || '', ar, url: p.permalink || '' });
    }
    if (page >= totalPages || j.length < 100) break;
  }
  return osszes.filter((x) => x.nev);
}
// OpenCart (pl. Borkell): a név/ár/url a statikus kategórialapokon van (mint lib/opencart.js kategoriaTele).
async function opencartTeljes(shop) {
  const { sorok } = await import('../lib/opencart.js');
  const katLista = (shop.kategoria_slugek || []).length ? shop.kategoria_slugek : ['/borok'];
  const perLap = shop.kategoria_max_lap || 15;
  const ua = String(cfg.ua || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x00-\x7F]/g, '');
  const osszes = [];
  for (const kat of katLista) {
    for (let page = 1; page <= perLap; page++) {
      const url = `${shop.base_url}${/^\//.test(kat) ? kat : '/' + kat}?page=${page}`;
      let r;
      try {
        r = await fetch(url, { headers: { 'User-Agent': ua, 'Accept-Language': 'hu-HU' }, signal: AbortSignal.timeout((cfg.timeout_sec || 25) * 1000), redirect: 'follow' });
      } catch (e) { break; }
      if (!r.ok) break;
      const html = await r.text();
      const kartya = sorok(html, shop);
      if (!kartya.length) break;
      const uj = kartya.filter((x) => !osszes.some((o) => o.url === x.url));
      osszes.push(...uj);
      if (kartya.length < perLap) break;
    }
  }
  return [...new Map(osszes.map((x) => [x.url, x])).values()];
}

// ---- Termék-definíció generálás (a gen-termekek-100 séma szerint) ----
const normId = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const parseMeret = (nev) => {
  const m = String(nev).toLowerCase();
  const mm = m.match(/(\d)[,.](\d+)\s?l\b/) || m.match(/(\d+)\s?l\b/);
  if (!mm) return { meret: '0,75 l', ml: 750, darab: 1 };
  const lit = mm[1] !== undefined && mm[2] !== undefined ? parseFloat(`${mm[1]}.${mm[2]}`) : parseFloat(mm[1]);
  return { meret: `${String(lit).replace('.', ',')} l`, ml: Math.round(lit * 1000), darab: 1 };
};
const SPARKLING_RE = /pezsg|brut|prosecco|cava|champagne|pet[- ]nat|carassia|gran reserva/i;
const kategoria = (nev) => {
  const n = String(nev || '');
  if (SPARKLING_RE.test(n)) return 'sparkling';
  if (/ászú|szamorodni|eszencia/i.test(n)) return 'desszert';
  if (/rosé/i.test(n)) return 'rosé';
  return 'wine';
};
function evjaratInfo(nev) {
  let puttony = null;
  const pm = String(nev).match(/(\d)\s*puttony/i);
  if (pm) puttony = parseInt(pm[1], 10);
  const em = String(nev).match(/\b(19\d\d|20\d\d)\b/);
  let evj = null;
  if (em) evj = parseInt(em[1], 10);
  let statusz;
  if (evj) statusz = 'vintage';
  else if (/non[- ]vintage|brut|extra dry|late harvest|szamorodni/i.test(String(nev))) statusz = 'non_vintage';
  else statusz = 'unknown';
  return { evj, statusz, puttony };
}
function csomagolas(nev) {
  if (/\bset\b/i.test(String(nev))) return 'set';
  if (/gift|ajándék|doboz/i.test(String(nev))) return 'gift_box';
  if (/magnum/i.test(String(nev))) return 'magnum';
  return 'plain_bottle';
}
function radovinKereso(nev) {
  return String(nev)
    .replace(/&#8217;/g, "'").replace(/&#8220;|&#8221;/g, '"')
    .replace(/\b(19\d\d|20\d\d)\b/g, ' ')
    .replace(/\b\d+[.,]?\d*\s?%/g, ' ')
    .replace(/\b\d+[.,]?\d*\s?l\b/gi, ' ')
    .replace(/\b\d+\s+puttony(?:os)?\b/gi, 'puttonyos')
    .replace(/\s+/g, ' ').trim();
}

// Évjárat-információ a konkurens névből (hogy ne ütközzön a Radovin-évjárattal)
function evjaratKonkurenciabol(konkNev) {
  const m = String(konkNev).match(/\b(19\d\d|20\d\d)\b/);
  return m ? parseInt(m[1], 10) : null;
}

// ---- FŐ PROGRAM ----
(async () => {
  console.log('=== KERESZTEZÉS-BETÖLTŐ ===');
  console.log('Márkák:' + (MARKAK.join(', ') || '(lista)') + (DRY ? '  [DRY mód — nem ír]' : ''));

  // 0) Jelenlegi termékek (a meglévőket megtartjuk; csak újakat adunk hozzá)
  const jelenlegi = JSON.parse(readFileSync(TERMEKEK, 'utf8'));
  const aktualisId = new Set(jelenlegi.termekek.map((t) => t.id));

  // 1) Radovin katalógus + szűrés
  console.log('Radovin-katalógus letöltése…');
  const radovin = await radovinKatalogus();
  let celok;
  if (LISTA) {
    const lista = JSON.parse(readFileSync(LISTA, 'utf8'));
    celok = lista.map((x) => ({ nev: x.nev, ar: x.ar ?? null, url: x.url ?? '' }));
  } else {
    celok = radovin.filter((r) => MARKAK.some((m) => r.nev.toLowerCase().includes(m)));
  }
  console.log(`  ${celok.length} céltétel.`);

  // 2) Shop-katalógusok (aktív, opcionálisan korlátozva)
  const shopok = JSON.parse(readFileSync(SHOPOK, 'utf8')).shopok;
  let aktivek = shopok.filter((s) => s.statusz === 'active' && s.id !== 'radovin');
  if (SHOPKORLAT) {
    const engedett = new Set(SHOPKORLAT.split(',').map((s) => s.trim()));
    aktivek = aktivek.filter((s) => engedett.has(s.id));
  }
  console.log('Shopok: ' + aktivek.map((s) => s.id).join(', '));
  const katalogusok = {};
  for (const s of aktivek) {
    const kat = await shopKatalogus(s);
    if (Array.isArray(kat)) { katalogusok[s.id] = kat; console.log(`  ${s.id}: ${kat.length} tétel`); }
    else { katalogusok[s.id] = []; console.log(`  ${s.id}: HIBÁS (${kat.hiba})`); }
  }

  // 3) Minden céltermékhez: találatok shoponként + döntés (biztos / kétértelmű / nincs)
  console.log('\n--- Találatok ---');
  const ujTermekek = [];
  const ellenorzendo = [];
  let meglovo = 0;

  for (const r of celok) {
    const talalatok = [];
    for (const s of aktivek) {
      const kat = katalogusok[s.id] || [];
      const jeloltek = kat.filter((x) => egyezik(r.nev, x.nev));
      if (jeloltek.length) {
        // Legjobb: az első, ami névre is és árra is reális; de a konkrét URL-t az első jelölt adja
        const j = jeloltek.sort((a, b) => (b.ar ?? 0) - (a.ar ?? 0))[0];
        talalatok.push({ shop: s.id, nev: j.nev, ar: j.ar, url: j.url });
      }
    }

    // DÖNTÉS: biztos = van legalább 1 konkrét találat, aminek van URL-je és neve közel áll
    const biztos = talalatok;
    if (biztos.length) {
      const konkStudk = {};
      for (const t of biztos) {
        // MÉRET-SZIGOR (a betöltésre): ha a Radovin-tételnek van explicit kiszerelése ÉS
        // a konkurrens neve MÁS explicit kiszerelést mond (pl. 0,75 vs 1,5 magnum), az
        // NEM ugyanaz a tétel → ellenőrzésre tesszük, nem töltjük be.
        const rMl = kertLiterFn(r.nev) ? kertLiterFn(r.nev) * 1000 : null;
        const tMl = kertLiterFn(t.nev) ? kertLiterFn(t.nev) * 1000 : null;
        if (rMl != null && tMl != null && Math.abs(rMl - tMl) > 10) {
          ellenorzendo.push({ radovin: r.nev, shop: t.shop, konkurencia: t.nev, ar: t.ar, url: t.url, ind: 'eltérő kiszerelés (' + (rMl / 1000) + 'l vs ' + (tMl / 1000) + 'l)' });
          continue;
        }
        // EVJÁRAT-SZIGOR: ha a Radovin-tételnek van évjárata ÉS a konkurrens MÁS évjáratot
        // ír ki, NEM ugyanaz a tétel.
        const rEvjarat = evjaratInfo(r.nev).evj;
        const tEvjarat = evjaratKonkurenciabol(t.nev);
        if (rEvjarat != null && tEvjarat != null && rEvjarat !== tEvjarat) {
          ellenorzendo.push({ radovin: r.nev, shop: t.shop, konkurencia: t.nev, ar: t.ar, url: t.url, ind: 'eltérő évjárat (' + rEvjarat + ' vs ' + tEvjarat + ')' });
          continue;
        }
        // Kétértelmű jelölés: ha a találatnév NEM fedi a Radovin-tétel lényegi szavait,
        // ellenőrzésre külön tesszük (ne legyen hamis ár a weboldalon).
        const rSzavak = tolKek(r.nev).split(/\s+/).filter((w) => w.length >= 4);
        const tSzavak = tolKek(t.nev).split(/\s+/).filter((w) => w.length >= 4);
        const maxtt = Math.max(rSzavak.length, tSzavak.length);
        const fedo = rSzavak.length && tSzavak.length ? rSzavak.filter((w) => tSzavak.includes(w)).length / maxtt : 0;
        if (fedo < 0.75) {
          ellenorzendo.push({ radovin: r.nev, shop: t.shop, konkurencia: t.nev, ar: t.ar, url: t.url, ind: 'alacsony szóátfedés' });
          continue;
        }
        konkStudk[t.shop] = { url: t.url, ellenorzott_nev: t.nev, ellenorizve: new Date().toISOString().slice(0, 10), ellenorzes_modja: 'keresztezes_betolto' };
      }
      if (!Object.keys(konkStudk).length) continue;

      const { meret, ml, darab } = parseMeret(r.nev);
      const marka = String(r.nev).split(' ')[0];
      const tipusGuess = kategoria(r.nev);
      const tipus = tipusGuess === 'sparkling' ? 'pezsgő' : tipusGuess === 'desszert' ? 'aszú' : 'bor';
      const { evj, statusz, puttony } = evjaratInfo(r.nev);

      const uj = {
        id: normId(r.nev),
        nev: r.nev,
        marka,
        tipus,
        meret,
        evjarat: evj,
        radovin_kereso: radovinKereso(r.nev),
        aktiv: true,
        azonositas: {
          termekkategoria: tipusGuess, gyarto: marka,
          marka_aliasok: [marka].filter(Boolean),
          tetel: r.nev, evjarat: evj, evjarat_statusz: statusz,
          kiszereles_ml: ml, darab, csomagolas: csomagolas(r.nev), puttony, penznem: 'HUF',
        },
        shop_azonositas: {
          radovin: {
            elfogadott_tetel_aliasok: [radovinKereso(r.nev), r.nev].filter(Boolean),
            ellenorzott_nev: r.nev, ellenorizve: new Date().toISOString().slice(0, 10),
            ellenorzes_modja: 'keresztezes_betolto_radovin',
            megjegyzes: 'Radovin-saját tétel a keresztezés-betöltőből.',
          },
          ...konkStudk,
        },
      };
      if (!aktualisId.has(uj.id)) { ujTermekek.push(uj); aktualisId.add(uj.id); }
      else meglovo++;
      console.log(`${r.nev}  →  ` + Object.keys(konkStudk).map((k) => `${k}: "${konkStudk[k].ellenorzott_nev}" (${konkStudk[k].url})`).join(' | '));
    } else {
      console.log(`${r.nev}  →  (nincs egyetlen másik shopban sem)`);
    }
  }

  console.log('\n--- ÖSSZESÍTÉS ---');
  console.log(`Új, betölthető termék: ${ujTermekek.length}`);
  console.log(`Már meglévő (nem duplázva, de ellenőrzésre javasolt): ${meglovo}`);
  console.log(`Kétértelmű/ellenőrzendő (NEM lett betöltve): ${ellenorzendo.length}`);
  forgassuk: for (const e of ellenorzendo) {
    console.log(`  ? ${e.radovin} ←${e.shop} "${e.konkurencia}" (${e.ar} Ft) [${e.ind}]`);
  }

  if (DRY) {
    console.log('\nDRY mód — NEM írtam a config-ba. A betöltéshez futtasd --commit paranccsal.');
    process.exit(0);
  }

  // ---- COMMIT: backup + swap ----
  const oggi = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  await import('node:fs').then((fs) => fs.mkdirSync(ROOT + 'config/backup', { recursive: true }));
  if (!ujTermekek.length) {
    console.log('\nNincs új betölthető termék; a config érintetlen.');
    process.exit(0);
  }
  const backupUt = backupPath(ROOT);
  copyFileSync(TERMEKEK, backupUt);
  const ujLista = [...jelenlegi.termekek, ...ujTermekek];
  const csomag = {
    meta: { ...jelenlegi.meta, frissitve: new Date().toISOString().slice(0, 10), termekszam: ujLista.length, forras: jelenlegi.meta.forras + '; keresztezes-betolto' },
    termekek: ujLista,
  };
  writeFileSync(TERMEKEK, JSON.stringify(csomag, null, 2) + '\n');
  console.log(`\n[COMMIT] ${ujTermekek.length} termék betöltve. Backup: ${backupUt}`);
  console.log('Futtasd le: node run.js  →  az árak bekerülnek a weboldal mögé.');
})().catch((e) => { console.error('HIBA:', e); process.exit(1); });

function backupPath(ROOT) {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return ROOT + 'config/backup/termekek-' + d + '.json';
}
