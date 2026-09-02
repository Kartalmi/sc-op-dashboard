# GOFO SC Network Ops Console

南加片区站点数据看板 — single static site: network operations map + analytics subpage + repo-driven price sheet.
Same build and same logic as `nc-ops-console`, rebuilt on the SoCal roster.

```
index.html                     Network map (main page)
analytics/dsp-pricing.html     DSP pricing — avg price by station (linked from map sidebar)
data/price_adjustments.csv     Price sheet — edit this file to adjust ZIP prices
README.md
```

## Coverage

14 stations · 29 DSPs · 864 ZIPs · 238,819 pkg/day
LAX01 · LAX02 · LAX03 · SFV01 · SFV02 · CNO01 · SAN01 · BKD01 · VTC01 · FAT01 · SMX01 · YUM01 · YUM02 · PLM01

## Deploy once → get a shareable link (GitHub Pages)

The repo is https://github.com/Kartalmi/sc-op-dashboard — push to `main` and Pages redeploys.

1. **Settings → Pages → Source: Deploy from a branch → Branch: main, folder: / (root) → Save** (one-time).
2. After ~1 minute the link is live: `https://kartalmi.github.io/sc-op-dashboard/`

## Updating prices

`data/price_adjustments.csv` holds the full baseline (864 rows, columns `zip,price,station`).
The third column is optional and only needed for ZIPs served by two stations at different rates (90041 / 90042 / 90050); leave it blank otherwise.

1. Edit prices in the CSV (Excel is fine — keep it saved as CSV).
2. Commit the file to the repo.
3. Pages redeploys in ~1 minute. ZIP colors, station/route/DSP averages, and rankings all recompute on load.

The map sidebar shows a status line: how many ZIPs loaded and how many differ from the base data.

## Known data gaps (flagged in the map sidebar)

- **SAN01** — no daily volume in the source file (135 ZIPs, all blank). Pricing and coverage are valid; volume shows as no-data.
- **SFV01** — on-file address ZIP 94560 (Newark, NorCal) is outside its service area; pin plotted at its service-area centroid.
- **ZIP 91766 (CNO01)** — listed on routes CNO-041 and CNO-042, each at 710/day and at different prices ($1.55 / $1.70); currently summed to 1,420/day.
- **170 ZIPs** are PO-Box / point ZIPs with no US Census ZCTA polygon, so they are unshaded on the map (0.14% of volume). They still count in every total and are findable via ZIP search.

## Adding future analytics subpages

Drop new HTML files into `analytics/` and add a link in the map sidebar (search for `subweb-link` in index.html).
