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

## Adapterek és jelenlegi lefedettség
- **WooCommerce/JSON-LD** (`woocommerce` adapter): a Radovin és a Winehub pontosan,
  headless nélkül. A keresőből termék-URL-t, a termékoldal JSON-LD `price` mezőjéből árat.
- **Headless (böngészős)** (`headless` adapter, Puppeteer-core + a rendszer Chrome-ja):
  a JS-renderelt/AJAX-os shopokhoz (Veritas, Italpark, Borháló, Bortársaság), amelyek
  sima GET-re nem adnak megbízható árat. Jelenleg `pending` / validálás alatt; a
  sima kereső-lista sok esetben robotvédett, ezért per-márka kategóriaoldalról érdemes
  kinyerni.

**A párosítás szigorú**: a versenytársi találat csak akkor számít, ha a márka, a
kiszerelés (liter) és adott esetben a puttony-szám is egyezik. Ha nincs pontos találat,
**nem** adunk hamis árat — a tétel „nincs adat” jelzést kap. Ez elkerüli, hogy a pozíciót
összekevert (pl. 5 vs 6 puttonyos, más márka) árak torzítsák.

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
