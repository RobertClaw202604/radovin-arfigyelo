# Radovin Price Monitor — Lessons Learned & Pitfalls

Companion to `SPEC.md`. A candid, detailed account of what worked, what did not,
which methods are reliable vs. unreliable, and the concrete mistakes/inaccuracies
encountered while building and expanding the system (2026-08). Written so the
next iteration (or a rebuild) avoids re-learning all of this.

---

## 1. What worked (reliable methods — build on these)

### 1.1 Catalog-list JSON APIs — the most robust extraction
Shopify `/products.json` (Borvilág) and WooCommerce `/wp-json/wc/store/products`
(Winehub, Borpiac) expose the **entire catalog** with exact prices, over plain
GET, **no headless, no fragile search**. This is the gold standard: pull the full
list, run the strict matcher. Use this path first whenever a competitor runs
Shopify or WooCommerce.

### 1.2 Radovin's public WooCommerce catalog API
`https://radovin.hu/wp-json/wc/store/products` is a plain-GET survey endpoint
(UA `radovin-arfigyelo`) → full 1,556-product dump with `slug` + `price`.
This made the "Radovin baseline" verifiable without crawling the site item by
item, and produced the slug map used for direct product fetches.

### 1.3 Direct JSON-LD fetch by `radovin_slug`
Once an item has an exact Radovin slug, the scraper hits
`{host}/termek/{slug}/` and reads the JSON-LD `price` directly. **Precise +
fast**, and it bypasses the fragile `/?s=` search (which returned "no result"
for several items that DO exist). Every precise item should have a
`radovin_slug`.

### 1.4 Borháló GA4 dataLayer trick — the creative win
Borháló pushes the name+price into the **GA4 dataLayer JSON** (`data-gt-params`:
`item_name` + `price`) inside the raw HTML, on the same `<a>` as
`href=/termek/{slug}`. So the price AND the stable product URL are both in the
static HTML → **headless-free**, paginated via `?limit=100&page=N`. Wrinkle:
`base_url` must be **non-www** (`https://borhalo.hu`), because www 301s on the
pezsgők/párlatok categories.

### 1.5 Manual pair verification — the only trustworthy route
Every catalog pair was **manually validated** (Radovin slug+price+vintage from
the survey ↔ competitor's stored data). This is slow but safe. Heuristic mass
pairing did NOT work (§2.1).

### 1.6 Delegating long production runs to a subagent
A ~27-item run with the headless Italpark adapter was SIGKILLed in the main
session after ~10 min. Re-running the same pipeline inside a spawned subagent
(`sessions_spawn`, report-only) completed cleanly (exit 0, no interruption). This
is now the standard pattern for any run that includes slow/headless shops.

### 1.7 Suspension over deletion
Items without a verified Radovin baseline are marked `aktiv:false` +
`szuneteltetes_oka` (reason + date) instead of deleted. `run.js` skips them.
Nothing is lost, and the "only Radovin-stocked items are tracked" principle is
respected. Re-activatable if the product appears under a different vintage/naming.

### 1.8 URL-keyed product collector
Saving every concrete product (even unmatchable) keyed by URL, with a separate
append-only time-series + index, cleanly separates "passive collection of market
intel" from "active catalog matching". Cheap, non-invasive, future-proof.

---

## 2. What did NOT work (avoid / fix these)

### 2.1 Mass heuristic variety-extraction — FAILED (twice)
Attempting to auto-pair 83 wines by heuristically parsing grape variety from
product names produced **0–4 correct pairs**. Product names are too irregular
(prefixes, suffixes, blends, brand-in-name, transliteration quirks). **Manual
pairing is the only reliable method.** Do not re-attempt pure-heuristic mass
pairing.

### 2.2 Trusting a subagent's pairing claims blindly — INACCURATE
The search subagent reported several "verified" pairs that were **wrong on
vintage or size**:
- **2HA Shiraz**: subagent said "2021". Radovin's survey has only
  `2ha-shiraz-2020` (9990). Borháló's Shiraz is 2021. Same brand, different
  vintage → NOT the same product. (Later re-verified as a genuine pair via the
  actual Radovin product NAME being 2021 even though the slug says 2020 — see
  §3.4. The slug is not always the truth.)
- **Bukolyi Pinot Noir "Joy"**: subagent claimed the 2025. Radovin only carries
  `bukolyi-marcell-pinot-noir-joy-2022` (5790); Borháló has the 2025. Different
  vintage → rejected.
- **JW Gold Reserve**: claimed a Borvilág price, but Borvilág has **no**
  "gold reserve" → no valid pair.
- **Disznókő Aszú**: subagent queried the **2015** vintage; the correct Radovin
  pair is the **2017** (48530). Off-by-vintage.

**Lesson:** treat every subagent pairing claim as a *hypothesis* to be
re-verified against `data/felmeres-radovin.json` (slug, price, vintage) AND the
competitor's stored data before writing it to the catalog. Never auto-ingest.

### 2.3 Headless as a blanket fallback — expensive + can hit walls
Headless (Puppeteer) handles JS/AJAX but is **slow** and, at scale, the main
runtime/SIGKILL driver. It also can fail even when it gets a 200:
- **Bortársaság**: mobile-UA bypass returns 200, but content is JS-rendered AND
  the brand filter needs an in-page JS interaction (no URL params). So a 200 is
  NOT "working" — you must confirm the product data actually renders.
- **Italpark**: plain search returns empty even headless; the workaround is the
  brand-category page (`{marka}-whisky`), pre-checked with a plain fetch (200)
  before launching a browser. Still returns only a single product (no full list
  into the collector).

**Lesson:** prefer catalog-list / JSON-LD / dataLayer static extraction first.
Reserve headless for genuinely JS-only shops, use the pre-filter (plain 200
check), and expect it to be the runtime bottleneck.

### 2.4 `/?s=` search fragility
The WooCommerce search endpoint misses several real products ("no result" for
items that DO exist at Radovin). The `radovin_slug` direct fetch fixed this.
Never rely on search alone for the baseline.

### 2.5 `html-simon` (free-text context regex)
Too fragile to be trusted; only used for pending shops (Benebor/Borbáró). Not
production confidence.

### 2.6 "Generic Tokaji Aszú 5 puttonyos" generic item
A generic (no winery + vintage) Tokaji was added early. It was suspended
(`aktiv:false`) because without winery+vintage it can't be matched precisely.
**Wine identity requires winery + variety + vintage — all three**, per the
product owner.

### 2.7 Double Black vs Black Label confusion
JW "Double Black" kept almost matching "Black Label". Only the mandatory
`fajta` (tétel) gate — with the competitor's exact naming — stopped the false
pair (§4 below).

---

## 3. Specific technical inaccuracies / data traps (check these)

### 3.1 WooCommerce price unit is FORINT, not fillér
Radovin's `currency_minor_unit = 0`, so `prices.price` arrives in **forint**
ALREADY (e.g. 2490, not 24.90). An early version divided by 100 → wrong. **Never
blindly `/100`; inspect `currency_minor_unit` first.**

### 3.2 Size traps (0.75l vs Magnum; 0.7l vs 1l)
- **Sauska Rosé Brut**: correct Radovin price is **7990 Ft (0.75l)**, NOT the
  18990 Ft 1.5l Magnum. Slug `sauska-rose-brut-12-075l` confirmed it.
- **Pol Roger Brut Réserve**: Borháló only sells a **gift-boxed (díszdobozos)**
  version (28900) which is NOT equivalent to the plain bottle (Radovin 30990).
  → Suspended rather than risk a false comparison. The headless adapter enforces
  the same size rule (`kiszereles_elteter`).

### 3.3 Slug/brand category heuristics are leaky
Slugs are unreliable as identity:
- `heumann-terra-tartaro-2015` but the product NAME is **2018** (Radovin typo).
- `heumann-la-trinita-2018` but the product NAME is **2019**.
- `bodri-rozi-rose-2023` but the product NAME is **2025**.
- `2ha-shiraz-2020` but the product NAME is **2021** (also a split from §2.2).
**The product NAME (and, for matching, the competitor's NAME) is the source of
truth — the slug is just a fetch handle.** Always cross-check the name on the
fetched product page.

### 3.4 Categories can be an ARRAY
Radovin's `kategoria` field is an **array**, not a string. Code that iterated it
as a string broke. Handle both forms.

### 3.5 Config JSON trailing-comma bug
A trailing comma after `"radovin_slug": null,` at the end of an object node
produced a syntax error that broke parsing. Always validate `JSON.parse` after
hand-editing configs.

### 3.6 Concurrent writers to the same config (process clobbering)
Two parallel run-subagents both wrote to `config/termekek.json`, producing a
mixed intermediate state (my `kali-kovek-rezeda-2024` + the other's `2ha-shiraz`
activation + the `pol-roger` suspension). The FINAL state was coherent, but this
was luck. **Serialize catalog writes** (one writer, or git-commit-reconcile).

---

## 4. The single most important principle: exact identity + mandatory gates

The whole accuracy story reduces to two things:

1. **Exact product identity.** For wine: **winery (pincészet) + variety (fajta) +
   vintage (évjárat)** all three, plus size. For spirits: **brand + exact
   expression/tétel** (no vintage) plus size. "Black Label" ≠ "Double Black";
   "8 Years" ≠ "12 Rare Blend"; 0.7l ≠ 1l.

2. **Mandatory-match gates in the matcher** (`matricas.js`), NOT soft bonuses:
   - brand (unless `generikus`)
   - **`fajta` mandatory** if set
   - **vintage mandatory** if set
   - puttony mandatory for aszú
   - size enforced
   Only candidates passing ALL gates are scored; only `score > 0` is accepted;
   otherwise **`null`** → honest "no data", never a fabricated price.

**The most impactful field is `fajta` holding the COMPETITOR's exact naming.**
Radovin "8 Years" ↔ Borvilág "Reserve Blend"; "XO Triple Cask" ↔ "XO Reserve
Triple Cask"; "Black Triple Cask" ↔ "Black Label Triple Cask". Confusing the two
naming systems was the root cause of the worst near-misses.

---

## 5. Market signals captured (what the data says — for context)

- Borháló wine prices are often **below** Radovin (Ermitage 3990 vs 4100,
  Kopar 12500 vs 12990, Brut Nature 9500 vs 9590).
- Borvilág spirit prices are **well below** Radovin (Monkey 47 Dry 17850 vs
  20990, Appleton 8 17990 vs 24190, Mount Gay XO 23490 vs 28990, Macallan 12
  31010 vs 39000).
- 3-shop examples: Macallan 12 (Radovin 39000 > Borvilág 31010 < Italpark
  32289); Charles Heidsieck Brut Réserve (Radovin 31990 > Borháló 30900).
- Not universal: Monkey 47 Sloe (Radovin 20990 < Borvilág 22490); JW Island
  Green (Radovin 33590 > Borvilág 32890).

---

## 6. Recommended next steps (if continuing)

1. **Winehub/Borpiac as additional comparators** for the same items → more
   precise pairs (supply-limited by exact-match, so more sources = more pairs).
2. **Bortársaság** dedicated browser-automation pass (headless + mobile UA +
   activate brand filter in-page) to reach Kreinbacher Brut pezsgő price.
3. **Veritas** headless brand/category mapping.
4. **Italpark**: make headless return the full `talalatok` list into the
   collector (not just one product).
5. Serialize/pipeline catalog writes to avoid §3.6 clobbering.
