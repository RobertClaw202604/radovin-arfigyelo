// Radovin Árfigyelő – kiszolgáló
// Kiszolgálja a web/ mappát + kezeli a termék-hozzáadást (api/hozzaad),
// valamint biztosítja a data/ JSON-öket a megjelenítéshez.
// Használat: node server.js  (alapértelmezett: localhost:4300)
//
// MEGJEGYZÉS: a per-shop scraping a run.js-ben fut; ez a szerver csak a
// megjelenítőt és a termék-hozzáadást szolgálja. Éles gitHub publikáláskor
// a static site a web/ + data/ feltöltésével is működik (run.js generálja).

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4300;
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

  // --- API: termék hozzáadás ---
  if (url === '/api/hozzaad' && req.method === 'POST') {
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
        fs.writeFileSync(TERMEKEK, JSON.stringify(lista, null, 2));
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

server.listen(PORT, () => {
  console.log(`Radovin Árfigyelő fut: http://localhost:${PORT}`);
});
