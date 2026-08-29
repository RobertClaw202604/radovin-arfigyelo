#!/usr/bin/env node
// Radovin árfigyelő – titkos-ellenőrző (Commit 1 / P0).
//
// Átfésüli a könyvtár NEM-ignorált fájljait, és hibával kilép, ha bármilyen
// lehetséges hitelesítő adat / token / jelszó-szerű minta a verziókezelt kódban
// van (amely a GitHub Pages-re vagy a repóba kerülhetne).
//
// Használat: node scripts/scan-secrets.js   (elhagyható: --strict)
// Kilépési kód: 0 = tiszta, 1 = talált minta (kiírva).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const IGNORED = [
  '.git',
  'node_modules',
  'data',           // a nyers, append-only gyűjtő – a Pages-en is publikus, de nem kód;
                    // a Product-URL-ek tartalmazhatják a "secret" szót (pl. borcímek),
                    // ezért itt nem vizsgáljuk (a publikálásra kerülő tömör változatot igen).
  'runtime',        // lokális, git-ignore-olt futás-könyvtár
];

// Erős minták: konkrét hitelesítő adatok, amik NEM kerülhetnek a built/ publikálásra.
// (A gyenge szavakat – password, secret, token – NEM keressük önmagukban, mert
//  a terméknevek / dokumentáció gyakran tartalmazzák. Csak konkrét érték-jelöléseket.)
const MMP = [
  // /(https?:)?\/\/(sk-|pk-|ea|ghp_|github_pat_|xoxb-|xoxp-|AKIA)[A-Za-z0-9_\-]{10,}/,
  /\b(sk-[A-Za-z0-9]{16,})\b/,
  /\b(ghp_[A-Za-z0-9]{36,})\b/,
  /\b(AKIA[0-9A-Z]{16})\b/,
  /\b(EAA[A-Za-z0-9]{40,})\b/,           // Facebook/Meta page & user token
  /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/,  // Slack token
  /api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9]{20,}/i,
  /(password|jelszo|admin_pw|ADMIN_PW)\s*[:=]\s*["'][^"']{6,}["']/i,
  /Bearer\s+[A-Za-z0-9._\-]{20,}/,
];

function isIgnored(p) {
  const rel = path.relative(ROOT, p);
  return IGNORED.some((ig) => rel === ig || rel.startsWith(ig + path.sep));
}

function walk(dir, acc) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!isIgnored(full)) walk(full, acc);
    } else if (e.isFile() && ['.js', '.mjs', '.cjs', '.json', '.html', '.md', '.ts', '.env'].includes(path.extname(e.name))) {
      acc.push(full);
    }
  }
  return acc;
}

let koszos = [];
for (const f of walk(ROOT, [])) {
  let txt;
  try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
  for (const re of MMP) {
    const m = txt.match(re);
    if (m) {
      koszos.push(`${path.relative(ROOT, f)}: ${re} -> "${(m[0]||'').slice(0,32)}…"`);
    }
  }
}

if (koszos.length) {
  console.error('⚠️ Lehetséges hitelesítő adat a verziókezelt fájlokban:');
  for (const k of koszos) console.error('  - ' + k);
  console.error('Javítsd (távolítsd el / környezeti változóba rakd), mielőtt publikálod.');
  process.exit(1);
} else {
  console.log('✅ Nincs ismert hitelesítő adat minta a verziókezelt fájlokban.');
}
