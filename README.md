# 🍷 Radovin Árfigyelő

Borok és tömény italok árának összehasonlítása a **Radovin** és a versenytársak között.
A rendszer meghatározott gyakorisággal (alapértelmezett: **8 óránként**) lekérdi a termékárakat,
elmenti őket (idősort is vezet), és mutatja, hogy a Radovin ára **hova esik** a konkurens
ajánlatok közé.

## Főbb képességek
- **Árlekérés** a Radovin (és – fejlesztés alatt – a versenytársak) webshopjából
- **Ártárolás**: minden futás hozzáfűződik a `data/arak.jsonl`-hez (append-only, nem vész el korábbi adat)
- **Pozíció-jelölés**: a Radovin ár = hányadik a legalacsonyabbtól (pl. `2/5`)
- **Idősor / előzmények**: `data/elozmeny.json` — visszanézhetők a korábbi futások
- **Webes nézet**: `index.html` – jelenlegi állapot + árelőzmények, kereshető
- **Admin**: termékek hozzáadása (belépés: e-mail + jelszó)
- **Ütemezés**: 8 óránkénti futtatás cron-jobból (Mac mini) + push a GitHubra

## Futtatás
```bash
npm install      # ha szükséges (jelenleg nincs külső függőség)
node run.js      # árlekérés + adatmentés + előzmény
node server.js   # webes megjelenítő: http://localhost:4300
```

## Konfiguráció
- **Termékek**: `config/termekek.json` – az összehasonlítandó borok/tömény italok
  (azonosság = név + márka + kiszerelés + pontos terméknév)
- **Shopok**: `config/shopok.json` – az adapterek és a shop-státuszok
  - `active` = lekérve a futtatáskor, `pending` = adapter még fejlesztés alatt
  - A **Bortársaság** bot-védett, ehhez fejfeles böngésző + engedély kell, ezért `blocked`

## Adapterek és jelenlegi lefedettség (repertoár)
**Kinyerési módok, amelyek működnek és pontosak:**
1. **WooCommerce JSON-LD** (`woocommerce` adapter): a Radovin és a Winehub pontosan,
   headless nélkül. A keresőből termék-URL-t, a termékoldal JSON-LD `price` mezőjéből árat.
2. **Katalóguslista-API** (`katlistas`/`shopify`/`woocommerce-api` adapter, `lib/katlistas.js`):
   a teljes katalógust nyilvános JSON-endpointról húzza – Shopify `/products.json` (Borvilág),
   WooCommerce `/wp-json/wc/store/products` (Borpiac) – és a szigorú matcherrel jelöli a legjobb
   találatot. **Headless NÉLKÜL** megbízható, pontos.
3. **Headless (böngészős)** (`headless` adapter, Puppeteer-core + a rendszer Chrome-ja): a
   JS-renderelt/AJAX-os shopokhoz (Italpark, Veritas, Borháló, Bortársaság), amelyek sima GET-re
   nem adnak megbízható árat. A headless adapter **méret-tudatos**: ha a találat kiszerelése eltér
   a katalógus-tételétől (pl. a Radovin 1l-es vs az Italpark 0,7l-es Johnnie Walker), a találatot
   elutasítja (`kiszereles_elteter`), így **soha nem ad hamis / eltérő kiszerelésű** összehasonlítást.
   A `kategoria_url` (márka-alapú kategóriaoldal) használatakor először olcsó GET-ellenőrzéssel
   kiszűri a nem létező kategóriákat (nem indít böngészőt hiába).

**Jelenleg éles, pontos shopok:** Radovin (saját), Winehub, Borvilág, Borpiac, **Italpark (headless)**.
**Fejlesztés alatt:** Veritas, Borháló, Benebor, Borbáró (JS/robotvédett).
**Bot-védett:** Bortársaság.

> Az Italpark headless-szel aktív, de a jelenlegi katalógus tételeihez **nincs valódi (azonos
> kiszerelésű) Italpark-árazás** – a Johnnie Walker Black a Radovinnál 1l, az Italparkon 0,7l
> (eltérő termék), a többi tétel Radovin-specifikus. A rendszer ezt **becsületesen „nincs adat“-ként**
> jelzi (nem hamis árat), és amint olyan tétel kerül be, amely az Italparkon azonos kiszerelésben
> kapható, automatikusan élesen összehasonlítja.

**A párosítás szigorú**: a versenytársi találat csak akkor számít, ha a márka, a
kiszerelés (liter) és adott esetben a puttony-szám is egyezik. A „generikus“ márka (pl.
„generikus (Tokaj)“) azt jelenti, hogy bármely pincészet elfogadható (a típust/puttonyt
így a radovin tétele pozíciójához mérjük). Ha nincs pontos találat, **nem** adunk hamis
árat — a tétel „nincs adat” jelzést kap.

## Adatfájlok
- `data/arak.jsonl` – nyers, idősoros áradat (minden futás)
- `data/legutobbi.json` – a legutóbbi futás összesítése (webes nézet)
- `data/elozmeny.json` – termékenkénti előzmény-index

## Megjegyzés
Az árakhoz a **Radovin WooCommerce JSON-LD**-je ad pontos adatot (stabil).
A versenytársak többsége nem ad nyílt API-t, az ő árkinyerésük (Veritas, Borháló,
Italpark, Benebor, Borbáró, Winehub) **per-shop validált adaptert igényel**, ami
folyamatosan kerül beépítésre; amíg nem éles, **nem számítanak bele hamis adatot**
a pozíciókba (jelzéssel jelennek meg).
