/* RV400 Floodlight Telemetry - runtime.
   Python (Actions) precomputes analytics.json; this file only filters and draws. */
"use strict";

const MODE_C = { eco: "#2dd4a7", city: "#5b8def", sport: "#ff5d5d" };
const AMBER = "#ffb547", INK = "#eef3ff", MUTED = "#8fa0c4", FAINT = "#55648a";
const GRID = "rgba(143,160,196,0.12)";
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const MONTHS_S = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOWS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

let D = null;          // full payload from Python
let F = [];            // filtered rides
const state = { from: null, to: null, modes: new Set(["eco","city","sport"]),
                sizes: new Set(["short","medium","long"]), day: "all", gran: "week" };

/* ---------- tiny utils ---------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const fmt = (n, d = 0) => (n == null || isNaN(n)) ? "–" :
  Number(n).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: 0 });
const sum = (a, f) => a.reduce((t, x) => t + (f ? f(x) : x), 0);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x,y)=>x-y);
  const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m-1]+s[m])/2; };
const groupSum = (rows, keyF, valF) => {
  const m = new Map();
  for (const r of rows) { const k = keyF(r); m.set(k, (m.get(k) || 0) + valF(r)); }
  return m;
};
const weekStart = (iso) => { const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0,10); };

function baseLayout(extra = {}) {
  return Object.assign({
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "JetBrains Mono, monospace", size: 11, color: MUTED },
    margin: { l: 44, r: 14, t: 10, b: 34 },
    xaxis: { gridcolor: GRID, zerolinecolor: GRID, linecolor: GRID },
    yaxis: { gridcolor: GRID, zerolinecolor: GRID, linecolor: GRID },
    legend: { orientation: "h", y: 1.12, font: { size: 10 } },
    hoverlabel: { bgcolor: "#101b38", bordercolor: AMBER, font: { family: "JetBrains Mono", color: INK, size: 11 } },
    colorway: [AMBER, MODE_C.eco, MODE_C.city, MODE_C.sport, "#a78bfa", "#f472b6"],
  }, extra);
}
const CFG_PLOT = { displayModeBar: false, responsive: true };

/* ---------- chart registry: lazy + dirty ---------- */
const REG = [];
function reg(id, build, opts = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  REG.push({ id, el, build, visible: false, dirty: true, alltime: !!opts.alltime, built: false });
}
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const c = REG.find(x => x.el === e.target);
    if (!c) continue;
    if (e.isIntersecting) {
      c.visible = true;
      c.el.closest(".chart-card")?.classList.add("seen");
      if (c.dirty) drawChart(c);
    } else c.visible = false;
  }
}, { rootMargin: "160px" });

function drawChart(c) {
  try { c.build(c.el); c.dirty = false; c.built = true; }
  catch (err) { console.error("chart", c.id, err); }
}
function rerenderAll() {
  for (const c of REG) {
    if (c.alltime && c.built) continue;          // all-time charts don't respond to filters
    c.dirty = true;
    if (c.visible) drawChart(c);
  }
}

/* ---------- filters ---------- */
function applyFilters() {
  const from = state.from, to = state.to;
  F = D.rides.filter(r =>
    (!from || r.date >= from) && (!to || r.date <= to) &&
    state.modes.has(r.dominant_mode) && state.sizes.has(r.size_bucket) &&
    (state.day === "all" || r.day_type === state.day));
  $("#f-count").textContent = `${fmt(F.length)} rides · ${fmt(sum(F, r=>r.distance_km))} km`;
  $("#gran-echo").textContent = `(by ${state.gran})`;
  renderKPIs();
  renderTable(true);
  rerenderAll();
}
function wireFilters() {
  const last = D.kpis_alltime.last_ride, first = D.kpis_alltime.first_ride;
  $("#f-from").min = first; $("#f-from").max = last;
  $("#f-to").min = first; $("#f-to").max = last;
  $$(".chip.preset").forEach(b => b.onclick = () => {
    $$(".chip.preset").forEach(x => x.classList.remove("on")); b.classList.add("on");
    const p = b.dataset.preset, end = new Date(last + "T00:00:00");
    if (p === "all") { state.from = null; state.to = null; }
    else if (p === "ytd") { state.from = last.slice(0,4) + "-01-01"; state.to = last; }
    else { const s = new Date(end); s.setDate(s.getDate() - (+p)); state.from = s.toISOString().slice(0,10); state.to = last; }
    $("#f-from").value = state.from || ""; $("#f-to").value = state.to || "";
    applyFilters();
  });
  $("#f-from").onchange = (e) => { state.from = e.target.value || null; applyFilters(); };
  $("#f-to").onchange = (e) => { state.to = e.target.value || null; applyFilters(); };
  $$(".chip[data-mode]").forEach(b => b.onclick = () => {
    const m = b.dataset.mode;
    if (state.modes.has(m) && state.modes.size > 1) { state.modes.delete(m); b.classList.remove("on"); }
    else { state.modes.add(m); b.classList.add("on"); }
    applyFilters();
  });
  $$(".chip.size").forEach(b => b.onclick = () => {
    const s = b.dataset.size;
    if (state.sizes.has(s) && state.sizes.size > 1) { state.sizes.delete(s); b.classList.remove("on"); }
    else { state.sizes.add(s); b.classList.add("on"); }
    applyFilters();
  });
  $$(".chip.day").forEach(b => b.onclick = () => {
    $$(".chip.day").forEach(x => x.classList.remove("on")); b.classList.add("on");
    state.day = b.dataset.day; applyFilters();
  });
  $$(".chip.gran").forEach(b => b.onclick = () => {
    $$(".chip.gran").forEach(x => x.classList.remove("on")); b.classList.add("on");
    state.gran = b.dataset.gran; applyFilters();
  });
  $("#f-reset").onclick = () => {
    state.from = null; state.to = null; state.day = "all"; state.gran = "week";
    state.modes = new Set(["eco","city","sport"]); state.sizes = new Set(["short","medium","long"]);
    $$(".chip").forEach(c => c.classList.add("on"));
    $$(".chip.preset").forEach(c => c.classList.toggle("on", c.dataset.preset === "all"));
    $$(".chip.day").forEach(c => c.classList.toggle("on", c.dataset.day === "all"));
    $$(".chip.gran").forEach(c => c.classList.toggle("on", c.dataset.gran === "week"));
    $("#f-reset").classList.remove("on");
    $("#f-from").value = ""; $("#f-to").value = "";
    applyFilters();
  };
}

/* ---------- KPIs ---------- */
function renderKPIs() {
  const km = sum(F, r => r.distance_km), hrs = sum(F, r => r.duration_min) / 60;
  const kwh = sum(F, r => r.energy_kwh), saved = sum(F, r => r.saved_inr);
  const co2 = sum(F, r => r.co2_saved_kg);
  const days = new Set(F.map(r => r.date)).size;
  const spanD = F.length ? (new Date(F[F.length-1].date) - new Date(F[0].date)) / 864e5 + 1 : 1;
  const ecoKm = sum(F, r => r.distance_km * r.eco_pct / 100);
  const cards = [
    ["Distance", fmt(km, 1) + " km", "gold"],
    ["Rides", fmt(F.length), ""],
    ["Ride time", fmt(hrs, 1) + " h", ""],
    ["Avg speed", (hrs ? fmt(km/hrs, 1) : "–") + " km/h", ""],
    ["Median ride", fmt(median(F.map(r=>r.distance_km)), 1) + " km", ""],
    ["Longest ride", fmt(Math.max(0, ...F.map(r=>r.distance_km)), 1) + " km", ""],
    ["Rides / week", fmt(F.length / (spanD/7), 1), ""],
    ["Eco share", (km ? fmt(ecoKm/km*100, 0) : "–") + " %", "eco"],
    ["Energy", fmt(kwh, 1) + " kWh", "city"],
    ["Efficiency", (kwh ? fmt(km/kwh, 1) : "–") + " km/kWh", "city"],
    ["Saved", "₹" + fmt(saved), "gold"],
    ["CO₂ avoided", fmt(co2, 1) + " kg", "eco"],
  ];
  $("#kpis").innerHTML = cards.map(([l,v,c]) =>
    `<div class="kpi ${c}"><b>${v}</b><span>${l}</span></div>`).join("");
}

/* ---------- hero ---------- */
function hero() {
  const K = D.kpis_alltime, B = D.battery.latest, S = D.service;
  const target = K.total_km;
  const el = $("#odo");
  if (REDUCED) el.textContent = fmt(target, 0);
  else {
    const t0 = performance.now(), dur = 1500;
    const tick = (t) => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(target * e, 0); if (p < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  $("#hero-sub").textContent =
    `${fmt(K.total_rides)} rides · ${fmt(K.total_hours)} h in the saddle · ₹${fmt(K.saved_inr)} saved vs petrol · ${fmt(K.co2_saved_kg)} kg CO₂ avoided (≈ ${fmt(K.trees_equiv,1)} trees).`;
  if (B) { $("#hs-soc").textContent = B.soc_pct + "%"; $("#hs-range").textContent = B.est_range_km + " km";
           $("#hs-soh").textContent = B.soh_pct + "%"; }
  $("#hs-due").textContent = fmt(S.km_to_due);
  $("#stamp").textContent = `python build · ${D.meta.generated}`;
  if (D.meta.seed_rows > 0) {
    const n = $("#seed-note"); n.hidden = false;
    n.innerHTML = `<b>${fmt(D.meta.seed_rows)} of ${fmt(D.meta.seed_rows + D.meta.real_rows)} rides are calibrated seed data</b> — totals match your app summary (${fmt(D.kpis_alltime.total_km)} km / ${fmt(D.kpis_alltime.total_hours)} h) and service odometer checkpoints, but individual rides are simulated. Replace or append real rows in <code>data/rides.csv</code> (set source to <code>app</code>) and this note fades away.`;
  }
}

/* ================= CHART BUILDERS ================= */

/* 01 · time */
function cDaily(el) {
  const keyF = state.gran === "day" ? (r=>r.date) : state.gran === "week" ? (r=>weekStart(r.date)) : (r=>r.month + "-01");
  const m = groupSum(F, keyF, r => r.distance_km);
  const x = [...m.keys()].sort(), y = x.map(k => +m.get(k).toFixed(1));
  const win = state.gran === "day" ? 7 : state.gran === "week" ? 4 : 3;
  const ma = y.map((_, i) => { const s = y.slice(Math.max(0, i-win+1), i+1); return +(sum(s)/s.length).toFixed(1); });
  Plotly.newPlot(el, [
    { x, y, type: "bar", name: "km", marker: { color: "rgba(255,181,71,0.32)" }, hovertemplate: "%{x}<br>%{y} km<extra></extra>" },
    { x, y: ma, type: "scatter", mode: "lines", name: `${win}-${state.gran} avg`, line: { color: AMBER, width: 2.4, shape: "spline" } },
  ], baseLayout({ barmode: "overlay" }), CFG_PLOT);
}

function cCum(el) {
  let acc = 0;
  const x = F.map(r => r.date), y = F.map(r => +(acc += r.distance_km).toFixed(1));
  const data = [{ x, y, type: "scatter", mode: "lines", name: "odometer (filtered)",
    fill: "tozeroy", fillcolor: "rgba(255,181,71,0.08)", line: { color: AMBER, width: 2.4 } }];
  const showAll = !state.from && !state.to && state.day === "all" && state.modes.size === 3 && state.sizes.size === 3;
  if (showAll) {
    for (const m of D.milestones) if (m.date) {
      data.push({ x: [m.date], y: [m.km], type: "scatter", mode: "markers+text", showlegend: false,
        text: [fmt(m.km/1000,1)+"k"], textposition: "top center", textfont: { color: MUTED, size: 10 },
        marker: { symbol: "diamond", size: 9, color: "#a78bfa" },
        hovertemplate: `${fmt(m.km)} km · %{x}<extra>milestone</extra>` });
    }
    const fx = D.forecast.map(f => f.month + "-01"), fy = D.forecast.map(f => f.odo_km);
    data.push({ x: [x[x.length-1], ...fx], y: [y[y.length-1], ...fy], type: "scatter", mode: "lines",
      name: "12-mo projection", line: { color: FAINT, width: 1.6, dash: "dot" } });
  }
  Plotly.newPlot(el, data, baseLayout(), CFG_PLOT);
}

function cMonthly(el) {
  const m = groupSum(F, r => r.month, r => r.distance_km);
  const x = [...m.keys()].sort(), y = x.map(k => +m.get(k).toFixed(1));
  const frames = x.map((_, i) => ({ name: String(i),
    data: [{ y: y.map((v, j) => j <= i ? v : 0) }] }));
  Plotly.newPlot(el, [{ x, y: y.map(() => 0), type: "bar",
    marker: { color: y, colorscale: [[0,"#1d2a4d"],[1,AMBER]], line: { width: 0 } },
    hovertemplate: "%{x}<br>%{y} km<extra></extra>" }],
    baseLayout({ yaxis: { gridcolor: GRID, range: [0, Math.max(...y) * 1.1] },
      updatemenus: [{ type: "buttons", x: 0, y: 1.25, bgcolor: "#101b38", bordercolor: GRID,
        font: { color: AMBER }, buttons: [{ label: "▶ play", method: "animate",
          args: [null, { frame: { duration: 60, redraw: false }, transition: { duration: 40 }, fromcurrent: false }] }] }] }),
    CFG_PLOT).then(() => Plotly.addFrames(el, frames));
}

function cCal(el) {
  const m = groupSum(F, r => r.date, r => r.distance_km);
  if (!m.size) return Plotly.newPlot(el, [], baseLayout(), CFG_PLOT);
  const days = [...m.keys()].sort();
  const w0 = weekStart(days[0]), w1 = weekStart(days[days.length-1]);
  const weeks = []; let w = w0;
  while (w <= w1) { weeks.push(w); const d = new Date(w+"T00:00:00"); d.setDate(d.getDate()+7); w = d.toISOString().slice(0,10); }
  const z = DOWS.map((_, di) => weeks.map(ws => {
    const d = new Date(ws+"T00:00:00"); d.setDate(d.getDate()+di);
    return +(m.get(d.toISOString().slice(0,10)) || 0).toFixed(1) || null; }));
  Plotly.newPlot(el, [{ x: weeks, y: DOWS, z, type: "heatmap", xgap: 2, ygap: 2,
    colorscale: [[0,"#0d1730"],[0.5,"#8a6a2f"],[1,AMBER]], showscale: false,
    hovertemplate: "wk of %{x} · %{y}<br>%{z} km<extra></extra>" }],
    baseLayout({ yaxis: { autorange: "reversed", gridcolor: "rgba(0,0,0,0)" }, xaxis: { showgrid: false } }), CFG_PLOT);
}

/* 02 · patterns */
function dowHourZ() {
  const z = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of F) z[r.dow][r.hour] += r.distance_km;
  return z.map(row => row.map(v => +v.toFixed(1)));
}
function cDowHour(el) {
  Plotly.newPlot(el, [{ z: dowHourZ(), x: [...Array(24).keys()], y: DOWS, type: "heatmap",
    colorscale: [[0,"#0d1730"],[0.55,"#2b6b8f"],[1,MODE_C.eco]], showscale: false, xgap: 1.5, ygap: 1.5,
    hovertemplate: "%{y} %{x}:00<br>%{z} km<extra></extra>" }],
    baseLayout({ yaxis: { autorange: "reversed" }, xaxis: { dtick: 3, title: { text: "hour", font: { size: 10 } } } }), CFG_PLOT);
}
function cHist(el) {
  Plotly.newPlot(el, [{ x: F.map(r => r.distance_km), type: "histogram", nbinsx: 28,
    marker: { color: "rgba(255,181,71,0.55)", line: { color: AMBER, width: 0.5 } },
    hovertemplate: "%{x} km bin · %{y} rides<extra></extra>" }],
    baseLayout({ xaxis: { title: { text: "km / ride", font: { size: 10 } }, gridcolor: GRID }, bargap: 0.06 }), CFG_PLOT);
}
function cViolin(el) {
  const tr = ["eco","city","sport"].map(mo => ({ y: F.filter(r => r.dominant_mode === mo).map(r => r.avg_speed_kmph),
    type: "violin", name: mo, box: { visible: true }, meanline: { visible: true }, points: false,
    line: { color: MODE_C[mo] }, fillcolor: MODE_C[mo] + "33" }));
  Plotly.newPlot(el, tr, baseLayout({ yaxis: { title: { text: "km/h", font: { size: 10 } }, gridcolor: GRID }, showlegend: false }), CFG_PLOT);
}
function cRadar(el) {
  const K = D.kpis_alltime;
  const km = sum(F, r=>r.distance_km), hrs = sum(F, r=>r.duration_min)/60, kwh = sum(F, r=>r.energy_kwh);
  const spanD = F.length ? (new Date(F[F.length-1].date) - new Date(F[0].date))/864e5 + 1 : 1;
  const cur = [ hrs?km/hrs:0, median(F.map(r=>r.distance_km)), F.length/(spanD/7),
    km?sum(F,r=>r.distance_km*r.eco_pct/100)/km*100:0, kwh?km/kwh:0, F.length?sum(F,r=>r.duration_min)/F.length:0 ];
  const base = [ K.avg_speed, K.median_ride_km, K.rides_per_week, K.eco_share_km, K.km_per_kwh,
    K.total_hours*60/K.total_rides ];
  const axes = ["avg speed","median km","rides/wk","eco %","km/kWh","avg mins"];
  const norm = cur.map((v, i) => Math.min(200, base[i] ? v/base[i]*100 : 0));
  Plotly.newPlot(el, [
    { type: "scatterpolar", r: [...axes.map(()=>100), 100], theta: [...axes, axes[0]], name: "all-time = 100",
      line: { color: FAINT, dash: "dot" } },
    { type: "scatterpolar", r: [...norm, norm[0]], theta: [...axes, axes[0]], fill: "toself",
      name: "filtered", line: { color: AMBER }, fillcolor: "rgba(255,181,71,0.18)" },
  ], baseLayout({ polar: { bgcolor: "rgba(0,0,0,0)",
      radialaxis: { gridcolor: GRID, range: [0, 200], tickfont: { size: 9 } },
      angularaxis: { gridcolor: GRID, tickfont: { size: 10 } } } }), CFG_PLOT);
}
function cBubble(el) {
  Plotly.newPlot(el, ["eco","city","sport"].map(mo => {
    const g = F.filter(r => r.dominant_mode === mo);
    return { x: g.map(r=>r.date), y: g.map(r=>r.distance_km), name: mo, mode: "markers", type: "scattergl",
      marker: { size: g.map(r=>r.duration_min), sizemode: "area", sizeref: 2.2, sizemin: 3,
        color: MODE_C[mo], opacity: 0.75, line: { width: 0 } },
      customdata: g.map(r=>r.duration_min),
      hovertemplate: "%{x}<br>%{y} km · %{customdata} min<extra>"+mo+"</extra>" };
  }), baseLayout(), CFG_PLOT);
}
function cScatter(el) {
  const xs = F.map(r=>r.distance_km), ys = F.map(r=>r.avg_speed_kmph);
  const n = xs.length || 1, mx = sum(xs)/n, my = sum(ys)/n;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i]-mx)*(ys[i]-my); den += (xs[i]-mx)**2; }
  const b = den ? num/den : 0, a = my - b*mx;
  const xr = [Math.min(...xs, 0), Math.max(...xs, 1)];
  Plotly.newPlot(el, [
    ...["eco","city","sport"].map(mo => { const g = F.filter(r=>r.dominant_mode===mo);
      return { x: g.map(r=>r.distance_km), y: g.map(r=>r.avg_speed_kmph), name: mo, mode: "markers",
        type: "scattergl", marker: { color: MODE_C[mo], size: 6, opacity: 0.7 } }; }),
    { x: xr, y: xr.map(x=>a+b*x), mode: "lines", name: "trend",
      line: { color: AMBER, width: 2, dash: "dash" },
      hovertemplate: `speed ≈ ${a.toFixed(1)} + ${b.toFixed(2)}·km<extra></extra>` },
  ], baseLayout({ xaxis: { title: { text: "km", font: { size: 10 } }, gridcolor: GRID },
                  yaxis: { title: { text: "km/h", font: { size: 10 } }, gridcolor: GRID } }), CFG_PLOT);
}
function c3d(el) {
  const tr = ["eco","city","sport"].map(mo => { const g = F.filter(r=>r.dominant_mode===mo);
    return { x: g.map(r=>r.distance_km), y: g.map(r=>r.duration_min), z: g.map(r=>r.avg_speed_kmph),
      name: mo, type: "scatter3d", mode: "markers",
      marker: { size: 3.6, color: MODE_C[mo], opacity: 0.8 },
      hovertemplate: "%{x} km · %{y} min · %{z} km/h<extra>"+mo+"</extra>" }; });
  const ax = { gridcolor: GRID, zerolinecolor: GRID, showbackground: false, tickfont: { size: 9 }, titlefont: { size: 10 } };
  Plotly.newPlot(el, tr, baseLayout({ margin: { l: 0, r: 0, t: 0, b: 0 },
    scene: { xaxis: { ...ax, title: "km" }, yaxis: { ...ax, title: "min" }, zaxis: { ...ax, title: "km/h" },
      camera: { eye: { x: 1.6, y: 1.2, z: 0.7 } } } }), CFG_PLOT).then(() => spin(el));
}
function spin(el) {
  if (REDUCED) return;
  let t = 0, user = false;
  el.on("plotly_relayouting", () => user = true);
  (function orbit() {
    if (user || !document.body.contains(el)) return;
    t += 0.004;
    Plotly.relayout(el, { "scene.camera.eye": { x: 1.9*Math.cos(t), y: 1.9*Math.sin(t), z: 0.7 } });
    requestAnimationFrame(orbit);
  })();
}
function cSurface(el) {
  Plotly.newPlot(el, [{ z: dowHourZ(), x: [...Array(24).keys()], y: DOWS, type: "surface",
    colorscale: [[0,"#0d1730"],[0.5,"#2b6b8f"],[1,AMBER]], showscale: false,
    contours: { z: { show: true, usecolormap: true, project: { z: true } } } }],
    baseLayout({ margin: { l: 0, r: 0, t: 0, b: 0 },
      scene: { xaxis: { title: "hour", gridcolor: GRID, showbackground: false },
               yaxis: { title: "", gridcolor: GRID, showbackground: false },
               zaxis: { title: "km", gridcolor: GRID, showbackground: false },
               camera: { eye: { x: -1.5, y: -1.5, z: 0.9 } } } }), CFG_PLOT);
}

/* 03 · shape of the data */
function monthModeMatrix() {
  const months = [...new Set(F.map(r => r.month))].sort();
  const g = { eco: {}, city: {}, sport: {} };
  for (const r of F) for (const mo of ["eco","city","sport"])
    g[mo][r.month] = (g[mo][r.month] || 0) + r.distance_km * r[mo+"_pct"] / 100;
  return { months, g };
}
function cStream(el) {
  const { months, g } = monthModeMatrix();
  const tot = months.map(m => (g.eco[m]||0) + (g.city[m]||0) + (g.sport[m]||0));
  const L0 = months.map((_, i) => -tot[i]/2);
  const L1 = months.map((m, i) => L0[i] + (g.eco[m]||0));
  const L2 = months.map((m, i) => L1[i] + (g.city[m]||0));
  const L3 = months.map((m, i) => L2[i] + (g.sport[m]||0));
  const line = { width: 0.6, shape: "spline", smoothing: 1.1 };
  Plotly.newPlot(el, [
    { x: months, y: L0, mode: "lines", line: { ...line, color: "rgba(0,0,0,0)" }, hoverinfo: "skip", showlegend: false },
    { x: months, y: L1, mode: "lines", name: "eco", fill: "tonexty", fillcolor: MODE_C.eco+"cc", line: { ...line, color: MODE_C.eco },
      customdata: months.map(m=>+(g.eco[m]||0).toFixed(1)), hovertemplate: "%{x} · eco %{customdata} km<extra></extra>" },
    { x: months, y: L2, mode: "lines", name: "city", fill: "tonexty", fillcolor: MODE_C.city+"cc", line: { ...line, color: MODE_C.city },
      customdata: months.map(m=>+(g.city[m]||0).toFixed(1)), hovertemplate: "%{x} · city %{customdata} km<extra></extra>" },
    { x: months, y: L3, mode: "lines", name: "sport", fill: "tonexty", fillcolor: MODE_C.sport+"cc", line: { ...line, color: MODE_C.sport },
      customdata: months.map(m=>+(g.sport[m]||0).toFixed(1)), hovertemplate: "%{x} · sport %{customdata} km<extra></extra>" },
  ], baseLayout({ yaxis: { visible: false } }), CFG_PLOT);
}
function cBump(el) {
  const { months, g } = monthModeMatrix();
  const ranks = { eco: [], city: [], sport: [] };
  for (const m of months) {
    const order = ["eco","city","sport"].map(mo => [mo, g[mo][m]||0]).sort((a,b)=>b[1]-a[1]);
    order.forEach(([mo], i) => ranks[mo].push(i+1));
  }
  Plotly.newPlot(el, ["eco","city","sport"].map(mo => ({ x: months, y: ranks[mo], name: mo,
    mode: "lines+markers", line: { color: MODE_C[mo], width: 2.4, shape: "spline" }, marker: { size: 6 } })),
    baseLayout({ yaxis: { autorange: "reversed", dtick: 1, gridcolor: GRID, title: { text: "rank", font: { size: 10 } } } }), CFG_PLOT);
}
function cSankey(el) {
  const years = [...new Set(F.map(r=>String(r.year)))].sort();
  const nodes = [...years, "eco", "city", "sport"];
  const idx = Object.fromEntries(nodes.map((n,i)=>[n,i]));
  const src = [], tgt = [], val = [], lc = [];
  for (const y of years) for (const mo of ["eco","city","sport"]) {
    const v = sum(F.filter(r=>String(r.year)===y), r=>r.distance_km*r[mo+"_pct"]/100);
    if (v > 0.5) { src.push(idx[y]); tgt.push(idx[mo]); val.push(+v.toFixed(1)); lc.push(MODE_C[mo]+"66"); }
  }
  Plotly.newPlot(el, [{ type: "sankey", orientation: "h",
    node: { pad: 14, thickness: 14, line: { width: 0 },
      color: nodes.map(n => MODE_C[n] || AMBER), label: nodes,
      hovertemplate: "%{label}: %{value:.0f} km<extra></extra>" },
    link: { source: src, target: tgt, value: val, color: lc,
      hovertemplate: "%{source.label} → %{target.label}<br>%{value:.0f} km<extra></extra>" } }],
    baseLayout({ margin: { l: 8, r: 8, t: 8, b: 8 } }), CFG_PLOT);
}
function hierData(levels) {   // levels: array of keyFns; returns ids/labels/parents/values (branch totals)
  const map = new Map();      // id -> {label, parent, value}
  for (const r of F) {
    let parent = "";
    let path = "";
    levels.forEach((kf, li) => {
      const k = String(kf(r));
      path = path ? path + "|" + k : k;
      if (!map.has(path)) map.set(path, { label: k, parent, value: 0 });
      map.get(path).value += r.distance_km;
      parent = path;
    });
  }
  const ids = [], labels = [], parents = [], values = [];
  for (const [id, n] of map) { ids.push(id); labels.push(n.label); parents.push(n.parent); values.push(+n.value.toFixed(1)); }
  return { ids, labels, parents, values };
}
function cSunburst(el) {
  const h = hierData([r=>r.year, r=>r.month_name, r=>r.dominant_mode]);
  Plotly.newPlot(el, [{ type: "sunburst", ...h, branchvalues: "total",
    marker: { colors: h.ids.map(id => { const leaf = id.split("|").pop();
      return MODE_C[leaf] || (id.includes("|") ? "#22335f" : "#1a2850"); }), line: { color: "#060b1a", width: 1.4 } },
    hovertemplate: "%{label}<br>%{value} km<extra></extra>", maxdepth: 3 }],
    baseLayout({ margin: { l: 4, r: 4, t: 4, b: 4 } }), CFG_PLOT);
}
function cIcicle(el) {
  const h = hierData([r=>r.year, r=>r.quarter, r=>r.month_name]);
  Plotly.newPlot(el, [{ type: "icicle", ...h, branchvalues: "total", tiling: { orientation: "v" },
    marker: { colorscale: [[0,"#101b38"],[1,AMBER]], line: { color: "#060b1a", width: 1.2 } },
    hovertemplate: "%{label}<br>%{value} km<extra></extra>" }],
    baseLayout({ margin: { l: 4, r: 4, t: 4, b: 4 } }), CFG_PLOT);
}
function cTreemap(el) {
  const m = groupSum(F, r => r.month_name, r => r.distance_km);
  const eco = groupSum(F, r => r.month_name, r => r.distance_km * r.eco_pct / 100);
  const labels = [...m.keys()], values = labels.map(k => +m.get(k).toFixed(1));
  const shade = labels.map(k => (eco.get(k)||0) / (m.get(k)||1) * 100);
  Plotly.newPlot(el, [{ type: "treemap", labels, parents: labels.map(()=>"" ), values,
    marker: { colors: shade, colorscale: [[0,MODE_C.sport],[0.5,MODE_C.city],[1,MODE_C.eco]],
      colorbar: { title: { text: "eco %", font: { size: 9 } }, thickness: 8, tickfont: { size: 9 } },
      line: { color: "#060b1a", width: 1.4 } },
    textfont: { family: "JetBrains Mono", size: 11 },
    hovertemplate: "%{label}<br>%{value} km · %{color:.0f}% eco<extra></extra>" }],
    baseLayout({ margin: { l: 4, r: 4, t: 4, b: 4 } }), CFG_PLOT);
}
function cWaterfall(el) {
  const m = groupSum(F, r => r.month, r => r.distance_km);
  const ks = [...m.keys()].sort();
  const shown = ks.slice(-12), earlier = ks.slice(0, -12);
  const x = [], y = [], meas = [];
  if (earlier.length) { x.push("earlier"); y.push(+sum(earlier.map(k=>m.get(k))).toFixed(1)); meas.push("relative"); }
  for (const k of shown) { x.push(k.slice(2)); y.push(+m.get(k).toFixed(1)); meas.push("relative"); }
  x.push("total"); y.push(0); meas.push("total");
  Plotly.newPlot(el, [{ type: "waterfall", x, y, measure: meas,
    increasing: { marker: { color: "rgba(255,181,71,0.7)" } },
    totals: { marker: { color: MODE_C.eco } },
    connector: { line: { color: GRID, width: 1 } },
    hovertemplate: "%{x}<br>%{y} km<extra></extra>" }],
    baseLayout(), CFG_PLOT);
}
function cPack(el) {
  if (!D.packing.length) { el.innerHTML = "<p style='padding:20px;color:#55648a;font-size:12px'>Circle packing appears after the first GitHub Actions build (needs the circlify package).</p>"; return; }
  const keep = new Set(F.map(r => r.i));
  const monthsInF = new Set(F.map(r => r.month));
  const shapes = D.packing.filter(c => c.kind === "month").map(c => ({
    type: "circle", xref: "x", yref: "y", x0: c.x - c.r, x1: c.x + c.r, y0: c.y - c.r, y1: c.y + c.r,
    line: { color: monthsInF.has(c.month) ? "rgba(255,181,71,0.35)" : "rgba(85,100,138,0.15)", width: 1 } }));
  const leaves = D.packing.filter(c => c.kind === "ride");
  const size = el.clientWidth ? Math.min(el.clientWidth, 460) : 420;
  const pxPerUnit = (size - 20) / 2.15;
  Plotly.newPlot(el, [{ x: leaves.map(c=>c.x), y: leaves.map(c=>c.y), type: "scattergl", mode: "markers",
    marker: { size: leaves.map(c => Math.max(2.5, c.r * 2 * pxPerUnit)),
      color: leaves.map(c => MODE_C[c.mode] || AMBER),
      opacity: leaves.map(c => keep.has(c.idx) ? 0.85 : 0.06), line: { width: 0 } },
    customdata: leaves.map(c => [c.date, c.km, c.mode]),
    hovertemplate: "%{customdata[0]}<br>%{customdata[1]} km · %{customdata[2]}<extra></extra>" }],
    baseLayout({ shapes, height: size,
      xaxis: { visible: false, range: [-1.08, 1.08], fixedrange: true },
      yaxis: { visible: false, range: [-1.08, 1.08], scaleanchor: "x", fixedrange: true },
      margin: { l: 10, r: 10, t: 10, b: 10 }, showlegend: false }), CFG_PLOT);
}

/* 04 · energy & money */
function cSavings(el) {
  let s = 0, c = 0;
  const x = F.map(r=>r.date), ys = F.map(r=>+(s += r.saved_inr).toFixed(0)), yc = F.map(r=>+(c += r.co2_saved_kg).toFixed(1));
  Plotly.newPlot(el, [
    { x, y: ys, name: "₹ saved", mode: "lines", line: { color: AMBER, width: 2.4 }, fill: "tozeroy", fillcolor: "rgba(255,181,71,0.07)" },
    { x, y: yc, name: "kg CO₂", mode: "lines", yaxis: "y2", line: { color: MODE_C.eco, width: 2, dash: "dot" } },
  ], baseLayout({ yaxis: { title: { text: "₹", font: { size: 10 } }, gridcolor: GRID },
      yaxis2: { title: { text: "kg CO₂", font: { size: 10 } }, overlaying: "y", side: "right", gridcolor: "rgba(0,0,0,0)" } }), CFG_PLOT);
}
function cEnergy(el) {
  const e = D.config.bike.efficiency_wh_per_km;
  const vals = ["eco","city","sport"].map(mo => +sum(F, r => r.distance_km * r[mo+"_pct"]/100 * e[mo] / 1000).toFixed(1));
  Plotly.newPlot(el, [{ type: "pie", hole: 0.62, labels: ["eco","city","sport"], values: vals,
    marker: { colors: [MODE_C.eco, MODE_C.city, MODE_C.sport], line: { color: "#060b1a", width: 2 } },
    textinfo: "label+percent", textfont: { family: "JetBrains Mono", size: 11 },
    hovertemplate: "%{label}: %{value} kWh<extra></extra>" }],
    baseLayout({ showlegend: false, margin: { l: 8, r: 8, t: 8, b: 8 },
      annotations: [{ text: fmt(sum(vals),1) + "<br>kWh", showarrow: false, font: { size: 15, color: INK, family: "JetBrains Mono" } }] }), CFG_PLOT);
}
function cCost(el) {
  const ch = groupSum(F, r=>r.month, r=>r.charge_cost_inr), pe = groupSum(F, r=>r.month, r=>r.petrol_cost_inr);
  const x = [...ch.keys()].sort();
  Plotly.newPlot(el, [
    { x, y: x.map(k=>+ch.get(k).toFixed(0)), name: "charging", type: "bar", marker: { color: MODE_C.eco } },
    { x, y: x.map(k=>+(pe.get(k)||0).toFixed(0)), name: "petrol equiv.", type: "bar", marker: { color: "rgba(255,93,93,0.55)" } },
  ], baseLayout({ barmode: "group", yaxis: { title: { text: "₹ / month", font: { size: 10 } }, gridcolor: GRID } }), CFG_PLOT);
}

/* 05 · battery & service (all-time) */
function cGauges(el) {
  const B = D.battery.latest || { soc_pct: 0, soh_pct: 0, temp_c: 0, voltage_v: 0 };
  const g = (v, title, x, color, suffix) => ({ type: "indicator", mode: "gauge+number",
    value: v, number: { suffix, font: { size: 22, family: "JetBrains Mono" } },
    title: { text: title, font: { size: 11, color: MUTED } }, domain: { x, y: [0, 1] },
    gauge: { axis: { range: [0, 100], tickfont: { size: 8 }, tickcolor: GRID },
      bar: { color, thickness: 0.28 }, bgcolor: "#0d1730", borderwidth: 0 } });
  Plotly.newPlot(el, [
    g(B.soc_pct, "State of charge", [0, 0.48], MODE_C.eco, "%"),
    g(B.soh_pct, "State of health", [0.52, 1], AMBER, "%"),
  ], baseLayout({ margin: { l: 18, r: 18, t: 30, b: 6 },
    annotations: [{ text: `${B.voltage_v} V · ${B.temp_c} °C · ${D.battery.latest ? D.battery.latest.full_charge_equivalents : "–"} full-charge cycles est.`,
      x: 0.5, y: -0.12, showarrow: false, font: { size: 10, color: FAINT } }] }), CFG_PLOT);
}
function cSvcGauge(el) {
  const S = D.service;
  $("#svc-hint").textContent = S.overdue
    ? `Overdue — last service ${S.history.length ? S.history[S.history.length-1].date : "?"}. Book one.`
    : `Due at ${fmt(S.interval_km)} km since last service${S.due_projection_by_kms ? " · projected ~" + S.due_projection_by_kms : ""}${S.due_by_date ? " · or by " + S.due_by_date : ""}.`;
  Plotly.newPlot(el, [{ type: "indicator", mode: "gauge+number+delta",
    value: S.km_since_service, number: { suffix: " km", font: { size: 22, family: "JetBrains Mono" } },
    delta: { reference: S.interval_km, decreasing: { color: MODE_C.eco }, increasing: { color: MODE_C.sport } },
    gauge: { axis: { range: [0, S.interval_km * 1.2], tickfont: { size: 8 }, tickcolor: GRID },
      bar: { color: S.overdue ? MODE_C.sport : AMBER, thickness: 0.28 }, bgcolor: "#0d1730", borderwidth: 0,
      threshold: { line: { color: MODE_C.sport, width: 2.5 }, thickness: 0.85, value: S.interval_km } } }],
    baseLayout({ margin: { l: 24, r: 24, t: 24, b: 6 } }), CFG_PLOT);
}
function cBattery(el) {
  const s = D.battery.series;
  const x = s.map(p=>p.t);
  Plotly.newPlot(el, [
    { x, y: s.map(p=>p.soc_pct), name: "SOC %", mode: "lines+markers", line: { color: MODE_C.eco } },
    { x, y: s.map(p=>p.soh_pct), name: "SOH %", mode: "lines+markers", line: { color: AMBER } },
    { x, y: s.map(p=>p.temp_c), name: "°C", mode: "lines+markers", line: { color: MODE_C.sport, dash: "dot" } },
    { x, y: s.map(p=>p.voltage_v), name: "V", yaxis: "y2", mode: "lines+markers", line: { color: MODE_C.city } },
  ], baseLayout({ yaxis: { gridcolor: GRID, title: { text: "% / °C", font: { size: 10 } } },
      yaxis2: { overlaying: "y", side: "right", title: { text: "V", font: { size: 10 } }, gridcolor: "rgba(0,0,0,0)" } }), CFG_PLOT);
}
function cService(el) {
  const x = D.rides.map(r=>r.date), y = D.rides.map(r=>r.odometer_km);
  const S = D.service;
  const data = [
    { x, y, mode: "lines", name: "odometer", line: { color: "rgba(255,181,71,0.7)", width: 2 } },
    { x: S.history.map(h=>h.date), y: S.history.map(h=>h.odometer_km), mode: "markers+text",
      name: "service", text: S.history.map(h=>h.type.split(" ")[0]), textposition: "top left",
      textfont: { size: 9, color: MUTED },
      marker: { symbol: "star", size: 13, color: MODE_C.city, line: { color: INK, width: 1 } },
      customdata: S.history.map(h=>[h.workshop, h.km_since_prev]),
      hovertemplate: "%{x} · %{y} km<br>%{customdata[0]} · +%{customdata[1]} km<extra></extra>" },
  ];
  const nextY = S.history.length ? S.history[S.history.length-1].odometer_km + S.interval_km : S.interval_km;
  data.push({ x: [x[0], x[x.length-1]], y: [nextY, nextY], mode: "lines", name: "next due",
    line: { color: MODE_C.sport, width: 1.4, dash: "dash" } });
  Plotly.newPlot(el, data, baseLayout({ yaxis: { title: { text: "km", font: { size: 10 } }, gridcolor: GRID } }), CFG_PLOT);
}

/* 06 · map */
function circlePts(lat, lon, km) {
  const la = [], lo = [];
  for (let i = 0; i <= 72; i++) { const a = i/72*2*Math.PI;
    la.push(lat + (km/110.574)*Math.sin(a));
    lo.push(lon + (km/(111.32*Math.cos(lat*Math.PI/180)))*Math.cos(a)); }
  return { la, lo };
}
function cMap(el) {
  const L = D.config.locations;
  const pts = F.filter(r => r.lat != null && r.lon != null);
  $("#map-hint").textContent = pts.length
    ? `${pts.length} rides have GPS start points.`
    : "No per-ride GPS yet — add start_lat / start_lon columns in rides.csv (use View Map in the Revolt app) and they'll plot here.";
  const fence = circlePts(L.home.lat, L.home.lon, L.geofence_radius_km);
  const data = [
    { type: "scattermap", lat: fence.la, lon: fence.lo, mode: "lines", name: "geo-fence",
      line: { color: "rgba(255,181,71,0.5)", width: 1.5 }, hoverinfo: "skip" },
    { type: "scattermap", lat: [L.home.lat], lon: [L.home.lon], mode: "markers+text", name: "home",
      text: [L.home.label], textposition: "top right", textfont: { color: INK, size: 11 },
      marker: { size: 15, color: AMBER } },
    { type: "scattermap", lat: [L.dealer.lat], lon: [L.dealer.lon], mode: "markers+text", name: "dealer",
      text: [L.dealer.label], textposition: "top right", textfont: { color: MUTED, size: 10 },
      marker: { size: 12, color: MODE_C.city } },
  ];
  if (pts.length) data.push({ type: "scattermap", lat: pts.map(r=>r.lat), lon: pts.map(r=>r.lon),
    mode: "markers", name: "ride starts",
    marker: { size: 8, color: pts.map(r=>MODE_C[r.dominant_mode]), opacity: 0.8 },
    customdata: pts.map(r=>[r.date, r.distance_km]),
    hovertemplate: "%{customdata[0]} · %{customdata[1]} km<extra></extra>" });
  Plotly.newPlot(el, data, baseLayout({
    map: { style: "carto-darkmatter", center: { lat: L.home.lat, lon: L.home.lon }, zoom: 11 },
    margin: { l: 0, r: 0, t: 0, b: 0 }, height: 430,
    legend: { y: 0.02, x: 0.02, bgcolor: "rgba(6,11,26,0.6)" } }), CFG_PLOT);
}

/* 07 · table ---------------------------------------------------------------- */
const T = { page: 0, size: 25, key: "date", dir: -1 };
const COLS = [
  ["date","Date"], ["time","Time"], ["distance_km","km"], ["duration_min","min"],
  ["avg_speed_kmph","km/h"], ["dominant_mode","Mode"], ["energy_kwh","kWh"],
  ["saved_inr","₹ saved"], ["co2_saved_kg","CO₂ kg"], ["source","Src"],
];
function renderTable(reset) {
  if (reset) T.page = 0;
  const rows = [...F].sort((a,b) => {
    const x = a[T.key], y = b[T.key];
    return (x > y ? 1 : x < y ? -1 : 0) * T.dir;
  });
  const start = T.page * T.size, pageRows = rows.slice(start, start + T.size);
  $("#ride-table thead").innerHTML = "<tr>" + COLS.map(([k,l]) =>
    `<th data-k="${k}">${l}${T.key===k ? (T.dir>0?" ↑":" ↓") : ""}</th>`).join("") + "</tr>";
  $("#ride-table tbody").innerHTML = pageRows.map(r => `<tr>
    <td>${r.date}</td><td>${r.time}</td><td>${r.distance_km}</td><td>${r.duration_min}</td>
    <td>${r.avg_speed_kmph}${r.speed_anomaly ? " ⚠" : ""}</td>
    <td><span class="pill ${r.dominant_mode}">${r.dominant_mode}</span></td>
    <td>${r.energy_kwh}</td><td>${r.saved_inr}</td><td>${r.co2_saved_kg}</td><td>${r.source}</td></tr>`).join("");
  $("#pager").textContent = rows.length
    ? `${start+1}–${Math.min(start+T.size, rows.length)} of ${fmt(rows.length)}` : "no rides in filter";
  $$("#ride-table th").forEach(th => th.onclick = () => {
    const k = th.dataset.k;
    if (T.key === k) T.dir *= -1; else { T.key = k; T.dir = -1; }
    renderTable(false);
  });
}
function wireTable() {
  $("#pg-prev").onclick = () => { if (T.page > 0) { T.page--; renderTable(false); } };
  $("#pg-next").onclick = () => { if ((T.page+1)*T.size < F.length) { T.page++; renderTable(false); } };
  $("#csv-btn").onclick = () => {
    const head = ["date","time","distance_km","duration_min","avg_speed_kmph","dominant_mode",
      "eco_pct","city_pct","sport_pct","energy_kwh","charge_cost_inr","saved_inr","co2_saved_kg","source"];
    const csv = [head.join(",")].concat(F.map(r => head.map(k => r[k]).join(","))).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "rv400_rides_filtered.csv"; a.click(); URL.revokeObjectURL(a.href);
  };
}

/* ---------- boot ---------- */
async function boot() {
  const res = await fetch("data/analytics.json");
  D = await res.json();
  document.title = D.config.title || document.title;
  hero(); wireFilters(); wireTable();

  reg("g-gauges", cGauges, { alltime: true });
  reg("g-svc-gauge", cSvcGauge, { alltime: true });
  reg("g-daily", cDaily); reg("g-cum", cCum); reg("g-monthly", cMonthly); reg("g-cal", cCal);
  reg("g-dowhour", cDowHour); reg("g-hist", cHist); reg("g-violin", cViolin); reg("g-radar", cRadar);
  reg("g-bubble", cBubble); reg("g-scatter", cScatter); reg("g-3d", c3d);
  reg("g-stream", cStream); reg("g-bump", cBump); reg("g-sankey", cSankey);
  reg("g-sunburst", cSunburst); reg("g-pack", cPack); reg("g-icicle", cIcicle);
  reg("g-treemap", cTreemap); reg("g-waterfall", cWaterfall); reg("g-surface", cSurface);
  reg("g-savings", cSavings); reg("g-energy", cEnergy); reg("g-cost", cCost);
  reg("g-battery", cBattery, { alltime: true }); reg("g-service", cService, { alltime: true });
  reg("g-map", cMap);

  applyFilters();
  for (const c of REG) io.observe(c.el);
}
boot().catch(err => {
  document.body.insertAdjacentHTML("afterbegin",
    `<div style="padding:16px;color:#ff5d5d;font-family:monospace">Failed to load analytics.json — has the GitHub Action run yet? (${err})</div>`);
});
