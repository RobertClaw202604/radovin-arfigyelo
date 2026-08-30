// Radovin árfigyelő – korlátos párhuzamosság segéd (guide §11, Commit 6).
// Függőség nélküli mapLimit: legfeljebb `limit` worker dolgozik egyszerre,
// így nem döntjük le magunknak a shopokat / nem szabadul el a Chrome-folyamatok száma.

'use strict';

/**
 * `values` elemein futtatja a `worker`-t, legfeljebb `limit` egyidejű hívással.
 * Az eredmények az input sorrendjében állnak elő; a kimeneti tömb nem feltétlenül
 * abban a sorrendben „érkezik meg”, de a return FIX sorrendű.
 *
 * @template T, R
 * @param {T[]} values
 * @param {number} limit
 * @param {(value: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
async function mapLimit(values, limit, worker) {
  const results = new Array(values.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  }

  const count = Math.max(1, Math.min(Math.floor(limit) || 1, values.length));
  await Promise.all(Array.from({ length: count }, () => runWorker()));
  return results;
}

module.exports = { mapLimit };
