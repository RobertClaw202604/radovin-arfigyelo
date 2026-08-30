#!/usr/bin/env node
// One-off (2026-08-30): Bock / Sauska / Gere Tamás / Gere Attila lefedettség-térkép.
//
// Szabolcs kérése: a Radovin webshopban lévő összes Bock/Sauska/Gere borról nézzük meg,
// hogy a konkurrens webshopokban megtalálható-e. NEM módosít configot/fájlt – csak elemzi.
//
// Matcher: ugyanaz a laza, brand+fajta+kiszerelés alapú `egyezik()` mint a
// scripts/katalogus-keresztezes.mjs – ez a "megvan-e máshol is" kérdésre való.

import katMod from '../lib/katlistas.js';
import borhaloMod from '../lib/borhalo.js';
import shoprenterMod from '../lib/shoprenter.js';
import unasMod from '../lib/unas.js';
import opencartMod from '../lib/opencart.js';
import { norm, kertLiter } from '../lib/matricas.js';

const { teljesKatalogus: katlistasTeljesKatalogus } = katMod;
const borhaloKat = borhaloMod.kategoriaTele;
const shoprenterKat = shoprenterMod.kategoriaTele;
const unasKat = unasMod.kategoriaTele;
const opencartKat = opencartMod.kategoriaTele;

const UA = 'RadovinArfigyelo/1.0 (+https://github.com/RobertClaw202604)';
const cfg = { ua: UA, timeout_sec: 30 };

// ---------- Laza egyezés (a katalogus-keresztezes-szel konzisztens) ----------
function tolKek(s) {
  return (s || '')
    .replace(/\b(0\,\s?[0-9]+|\d+,\s?\d+|\d+)\s*(l|ml|liter|literes)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}
function kertLiterFn(s) {
  const m = (s || '').replace(/\s/g, '').replace(',', '.');
  const v = m.match(/(\d+\.?\d*)l/);
  return v ? parseFloat(v[1]) : null;
}
function egyezik(rad, kon) {
  const rn = norm(rad || ''), kn = norm(kon || '');
  if (!rn || !kn) return false;
  const marka = norm((rad || '').split(' ')[0]);
  if (marka && marka.length >= 3 && !kn.includes(marka)) return false;
  const rnTol = tolKek(rn), knTol = tolKek(kn);
  if (!rnTol) return false;
  const lR = kertLiterFn(rad), lK = kertLiterFn(kon);
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

// ---------- Radovin katalógus (Bock/Sauska/Gere) ----------
async function radovinBockSauskaGere() {
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
  const kell = ['bock', 'sauska', 'gere'];
  return all
    .filter((p) => kell.some((k) => (p.name || '').toLowerCase().includes(k)))
    .map((p) => ({
      nev: (p.name || '').replace(/&#8220;|&#8221;/g, '"').replace(/&#038;|&amp;/g, '&').trim(),
      ar: Number(((p.prices && p.prices.price) || 0)),
      url: p.permalink || '',
    }));
}

// ---------- Robusztus WooCommerce katalógus-fetch (header-alapú laptörténet) ----------
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
      const ar = Number(((p.prices && p.prices.price) ?? (p.prices && p.prices.regular_price))) || null;
      const pr = isNaN(ar) ? null : ar;
      osszes.push({ nev: p.name || '', ar: pr, url: p.permalink || '' });
    }
    if (page >= totalPages || j.length < 100) break;
  }
  return osszes.filter((x) => x.nev);
}

async function shopKatalogus(shop) {
  try {
    switch (shop.adapter) {
      case 'katlistas':
      case 'shopify':
      case 'woocommerce-api': {
        if (shop.adapter === 'shopify') return await katlistasTeljesKatalogus(shop, cfg);
        return await woocommerceTeljes(shop.base_url);
      }
      case 'borhalo': return await borhaloKat(shop, cfg);
      case 'shoprenter': return await shoprenterKat(shop, cfg);
      case 'unas': return await unasKat(shop, cfg);
      case 'opencart': return await opencartKat(shop, cfg);
      default: return { hiba: 'nincs_fetch:' + shop.adapter };
    }
  } catch (e) { return { hiba: e.message || String(e) }; }
}

// ---------- Futtatás ----------
(async () => {
  console.log('Radovin Bock/Sauska/Gere lekérése…');
  const radovin = await radovinBockSauskaGere();
  console.log(`  ${radovin.length} tétel.`);

  const shopok = JSON.parse((await import('node:fs')).readFileSync(new URL('../config/shopok.json', import.meta.url), 'utf8')).shopok;
  const aktivek = shopok.filter((s) => s.statusz === 'active' && s.id !== 'radovin');
  console.log('Shopok: ' + aktivek.map((s) => s.id).join(', '));

  const katalogusok = {};
  for (const s of aktivek) {
    const kat = await shopKatalogus(s);
    if (Array.isArray(kat)) { katalogusok[s.id] = kat; console.log(`  ${s.id}: ${kat.length} tétel`); }
    else { katalogusok[s.id] = []; console.log(`  ${s.id}: HIBÁS (${kat.hiba})`); }
  }
  console.log('');

  const shopIds = aktivek.map((s) => s.id);
  const eredmeny = radovin.map((r) => {
    const talalatok = [];
    for (const sid of shopIds) {
      const kat = katalogusok[sid] || [];
      const jelolt = kat.filter((x) => egyezik(r.nev, x.nev));
      if (jelolt.length) {
        talalatok.push({ shop: sid, peldany: jelolt[0].nev, ar: jelolt[0].ar, n: jelolt.length });
      }
    }
    return { ...r, talalatok };
  });

  console.log('================ LEGFEDETTSÉGI TÉRKÉP (Bock/Sauska/Gere) ================\n');
  const fejlec = 'Tétel'.padEnd(50) + shopIds.map((s) => s.padEnd(10)).join('');
  console.log(fejlec);
  console.log('─'.repeat(fejlec.length));
  for (const s of eredmeny) {
    const sejtek = shopIds.map((sid) => {
      const t = s.talalatok.find((x) => x.shop === sid);
      return t ? '✓' : '·';
    });
    console.log(s.nev.padEnd(50) + sejtek.join('         '));
  }
  console.log('');

  console.log('===== RÉSZLETEK (mely shopban, mi a pontos név, milyen áron) =====\n');
  for (const s of eredmeny) {
    console.log('◆ ' + s.nev + '  (Radovin: ' + (s.ar || '?') + ' Ft)');
    if (!s.talalatok.length) { console.log('    (nincs másik shopban)'); continue; }
    for (const t of s.talalatok) {
      console.log(`    ${t.shop} [${t.n === 1 ? '' : t.n + ' tétel'}]: "${t.peldany}" · ${t.ar != null ? t.ar + ' Ft' : 'ár nélkül'}`);
    }
  }

  console.log('');
  console.log('===== ÖSSZESÍTÉS =====');
  let osszesTalalat = 0;
  for (const s of eredmeny) {
    const megvan = s.talalatok.length;
    if (megvan) osszesTalalat++;
    console.log(`${megvan} shop | ${s.nev} | ${s.talalatok.map((t) => t.shop).join(',')}`);
  }
  console.log('');
  console.log(`Összes tétel: ${eredmeny.length} · legalább 1 másik shopban megtalálható: ${osszesTalalat}/${eredmeny.length}`);
})().catch((e) => { console.error('HIBA:', e); process.exit(1); });
