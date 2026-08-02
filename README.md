# RV400 · Floodlight Telemetry

Personal analytics dashboard for a Revolt RV400 electric bike, hosted free on GitHub Pages.
**Python is the analytics engine** — a pandas pipeline runs inside GitHub Actions on every data
edit and pre-computes every derived statistic; the browser only filters and draws (Plotly).

```
data/*.csv + config.json ──▶ GitHub Actions ──▶ scripts/build_analytics.py (Python)
                                                        │
                                              site/data/analytics.json
                                                        │
                                     GitHub Pages ◀── site/ (HTML + Plotly)
```

## One-time setup (GitHub web UI only — no command line needed)

1. Create a new **public** repository (e.g. `rv400-telemetry`) and upload this folder's
   contents keeping the same paths. Tip: in *Add file → Create new file*, typing
   `scripts/build_analytics.py` as the filename creates the folder automatically.
2. Open **Settings → Pages → Build and deployment → Source** and pick **GitHub Actions**.
3. Open the **Actions** tab → *Build analytics & deploy to Pages* → **Run workflow**.
   About a minute later the dashboard is live at `https://<username>.github.io/<repo>/`.

Every later edit to anything in `data/` re-runs Python and republishes automatically.

## Adding data (from your phone)

| File | When to edit | What to add |
|---|---|---|
| `data/rides.csv` | after a ride | one row: date, start time, km, minutes, mode split %; set `source` to `app`. Optional `start_lat`,`start_lon` (from *View Map* in the Revolt app) light up the map. |
| `data/battery_log.csv` | after *Run Diagnostics* in the app | timestamp, voltage, SOC (State of Charge), SOH (State of Health), temp, est. range |
| `data/services.csv` | after a service | date, type, odometer, workshop |
| `data/config.json` | when assumptions change | tariffs, petrol price, efficiency (Wh/km), service interval, home/dealer coordinates |

**Seed data:** most rows in `rides.csv` are marked `source=seed` — simulated rides calibrated so
the totals (~3,524 km, ~154 h) and service odometer checkpoints (100 km / 914 km) match the real
app summary. Replace them with real rows over time; the dashboard shows a banner until then and
every real row is tagged distinctly in the ride log.

## Derived analytics (computed in Python)

Speed, dominant mode, energy (kWh) via per-mode Wh/km, efficiency (km/kWh), charging cost,
petrol-equivalent cost and ₹ savings, CO₂ avoided and tree-equivalents, ride-size buckets,
day-of-week × hour matrices, streaks, 90-day run-rate, 12-month odometer forecast, milestone
dates, service intervals + due projection (by km run-rate *and* by calendar), full-charge-cycle
estimate, speed anomaly flags (z-score per mode), and circle-packing layouts (circlify).

## Privacy

GitHub Pages sites are **public**. This repo therefore ships with a masked chassis number, no
phone number, and coordinates rounded to ~1 km. Keep it that way, or make the repo private
(private Pages needs a paid GitHub plan).

## Costs

Zero. Public repo + GitHub Actions free tier + GitHub Pages + CDN-served Plotly. No database,
no backend, no keys.
