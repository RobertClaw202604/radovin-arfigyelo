// Pozíció-számítás: a Radovin ára hova esik a konkurens ajánlatok között?
// Visszaad: min, max, median, rank (hányadik a legalacsonyabbtól), összes ár.

function pozicio(arak) {
  if (!arak) return { van: false, darab: 0, min: null, max: null, median: null, radovin_ar: null, rank: null, rank_jelolo: '—' };

  const all = (arak || []).filter((a) => a && a.ar != null && a.ar > 0);
  if (!all.length) return { van: false, darab: 0, min: null, max: null, median: null, radovin_ar: null, rank: null, rank_jelolo: '—' };

  const ertekek = all.map((a) => a.ar).sort((x, y) => x - y);

  // medián
  const mid = Math.floor(ertekek.length / 2);
  const median = ertekek.length % 2
    ? ertekek[mid]
    : (ertekek[mid - 1] + ertekek[mid]) / 2;

  // Radovin ára és helye
  const rad = all.find((a) => a.shop === 'radovin');
  let rank = null;
  if (rad) {
    rank = ertekek.filter((e) => e < rad.ar).length + 1; // 1 = legolcsóbb
  }

  return {
    van: true,
    darab: all.length,
    min: ertekek[0],
    max: ertekek[ertekek.length - 1],
    median: Math.round(median * 100) / 100,
    arak: all,
    radovin_ar: rad ? rad.ar : null,
    rank: rank,                       // pozíció (1..N)
    rank_jelolo: rank ? `${rank}/${all.length}` : '—', // pl. 2/5
  };
}

module.exports = { pozicio };
