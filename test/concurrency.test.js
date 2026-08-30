// Radovin árfigyelő – Commit 6: korlátos párhuzamosság + katalógus-gyorsítótár.
// (a browser-pool valós Chrome-indítást igényel, amit ez a teszt NEM indít;
//  a pool-logikát mock-olt függőséggel ellenőrizzük, ha indokolt)

const test = require('node:test');
const assert = require('node:assert/strict');
const { mapLimit } = require('../lib/runtime/concurrency.js');

test('mapLimit: minden elemet feldolgoz, az eredmény sorrendje fix', async () => {
  const out = await mapLimit([1, 2, 3, 4, 5], 2, async (x) => x * 10);
  assert.deepEqual(out, [10, 20, 30, 40, 50]);
});

test('mapLimit: limit=1 szekvenciális, limit>len is biztonságos', async () => {
  const seq = await mapLimit([1, 2, 3], 1, async (x) => x + 1);
  assert.deepEqual(seq, [2, 3, 4]);
  const over = await mapLimit([1, 2], 99, async (x) => x * 2);
  assert.deepEqual(over, [2, 4]);
});

test('mapLimit: sosem dolgoz párhuzamosan többen mint a limit (max aktív számláló)', async () => {
  let active = 0;
  let maxActive = 0;
  await mapLimit([0, 1, 2, 3, 4, 5, 6], 3, async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
  });
  assert.ok(maxActive <= 3, `maxActive=${maxActive}`);
  assert.equal(maxActive, 3); // 3 worker aktívan dolgozott egy időben
});

test('mapLimit: empty array a katonai átmegy', async () => {
  assert.deepEqual(await mapLimit([], 2, async (x) => x), []);
});
