# GOFO SC Network Ops Console

南加片区站点数据看板 — a static site: network operations map + analytics subpage, driven entirely by two CSV files.

**All operational data lives in `data/`. Nothing needs to be changed in the HTML.**

```
data/stations.csv              站点 — one row per station (14 rows)
data/assignments.csv           报价 + 线路归属 + 单量 — one row per station+ZIP+route (862 rows)

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
- A ZIP served by two stations, or split across two routes, is simply two rows — and they may carry
  different prices; the ZIP price then averages them by volume. Every ZIP is currently on one row.

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

**数据更新时间 · last data update: 2026-09-04**

14 stations · 28 DSPs · 196 routes · 862 ZIP rows · 262,061 pkg/day
LAX01 · LAX02 · LAX03 · SFV01 · SFV02 · CNO01 · SAN01 · BKD01 · VTC01 · FAT01 · SMX01 · YUM01 · YUM02 · PLM01

These figures are a snapshot of the CSVs — the site itself computes them at load time, so the
sidebar and page footers are always current even when this section is not. Update the date above
whenever you commit a data change.

## Deploy

Repo: https://github.com/Kartalmi/sc-op-dashboard — push to `main` and Pages redeploys.
Live: https://kartalmi.github.io/sc-op-dashboard/
(one-time setup: **Settings → Pages → Deploy from a branch → `main` / `(root)`**)

## Known data gaps

- **159 ZIP rows** are PO-Box / point ZIPs with no US Census ZCTA polygon at all, so they are
  unshaded on the map (2.21% of volume). They still count in every total and are findable via
  ZIP search.

The polygons in `index.html` cover the ZIPs known at build time. A ZIP added to `assignments.csv`
later has no boundary and stays unshaded even when a real ZCTA exists — check the map after adding
one. To add a boundary, pull it from the Census TIGERweb ZCTA layer and append a feature to the
`zipgeo` block with `properties: {zip, lat, lon}`, using the layer's `INTPTLAT` / `INTPTLON` as
`lat` / `lon`.

## Adding future analytics subpages

Drop new HTML files into `analytics/`, load `../assets/data-loader.js`, call
`GofoData.load('../')`, and add a link in the map sidebar (search for `subweb-link` in index.html).
