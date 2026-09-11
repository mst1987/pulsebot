// Inline-SVG charts for the report page's fight timelines.
//
// Pure string builders, no DOM and no library: the report page is server
// rendered, public and must work without a JS bundle. Every chart is drawn on
// the page's own theme tokens (var(--accent) and friends), so light and dark
// come for free, and every chart carries a table twin so nothing is readable
// by colour alone.
//
// Shapes the builders consume are the `timeline` field of a report (see
// utils/logcheck/fightTimeline.js): times in ms relative to the fight start,
// bands as `[from, to]` pairs or `{ from, to, stacks }` objects.

const LABEL_W = 150;     // left column with the row labels
const VALUE_W = 56;      // right column with the row's headline number
const ROW_H = 24;        // one ribbon row
const BAND_H = 14;       // the band inside a row (leaves air above and below)
const AXIS_H = 22;       // the time axis band under the rows
const PAD_TOP = 6;
const DEFAULT_W = 900;

function esc(s) {
    return String(s === undefined || s === null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** `m:ss` for a millisecond offset; `1:05:00` past an hour. */
function fmtTime(ms) {
    const s = Math.max(0, Math.round((ms || 0) / 1000));
    const m = Math.floor(s / 60);
    const sec = String(s % 60).padStart(2, "0");
    if (m < 60) return `${m}:${sec}`;
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${sec}`;
}

/** A tick every clean step so a fight of any length gets 4–8 labelled ticks. */
function axisTicks(duration) {
    const steps = [5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000];
    const total = Math.max(1, duration || 0);
    let step = steps[steps.length - 1];
    for (const s of steps) {
        if (total / s <= 8) { step = s; break; }
    }
    const ticks = [];
    for (let t = 0; t <= total; t += step) ticks.push(t);
    return ticks;
}

function scale(duration, plotW) {
    const total = Math.max(1, duration || 0);
    return (t) => (Math.max(0, Math.min(total, t)) / total) * plotW;
}

function axisSvg(duration, x0, plotW, y) {
    const sx = scale(duration, plotW);
    const ticks = axisTicks(duration).map((t) => {
        const x = x0 + sx(t);
        return `<line class="fc-tick" x1="${x.toFixed(1)}" y1="${y}" x2="${x.toFixed(1)}" y2="${y + 4}"/>`
            + `<text class="fc-axis" x="${x.toFixed(1)}" y="${y + 16}" text-anchor="middle">${fmtTime(t)}</text>`;
    }).join("");
    return `<line class="fc-axisline" x1="${x0}" y1="${y}" x2="${x0 + plotW}" y2="${y}"/>${ticks}`;
}

/** Vertical hairlines for every death, in the class colour, with the reason in the title. */
function deathMarkers(deaths, duration, x0, plotW, y0, y1, classColor) {
    const sx = scale(duration, plotW);
    return (deaths || []).map((d) => {
        const x = (x0 + sx(d.at)).toFixed(1);
        const color = (classColor && classColor(d.type)) || "";
        const style = color ? ` style="--cc:${esc(color)}"` : "";
        const why = d.ability ? ` († ${d.ability})` : "";
        return `<g class="fc-death"${style}><title>${esc(`${fmtTime(d.at)} ${d.name}${why}`)}</title>`
            + `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}"/>`
            + `<rect x="${(Number(x) - 6).toFixed(1)}" y="${y0}" width="12" height="${y1 - y0}" class="fc-hit"/></g>`;
    }).join("");
}

function normalizeBand(b) {
    if (Array.isArray(b)) return { from: b[0], to: b[1], stacks: 0 };
    if (b && typeof b === "object") return { from: b.from, to: b.to, stacks: b.stacks || 0 };
    return null;
}

// Roughly how many characters of the 12.5px label font fit the label column.
const LABEL_CHARS = 22;
const LABEL_CHARS_ICON = 19;

/** Shorten a label to the column, keeping the full text in the title. */
function truncate(label, max) {
    const s = String(label || "");
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Row label with an optional icon, shortened to the label column. */
function rowLabel(row, y) {
    const icon = row.icon
        ? `<image class="fc-icon" href="${esc(iconUrl(row.icon))}" x="4" y="${y + (ROW_H - 16) / 2}" width="16" height="16"/>`
        : "";
    const tx = row.icon ? 26 : 6;
    const text = truncate(row.label, row.icon ? LABEL_CHARS_ICON : LABEL_CHARS);
    return `${icon}<text class="fc-label" x="${tx}" y="${y + ROW_H / 2 + 4}"><title>${esc(row.label)}</title>${esc(text)}</text>`;
}

function iconUrl(icon) {
    const name = String(icon || "inv_misc_questionmark").replace(/\.(jpg|jpeg|png|gif)$/i, "").toLowerCase();
    return `https://wow.zamimg.com/images/wow/icons/small/${name}.jpg`;
}

/**
 * Ribbon timeline: one row per aura/debuff/activity, filled bands on the fight's
 * time axis, gaps as surface. Stacked bands are drawn in one hue, stepped by
 * height (light → dark), so 5/5 Sunder reads darker than 1/5. Deaths are
 * hairlines across every row.
 *
 * @param {object} chart
 * @param {number} chart.duration  fight length in ms
 * @param {Array<{ label, icon?, bands, maxStacks?, value?, tone? }>} chart.rows
 *   `bands` are `[from,to]` pairs or `{from,to,stacks}`; `value` is the row's
 *   headline (e.g. "87%") shown at the right; `tone` colours it good/medium/high.
 * @param {Array} [chart.deaths]   `{ at, name, type, ability }`
 * @param {function} [chart.classColor]  class name → hex, for the death markers
 * @param {number} [chart.width]
 * @param {string} [chart.title]   caption above the chart
 */
function ribbonChart(chart) {
    const rows = chart.rows || [];
    if (rows.length === 0) return "<div class=\"fc-empty\">Keine Daten für diesen Kampf.</div>";
    const width = chart.width || DEFAULT_W;
    const plotW = width - LABEL_W - VALUE_W;
    const sx = scale(chart.duration, plotW);
    const rowsTop = PAD_TOP;
    const rowsBottom = rowsTop + rows.length * ROW_H;
    const height = rowsBottom + AXIS_H;

    const body = rows.map((row, i) => {
        const y = rowsTop + i * ROW_H;
        const by = y + (ROW_H - BAND_H) / 2;
        const max = row.maxStacks || 0;
        const bands = (row.bands || []).map(normalizeBand).filter((b) => b && b.to > b.from).map((b) => {
            const x = x0(sx(b.from));
            const w = Math.max(1, sx(b.to) - sx(b.from));
            const level = max > 0 && b.stacks > 0 ? Math.max(0.3, Math.min(1, b.stacks / max)) : 1;
            const tip = max > 0
                ? `${fmtTime(b.from)}–${fmtTime(b.to)} · ${b.stacks}/${max} Stacks`
                : `${fmtTime(b.from)}–${fmtTime(b.to)}`;
            return `<rect class="fc-band${row.tone ? ` fc-${row.tone}` : ""}" x="${x.toFixed(1)}" y="${by}" width="${w.toFixed(1)}" height="${BAND_H}" rx="2" fill-opacity="${level.toFixed(2)}"><title>${esc(`${row.label}: ${tip}`)}</title></rect>`;
        }).join("");
        const value = row.value !== undefined && row.value !== null
            ? `<text class="fc-value${row.tone ? ` fc-${row.tone}` : ""}" x="${width - 6}" y="${y + ROW_H / 2 + 4}" text-anchor="end">${esc(row.value)}</text>`
            : "";
        return `<g class="fc-row">${rowLabel(row, y)}<line class="fc-track" x1="${LABEL_W}" y1="${y + ROW_H / 2}" x2="${LABEL_W + plotW}" y2="${y + ROW_H / 2}"/>${bands}${value}</g>`;
    }).join("");

    const deaths = deathMarkers(chart.deaths, chart.duration, LABEL_W, plotW, rowsTop, rowsBottom, chart.classColor);
    const svg = `<svg class="fchart fc-ribbon" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(chart.title || "Zeitleiste")}">`
        + body + deaths + axisSvg(chart.duration, LABEL_W, plotW, rowsBottom + 2) + "</svg>";
    return figure(chart.title, svg, ribbonTable(rows, chart));
}

function x0(x) { return LABEL_W + x; }

function ribbonTable(rows, chart) {
    const head = "<tr><th>Zeile</th><th>Uptime</th><th>Lücken</th><th>Erste Anwendung</th><th>Längste Lücke</th></tr>";
    const body = rows.map((row) => {
        const bands = (row.bands || []).map(normalizeBand).filter((b) => b && b.to > b.from);
        const stats = bandStats(bands, chart.duration);
        return `<tr><td>${esc(row.label)}</td><td>${stats.uptimePct}%</td><td>${stats.gapCount}</td><td>${stats.firstAt === null ? "–" : fmtTime(stats.firstAt)}</td><td>${stats.longestGap ? fmtTime(stats.longestGap) : "–"}</td></tr>`;
    }).join("");
    return `<table class="idx fc-table">${head}${body}</table>`;
}

/** Uptime / gaps of a band list — the same arithmetic the analyzers use, kept local so the module stays dependency-free. */
function bandStats(bands, duration) {
    const total = Math.max(0, duration || 0);
    const sorted = bands.map((b) => [b.from, b.to]).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [from, to] of sorted) {
        const last = merged[merged.length - 1];
        if (last && from <= last[1]) { if (to > last[1]) last[1] = to; } else merged.push([from, to]);
    }
    let cursor = 0;
    let uptime = 0;
    let gapCount = 0;
    let longestGap = 0;
    for (const [from, to] of merged) {
        if (from > cursor) { gapCount++; longestGap = Math.max(longestGap, from - cursor); }
        uptime += to - from;
        cursor = to;
    }
    if (cursor < total) { gapCount++; longestGap = Math.max(longestGap, total - cursor); }
    return {
        uptimePct: total ? Math.min(100, Math.round((uptime / total) * 100)) : 0,
        gapCount,
        longestGap,
        firstAt: merged.length ? merged[0][0] : null,
    };
}

/**
 * Marker timeline: one row per player or ability with a dot per cast, an
 * optional band underneath (the buff the casts keep up) and downtime stretches
 * highlighted. Used for totems, cooldowns and potions.
 *
 * @param {object} chart
 * @param {number} chart.duration
 * @param {Array<{ label, icon?, markers: Array<{ at, label?, icon? }>, band?, downtimes?, value?, tone? }>} chart.rows
 * @param {Array<{ label, from, to }>} [chart.windows]  shaded spans behind every row (a Bloodlust window)
 * @param {Array} [chart.deaths]
 * @param {function} [chart.classColor]
 */
function markerChart(chart) {
    const rows = chart.rows || [];
    if (rows.length === 0) return "<div class=\"fc-empty\">Keine Daten für diesen Kampf.</div>";
    const width = chart.width || DEFAULT_W;
    const plotW = width - LABEL_W - VALUE_W;
    const sx = scale(chart.duration, plotW);
    const rowsTop = PAD_TOP;
    const rowsBottom = rowsTop + rows.length * ROW_H;
    const height = rowsBottom + AXIS_H;

    const windows = (chart.windows || []).map((w) => {
        const x = x0(sx(w.from));
        const wd = Math.max(1, sx(w.to) - sx(w.from));
        return `<rect class="fc-window" x="${x.toFixed(1)}" y="${rowsTop}" width="${wd.toFixed(1)}" height="${rowsBottom - rowsTop}"><title>${esc(`${w.label}: ${fmtTime(w.from)}–${fmtTime(w.to)}`)}</title></rect>`;
    }).join("");

    const body = rows.map((row, i) => {
        const y = rowsTop + i * ROW_H;
        const cy = y + ROW_H / 2;
        const band = (row.band || []).map(normalizeBand).filter((b) => b && b.to > b.from).map((b) =>
            `<rect class="fc-band fc-band-soft" x="${x0(sx(b.from)).toFixed(1)}" y="${cy - 4}" width="${Math.max(1, sx(b.to) - sx(b.from)).toFixed(1)}" height="8" rx="2"><title>${esc(`${row.label}: ${fmtTime(b.from)}–${fmtTime(b.to)}`)}</title></rect>`).join("");
        const downtimes = (row.downtimes || []).map(normalizeBand).filter((b) => b && b.to > b.from).map((b) =>
            `<rect class="fc-band fc-high" x="${x0(sx(b.from)).toFixed(1)}" y="${cy - 4}" width="${Math.max(1, sx(b.to) - sx(b.from)).toFixed(1)}" height="8" rx="2"><title>${esc(`${row.label}: Lücke ${fmtTime(b.from)}–${fmtTime(b.to)} (${fmtTime(b.to - b.from)})`)}</title></rect>`).join("");
        const markers = (row.markers || []).filter((m) => m && Number.isFinite(m.at)).map((m) => {
            const cx = x0(sx(m.at)).toFixed(1);
            const tip = `${fmtTime(m.at)} ${m.label || row.label}`;
            const dot = m.icon
                ? `<image class="fc-marker-icon" href="${esc(iconUrl(m.icon))}" x="${(Number(cx) - 7).toFixed(1)}" y="${cy - 7}" width="14" height="14"/>`
                : `<circle class="fc-marker" cx="${cx}" cy="${cy}" r="4"/>`;
            return `<g class="fc-mark"><title>${esc(tip)}</title>${dot}<rect class="fc-hit" x="${(Number(cx) - 12).toFixed(1)}" y="${y}" width="24" height="${ROW_H}"/></g>`;
        }).join("");
        const value = row.value !== undefined && row.value !== null
            ? `<text class="fc-value${row.tone ? ` fc-${row.tone}` : ""}" x="${width - 6}" y="${cy + 4}" text-anchor="end">${esc(row.value)}</text>`
            : "";
        return `<g class="fc-row">${rowLabel(row, y)}<line class="fc-track" x1="${LABEL_W}" y1="${cy}" x2="${LABEL_W + plotW}" y2="${cy}"/>${band}${downtimes}${markers}${value}</g>`;
    }).join("");

    const deaths = deathMarkers(chart.deaths, chart.duration, LABEL_W, plotW, rowsTop, rowsBottom, chart.classColor);
    const svg = `<svg class="fchart fc-markers" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(chart.title || "Zeitleiste")}">`
        + windows + body + deaths + axisSvg(chart.duration, LABEL_W, plotW, rowsBottom + 2) + "</svg>";
    return figure(chart.title, svg, markerTable(rows));
}

function markerTable(rows) {
    const head = "<tr><th>Zeile</th><th>Anzahl</th><th>Zeitpunkte</th><th>Lücken</th></tr>";
    const body = rows.map((row) => {
        const marks = (row.markers || []).filter((m) => m && Number.isFinite(m.at));
        const times = marks.map((m) => fmtTime(m.at)).join(", ");
        const gaps = (row.downtimes || []).map(normalizeBand).filter(Boolean).map((b) => `${fmtTime(b.from)}–${fmtTime(b.to)}`).join(", ");
        return `<tr><td>${esc(row.label)}</td><td>${marks.length}</td><td>${esc(times) || "–"}</td><td>${esc(gaps) || "–"}</td></tr>`;
    }).join("");
    return `<table class="idx fc-table">${head}${body}</table>`;
}

/**
 * Horizontal bars, one per row, for a percentage or count across bosses or
 * players. Thin bars with a rounded data end, value at the tip, optional link.
 *
 * @param {object} chart
 * @param {Array<{ label, value, max?, display?, href?, tone? }>} chart.rows
 * @param {number} [chart.max]   scale maximum (default: 100 or the largest value)
 */
function barChart(chart) {
    const rows = chart.rows || [];
    if (rows.length === 0) return "<div class=\"fc-empty\">Keine Daten.</div>";
    const width = chart.width || DEFAULT_W;
    const plotW = width - LABEL_W - VALUE_W;
    const max = Math.max(1, chart.max || Math.max(100, ...rows.map((r) => Number(r.value) || 0)));
    const height = PAD_TOP * 2 + rows.length * ROW_H;
    const body = rows.map((row, i) => {
        const y = PAD_TOP + i * ROW_H;
        const v = Math.max(0, Math.min(max, Number(row.value) || 0));
        const w = (v / max) * plotW;
        const display = row.display !== undefined ? row.display : `${row.value}`;
        const label = row.href
            ? `<a href="${esc(row.href)}">${rowLabel(row, y)}</a>`
            : rowLabel(row, y);
        // rounded at the data end only: square at the baseline
        const bar = w > 0
            ? `<path class="fc-bar${row.tone ? ` fc-${row.tone}` : ""}" d="M${LABEL_W},${y + 4} h${Math.max(0, w - 4).toFixed(1)} a4,4 0 0 1 4,4 v8 a4,4 0 0 1 -4,4 h-${Math.max(0, w - 4).toFixed(1)} z"><title>${esc(`${row.label}: ${display}`)}</title></path>`
            : "";
        return `<g class="fc-row">${label}<line class="fc-track" x1="${LABEL_W}" y1="${y + ROW_H / 2}" x2="${LABEL_W + plotW}" y2="${y + ROW_H / 2}"/>${bar}<text class="fc-value" x="${(LABEL_W + w + 6).toFixed(1)}" y="${y + ROW_H / 2 + 4}">${esc(display)}</text></g>`;
    }).join("");
    const svg = `<svg class="fchart fc-bars" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(chart.title || "Balken")}">${body}</svg>`;
    const table = `<table class="idx fc-table"><tr><th>Zeile</th><th>Wert</th></tr>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.display !== undefined ? r.display : r.value)}</td></tr>`).join("")}</table>`;
    return figure(chart.title, svg, table);
}

/**
 * Line chart over the fight: up to two series (DPS and HPS, say) on one axis,
 * plus an optional boss-health line on its own 0–100 % scale drawn as a faint
 * reference — never a second numeric axis. Values are equally spaced buckets of
 * `step` ms.
 *
 * @param {object} chart
 * @param {number} chart.duration
 * @param {number} chart.step        bucket length in ms
 * @param {Array<{ label, values: number[], key?: "a"|"b" }>} chart.series
 * @param {number[]} [chart.bossHp]  0–100 per bucket
 * @param {Array} [chart.deaths]
 * @param {function} [chart.classColor]
 */
function lineChart(chart) {
    const series = (chart.series || []).filter((s) => s && Array.isArray(s.values) && s.values.length);
    if (series.length === 0) return "<div class=\"fc-empty\">Kein Verlauf für diesen Kampf.</div>";
    const width = chart.width || DEFAULT_W;
    const plotH = 120;
    // the end labels ("Raid-DPS") need more room than a percentage does
    const plotW = width - LABEL_W - VALUE_W - 30;
    const sx = scale(chart.duration, plotW);
    const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => Number(v) || 0)));
    const sy = (v) => PAD_TOP + plotH - (Math.max(0, Math.min(max, Number(v) || 0)) / max) * plotH;
    const step = Math.max(1, chart.step || 5000);
    const px = (i) => x0(sx(i * step));

    const grid = [0, 0.5, 1].map((f) => {
        const y = (PAD_TOP + plotH - f * plotH).toFixed(1);
        return `<line class="fc-grid" x1="${LABEL_W}" y1="${y}" x2="${LABEL_W + plotW}" y2="${y}"/><text class="fc-axis" x="${LABEL_W - 6}" y="${Number(y) + 4}" text-anchor="end">${fmtNumber(max * f)}</text>`;
    }).join("");

    const lines = series.map((s, i) => {
        const key = s.key || (i === 0 ? "a" : "b");
        const pts = s.values.map((v, j) => `${px(j).toFixed(1)},${sy(v).toFixed(1)}`);
        const area = `M${px(0).toFixed(1)},${(PAD_TOP + plotH).toFixed(1)} L${pts.join(" L")} L${px(s.values.length - 1).toFixed(1)},${(PAD_TOP + plotH).toFixed(1)} Z`;
        const last = s.values.length - 1;
        return `<g class="fc-series fc-series-${key}"><title>${esc(s.label)}</title><path class="fc-area" d="${area}"/><polyline class="fc-line" points="${pts.join(" ")}"/>`
            + `<circle class="fc-end" cx="${px(last).toFixed(1)}" cy="${sy(s.values[last]).toFixed(1)}" r="4"/>`
            + `<text class="fc-value" x="${(px(last) + 8).toFixed(1)}" y="${(sy(s.values[last]) + 4).toFixed(1)}">${esc(s.label)}</text></g>`;
    }).join("");

    const hp = Array.isArray(chart.bossHp) && chart.bossHp.length
        ? `<polyline class="fc-hp" points="${chart.bossHp.map((v, j) => `${px(j).toFixed(1)},${(PAD_TOP + plotH - (Math.max(0, Math.min(100, Number(v) || 0)) / 100) * plotH).toFixed(1)}`).join(" ")}"><title>Boss-Leben (%)</title></polyline>`
        : "";

    const legend = series.map((s, i) => `<span class="fc-key fc-key-${s.key || (i === 0 ? "a" : "b")}"></span>${esc(s.label)}`).join(" · ")
        + (hp ? " · <span class=\"fc-key fc-key-hp\"></span>Boss-Leben" : "");
    const deaths = deathMarkers(chart.deaths, chart.duration, LABEL_W, plotW, PAD_TOP, PAD_TOP + plotH, chart.classColor);
    const height = PAD_TOP + plotH + AXIS_H + 4;
    const svg = `<svg class="fchart fc-lines" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(chart.title || "Verlauf")}">`
        + grid + lines + hp + deaths + axisSvg(chart.duration, LABEL_W, plotW, PAD_TOP + plotH + 4) + "</svg>";
    const table = `<table class="idx fc-table"><tr><th>Zeit</th>${series.map((s) => `<th>${esc(s.label)}</th>`).join("")}${hp ? "<th>Boss-Leben</th>" : ""}</tr>`
        + series[0].values.map((_, j) => `<tr><td>${fmtTime(j * step)}</td>${series.map((s) => `<td>${fmtNumber(s.values[j])}</td>`).join("")}${hp ? `<td>${Math.round(Number(chart.bossHp[j]) || 0)}%</td>` : ""}</tr>`).join("")
        + "</table>";
    return figure(chart.title, svg, table, `<div class="fc-legend">${legend}</div>`);
}

function fmtNumber(v) {
    const n = Number(v) || 0;
    if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
    return String(Math.round(n));
}

/** Chart + collapsible table twin in one figure. */
function figure(title, svg, table, extra = "") {
    return `<figure class="fc-figure">${title ? `<figcaption class="fc-title">${esc(title)}</figcaption>` : ""}${extra}${svg}`
        + `<details class="fc-details"><summary>Als Tabelle</summary>${table}</details></figure>`;
}

/** The page CSS for every chart above; appended once to the report page's style block. */
const CHART_STYLE = `
  .fc-figure { margin:0 0 18px; }
  .fc-title { font-size:12px; font-family:var(--font-mono); text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin:0 0 6px; }
  .fc-legend { font-size:12.5px; color:var(--muted); margin:0 0 6px; }
  .fc-key { display:inline-block; width:14px; height:2px; vertical-align:middle; margin-right:5px; background:var(--accent); }
  .fc-key-b { background:var(--accent-2); }
  .fc-key-hp { background:var(--muted); }
  .fchart { display:block; max-width:100%; height:auto; font:12px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; --cc:var(--muted); }
  .fchart text { fill:var(--text); }
  .fchart .fc-label { font-size:12.5px; }
  .fchart .fc-axis { fill:var(--muted); font-size:11px; font-variant-numeric:tabular-nums; }
  .fchart .fc-value { fill:var(--muted); font-size:11.5px; font-variant-numeric:tabular-nums; font-family:var(--font-mono); }
  .fchart .fc-value.fc-good { fill:var(--good); }
  .fchart .fc-value.fc-medium { fill:var(--medium); }
  .fchart .fc-value.fc-high { fill:var(--high); }
  .fchart .fc-track { stroke:var(--line-soft); stroke-width:1; }
  .fchart .fc-tick, .fchart .fc-axisline, .fchart .fc-grid { stroke:var(--line); stroke-width:1; }
  .fchart .fc-band { fill:var(--accent); }
  .fchart .fc-band.fc-good { fill:var(--good); }
  .fchart .fc-band.fc-medium { fill:var(--medium); }
  .fchart .fc-band.fc-high { fill:var(--high); }
  .fchart .fc-band-soft { fill:var(--accent); fill-opacity:.45; }
  .fchart .fc-bar { fill:var(--accent); }
  .fchart .fc-bar.fc-good { fill:var(--good); }
  .fchart .fc-bar.fc-medium { fill:var(--medium); }
  .fchart .fc-bar.fc-high { fill:var(--high); }
  .fchart .fc-window { fill:var(--accent-2); fill-opacity:.12; }
  .fchart .fc-marker { fill:var(--accent); stroke:var(--panel); stroke-width:2; }
  .fchart .fc-mark:hover .fc-marker { fill:var(--accent-2); }
  .fchart .fc-hit { fill:transparent; }
  .fchart .fc-death line { stroke:var(--cc); stroke-width:2; }
  .fchart .fc-death:hover line { stroke-width:3; }
  .fchart .fc-line { fill:none; stroke:var(--accent); stroke-width:2; stroke-linejoin:round; stroke-linecap:round; }
  .fchart .fc-area { fill:var(--accent); fill-opacity:.1; }
  .fchart .fc-end { fill:var(--accent); stroke:var(--panel); stroke-width:2; }
  .fchart .fc-series-b .fc-line, .fchart .fc-series-b .fc-key { stroke:var(--accent-2); }
  .fchart .fc-series-b .fc-area, .fchart .fc-series-b .fc-end { fill:var(--accent-2); }
  .fchart .fc-hp { fill:none; stroke:var(--muted); stroke-width:1; }
  .fc-details { margin-top:4px; font-size:12.5px; }
  .fc-details summary { color:var(--muted); cursor:pointer; }
  .fc-table { width:100%; border-collapse:collapse; margin-top:6px; font-variant-numeric:tabular-nums; }
  .fc-table th, .fc-table td { text-align:left; padding:5px 10px; border-bottom:1px solid var(--line-soft); }
  .fc-empty { color:var(--muted); padding:10px 0; }
  /* light theme: WoW's class palette is made for a dark ground — darken it for the markers */
  @media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) .fchart .fc-death line { stroke:color-mix(in srgb, var(--cc) 70%, #000); } }
  :root[data-theme="light"] .fchart .fc-death line { stroke:color-mix(in srgb, var(--cc) 70%, #000); }
`;

module.exports = {
    ribbonChart,
    markerChart,
    barChart,
    lineChart,
    fmtTime,
    axisTicks,
    bandStats,
    CHART_STYLE,
};
