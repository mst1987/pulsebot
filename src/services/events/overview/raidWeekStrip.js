// The week strip of the raid overview as a drawn picture (design "D · Raid-Übersicht
// mit Wochenleiste als Bild", Oct 2026, a test behind `config.discordVisuals.overviewWeekStrip`).
// Pure: an ID group of raidOverviewPanel.js in, an SVG string and its alt text out;
// services/discord/discordImage.js renders it.
//
//   NEXT ID   Wed 14.10. – Tue 20.10.
//   [WED 14] [THU 15] [FRI 16] [SAT 17] [SUN 18] [MON 19] [TUE 20]
//
// A day with a raid gets a border in the colour of its fill (green, orange when full, grey
// under a third - the same rule as the fill bar of the text), the start time of its first
// raid, a tag per raid ("HYJAL", "KARA", "HYJAL + BT"; two raids a day stacked, a third
// and more as "+n") and a thin fill bar. In the running ID the days already over are
// dimmed and today is marked purple. Weekday names in the language of the category.
const { DateTime } = require("luxon");
const { TIMEZONE } = require("../../../config/timezone");
const { DAY_MS, RESET_HOUR, raidIdRange } = require("../../../utils/time/raidId");
const { dateLocale } = require("../../../utils/i18n/botText");
const { serverDateTime } = require("../../../utils/time");
const { content } = require("../../../config/data/raidContent");
const { raidContentIds } = require("./raidListing");
const { PALETTE, text, rect, svgDocument } = require("../../../utils/image/svg");
const { textWidth, fitSize } = require("../../../utils/image/fontMetrics");

const WIDTH = 1050;
const PAD = 24;
const GAP = 10;
const TILE_TOP = 72;
const TILE_H = 196;
const HEIGHT = TILE_TOP + TILE_H + PAD;
const TILE_W = (WIDTH - 2 * PAD - 6 * GAP) / 7;
/** Below this share of the places a raid's colour is grey (raidOverviewPanel's BAR_LOW). */
const LOW_SHARE = 1 / 3;
/** Alt text of a media gallery item: Discord allows 1024 characters. */
const ALT_MAX = 1024;

/** The tile (0 = Wednesday … 6 = Tuesday) an epoch-ms time falls on within the ID `id`; a time before the reset hour counts to the day before. */
function dayIndex(ms, id) {
    const local = DateTime.fromMillis(Number(ms) - RESET_HOUR * 3600000, { zone: TIMEZONE });
    const day = Date.UTC(local.year, local.month - 1, local.day);
    return Math.round((day - id) / DAY_MS);
}

/** "HYJAL", "HYJAL + BT", else the title in capitals. */
function raidTag(event) {
    const ids = raidContentIds({ title: event.title, instanceIds: event.instanceIds, versionId: event.versionId }).contentIds;
    const shorts = ids.map((id) => (content(id) || {}).short).filter(Boolean);
    const tag = shorts.length ? shorts.join(" + ") : String(event.title || "Raid").replace(/\s+/g, " ").trim();
    return tag.toLocaleUpperCase("de-DE");
}

/** How full a raid is: share of its places (null without a size) and its colour. */
function fillState(event, counts) {
    const size = Number(event.size) || 0;
    if (!size) return { share: null, color: PALETTE.grey, size: 0 };
    const share = Math.min(1, Math.max(0, counts / size));
    const color = share >= 1 ? PALETTE.orange : share < LOW_SHARE ? PALETTE.grey : PALETTE.green;
    return { share, color, size };
}

/** "MI" / "WED": the short weekday in capitals, without the German abbreviation dot. */
function weekdayShort(dt, lang) {
    return dt.setLocale(dateLocale(lang)).toFormat("ccc").replace(/\./g, "").toLocaleUpperCase("de-DE");
}

/** One raid's tag chip and fill bar inside a tile. */
function raidRows(raids, x, top, width) {
    const n = Math.min(raids.length, 2);
    const slot = 76 / n;
    const big = n === 1;
    const chipH = big ? 36 : 26;
    const out = [];
    for (let k = 0; k < n; k++) {
        const r = raids[k];
        const y = top + k * slot;
        const more = k === 1 && raids.length > 2;
        const label = more ? `+${raids.length - 1}` : r.tag;
        const color = more ? PALETTE.muted : r.state.color;
        // a long tag ("MAGTHERIDON", "HYJAL + BT") gets smaller before it is cut
        const size = fitSize(label, width - 12, big ? 19 : 15, big ? 13 : 11, { bold: true });
        out.push(rect(x, y, width, chipH, { r: 7, fill: color, opacity: 0.18 }));
        out.push(text(x + width / 2, y + chipH / 2 + size * 0.36, label, { size, bold: true, fill: color, anchor: "middle", maxWidth: width - 12 }));
        if (more) continue;
        const barY = y + chipH + (big ? 10 : 5);
        const barH = big ? 10 : 6;
        out.push(rect(x, barY, width, barH, { r: barH / 2, fill: PALETTE.line }));
        if (r.state.share !== null && r.counts > 0) {
            out.push(rect(x, barY, Math.max(barH, width * r.state.share), barH, { r: barH / 2, fill: r.state.color }));
        }
    }
    return out.join("");
}

/**
 * The picture of one raid ID.
 * @param {object} o
 * @param {number} o.id the ID (its Wednesday as UTC midnight, utils/time/raidId.js)
 * @param {object[]} o.events the raids of the ID that are listed (any order)
 * @param {string} o.title "NEXT ID" / "THIS ID" / "ID" in the language (any case; drawn in capitals)
 * @param {string} o.range "Wed 14.10. – Tue 20.10."
 * @param {number} [o.now] ms
 * @param {string} [o.lang]
 * @param {(event: object) => number} o.attending how many accounts are coming
 * @returns {{ svg: string, alt: string, width: number, height: number }}
 */
function raidWeekStripSvg({ id, events = [], title = "", range = "", now = Date.now(), lang = "de", attending = () => 0 }) {
    const { from } = raidIdRange(id);
    const today = dayIndex(now, id);
    const byDay = Array.from({ length: 7 }, () => []);
    const sorted = [...events].sort((a, b) => Number(a.startTime) - Number(b.startTime));
    for (const e of sorted) {
        const i = dayIndex(Number(e.startTime) * 1000, id);
        if (i < 0 || i > 6) continue;
        const counts = Number(attending(e)) || 0;
        byDay[i].push({ event: e, counts, tag: raidTag(e), state: fillState(e, counts) });
    }

    const parts = [];
    const heading = String(title || "").toLocaleUpperCase("de-DE");
    parts.push(text(PAD, 46, heading, { size: 24, bold: true, fill: PALETTE.purple, letterSpacing: 2 }));
    const headW = textWidth(heading, 24, { bold: true, letterSpacing: 2 });
    parts.push(text(PAD + headW + 16, 46, range, { size: 24, fill: PALETTE.muted, maxWidth: WIDTH - 2 * PAD - headW - 16 }));

    const alt = [`${title} · ${range}`];
    for (let i = 0; i < 7; i++) {
        const x = PAD + i * (TILE_W + GAP);
        const dt = DateTime.fromMillis(from + i * DAY_MS, { zone: "utc" });
        const raids = byDay[i];
        const past = today > i && today <= 6;
        const isToday = today === i;
        const tile = [];
        const border = raids.length ? raids[0].state.color : "";
        tile.push(rect(x, TILE_TOP, TILE_W, TILE_H, { r: 14, fill: PALETTE.panel }));
        if (border) tile.push(rect(x, TILE_TOP, TILE_W, TILE_H, { r: 14, stroke: border, strokeWidth: 3 }));
        if (isToday) tile.push(rect(x + 14, TILE_TOP, TILE_W - 28, 5, { r: 2.5, fill: PALETTE.purple }));
        tile.push(text(x + 16, TILE_TOP + 36, weekdayShort(dt, lang), { size: 19, bold: true, fill: isToday ? PALETTE.purple : PALETTE.muted, letterSpacing: 1 }));
        if (raids.length) {
            const start = serverDateTime(Number(raids[0].event.startTime));
            if (start) tile.push(text(x + TILE_W - 14, TILE_TOP + 36, start.toFormat("HH:mm"), { size: 17, fill: PALETTE.text, anchor: "end" }));
        }
        tile.push(text(x + 16, TILE_TOP + 92, dt.toFormat("d"), { size: 48, bold: true, fill: raids.length ? PALETTE.text : PALETTE.muted }));
        if (raids.length) tile.push(raidRows(raids, x + 12, TILE_TOP + 108, TILE_W - 24));
        parts.push(past ? `<g opacity="0.4">${tile.join("")}</g>` : tile.join(""));
        for (const r of raids) {
            const fill = r.state.size ? `${r.counts}/${r.state.size}` : String(r.counts);
            alt.push(`${dt.setLocale(dateLocale(lang)).toFormat("ccc dd.LL.")} ${r.tag} ${fill}`);
        }
    }
    const altText = alt.join(" · ");
    return {
        svg: svgDocument(WIDTH, HEIGHT, parts.join("")),
        alt: altText.length > ALT_MAX ? `${altText.slice(0, ALT_MAX - 1)}…` : altText,
        width: WIDTH,
        height: HEIGHT,
    };
}

module.exports = { raidWeekStripSvg, dayIndex, raidTag, fillState, WIDTH, HEIGHT };
