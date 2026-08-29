// Segédfüggvények: timeout-os fetch, szám-normalizálás

async function fetchTimeout(url, ms, ua, delayMs = 0) {
  if (delayMs) await sleep(delayMs);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 25000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': ua || 'Mozilla/5.0', 'Accept-Language': 'hu-HU,hu;q=0.9' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function num(v) {
  if (v == null) return null;
  const s = String(v).replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { fetchTimeout, num, sleep };
