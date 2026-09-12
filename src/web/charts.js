// Inline-SVG charts for the report page's fight timelines.
//
// Pure string builders, no DOM and no library: the report page is server
// rendered, public and must work without a JS bundle. Every chart is drawn on
// the page's own theme tokens (var(--accent) and friends), so light and dark
// come for free, and every chart carries a table twin so nothing is readable
// by colour alone.
//
// A timeline chart is three columns: an HTML column of icons on the left (the
// row's label lives in its tooltip), the SVG plot in a horizontally scrolling
// box in the middle, and an HTML column of headline values on the right. The
// plot has a fixed scale (px per second), so a long fight scrolls instead of
// being squeezed, while the icons and values stay put.
//
// Shapes the builders consume are the `timeline` field of a report (see
// utils/logcheck/fightTimeline.js): times in ms relative to the fight start,
// bands as `[from, to]` pairs or `{ from, to, stacks }` objects.

const ROW_H = 52;        // one timeline row
const BAND_H = 24;       // the band inside a row
const AXIS_H = 28;       // the time axis under the rows
const PAD_TOP = 4;
const PAD_RIGHT = 28;    // room for the last axis label
const PX_PER_SEC = 6;    // the fixed time scale
const MIN_PLOT_W = 700;  // a short fight still fills a reasonable width
const LINE_H = 180;      // the DPS/HPS plot height
const BAR_ROW_H = 28;
const BAR_LABEL_W = 170;
const BAR_VALUE_W = 60;

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

/** A tick every clean step so a fight of any length gets 4–8 labelled ticks per screen. */
function axisTicks(duration) {
    const steps = [5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000];
    const total = Math.max(1, duration || 0);
    let step = steps[steps.length - 1];
    for (const s of steps) {
        if (total / s <= 8) { step = s; break; }
    }
    // on the fixed scale a long fight is wide, so ticks may sit closer in time
    while (step > 5000 && (step / 1000) * PX_PER_SEC > 140) step = steps[steps.indexOf(step) - 1];
    const ticks = [];
    for (let t = 0; t <= total; t += step) ticks.push(t);
    return ticks;
}

/** Plot width on the fixed scale. */
function plotWidth(duration, pxPerSec = PX_PER_SEC) {
    return Math.max(MIN_PLOT_W, Math.round((Math.max(0, duration || 0) / 1000) * pxPerSec));
}

function scale(duration, plotW) {
    const total = Math.max(1, duration || 0);
    return (t) => (Math.max(0, Math.min(total, t)) / total) * plotW;
}

function axisSvg(duration, plotW, y) {
    const sx = scale(duration, plotW);
    const ticks = axisTicks(duration).map((t) => {
        const x = sx(t).toFixed(1);
        return `<line class="fc-tick" x1="${x}" y1="${y}" x2="${x}" y2="${y + 5}"/>`
            + `<text class="fc-axis" x="${x}" y="${y + 20}" text-anchor="${t === 0 ? "start" : "middle"}">${fmtTime(t)}</text>`;
    }).join("");
    return `<line class="fc-axisline" x1="0" y1="${y}" x2="${plotW}" y2="${y}"/>${ticks}`;
}

/** Vertical hairlines for every death, in the class colour, with the reason in the title. */
function deathMarkers(deaths, duration, plotW, y0, y1, classColor) {
    const sx = scale(duration, plotW);
    return (deaths || []).map((d) => {
        const x = sx(d.at).toFixed(1);
        const color = (classColor && classColor(d.type)) || "";
        const style = color ? ` style="--cc:${esc(color)}"` : "";
        const why = d.ability ? ` data-tip-sub="${esc(`† ${d.ability}`)}"` : "";
        return `<g class="fc-death"${style} data-tip="${esc(`${fmtTime(d.at)} ${d.name}`)}"${why}>`
            + `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}"/>`
            + `<rect x="${(Number(x) - 6).toFixed(1)}" y="${y0}" width="12" height="${y1 - y0}" class="fc-hit"/></g>`;
    }).join("");
}

function normalizeBand(b) {
    if (Array.isArray(b)) return { from: b[0], to: b[1], stacks: 0 };
    if (b && typeof b === "object") return { from: b.from, to: b.to, stacks: b.stacks || 0 };
    return null;
}

function iconUrl(icon) {
    const name = String(icon || "inv_misc_questionmark").replace(/\.(jpg|jpeg|png|gif)$/i, "").toLowerCase();
    return `https://wow.zamimg.com/images/wow/icons/medium/${name}.jpg`;
}

/** The icon column: one cell per row, the label as tooltip; initials when a row has no icon. */
function iconColumn(rows) {
    const cells = rows.map((row) => {
        const inner = row.icon
            ? `<img src="${esc(iconUrl(row.icon))}" alt="">`
            : `<span class="fc-initial">${esc(String(row.label || "?").slice(0, 2))}</span>`;
        return `<div class="fc-cell" data-tip="${esc(row.label)}">${inner}</div>`;
    }).join("");
    return `<div class="fc-col fc-icons" style="padding-top:${PAD_TOP}px">${cells}</div>`;
}

/** The value column: the headline number, toned, with one short line under it. */
function valueColumn(rows) {
    const cells = rows.map((row) => {
        const value = row.value !== undefined && row.value !== null ? `<b class="${row.tone ? `fc-${row.tone}` : ""}">${esc(row.value)}</b>` : "";
        const sub = row.sub ? `<span>${esc(row.sub)}</span>` : "";
        return `<div class="fc-cell" data-tip="${esc(row.label)}"${row.sub ? ` data-tip-sub="${esc(row.sub)}"` : ""}>${value}${sub}</div>`;
    }).join("");
    return `<div class="fc-col fc-values" style="padding-top:${PAD_TOP}px">${cells}</div>`;
}

/** Chart + collapsible table twin in one figure. */
function figure(title, columns, table, extra = "") {
    return `<figure class="fc-figure">${title ? `<figcaption class="fc-title">${esc(title)}</figcaption>` : ""}${extra}<div class="fc-grid">${columns}</div>`
        + `<details class="fc-details"><summary>Als Tabelle</summary>${table}</details></figure>`;
}

/**
 * Ribbon timeline: one row per aura/debuff/activity, filled bands on the fight's
 * time axis, gaps as surface. Stacked bands are drawn in one hue, stepped by
 * height (light → dark), so 5/5 Sunder reads darker than 1/5. Deaths are
 * hairlines across every row.
 *
 * @param {object} chart
 * @param {number} chart.duration  fight length in ms
 * @param {Array<{ label, icon?, bands, maxStacks?, value?, sub?, tone? }>} chart.rows
 *   `bands` are `[from,to]` pairs or `{from,to,stacks}`; `value` is the row's
 *   headline (e.g. "87%") shown at the right with `sub` under it; `tone`
 *   colours it good/medium/high.
 * @param {Array} [chart.deaths]   `{ at, name, type, ability }`
 * @param {function} [chart.classColor]  class name → hex, for the death markers
 * @param {number} [chart.pxPerSec]
 * @param {string} [chart.title]   caption above the chart
 */
function ribbonChart(chart) {
    const rows = chart.rows || [];
    if (rows.length === 0) return "<div class=\"fc-empty\">Keine Daten für diesen Kampf.</div>";
    const plotW = plotWidth(chart.duration, chart.pxPerSec);
    const sx = scale(chart.duration, plotW);
    const rowsBottom = PAD_TOP + rows.length * ROW_H;
    const height = rowsBottom + AXIS_H;

    const body = rows.map((row, i) => {
        const y = PAD_TOP + i * ROW_H;
        const by = y + (ROW_H - BAND_H) / 2;
        const max = row.maxStacks || 0;
        const bands = (row.bands || []).map(normalizeBand).filter((b) => b && b.to > b.from).map((b) => {
            const x = sx(b.from);
            const w = Math.max(1, sx(b.to) - sx(b.from));
            const level = max > 0 && b.stacks > 0 ? Math.max(0.3, Math.min(1, b.stacks / max)) : 1;
            const tip = max > 0
                ? `${fmtTime(b.from)}–${fmtTime(b.to)} · ${b.stacks}/${max} Stacks`
                : `${fmtTime(b.from)}–${fmtTime(b.to)}`;
            return `<rect class="fc-band${row.tone ? ` fc-${row.tone}` : ""}" x="${x.toFixed(1)}" y="${by}" width="${w.toFixed(1)}" height="${BAND_H}" rx="3" fill-opacity="${level.toFixed(2)}" data-tip="${esc(row.label)}" data-tip-sub="${esc(tip)}"/>`;
        }).join("");
        return `<g class="fc-row"><line class="fc-track" x1="0" y1="${y + ROW_H / 2}" x2="${plotW}" y2="${y + ROW_H / 2}"/>${bands}</g>`;
    }).join("");

    const deaths = deathMarkers(chart.deaths, chart.duration, plotW, PAD_TOP, rowsBottom, chart.classColor);
    const svg = `<div class="fc-scroll"><svg class="fchart fc-ribbon" width="${plotW + PAD_RIGHT}" height="${height}" viewBox="0 0 ${plotW + PAD_RIGHT} ${height}" role="img" aria-label="${esc(chart.title || "Zeitleiste")}">`
        + body + deaths + axisSvg(chart.duration, plotW, rowsBottom + 2) + "</svg></div>";
    return figure(chart.title, iconColumn(rows) + svg + valueColumn(rows), ribbonTable(rows, chart));
}

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
 * Marker timeline: one row per player or ability with a mark per cast, an
 * optional band underneath (the buff the casts keep up) and downtime stretches
 * highlighted. Used for totems, cooldowns and potions.
 *
 * @param {object} chart
 * @param {number} chart.duration
 * @param {Array<{ label, icon?, markers: Array<{ at, label?, icon? }>, band?, downtimes?, value?, sub?, tone? }>} chart.rows
 * @param {Array<{ label, from, to }>} [chart.windows]  shaded spans behind every row (a Bloodlust window)
 * @param {Array} [chart.deaths]
 * @param {function} [chart.classColor]
 */
function markerChart(chart) {
    const rows = chart.rows || [];
    if (rows.length === 0) return "<div class=\"fc-empty\">Keine Daten für diesen Kampf.</div>";
    const plotW = plotWidth(chart.duration, chart.pxPerSec);
    const sx = scale(chart.duration, plotW);
    const rowsBottom = PAD_TOP + rows.length * ROW_H;
    const height = rowsBottom + AXIS_H;
    const mark = 28;

    const windows = (chart.windows || []).map((w) => {
        const x = sx(w.from);
        const wd = Math.max(1, sx(w.to) - sx(w.from));
        return `<rect class="fc-window" x="${x.toFixed(1)}" y="${PAD_TOP}" width="${wd.toFixed(1)}" height="${rowsBottom - PAD_TOP}" data-tip="${esc(w.label)}" data-tip-sub="${esc(`${fmtTime(w.from)}–${fmtTime(w.to)}`)}"/>`;
    }).join("");

    const body = rows.map((row, i) => {
        const y = PAD_TOP + i * ROW_H;
        const cy = y + ROW_H / 2;
        const band = (row.band || []).map(normalizeBand).filter((b) => b && b.to > b.from).map((b) =>
            `<rect class="fc-band fc-band-soft" x="${sx(b.from).toFixed(1)}" y="${cy - 6}" width="${Math.max(1, sx(b.to) - sx(b.from)).toFixed(1)}" height="12" rx="3" data-tip="${esc(row.label)}" data-tip-sub="${esc(`${fmtTime(b.from)}–${fmtTime(b.to)}`)}"/>`).join("");
        const downtimes = (row.downtimes || []).map(normalizeBand).filter((b) => b && b.to > b.from).map((b) =>
            `<rect class="fc-band fc-high" x="${sx(b.from).toFixed(1)}" y="${cy - 6}" width="${Math.max(1, sx(b.to) - sx(b.from)).toFixed(1)}" height="12" rx="3" data-tip="${esc(row.label)}" data-tip-sub="${esc(`Lücke ${fmtTime(b.from)}–${fmtTime(b.to)} (${fmtTime(b.to - b.from)})`)}"/>`).join("");
        const markers = (row.markers || []).filter((m) => m && Number.isFinite(m.at)).map((m) => {
            const cx = sx(m.at);
            const tip = `${fmtTime(m.at)} ${m.label || row.label}`;
            const dot = m.icon
                ? `<image class="fc-marker-icon" href="${esc(iconUrl(m.icon))}" x="${(cx - mark / 2).toFixed(1)}" y="${cy - mark / 2}" width="${mark}" height="${mark}"/>`
                : `<circle class="fc-marker" cx="${cx.toFixed(1)}" cy="${cy}" r="6"/>`;
            return `<g class="fc-mark" data-tip="${esc(tip)}">${dot}<rect class="fc-hit" x="${(cx - 16).toFixed(1)}" y="${y}" width="32" height="${ROW_H}"/></g>`;
        }).join("");
        return `<g class="fc-row"><line class="fc-track" x1="0" y1="${cy}" x2="${plotW}" y2="${cy}"/>${band}${downtimes}${markers}</g>`;
    }).join("");

    const deaths = deathMarkers(chart.deaths, chart.duration, plotW, PAD_TOP, rowsBottom, chart.classColor);
    const svg = `<div class="fc-scroll"><svg class="fchart fc-markers" width="${plotW + PAD_RIGHT}" height="${height}" viewBox="0 0 ${plotW + PAD_RIGHT} ${height}" role="img" aria-label="${esc(chart.title || "Zeitleiste")}">`
        + windows + body + deaths + axisSvg(chart.duration, plotW, rowsBottom + 2) + "</svg></div>";
    return figure(chart.title, iconColumn(rows) + svg + valueColumn(rows), markerTable(rows));
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
 * Not a timeline: it keeps its labels and fits the container.
 *
 * @param {object} chart
 * @param {Array<{ label, value, max?, display?, href?, tone? }>} chart.rows
 * @param {number} [chart.max]   scale maximum (default: 100 or the largest value)
 */
function barChart(chart) {
    const rows = chart.rows || [];
    if (rows.length === 0) return "<div class=\"fc-empty\">Keine Daten.</div>";
    const width = chart.width || 900;
    const plotW = width - BAR_LABEL_W - BAR_VALUE_W;
    const max = Math.max(1, chart.max || Math.max(100, ...rows.map((r) => Number(r.value) || 0)));
    const height = PAD_TOP * 2 + rows.length * BAR_ROW_H;
    const body = rows.map((row, i) => {
        const y = PAD_TOP + i * BAR_ROW_H;
        const v = Math.max(0, Math.min(max, Number(row.value) || 0));
        const w = (v / max) * plotW;
        const display = row.display !== undefined ? row.display : `${row.value}`;
        const text = `<text class="fc-label" x="6" y="${y + BAR_ROW_H / 2 + 4}" data-tip="${esc(row.label)}">${esc(row.label)}</text>`;
        const label = row.href ? `<a href="${esc(row.href)}">${text}</a>` : text;
        // rounded at the data end only: square at the baseline
        const bar = w > 0
            ? `<path class="fc-bar${row.tone ? ` fc-${row.tone}` : ""}" d="M${BAR_LABEL_W},${y + 6} h${Math.max(0, w - 4).toFixed(1)} a4,4 0 0 1 4,4 v8 a4,4 0 0 1 -4,4 h-${Math.max(0, w - 4).toFixed(1)} z" data-tip="${esc(row.label)}" data-tip-sub="${esc(display)}"/>`
            : "";
        return `<g class="fc-row">${label}<line class="fc-track" x1="${BAR_LABEL_W}" y1="${y + BAR_ROW_H / 2}" x2="${BAR_LABEL_W + plotW}" y2="${y + BAR_ROW_H / 2}"/>${bar}<text class="fc-value" x="${(BAR_LABEL_W + w + 6).toFixed(1)}" y="${y + BAR_ROW_H / 2 + 4}">${esc(display)}</text></g>`;
    }).join("");
    const svg = `<svg class="fchart fc-bars" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(chart.title || "Balken")}">${body}</svg>`;
    const table = `<table class="idx fc-table"><tr><th>Zeile</th><th>Wert</th></tr>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.display !== undefined ? r.display : r.value)}</td></tr>`).join("")}</table>`;
    return `<figure class="fc-figure">${chart.title ? `<figcaption class="fc-title">${esc(chart.title)}</figcaption>` : ""}${svg}<details class="fc-details"><summary>Als Tabelle</summary>${table}</details></figure>`;
}

/**
 * Line chart over the fight: up to two series (DPS and HPS, say) on one axis,
 * plus an optional boss-health line on its own 0–100 % scale drawn as a faint
 * reference — never a second numeric axis. Values are equally spaced buckets of
 * `step` ms. Same three-column frame as the ribbons, so it lines up above them.
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
    const plotH = chart.height || LINE_H;
    const plotW = plotWidth(chart.duration, chart.pxPerSec);
    const sx = scale(chart.duration, plotW);
    // a fixed maximum (100 for a percentage) keeps two charts comparable; otherwise the data sets it
    const max = chart.max > 0 ? chart.max : Math.max(1, ...series.flatMap((s) => s.values.map((v) => Number(v) || 0)));
    const sy = (v) => PAD_TOP + plotH - (Math.max(0, Math.min(max, Number(v) || 0)) / max) * plotH;
    const step = Math.max(1, chart.step || 5000);
    const px = (i) => sx(i * step);

    const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
        const y = (PAD_TOP + plotH - f * plotH).toFixed(1);
        return `<line class="fc-grid" x1="0" y1="${y}" x2="${plotW}" y2="${y}"/>`;
    }).join("");
    const ticks = [0, 0.5, 1].map((f) => {
        const y = Math.round(PAD_TOP + plotH - f * plotH);
        return `<span class="fc-ytick" style="top:${y}px">${fmtNumber(max * f)}${esc(chart.unit || "")}</span>`;
    }).join("");

    const lines = series.map((s, i) => {
        const key = s.key || (i === 0 ? "a" : "b");
        const pts = s.values.map((v, j) => `${px(j).toFixed(1)},${sy(v).toFixed(1)}`);
        const area = `M${px(0).toFixed(1)},${(PAD_TOP + plotH).toFixed(1)} L${pts.join(" L")} L${px(s.values.length - 1).toFixed(1)},${(PAD_TOP + plotH).toFixed(1)} Z`;
        const last = s.values.length - 1;
        return `<g class="fc-series fc-series-${key}" data-tip="${esc(s.label)}"><path class="fc-area" d="${area}"/><polyline class="fc-line" points="${pts.join(" ")}"/>`
            + `<circle class="fc-end" cx="${px(last).toFixed(1)}" cy="${sy(s.values[last]).toFixed(1)}" r="5"/></g>`;
    }).join("");

    const hp = Array.isArray(chart.bossHp) && chart.bossHp.length
        ? `<polyline class="fc-hp" points="${chart.bossHp.map((v, j) => `${px(j).toFixed(1)},${(PAD_TOP + plotH - (Math.max(0, Math.min(100, Number(v) || 0)) / 100) * plotH).toFixed(1)}`).join(" ")}" data-tip="Boss-Leben (%)"/>`
        : "";

    // markers sit on the first series at their time: a potion on the mana curve
    const valueAt = (at) => {
        const s = series[0];
        const i = Math.min(s.values.length - 1, Math.max(0, Math.floor(at / step)));
        return s.values[i];
    };
    const markers = (chart.markers || []).filter((m) => m && Number.isFinite(m.at));
    const marks = markers.map((m) => {
        const x = sx(m.at);
        const y = sy(valueAt(m.at));
        const tip = `${fmtTime(m.at)} · ${m.label || ""}${m.value !== undefined && m.value !== null ? ` · ${m.value}` : ""}`;
        const icon = m.icon ? `<image href="${esc(iconUrl(m.icon))}" x="${(x - 10).toFixed(1)}" y="${(y - 32).toFixed(1)}" width="20" height="20"/>` : "";
        return `<g class="fc-mark" data-tip="${esc(tip)}"><circle class="fc-marker fc-mark-pt" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6"/>${icon}</g>`;
    }).join("");

    const legend = series.map((s, i) => `<span class="fc-key fc-key-${s.key || (i === 0 ? "a" : "b")}"></span>${esc(s.label)}`).join(" · ")
        + (hp ? " · <span class=\"fc-key fc-key-hp\"></span>Boss-Leben" : "")
        + (markers.length ? ` · <span class="fc-key fc-key-mark"></span>${esc(chart.markersLabel || "Markierungen")} (${markers.length})` : "");
    const deaths = deathMarkers(chart.deaths, chart.duration, plotW, PAD_TOP, PAD_TOP + plotH, chart.classColor);
    const height = PAD_TOP + plotH + AXIS_H + 4;
    const svg = `<div class="fc-scroll"><svg class="fchart fc-lines" width="${plotW + PAD_RIGHT}" height="${height}" viewBox="0 0 ${plotW + PAD_RIGHT} ${height}" role="img" aria-label="${esc(chart.title || "Verlauf")}">`
        + grid + lines + hp + marks + deaths + axisSvg(chart.duration, plotW, PAD_TOP + plotH + 4) + "</svg></div>";
    const left = `<div class="fc-col fc-yaxis" style="height:${PAD_TOP + plotH}px">${ticks}</div>`;
    const right = "<div class=\"fc-col fc-values\"></div>";
    const table = `<table class="idx fc-table"><tr><th>Zeit</th>${series.map((s) => `<th>${esc(s.label)}</th>`).join("")}${hp ? "<th>Boss-Leben</th>" : ""}</tr>`
        + series[0].values.map((_, j) => `<tr><td>${fmtTime(j * step)}</td>${series.map((s) => `<td>${fmtNumber(s.values[j])}${esc(chart.unit || "")}</td>`).join("")}${hp ? `<td>${Math.round(Number(chart.bossHp[j]) || 0)}%</td>` : ""}</tr>`).join("")
        + "</table>"
        + (markers.length ? `<ul class="fc-marks">${markers.map((m) => `<li><b>${fmtTime(m.at)}</b> ${esc(m.label || "")}${m.value !== undefined && m.value !== null ? ` · ${esc(m.value)}` : ""}</li>`).join("")}</ul>` : "");
    return figure(chart.title, left + svg + right, table, `<div class="fc-legend">${legend}</div>`);
}

function fmtNumber(v) {
    const n = Number(v) || 0;
    if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
    return String(Math.round(n));
}

/** The page CSS for every chart above; appended once to the report page's style block. */
const CHART_STYLE = `
  .fc-figure { margin:0; }
  .fc-title { font-size:13px; font-family:var(--font-mono); text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin:0 0 8px; }
  .fc-legend { font-size:13px; color:var(--muted); margin:0 0 6px; }
  .fc-key { display:inline-block; width:16px; height:2px; vertical-align:middle; margin-right:6px; background:var(--accent); }
  .fc-key-b { background:var(--accent-2); }
  .fc-key-hp { background:var(--muted); }
  .fc-key-mark { background:var(--accent-2); height:8px; width:8px; border-radius:50%; }
  .fc-marks { margin:6px 0 0; padding:0 0 0 18px; font-size:13px; color:var(--muted); }
  .fc-marks b { font-family:var(--font-mono); color:var(--text); }
  .fc-grid { display:flex; align-items:flex-start; }
  .fc-col { flex:0 0 auto; display:flex; flex-direction:column; box-sizing:border-box; }
  .fc-icons { width:72px; align-items:center; }
  .fc-values { width:100px; align-items:flex-end; padding-right:14px; }
  .fc-cell { height:${ROW_H}px; display:flex; flex-direction:column; align-items:center; justify-content:center; }
  .fc-values .fc-cell { align-items:flex-end; }
  .fc-icons img { width:36px; height:36px; border-radius:6px; border:1px solid var(--line); background:var(--panel2); display:block; }
  .fc-initial { width:36px; height:36px; border-radius:6px; border:1px solid var(--line); background:var(--panel2); display:grid; place-items:center; font-size:13px; font-weight:700; color:var(--muted); }
  .fc-values b { font-size:17px; font-family:var(--font-mono); font-variant-numeric:tabular-nums; color:var(--text); line-height:1.1; }
  .fc-values b.fc-good { color:var(--good); }
  .fc-values b.fc-medium { color:var(--medium); }
  .fc-values b.fc-high { color:var(--high); }
  .fc-values span { font-size:11.5px; color:var(--muted); white-space:nowrap; }
  .fc-yaxis { width:72px; position:relative; }
  .fc-ytick { position:absolute; right:10px; transform:translateY(-50%); font-size:12px; font-family:var(--font-mono); color:var(--muted); }
  .fc-scroll { flex:1 1 auto; min-width:0; overflow-x:auto; overflow-y:hidden; scrollbar-gutter:stable; }
  .fchart { display:block; font:12px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; --cc:var(--muted); }
  .fchart text { fill:var(--text); }
  .fchart .fc-label { font-size:13px; }
  .fchart .fc-axis { fill:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; }
  .fchart .fc-value { fill:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; font-family:var(--font-mono); }
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
  .fchart .fc-mark-pt { fill:var(--accent-2); }
  .fchart .fc-hit { fill:transparent; }
  .fchart .fc-death line { stroke:var(--cc); stroke-width:2; }
  .fchart .fc-death:hover line { stroke-width:3; }
  .fchart .fc-line { fill:none; stroke:var(--accent); stroke-width:2; stroke-linejoin:round; stroke-linecap:round; }
  .fchart .fc-area { fill:var(--accent); fill-opacity:.1; }
  .fchart .fc-end { fill:var(--accent); stroke:var(--panel); stroke-width:2; }
  .fchart .fc-series-b .fc-line { stroke:var(--accent-2); }
  .fchart .fc-series-b .fc-area, .fchart .fc-series-b .fc-end { fill:var(--accent-2); }
  .fchart .fc-hp { fill:none; stroke:var(--muted); stroke-width:1; }
  .fc-details { margin-top:6px; font-size:13px; }
  .fc-details summary { color:var(--muted); cursor:pointer; }
  .fc-table { width:100%; border-collapse:collapse; margin-top:6px; font-variant-numeric:tabular-nums; }
  .fc-table th, .fc-table td { text-align:left; padding:5px 10px; border-bottom:1px solid var(--line-soft); }
  .fc-empty { color:var(--muted); padding:12px 0; font-size:14px; }
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
    plotWidth,
    bandStats,
    CHART_STYLE,
    PX_PER_SEC,
};
