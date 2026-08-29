# Radovin Price Monitor — Technical Specification

A complete, implementation-ready specification of the working system at
`arfigyelo/` (repo `RobertClaw202604/radovin-arfigyelo`, live on GitHub Pages:
`https://robertclaw202604.github.io/radovin-arfigyelo/`). Written so the system
can be rebuilt from scratch from this document alone.

**State snapshot (2026-08-29):** 46 catalog entries total · **40 active** ·
6 suspended · 6 active shops · run `#1788030905000` = 40/40 Radovin baseline ·
**32 items with ≥1 precise competitor price** · currency HUF.

---

## 1. Purpose

Compare the **Radovin** price for a set of tracked products (wine + spirits)
against competitor webshops, on a fixed schedule (default **every 8 hours**),
and show where Radovin's price falls among competitors (rank, e.g. `2/5`).

**Hard constraints (the reason this system is trustworthy):**
- **Never emit a false price.** If no precise competitor match exists, the item
  reports "no data" — never a guessed/approximate price.
- **Radovin is the baseline.** Only track products that Radovin actually sells.
  Competitor prices are comparisons for those baseline items.
- Product identity must be **exact** (see §5). Approximate matches are rejected.

---

## 2. Tech stack & runtime

- **Language:** Node.js ≥18 (`type: commonjs`)
- **Dependencies:** `puppeteer-core` ^25.9.0 (for the headless adapter only).
  Everything else uses the built-in `fetch` (Node ≥18) — no HTTP client lib.
- **Runtime host:** the Mac mini, via a cron job (`cron` id `f2fed49c-...`,
  every `28800000` ms = 8 h). The cron runs `run.js`, then `git commit + push`
  so the fresh data reaches GitHub Pages.
- **No database.** All persistence is append-only JSONL files + JSON index files,
  all committed to git (the repo IS the database). GitHub Pages serves the static
  web view.
- **HTTP/2-friendly, good netizen behavior:** ASCII bot UA defined globally;
  per-request timeout + `kesleltetes_ms` (delay) between fetches.

### File layout
```
config/shopok.json     shop list + which adapter each uses + status
config/termekek.json   the catalog of tracked products (the "items")
data/arak.jsonl        append-only, one JSON obj per (run × item) — price time-series
data/legutobbi.json    latest run aggregate (drives the web view)
data/elozmeny.json     per-item history index (run ids / dates / ranks)
data/termekek.jsonl    append-only product-collector time-series (URL-keyed)
data/termekek.json     URL-keyed index of the product collector (for the "Terméktárház" tab)
data/felmeres-radovin.json  full Radovin catalog survey dump (1556 products, slug+price)
lib/utils.js           fetchTimeout, num (price normalizer), sleep
lib/matricas.js        STRICT matcher (brand + size + vintage + variety + puttony)
lib/scraper.js         dispatcher + woocommerce adapter (+ html-simon fallback)
lib/katlistas.js       catalog-list adapter (Shopify /products.json, WooCommerce /wp-json)
lib/borhalo.js         Borháló catalog adapter (GA4 dataLayer in raw HTML)
lib/headless.js        Puppeteer-core adapter (JS/AJAX shops)
lib/pozicio.js         rank / min / max / median computation
lib/termekgyujto.js    product collector (URL-keyed time series)
run.js                 main pipeline entry point
server.js              optional local web server (port 4300)
index.html             static web view (shops + Terméktárház tab)
```

---

## 3. Resource model (the two config files)

### 3.1 `config/shopok.json`
Top-level meta + `ciklus_ora` (8), `timeout_sec` (25), `user_agent`, and a
`shopok` array. Each shop:

| field | meaning |
|---|---|
| `id` | stable key (e.g. `radovin`, `borhalo`) |
| `nev` | display name |
| `tipus` | `sajat` (Radovin itself) or `konkurencia` |
| `statusz` | `active` (queried at run) · `pending` (adapter not done) · `blocked` (bot-walled) |
| `base_url` | root (WARNING: Borháló must be **non-www**; www 301s on some cats) |
| `kereso_url` | search template with `{q}` (used by woocommerce / headless) |
| `adapter` | which adapter (_see §4_) |
| `kesleltetes_ms` | delay between requests |
| shop-specific | `kategoria_slugek`, `kategoria_max_lap`, `kategoria_url`, `termek_kartya_selector`, `ar_selector`, `termek_selector` |

**Current shops (status → adapter):**
- `radovin` active → `woocommerce` (baseline)
- `winehub` active → `woocommerce-api` (catalog list)
- `borvilag` active → `shopify` (catalog list)
- `borpiac` active → `woocommerce-api` (catalog list)
- `borhalo` active → `borhalo` (custom catalog)
- `italpark` active → `headless`
- pending: `veritas` (`headless`), `benebor` (`html-simon`), `borbaro` (`html-simon`)
- blocked: `bortarsasag` (bot-walled; needs headless + mobile-UA + in-page filter)

### 3.2 `config/termekek.json` — the catalog
`meta` (version, date) + `termekek` array. Each item:

| field | meaning / rules |
|---|---|
| `id` | snake-case unique slug (the stable key across runs) |
| `nev` | display name, must include vintage for wines |
| `marka` | brand; `generikus (...)` prefix = brand NOT mandatory (type only) |
| `tipus` | `vörösbor` / `fehérbor` / `rosé` / `édesbor` / `pezsgő` / `gin` / `whisky` / `rum` / `pálinka` … |
| `meret` | e.g. `0,75 l` (normalized to liters internally) |
| `evjarat` | vintage `YYYY` for wines / sparkling; `null` for spirits/Champagne |
| `fajta` | **the critical field** — see §5 |
| `radovin_kereso` | search string for the `/?s=` fallback |
| `radovin_slug` | exact Radovin product slug → **direct JSON-LD fetch** (precise + fast) |
| `aktiv` | `false` = suspended (kept, not deleted) |
| `szuneteltetes_oka` | reason + date for suspension |
| `megjegyzes` | provenance note (which verified pair, prices) |

**Suspension rule:** `aktiv:false` + `szuneteltetes_oka` instead of deletion —
never lose data. `run.js` skips these (`if (termek.aktiv === false) continue`).

---

## 4. Adapter repertoire (how prices are extracted)

There are **5 working extraction methods**. Robustness ranking (highest first):

1. **Catalog-list JSON API** (`katlistas.js`; adpters `katlistas`/`shopify`/
   `woocommerce-api`) — pull the shop's **entire catalog** from its public JSON
   endpoint, then run the strict matcher. No headless, no fragile search.
   - Shopify: `GET {base}/products.json?limit=250&page=N` → `title`, first
     `variant.price`, URL = `https://{host}/products/{handle}`.
   - WooCommerce: `GET {base}/wp-json/wc/store/products?per_page=100&page=N`
     → `name`, `prices.price`, `permalink`.
   - Used by: Winehub, Borvilág, Borpiac.
2. **WooCommerce JSON-LD** (`scraper.js` `woocommerce`) — Radovin + Winehub
   (legacy) search-based.
   - **If `radovin_slug` present:** fetch `{host}/termek/{slug}/` directly, read
     the JSON-LD `price` (and `name`). Precise + fast; bypasses fragile search.
   - Else: hit `kereso_url={q}`, extract candidate product slugs from a
     `host/termek/{slug}` regex, fetch each product page, read JSON-LD `price`,
     then strict-match.
3. **Borháló catalog** (`borhalo.js`) — custom, headless-free. Borháló puts the
   name+price in the **GA4 dataLayer JSON** inside raw HTML
   (`data-gt-params` → `item_name` + `price`), with `href=/termek/{slug}` on the
   same `<a>`. Pages: `{base_url}/termekeink/{kat}?limit=100&page=N`, paginated
   (≤`kategoria_max_lap`, stop when a page returns <100). **base_url MUST be
   non-www** (`https://borhalo.hu`). Categories: borok-2, pezsgok-6, parlatok-8.
   Catalog cached per run (not per item).
4. **Headless** (`headless.js`, Puppeteer-core + system Chrome) — for JS/AJAX
   shops. Used by Italpark. Notable design points:
   - Pre-filter: check the brand category page with plain `fetch` (200) **before**
     launching a browser (avoids wasting a browser on a 404).
   - `waitUntil:networkidle0` → falls back to `domcontentloaded` (some sites
     never go network-idle due to telemetry).
   - Extracts product URL by best keyword match (not first result), rejects
     category-looking links, then reads price: JSON-LD → `itemprop=price` →
     shop-specific `ar_selector`.
   - **Size-awareness is critical (§5):** if the found product's size differs
     from the catalog item's (e.g. 0.7l vs 1l), the item is rejected
     (`kiszereles_elteter`), never a false comparison.
   - **Cost:** headless is the slow, heavy method — it dominates runtime and is
     the reason long multi-item runs risk SIGKILL (§7 ops lessons).
5. `html-simon` — context-based HTML regex (retained, least reliable; only for
   pending shops Benebor/Borbáró).

**Disabled/skipped:** `blocked` shops short-circuit in `scraper.run()`.

---

## 5. The strict matcher (`matricas.js`) — accuracy guarantee

`szigor(talalatok, termek)` scores every candidate and returns the single best
(`null` if none qualifies). Hard rejections (skip candidate):
- **Brand** must appear, unless `marka` starts with `generikus`.
- **`fajta` (variety/tétel) is MANDATORY** if the item has a `fajta` field: the
  candidate's name must contain the exact `fajta` string. This is what prevents
  e.g. Double Black being matched as Black Label.
- **Vintage is MANDATORY** (not a bonus): if the item has `evjarat`, the
  candidate's name must contain the exact year. (Extracted from `evjarat` field
  OR the item name.)
- **Puttony count is MANDATORY** for aszú: candidate must contain the exact
  puttony number (5 vs 6 not interchangeable).

Scoring (after passing the mandatory gates): keyword hits + puttony agreement
(+3 / −5 mismatch) + size agreement (`talalatLiter`):
- `|diff| < 0.05` → +2
- `|diff| < 0.2` → 0 (tie)
- else → −4 (size mismatch)

Accept only if `score > 0`. Returns the highest-scoring candidate.

### The `fajta` field — the single most important lesson
- **Wine:** Borháló and Radovin name the variety identically (Chardonnay,
  Portugieser, Kopar…) → same `fajta` works for both.
- **Spirits:** Radovin and Borvilág name the SAME product differently.
  Radovin "8 Years" ↔ Borvilág "Reserve Blend"; Radovin "XO Triple Cask" ↔
  Borvilág "XO Reserve Triple Cask"; Radovin "Black Triple Cask" ↔ Borvilág
  "Black Label Triple Cask".
  → **The `fajta`/tétel field MUST store the COMPETITOR's exact naming** so the
  matcher hits precisely and excludes near-but-not-identical items.

---

## 6. Position computation (`pozicio.js`)

`pozicio(arak)`:
- Filter to finite positive prices.
- `min`, `max`, `median` (median = middle value; even count → mean of the two middle).
- `rank` = count of prices strictly below Radovin's +1 → 1 = cheapest.
- `rank_jelolo` = `"2/5"` style label.

Only **active, validated** prices enter the position. `pending`/`blocked` shops
are reported separately with a "developing" flag and **never counted** in rank.

---

## 7. The run pipeline (`run.js`)

For each active item (skipping suspended):
1. For each active shop → `scraper.run(item, shop, cfg)`.
2. **Product collector** (§8): every concrete hit (url + price) is saved via
   `termekgyujto.mentes`, REGARDLESS of matchability.
   - Catalog-list shops' full lists are saved **once per shop per run**
     (a `katalogusosCachel` map), then only the matched best hit per item — to
     avoid 13× JSONL duplication.
3. `pozicio(termekArak)`.
4. Append one JSON object to `data/arak.jsonl`.
5. After all items: write `data/legutobbi.json` (latest run aggregate) and
   update `data/elozmeny.json` (per-item history).

---

## 8. Product collector (`termekgyujto.js`) — "Terméktárház"

Szabolcs's requirement: **save EVERY concrete product found** (name, link, price,
date), even if unmatchable. The **URL is the time-series key** (the link stays
stable across price changes; new price points attach to the same URL).

- `urlKulcs(u)`: strips trailing slash + query → stable key.
- `mentes(betelek)`: appends `{url, nev, ar, ido, shop, termek_id, tipus}` to
  `data/termekek.jsonl` (append-only) and updates the URL-keyed index
  `data/termekek.json` (last 500 points kept per URL for memory).
- The web view's "📦 Terméktárház" tab lists them (searchable, series length,
  price-change flag).
- Scale: 19,000+ JSONL lines / 6,000+ unique URLs across 5 shops.
- **Does not** affect the crawl/matcher — it is a mandatory logging layer.

### Product survey
`data/felmeres-radovin.json` is a full dump of Radovin's public WooCommerce
catalog API: `https://radovin.hu/wp-json/wc/store/products` (plain GET works,
UA `radovin-arfigyelo`), 1,556 products, 56 categories, `slug` + `price`.
WARNING: Radovin's `currency_minor_unit` is `0`, so `prices.price` is **forint**,
NOT fillér — do not divide by 100.

---

## 9. Web view

`index.html` (static, served by GitHub Pages):
- Current state from `data/legutobbi.json` + history from `data/elozmeny.json`.
- Admin section (client-side login — `szbudahazy@gmail.com` / `Camel100`,
  it's a demo login only): add products.
- "📦 Terméktárház" tab: product collector browsing.
- Read-only against the repo; no server DB.

---

## 10. How to run

```bash
npm install            # only pulls puppeteer-core
node run.js            # full price run + writes data files
node server.js         # optional: http://localhost:4300
```
Cron: `run.js` + `git add -A && git commit && git push` every 8 h
(`cron` job `f2fed49c-e62c-437a-993b-238555b66c42`, session target = the
Radovin Telegram thread/topic).

---

## 11. Verifying a run (QA checklist)

1. `data/legutobbi.json`: `futas_id` fresh, `termekekszam` == active count.
2. Every active item has `pozicio.radovin_ar != null` (Radovin baseline).
3. Spot-check matched competitor prices against the shop's live page — no
   fabricated prices.
4. Suspended items are absent from `eredmenyek`.
5. `git status` clean after the cron's auto-commit; Pages rebuilt.

---

## 12. Known limits / gaps

- **Matched pairs are supply-limited:** the exact-match rule means only items the
  competitor carries at the SAME vintage/size pair cleanly. Borháló = wine
  comparator; Borvilág = spirits comparator.
- **Bortársaság** is blocked (JS-rendered + brand filter needs in-page JS).
  Requires a dedicated browser-automation pass (headless + mobile UA + activating
  the filter in-page) — no static product data.
- **Veritas** pending (JS/AJAX; headless brand/category mapping needed).
- **Italpark headless** returns a single product only (no full `talalatok` list
  into the collector).
- Manual pairing is the only trustworthy route (see §13 lessons — heuristic
  variety extraction failed).

---

## 13. Process & operations notes (how to manage it safely)

- **Long runs → delegate to a subagent.** A ~27-item run with the headless
  Italpark adapter got SIGKILLed after ~10 min in the main session. Production
  runs run inside a spawned subagent (`sessions_spawn`, report-only, no code
  edits) so the main channel isn't blocked and the run isn't interrupted.
- **Every candidate pair must be independently verified** against
  `data/felmeres-radovin.json` (Radovin slug + price + vintage) AND the
  competitor's stored data before entering the catalog. Do not trust a
  subagent's pairing claims blindly (see lessons — they misread vintages).
- Keep the JSON valid (a trailing comma after `"radovin_slug": null` broke the
  file once).
