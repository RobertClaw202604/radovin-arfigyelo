#!/usr/bin/env node
// One-off (2026-08-30): Bock / Sauska / Gere Tamás / Gere Attila szállítói lefedettség-térkép.
//
// Cél (Szabolcs kérése): a Radovin webshopban szereplő összes Bock/Sauska/Gere-borhoz
// nézzük meg, hogy a TÖBBI (konkurens) webshop bármelyikében megtalálható-e.
// Nem ír be semmit a config-ba; NEM módosít fájlt; csak elemzi és kiírja az eredményt.
//
// Módszer: a production matcher (matcher-v2 `evaluateCandidate`) identitás-kapuit futtatjuk
// minden éles konkurens shop teljes katalógusán. Ha egy jelölt eljut az `unapproved_candidate`
// kapuig, az azt jelenti, hogy a termék VÁLÓBAN megvan a shopban (márka+tétel+évjárat+kiszerelés
// +csomagolás+darab+puttony+pénznem mind egyezik) – csak még nincs emberileg jóváhagyott referencia.
// Azt külön jelöljük, ha `matched` (jóváhagyott referencia + ár) is van.

import { readFileSync } from 'node:fs';
import { katlistas as katlistasTeljesKatalogus } from '../lib/katlistas.js';
import { borhalo } from '../lib/borhalo.js';
import { shoprenter as shoprenterTeljes } from '../lib/shoprenter.js';
import { unas as unasTeljes } from '../lib/unas.js';
import { opencart as opencartTeljes } from '../lib/opencart.js';
import { candidate } from '../lib/domain/candidate.js';
import { normalizeText, evaluateCandidate } from '../lib/domain/matcher-v2.js';

const ROOT = new URL('../', import.meta.url).pathname;
const termekekFajl = JSON.parse(readFileSync(ROOT + 'config/termekek.json', 'utf8'));
const shopokFajl = JSON.parse(readFileSync(ROOT + 'config/shopok.json', 'utf8'));

const UA = 'RadovinArfigyelo/1.0 (+https://github.com/RobertClaw202604)';
const cfg = { ua: UA, timeout_sec: 25 };

// ---------- 1) A Radovin katalógusából a Bock/Sauska/Gere termékek ----------
async function radovinBockSauskaGere() {
  const all = [];
  for (let page = 1; page <= 40; page++) {
    const r = await fetch('https://radovin.hu/wp-json/wc/store/products?per_page=100&page=' + page, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) break;
    const j = await r.json();
    if (!j.length) break;
    all.push(...j);
    if (j.length < 100) break;
  }
  const kell = ['bock', 'sauska', 'gere'];
  return all
    .filter((p) => kell.some((k) => (p.name || '').toLowerCase().includes(k)))
    .map((p) => ({
      nev: (p.name || '').replace(/&#8220;|&#8221;/g, '"').replace(/&#038;|&amp;/g, '&').trim(),
      ar: Number(((p.prices && p.prices.price) || 0)),
      url: p.permalink || '',
      slug: (p.permalink || '').split('/').filter(Boolean).pop() || '',
    }));
}

// ---------- 2) Identitás-objektum építése egy Radovin tételből ----------
const MERETRE = /(\d[\d,]*)l/i;
const EVI = /\b(19\d{2}|20\d{2})\b/;
const PUTTONYRE = /(\d)\s*puttonyos/i;
function azonositas(termek) {
  const nev = termek.nev;
  const norm = normalizeText(nev);
  let meret = null;
  let kiszereles_ml = null;
  const m = nev.match(MERETRE);
  if (m) {
    meret = m[1].replace(',', '.');
    const l = Number(meret);
    kiszereles_ml = m[0].toLowerCase().includes('l') ? Math.round(l * 1000) : Math.round(Number(meret) * 1000);
    if (/\bmagnum\b/i.test(nev)) kiszereles_ml = 1500;
  }
  if (/magnum/i.test(nev) && kiszereles_ml == null) kiszereles_ml = 1500;
  if (/(\d+)ml/i.test(nev)) kiszereles_ml = Number(RegExp.$1);

  const ev = nev.match(EVI);
  const evjarat = ev ? ev[1] : null;
  const puttonySzam = (nev.match(PUTTONYRE) || [])[1] ? Number(PUTTONYRE.exec(nev)[1]) : null;

  let tipus = 'bor';
  if (/pezsgő|brut|méthode/i.test(nev)) tipus = 'pezsgő';
  if (/aszú/i.test(nev)) tipus = 'aszú';

  let marka = 'Gere';
  if (/sauska/i.test(nev)) marka = 'Sauska';
  else if (/bock/i.test(nev)) marka = 'Bock';
  else if (/gere.*(tamás|zsolt)/i.test(nev)) marka = 'Gere Tamás és Zsolt';
  else if (/gere attila/i.test(nev)) marka = 'Gere Attila';
  else if (/gere zsolt/i.test(nev)) marka = 'Gere Zsolt';
  else if (/gere/i.test(nev)) marka = 'Gere';

  // A "tétel" (expression) a teljes, kiszerelés nélküli név – a matcher ezt keresi a shopban.
  return {
    termekkategoria: tipus,
    gyarto: marka,
    marka_aliasok: [marka.split(' és ')[0], marka],
    tetel: nev.replace(/\s*\d[\d,]*l\s*$/i, '').trim(),
    evjarat: evjarat,
    evjarat_statusz: evjarat ? 'concrete' : 'non_vintage',
    kiszereles_ml: kiszereles_ml,
    darab: 1,
    csomagolas: 'plain_bottle',
    puttony: puttonySzam,
    penznem: 'HUF',
  };
}

// ---------- 3) Shop katalógus-fetchek (ugyanazok, mint amit a run.js használ) ----------
async function shopKatalogus(shop) {
  try {
    switch (shop.adapter) {
      case 'katlistas':
      case 'shopify':
      case 'woocommerce-api':
        return await katlistasTeljesKatalogus(shop, cfg);
      case 'borhalo': {
        const sor = await borhalo(shop, cfg, undefined);
        return (sor && sor.talalatok) || [];
      }
      case 'shoprenter': {
        const sor = await shoprenterTeljes(shop, cfg, undefined);
        return (sor && sor.talalatok) || [];
      }
      case 'unas': {
        const sor = await unasTeljes(shop, cfg, undefined);
        return (sor && sor.talalatok) || [];
      }
      case 'opencart': {
        const sor = await opencartTeljes(shop, cfg, undefined);
        return (sor && sor.talalatok) || [];
      }
      default:
        return { hiba: 'nincs_fetch: ' + shop.adapter };
    }
  } catch (e) {
    return { hiba: 'hiba: ' + (e.message || '').slice(0, 80) };
  }
}

// ---------- 4) Futtatás ----------
(async () => {
  console.log('Radovin katalógusából Bock/Sauska/Gere tételek lekérése…');
  const radovin = await radovinBockSauskaGere();
  console.log(`  ${radovin.length} tétel a Radovin webshopban.`);

  const aktivek = shopokFajl.shopok.filter((s) => s.statusz === 'active' && s.id !== 'radovin');
  console.log('Konkurens shopok lekérése: ' + aktivek.map((s) => s.id).join(', '));
  const katalogusok = {};
  for (const s of aktivek) {
    const kat = await shopKatalogus(s);
    if (kat && Array.isArray(kat)) {
      katalogusok[s.id] = kat;
      console.log(`  ${s.id}: ${kat.length} termék`);
    } else {
      katalogusok[s.id] = [];
      console.log(`  ${s.id}: HIBÁS (${(kat && kat.hiba) || 'üres katalógus'})`);
    }
  }
  console.log('');

  // Minden radovin tételhez: mely shopokban van meg (identitás-gátak szerint).
  const sorok = radovin.map((r) => {
    const termek = {
      id: r.slug || r.nev,
      nev: r.nev,
      meret: '0,75 l',
      marka: azonositas(r).gyarto,
      fajta: null,
      evjarat: azonositas(r).evjarat,
      azonositas: azonositas(r),
      shop_azonositas: {},
    };
    const talalatok = [];
    for (const s of aktivek) {
      const kat = katalogusok[s.id] || [];
      const jeloltek = kat
        .filter((row) => row && row.nev && row.ar != null)
        .map((row) => candidate({
          shopId: s.id,
          name: row.nev,
          url: row.url && /^https?:\/\//.test(row.url) ? row.url : s.base_url,
          price: row.ar,
          currency: 'HUF',
          extractor: 'coverage-check',
          availability: 'in_stock',
        }));
      // A legjobb (legmagasabb identitás-átmeneti) jelölt igazságos értékelése
      let talalat = null;
      for (const c of jeloltek) {
        const d = evaluateCandidate(c, termek, s.id);
        if (c.identitas_igeny) c.identitas_igeny = null;
        if (!talalat || d.score > talalat.decision.score) talalat = { candidate: c, decision: d };
      }
      if (talalat) {
        const d = talalat.decision;
        // unapproved_candidate = megvan a shopban (minden identitás-gát átment), csak referencia hiányzik
        if (d.code === 'unapproved_candidate') {
          talalatok.push({ shop: s.id, status: 'MEGVAN', ar: talalat.candidate.price, evevtalas: d.code, megjegyzes: 'emberi jóváhagyás hiányzik (rejtett ár)' });
        } else if (d.code === 'exact_candidate') {
          talalatok.push({ shop: s.id, status: 'MEGVAN+JOVAHAGYVA', ar: talalat.candidate.price, evevtalas: d.code });
        } else {
          talalatok.push({ shop: s.id, status: 'NINCS_VAGY_ELTERO', blokk: d.code, ar: talalat.candidate.price });
        }
      } else {
        talalatok.push({ shop: s.id, status: 'NINCS_TALALAT', blokk: 'nincs_jelolt' });
      }
    }
    return { nev: r.nev, ar: r.ar, slug: r.slug, talalatok };
  });

  // ---- KIÍRÁS ----
  console.log('================ SHOP-LEFEDETTSÉGI TÉRKÉP (Bock/Sauska/Gere) ================\n');
  const shopIds = aktivek.map((s) => s.id);
  const fejlec = 'Tétel'.padEnd(52) + shopIds.map((s) => s.padEnd(9)).join('');
  console.log(fejlec);
  console.log('─'.repeat(fejlec.length));
  for (const sor of sorok) {
    const sejtek = sor.talalatok.map((t) => {
      if (t.status.startsWith('MEGVAN')) return '✓MEGVAN';
      return '·';
    });
    console.log(sor.nev.padEnd(52) + sejtek.join('      '));
  }
  console.log('');

  console.log('===== RÉSZLETEK (mely shopban, milyen áron) =====\n');
  for (const sor of sorok) {
    console.log('◆ ' + sor.nev + '  (Radovin: ' + sor.ar + ' Ft)');
    let vane = false;
    for (const t of sor.talalatok) {
      if (t.status.startsWith('MEGVAN')) {
        vane = true;
        console.log(`    ${t.shop}: ${t.status} — ár: ${t.ar} Ft  ${t.megjegyzes || ''}`);
      }
    }
    if (!vane) console.log('    (nincs meg másik shopban)');
  }

  console.log('');
  console.log('===== ÖSSZESÍTÉS =====');
  for (const sor of sorok) {
    const megvan = sor.talalatok.filter((t) => t.status.startsWith('MEGVAN'));
    const shopok = megvan.map((t) => t.shop).join(',');
    console.log(`${megvan.length ? megvan.length : '0'} shop | ${sor.nev} | ${shopok}`);
  }
  console.log('');
  const hanyTermek = sorok.length;
  const hanyMegvan = sorok.filter((s) => s.talalatok.some((t) => t.status.startsWith('MEGVAN'))).length;
  console.log(`Összes tétel: ${hanyTermek} · legalább 1 másik shopban megvan: ${hanyMegvan}`);
})().catch((e) => { console.error('HIBA:', e); process.exit(1); });
