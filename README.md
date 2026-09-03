# GOFO SC Network Ops Console

南加片区站点数据看板 — a static site: network operations map + analytics subpage, driven entirely by two CSV files.

**All operational data lives in `data/`. Nothing needs to be changed in the HTML.**

```
data/stations.csv              站点 — one row per station (14 rows)
data/assignments.csv           报价 + 线路归属 + 单量 — one row per station+ZIP+route (865 rows)

index.html                     Network map (main page)
analytics/dsp-pricing.html     DSP pricing — avg price by station (linked from map sidebar)
assets/data-loader.js          Reads the two CSVs and derives every total shown on the site
README.md
```

Station totals, average prices, the route table, the DSP summary, the map colours and
every count in the page footers are **computed at load time** from those two files.
There is no second copy of the numbers anywhere, so a CSV edit is the only edit needed.

## data/assignments.csv — 报价 / 线路归属 / 单量

One row per **station + ZIP + route**. Header must stay as-is.

| column    | meaning | notes |
|-----------|---------|-------|
| `station` | 站点代码 | must match a `station` in `stations.csv` |
| `zip`     | 5-digit ZIP | |
| `route`   | 线路号 | e.g. `LAX01-011` |
| `dsp`     | 承运 DSP | free text code; new codes are picked up automatically |
| `volume`  | 日均件量 | number, `0` allowed |
| `price`   | 报价 $/pkg | number |

How the derived numbers work:

- **ZIP price** = volume-weighted mean of that ZIP's rows. A ZIP on one route is just that row's price.
- **Route price** = volume-weighted mean over the route's ZIPs.
- **Station avg / DSP avg** = volume-weighted over priced ZIPs.
- A ZIP served by two stations (90041 / 90042 / 90050) is simply two rows with different `station`.
- A ZIP split across two routes (91766 on CNO-041 / CNO-042) is two rows — and they may carry
  **different prices**; the ZIP price then averages them by volume.

Common edits:

- **改报价** — change `price` on the ZIP's row(s).
- **改线路归属** — change `route` and/or `dsp` on the ZIP's row.
- **加 ZIP** — add a row. If the ZIP has a US Census ZCTA polygon it shades on the map automatically;
  otherwise it still counts in every total and is findable via ZIP search.
- **移交线路给别的 DSP** — change `dsp` on every row carrying that `route`.

## data/stations.csv — 站点

| column | meaning |
|--------|---------|
| `station` | 站点代码 (the key used by `assignments.csv`) |
| `head` | 站点负责人 |
| `address` | on-file address (quote it — it contains commas) |
| `address_zip` | ZIP the map pin is placed in |
| `lat` / `lon` | pin coordinates |
| `color` | station colour on the map and legend, `#RRGGBB` |
| `coord_source` | `address_zip`, or `service_area_centroid` to flag the pin as estimated |

Adding a station = one row here plus its rows in `assignments.csv`. A station listed only in
`assignments.csv` still renders (with a fallback colour and no pin) and the map sidebar reports it.

## Updating the site

1. Edit the CSV in Excel — keep it saved as CSV, keep the header row.
2. Commit and push to `main`.
3. Pages redeploys in ~1 minute; everything recomputes on load.

The map sidebar's **Data source** panel reports what was loaded and lists any row it had to
skip or correct (bad ZIP, unknown station, duplicate row). Details go to the browser console.

## Local preview

The pages read the CSVs over `fetch`, which browsers block for `file://`. Opening `index.html`
by double-clicking shows an empty map with an explanatory message. Serve the folder instead:

```bash
python -m http.server 8000
```

then open `http://localhost:8000/`.

## Coverage

14 stations · 29 DSPs · 195 routes · 864 ZIP rows · 238,819 pkg/day
LAX01 · LAX02 · LAX03 · SFV01 · SFV02 · CNO01 · SAN01 · BKD01 · VTC01 · FAT01 · SMX01 · YUM01 · YUM02 · PLM01

## Deploy

Repo: https://github.com/Kartalmi/sc-op-dashboard — push to `main` and Pages redeploys.
Live: https://kartalmi.github.io/sc-op-dashboard/
(one-time setup: **Settings → Pages → Deploy from a branch → `main` / `(root)`**)

## Known data gaps

- **SAN01** — no daily volume in the source roster (138 ZIP rows, all zero). Pricing and coverage
  are valid; volume shows as no-data.
- **ZIP 91766 (CNO01)** — carried on routes CNO-041 and CNO-042 at 710/day each, summed to
  1,420/day and priced at a flat 1.625. The source roster lists the two routes at $1.55 and $1.70;
  to reflect that, set those two prices on the two rows in `assignments.csv` — the ZIP price stays
  1.625 and the two routes then price separately.
- **172 ZIP rows** are PO-Box / point ZIPs with no US Census ZCTA polygon, so they are unshaded on
  the map (2.55% of volume). They still count in every total and are findable via ZIP search.

## Adding future analytics subpages

Drop new HTML files into `analytics/`, load `../assets/data-loader.js`, call
`GofoData.load('../')`, and add a link in the map sidebar (search for `subweb-link` in index.html).
