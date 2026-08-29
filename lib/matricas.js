// A konkurencia-termékhez legjobban illeszkedő találat kiválasztása.
// Szigorú matcher: márka + kiszerelés (liter) + puttony-szám egyezés kell.
// Ha nincs pontos találat, nullt adunk – SOHA nem hamis árat.

function norm(s) {
  return (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

// Találat mérete literben (a termék nevéből)
function talalatLiter(n) {
  const m = norm(n).replace(/\s/g, '');
  if (/magnum/.test(m)) return m.includes('double') ? 3 : 1.5;
  const lit = m.match(/(\d)[,.]?(\d{1,2})?l/);
  if (lit) {
    if (!lit[2]) return parseFloat(lit[1]);
    return parseFloat(lit[1] === '0' ? '0.' + lit[2] : lit[1] + '.' + lit[2]);
  }
  const cl = m.match(/(\d+)cl/);
  if (cl) return parseFloat(cl[1]) / 100;
  return null;
}

// A kért méret literben a meret mezőből (pl. '0,75 l' -> 0.75)
function kertLiter(meret) {
  const m = (meret || '').replace(/\s/g, '').replace(',', '.');
  if (m.includes('cl')) { const v = m.match(/(\d+)\.?\d*cl/); if (v) return parseFloat(v[1]) / 100; }
  const v = m.match(/(\d+\.?\d*)l/);
  return v ? parseFloat(v[1]) : null;
}

// Puttony-szám a névben (ha van)
function puttony(n) {
  const m = norm(n).match(/(\d)\s*puttonyos/);
  return m ? parseInt(m[1], 10) : null;
}

// Kinyeri egy termék évjáratát (4 jegyű évszám) az evjarat mezőből VAGY a névből.
function evjaratEgyezes(termek, talalatNev) {
  const tn = norm(talalatNev).replace(/\s/g, '');
  // Elsődleges forrás: a termék evjarat mezője (pl. '2021').
  let kert = null;
  if (termek.evjarat) {
    const ev = norm(termek.evjarat).match(/\b(19\d{2}|20\d{2})\b/);
    if (ev) kert = ev[1];
  }
  // Ha nincs evjarat mező, a névből próbáljuk (pl. 'Bock Merlot 2021').
  if (kert == null) {
    const ev = norm(termek.nev).match(/\b(19\d{2}|20\d{2})\b/);
    if (ev) kert = ev[1];
  }
  // Nincs kért évjárat → nem kötelező az egyezés (pl. whisky, gin, pezsgő évjárat nélkül).
  if (kert == null) return { kotelezo: false };
  // Kötelező: a találat nevében szerepelnie kell a pontos évjáratnak.
  const egyezik = tn.includes(kert);
  return { kotelezo: true, egyezik, kert };
}

function szigor(talalatok, termek) {
  if (!talalatok || !talalatok.length) return null;
  const kulcsszavak = termek.nev.toLowerCase().split(/[^a-z0-9éáíóöőúüűãæëç]+/).filter((w) => w.length > 2);
  // Ha a marka mező „generikus…“-kal kezdődik, az NEM valódi márka-követelmény
  // (pl. „generikus (Tokaj)“), csak jelzi a típust – ilyenkor bármely pincészet elfogadható.
  const markaNyers = (termek.marka || '').trim();
  const generikus = /^generikus/i.test(markaNyers);
  const markaNorm = generikus ? '' : norm(markaNyers).replace(/\s/g, '');
  const kertPuttony = puttony(termek.nev);
  const kL = kertLiter(termek.meret);
  // Ha a terméknek van explicit fajta-mezője (pl. 'Merlot', 'Chardonnay'), az KOTELEZO
  // egyezés: a találat nevében szerepelnie kell a fajtának – különben riskos a márka+
  // evjarat egyezes elerheto, de mas a sorta (pl. 'Bock Merlot 2021' vs 'Bock Syrah 2021').
  const fajtaNorm = termek.fajta ? norm(termek.fajta).replace(/\s/g, '') : '';
  const fajtaKotelezo = fajtaNorm.length > 0;
  // Ha a keresett név puttony-számot kötelezőként tartalmaz (pl. „5 puttonyos aszú“),
  // akkor a találatnak is tartalmaznia kell puttony-számot, és az pontosan egyezzen.
  const puttonyKotelezo = kertPuttony != null;
  // Évjárat-kötelezettség előre kiszámítva (a találatok név-alapú ellenőrzéséhez).
  const evJ = evjaratEgyezes(termek, '');

  let best = null;
  let bestScore = -Infinity;
  for (const t of talalatok) {
    const nyers = norm(t.nev);
    const n = nyers.replace(/\s/g, '');
    let score = 0;

    // Márka-követelmény: csak valódi (nem generikus) márkánál kötelező.
    if (markaNorm && !n.includes(markaNorm)) continue;

    // KOTELEZO fajta-egyezés: ha a terméknek van fajta-mezője, a találat nevében is
    // szerepelnie kell a pontos fajtának – különben érvénytelen (nem hamis ár).
    if (fajtaKotelezo && !n.includes(fajtaNorm)) continue;

    // Kötelező évjárat-egyezés: ha a terméknek van évjárata, a találat nevében is
    // szerepelnie kell a PONTOS évjáratnak – különben érvénytelen (nem hamis ár).
    if (evJ.kotelezo) {
      if (!n.includes(evJ.kert)) continue;
      score += 3;
    }

    // Kötelező puttony-egyezés: aszúnál a találatnak tartalmaznia kell a pontos puttony-számot.
    if (puttonyKotelezo) {
      const tPuttony = puttony(n);
      if (tPuttony === null || tPuttony !== kertPuttony) continue; // nincs puttony vagy eltér → érvénytelen
    }

    for (const k of kulcsszavak) if (n.includes(k)) score++;

    // Puttonyos-egyezés (5 vs 6 nem keverhető)
    const tP = puttony(n);
    if (kertPuttony != null && tP != null) score += (kertPuttony === tP) ? 3 : -5;

    // Méret-egyezés
    const tL = talalatLiter(nyers);
    if (kL != null && tL != null && kL > 0) {
      const diff = Math.abs(kL - tL);
      if (diff < 0.05) score += 2;
      else if (diff < 0.2) score += 0;
      else score -= 4;
    }

    if (score > bestScore && score > 0) { bestScore = score; best = t; }
  }
  return best;
}

module.exports = { norm, talalatLiter, kertLiter, puttony, szigor, evjaratEgyezes };
