#!/usr/bin/env python3
"""
RV400 Floodlight Telemetry - analytics builder.

Reads  : data/rides.csv, data/services.csv, data/battery_log.csv, data/config.json
Writes : site/data/analytics.json  (consumed by the static dashboard)

Runs inside GitHub Actions (see .github/workflows/deploy.yml). Pure Python is the
analytics brain: every derived metric, matrix, and pre-shaped structure the
front-end needs is computed here so the browser only filters and draws.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = ROOT / "site" / "data"
OUT.mkdir(parents=True, exist_ok=True)

# --------------------------------------------------------------------------- #
# Load
# --------------------------------------------------------------------------- #
cfg = json.loads((DATA / "config.json").read_text())
eff = cfg["bike"]["efficiency_wh_per_km"]          # Wh/km per mode
eco_wh, city_wh, sport_wh = eff["eco"], eff["city"], eff["sport"]
econ = cfg["economics"]

rides = pd.read_csv(DATA / "rides.csv")
rides["date"] = pd.to_datetime(rides["date"])
rides = rides.dropna(subset=["date", "distance_km"]).sort_values(["date", "start_time"]).reset_index(drop=True)
for col in ("eco_pct", "city_pct", "sport_pct"):
    rides[col] = pd.to_numeric(rides[col], errors="coerce").fillna(0)
rides["duration_min"] = pd.to_numeric(rides["duration_min"], errors="coerce").fillna(0).clip(lower=1)

svc = pd.read_csv(DATA / "services.csv")
svc["date"] = pd.to_datetime(svc["date"])
svc = svc.sort_values("date").reset_index(drop=True)

batt = pd.read_csv(DATA / "battery_log.csv")
batt["timestamp"] = pd.to_datetime(batt["timestamp"])
batt = batt.sort_values("timestamp").reset_index(drop=True)

# --------------------------------------------------------------------------- #
# Per-ride enrichment
# --------------------------------------------------------------------------- #
r = rides
r["avg_speed_kmph"] = (r["distance_km"] / (r["duration_min"] / 60)).round(1)

mode_share = r[["eco_pct", "city_pct", "sport_pct"]].to_numpy() / 100.0
r["dominant_mode"] = np.array(["eco", "city", "sport"])[mode_share.argmax(axis=1)]

wh_per_km = mode_share @ np.array([eco_wh, city_wh, sport_wh])
r["energy_kwh"] = (r["distance_km"] * wh_per_km / 1000).round(3)
r["km_per_kwh"] = (r["distance_km"] / r["energy_kwh"].replace(0, np.nan)).round(1)

r["charge_cost_inr"] = (r["energy_kwh"] * econ["electricity_rate_per_kwh"]).round(2)
petrol_l = r["distance_km"] / econ["petrol_bike_kmpl"]
r["petrol_cost_inr"] = (petrol_l * econ["petrol_price_per_litre"]).round(2)
r["saved_inr"] = (r["petrol_cost_inr"] - r["charge_cost_inr"]).round(2)
r["co2_saved_kg"] = (
    petrol_l * econ["petrol_co2_kg_per_litre"] - r["energy_kwh"] * econ["grid_co2_kg_per_kwh"]
).round(3)

r["size_bucket"] = pd.cut(
    r["distance_km"], bins=[0, 5, 20, np.inf], labels=["short", "medium", "long"]
).astype(str)
r["year"] = r["date"].dt.year
r["month"] = r["date"].dt.strftime("%Y-%m")
r["month_name"] = r["date"].dt.strftime("%b %Y")
r["quarter"] = r["date"].dt.year.astype(str) + " Q" + r["date"].dt.quarter.astype(str)
r["dow"] = r["date"].dt.dayofweek                       # 0=Mon
r["day_type"] = np.where(r["dow"] >= 5, "weekend", "weekday")
r["hour"] = pd.to_datetime(r["start_time"], format="%H:%M", errors="coerce").dt.hour.fillna(9).astype(int)
r["odometer_km"] = r["distance_km"].cumsum().round(1)

# Speed anomalies (z-score within dominant mode)
z = r.groupby("dominant_mode")["avg_speed_kmph"].transform(
    lambda s: (s - s.mean()) / (s.std(ddof=0) or 1)
)
r["speed_anomaly"] = (z.abs() > 2.5)

# --------------------------------------------------------------------------- #
# Headline aggregates (all-time; the browser recomputes filtered versions)
# --------------------------------------------------------------------------- #
total_km = float(r["distance_km"].sum())
total_h = float(r["duration_min"].sum() / 60)
first_day, last_day = r["date"].min(), r["date"].max()
active_days = int(r["date"].dt.date.nunique())
span_days = max(1, (last_day - first_day).days + 1)

# Streaks over daily activity
daily = r.groupby(r["date"].dt.date)["distance_km"].sum()
days_idx = pd.Series(1, index=pd.to_datetime(daily.index))
cal = days_idx.reindex(pd.date_range(first_day, last_day, freq="D"), fill_value=0)
grp = (cal == 0).cumsum()
streaks = cal.groupby(grp).cumsum()
longest_streak = int(streaks.max())
today = pd.Timestamp.today().normalize()
days_since_last = int((today - last_day.normalize()).days)

# 90-day run-rate + 12-month odometer forecast
recent = r[r["date"] >= last_day - pd.Timedelta(days=90)]
run_rate_km_day = float(recent["distance_km"].sum() / 90) if len(recent) else 0.0
forecast = []
odo = total_km
for i in range(1, 13):
    odo += run_rate_km_day * 30.44
    forecast.append({"month": (last_day + pd.DateOffset(months=i)).strftime("%Y-%m"), "odo_km": round(odo, 0)})

# Milestone crossings
milestones = []
for m in cfg["dashboard"]["milestones_km"]:
    hit = r[r["odometer_km"] >= m]
    milestones.append({
        "km": m,
        "date": hit["date"].iloc[0].strftime("%Y-%m-%d") if len(hit) else None,
        "projected": None if len(hit) or run_rate_km_day <= 0 else
        (last_day + pd.Timedelta(days=(m - total_km) / run_rate_km_day)).strftime("%Y-%m-%d"),
    })

# --------------------------------------------------------------------------- #
# Service analytics
# --------------------------------------------------------------------------- #
svc_rows = []
prev_km, prev_dt = 0.0, None
for _, s in svc.iterrows():
    svc_rows.append({
        "date": s["date"].strftime("%Y-%m-%d"),
        "type": s["type"],
        "odometer_km": float(s["odometer_km"]),
        "workshop": s.get("workshop", ""),
        "km_since_prev": round(float(s["odometer_km"]) - prev_km, 1),
        "days_since_prev": int((s["date"] - prev_dt).days) if prev_dt is not None else None,
    })
    prev_km, prev_dt = float(s["odometer_km"]), s["date"]

last_svc_km = prev_km
last_svc_dt = prev_dt
km_since_service = round(total_km - last_svc_km, 1)
km_to_due = round(cfg["service"]["interval_km"] - km_since_service, 1)
due_by_date = (last_svc_dt + pd.DateOffset(months=cfg["service"]["interval_months"])) if last_svc_dt is not None else None
due_projection = (
    (last_day + pd.Timedelta(days=km_to_due / run_rate_km_day)).strftime("%Y-%m-%d")
    if run_rate_km_day > 0 and km_to_due > 0 else None
)
service_block = {
    "history": svc_rows,
    "interval_km": cfg["service"]["interval_km"],
    "interval_months": cfg["service"]["interval_months"],
    "km_since_service": km_since_service,
    "km_to_due": km_to_due,
    "due_by_date": due_by_date.strftime("%Y-%m-%d") if due_by_date is not None else None,
    "due_projection_by_kms": due_projection,
    "overdue": bool(km_to_due < 0 or (due_by_date is not None and due_by_date < today)),
}

# --------------------------------------------------------------------------- #
# Circle packing (littlemissdata: circle-packing) - rides packed inside months
# --------------------------------------------------------------------------- #
def circle_packing() -> list[dict]:
    try:
        import circlify
    except ImportError:                                # local fallback; Actions installs it
        return []
    months = []
    for month, g in r.groupby("month", sort=True):
        months.append({
            "id": month,
            "datum": float(g["distance_km"].sum()),
            "children": [
                {"id": f"i{idx}", "datum": float(row.distance_km)}
                for idx, row in g.iterrows()
            ],
        })
    circles = circlify.circlify(months, show_enclosure=False, target_enclosure=circlify.Circle(x=0, y=0, r=1))
    ride_meta = r[["month", "dominant_mode", "distance_km", "date"]].copy()
    out = []
    for c in circles:
        ex = c.ex or {}
        cid = ex.get("id", "")
        if cid.startswith("i"):                        # leaf = a ride
            row = ride_meta.loc[int(cid[1:])]
            out.append({"x": round(c.x, 4), "y": round(c.y, 4), "r": round(c.r, 4),
                        "kind": "ride", "month": row["month"], "mode": row["dominant_mode"],
                        "km": float(row["distance_km"]), "date": row["date"].strftime("%Y-%m-%d"),
                        "idx": int(cid[1:])})
        else:                                          # month enclosure
            out.append({"x": round(c.x, 4), "y": round(c.y, 4), "r": round(c.r, 4),
                        "kind": "month", "month": cid})
    return out

packing = circle_packing()

# --------------------------------------------------------------------------- #
# Battery series
# --------------------------------------------------------------------------- #
battery_block = {
    "series": [
        {"t": row["timestamp"].strftime("%Y-%m-%d %H:%M"),
         "voltage_v": float(row["voltage_v"]), "soc_pct": float(row["soc_pct"]),
         "soh_pct": float(row["soh_pct"]), "temp_c": float(row["temp_c"]),
         "est_range_km": float(row.get("est_range_km", np.nan)) if not pd.isna(row.get("est_range_km", np.nan)) else None}
        for _, row in batt.iterrows()
    ],
    "latest": None,
}
if len(batt):
    L = batt.iloc[-1]
    full_charges_equiv = round(float(r["energy_kwh"].sum()) / cfg["bike"]["battery_kwh"], 1)
    battery_block["latest"] = {
        "t": L["timestamp"].strftime("%d %b %Y, %H:%M"),
        "voltage_v": float(L["voltage_v"]), "soc_pct": float(L["soc_pct"]),
        "soh_pct": float(L["soh_pct"]), "temp_c": float(L["temp_c"]),
        "est_range_km": float(L["est_range_km"]),
        "full_charge_equivalents": full_charges_equiv,
    }

# --------------------------------------------------------------------------- #
# All-time KPI block (radar "all-time" overlay + hero)
# --------------------------------------------------------------------------- #
kpis = {
    "total_km": round(total_km, 1),
    "total_rides": int(len(r)),
    "total_hours": round(total_h, 1),
    "avg_speed": round(total_km / total_h, 1) if total_h else 0,
    "median_ride_km": round(float(r["distance_km"].median()), 1),
    "longest_ride_km": round(float(r["distance_km"].max()), 1),
    "active_days": active_days,
    "span_days": span_days,
    "rides_per_week": round(len(r) / (span_days / 7), 2),
    "longest_streak_days": longest_streak,
    "days_since_last_ride": days_since_last,
    "eco_share_km": round(float((r["distance_km"] * r["eco_pct"] / 100).sum()) / total_km * 100, 1),
    "energy_kwh": round(float(r["energy_kwh"].sum()), 1),
    "km_per_kwh": round(total_km / float(r["energy_kwh"].sum()), 1),
    "charge_cost_inr": round(float(r["charge_cost_inr"].sum()), 0),
    "saved_inr": round(float(r["saved_inr"].sum()), 0),
    "co2_saved_kg": round(float(r["co2_saved_kg"].sum()), 1),
    "trees_equiv": round(float(r["co2_saved_kg"].sum()) / econ["tree_kg_co2_per_year"], 1),
    "run_rate_km_day": round(run_rate_km_day, 2),
    "first_ride": first_day.strftime("%Y-%m-%d"),
    "last_ride": last_day.strftime("%Y-%m-%d"),
}

# --------------------------------------------------------------------------- #
# Emit
# --------------------------------------------------------------------------- #
ride_cols = ["distance_km", "duration_min", "eco_pct", "city_pct", "sport_pct",
             "avg_speed_kmph", "dominant_mode", "energy_kwh", "km_per_kwh",
             "charge_cost_inr", "petrol_cost_inr", "saved_inr", "co2_saved_kg",
             "size_bucket", "year", "month", "month_name", "quarter", "dow",
             "day_type", "hour", "odometer_km", "speed_anomaly", "source"]
rides_out = []
for i, row in r.iterrows():
    d = {"i": int(i), "date": row["date"].strftime("%Y-%m-%d"), "time": str(row["start_time"])}
    for c in ride_cols:
        v = row[c]
        if isinstance(v, (np.integer,)):
            v = int(v)
        elif isinstance(v, (np.floating,)):
            v = None if math.isnan(v) else float(v)
        elif isinstance(v, (np.bool_,)):
            v = bool(v)
        d[c] = v
    if not pd.isna(row.get("start_lat")) and not pd.isna(row.get("start_lon")):
        d["lat"], d["lon"] = float(row["start_lat"]), float(row["start_lon"])
    rides_out.append(d)

payload = {
    "meta": {
        "generated": pd.Timestamp.now().strftime("%Y-%m-%d %H:%M"),
        "seed_rows": int((r["source"] == "seed").sum()),
        "real_rows": int((r["source"] != "seed").sum()),
    },
    "config": {
        "bike": cfg["bike"], "economics": econ,
        "locations": cfg["locations"], "title": cfg["dashboard"]["title"],
        "milestones_km": cfg["dashboard"]["milestones_km"],
    },
    "kpis_alltime": kpis,
    "rides": rides_out,
    "milestones": milestones,
    "forecast": forecast,
    "service": service_block,
    "battery": battery_block,
    "packing": packing,
}

(OUT / "analytics.json").write_text(json.dumps(payload, separators=(",", ":")))
print(f"analytics.json written - {len(rides_out)} rides, {len(packing)} packed circles, "
      f"{kpis['total_km']} km, saved INR {kpis['saved_inr']:.0f}, CO2 {kpis['co2_saved_kg']} kg")
