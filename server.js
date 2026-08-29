// Radovin Árfigyelő – kiszolgáló (LOKÁLIS ADMIN)
// Csak a helyi gépen fut, kizárólag a 127.0.0.1 loopback interfészen hallgat.
// Szolgálja a könyvtár statikus fájljait (index.html + data/), és kezeli a
// termék-hozzáadást (api/hozzaad).
// Használat: node server.js  (alapértelmezett: 127.0.0.1:4300)
//
// BIZTONSÁG (Commit 1 / P0):
//  - Kizárólag loopback binding – nem érhető el a hálózatról / internetről.
//  - NEM tartalmaz hardkódolt jelszót / tokent.
//  - A /api/hozzaad írási végpont védett: a környezeti RADOVIN_ADMIN_TOKEN
//    változóval kell hívni (Authorization: Bearer <token>). Ha nincs beállítva
//    a token, az írási végpont letiltott.
//  - A konfig-ba írás ATOMIKUS (temp fájl + rename), hogy ne szakadjon félbe.
//
// A GitHub Pages-en közzétett statikus nézet (index.html + data/) READ-ONLY,
// és NEM tartalmaz semmilyen hitelesítő adatot.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4300;
const HOST = process.env.HOST || '127.0.0.1'; // kizárólag loopback
const DIR = __dirname;
const WEB = DIR;
const DATA = path.join(DIR, 'data');
const TERMEKEK = path.join(DIR, 'config/termekek.json');

const MIME = {
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.png':'image/png',
  '.svg':'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  // --- API: termék hozzáadás (védett, csak loopback) ---
  if (url === '/api/hozzaad' && req.method === 'POST') {
    const tok = process.env.RADOVIN_ADMIN_TOKEN;
    const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!tok || auth !== tok) {
      res.writeHead(401, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:false, hiba:'admin token hiányzik vagy érvénytelen; a /api/hozzaad írási végpont védett és csak helyi tokennel hívható'}));
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const adat = JSON.parse(body || '{}');
        const nev = (adat.nev || '').trim();
        if (!nev) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,hiba:'név kötelező'})); return; }
        const lista = JSON.parse(fs.readFileSync(TERMEKEK, 'utf8'));
        const id = nev.toLowerCase().replace(/[^a-z0-9áéíóöőúüű]+/g,'-').replace(/(^-|-$)/g,'') || ('termek-'+Date.now());
        if (lista.termekek.some(t => t.nev.toLowerCase() === nev.toLowerCase())) {
          res.writeHead(200, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ok:true, duplikalt:true, uzi:'Már létezik ez a termék.'}));
          return;
        }
        lista.termekek.push({
          id,
          nev,
          marka: (adat.marka || '').trim() || null,
          tipus: 'egyéni',
          meret: (adat.meret || '').trim() || null,
          evjarat: null,
          radovin_kereso: (adat.radovin_kereso || '').trim() || nev,
        });
        // ATOMIKUS írás (temp + rename): ne sérüljön a konfig félbemaradt írásnál.
        const tmp = TERMEKEK + '.tmp-' + process.pid + '-' + Date.now();
        fs.writeFileSync(tmp, JSON.stringify(lista, null, 2));
        fs.renameSync(tmp, TERMEKEK);
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true, id}));
      } catch (e) {
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, hibba: e.message}));
      }
    });
    return;
  }

  // --- Statikus fájlok (web/ + data/) ---
  let fpath;
  if (url === '/') fpath = path.join(DIR, 'index.html');
  else if (url.startsWith('/data/')) fpath = path.join(DATA, url.slice('/data/'.length));
  else fpath = path.join(WEB, url);

  const safe = fpath.startsWith(DIR);
  if (!safe || !fs.existsSync(fpath) || fs.statSync(fpath).isDirectory()) {
    res.writeHead(404); res.end('Nem található'); return;
  }
  const ext = path.extname(fpath).toLowerCase();
  res.writeHead(200, {'Content-Type': MIME[ext] || 'application/octet-stream'});
  fs.createReadStream(fpath).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`Radovin Árfigyelő fut (LOKÁLIS): http://${HOST}:${PORT}`);
});
