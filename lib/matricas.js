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
  // Ha a keresett név puttony-számot kötelezőként tartalmaz (pl. „5 puttonyos aszú“),
  // akkor a találatnak is tartalmaznia kell puttony-számot, és az pontosan egyezzen.
  const puttonyKotelezo = kertPuttony != null;

  let best = null;
  let bestScore = -Infinity;
  for (const t of talalatok) {
    const nyers = norm(t.nev);
    const n = nyers.replace(/\s/g, '');
    let score = 0;

    // Márka-követelmény: csak valódi (nem generikus) márkánál kötelező.
    if (markaNorm && !n.includes(markaNorm)) continue;

    // Ha valódi márka megy, a generikus (pl. borrégió-típusú „tokaji“) nem feltetlenül
    // a termék márkája – de a puttony-/méret-egyezés ettől függetlenül dönt.

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

module.exports = { norm, talalatLiter, kertLiter, puttony, szigor };
