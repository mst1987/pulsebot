// The setup as a drawn picture (design "F · Setup als Grafik", Oct 2026, a test behind
// `config.discordVisuals.setupImage`). Pure: the approved lineup in, an SVG string out;
// setupMessage.js puts it into its embed as the image and services/discord/discordImage.js
// renders it.
//
//   GROUP 1            GROUP 2            GROUP 3
//   ■ Zibbo        ✓   ■ Kalu             ■ Thrall      ✗
//   ■ …                ■ …                ■ …
//   GROUP 4            GROUP 5            BENCH (2)
//
// One panel per group, three to a row (two for two or four panels, four from seven on);
// a raider is a row with a small square in their class colour, the character name in it
// and the spec beside it while there is room; the confirm mark on the right (green tick,
// red cross, nothing while unanswered - the same answers the text showed as emojis). The
// bench - only when it is posted - is the last panel. Names are cut with "…" to their
// panel; buffs are not drawn (the approved snapshot carries none).
const { buildClasses } = require("../../config/gameVersions/classes");
const { tr, specLabel: specLabelIn } = require("../../utils/i18n/botText");
const { PALETTE, text, rect, svgDocument } = require("../../utils/image/svg");
const { textWidth } = require("../../utils/image/fontMetrics");

const PAD = 24;
const GAP = 16;
const PANEL_W = 320;
const HEAD_H = 50;
const ROW_H = 44;
const PANEL_BOTTOM = 12;
/** More names than this in the bench panel are summed up as "+n". */
const BENCH_ROWS = 8;
const NAME_SIZE = 24;
const SPEC_SIZE = 16;

const CLASSES = buildClasses();
const CLASS_BY_ID = new Map(CLASSES.map((c) => [c.id, c]));
const SPEC_BY_KEY = new Map(CLASSES.flatMap((c) => c.specs.map((s) => [s.key, s])));

/** The class colour of a raider (from the class, else from the spec), white without either. */
function classColor(p) {
    const spec = SPEC_BY_KEY.get(p && p.spec);
    const cls = CLASS_BY_ID.get((p && p.classId) || (spec && spec.classId));
    return (cls && cls.color) || PALETTE.text;
}

/** How many panels go in one row. */
function columnsFor(count) {
    if (count <= 1) return 1;
    if (count === 2 || count === 4) return 2;
    return count >= 7 ? 4 : 3;
}

/** A tick or a cross, 18 px, centred on (cx, cy). */
function mark(status, cx, cy) {
    if (status === "confirmed") {
        return `<path d="M${cx - 8} ${cy}l5.5 5.5L${cx + 8} ${cy - 7}" fill="none" stroke="${PALETTE.green}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    if (status === "declined") {
        return `<path d="M${cx - 6.5} ${cy - 6.5}l13 13M${cx + 6.5} ${cy - 6.5}l-13 13" fill="none" stroke="${PALETTE.red}" stroke-width="3.2" stroke-linecap="round"/>`;
    }
    return "";
}

/** One raider row: class square, name, spec while there is room, the mark. */
function personRow(p, x, y, width, { lang, status = "", withMark = true }) {
    const out = [];
    const color = classColor(p);
    const mid = y + ROW_H / 2;
    out.push(rect(x + 16, mid - 8, 16, 16, { r: 4, fill: color }));
    const nameX = x + 44;
    const markW = withMark ? 42 : 18;
    const room = width - (nameX - x) - markW;
    const name = String((p && p.character) || "").trim() || "Raider";
    const spec = specLabelIn(lang, SPEC_BY_KEY.get(p && p.spec), "");
    const nameW = textWidth(name, NAME_SIZE, { bold: true });
    const specW = spec ? textWidth(spec, SPEC_SIZE) : 0;
    out.push(text(nameX, mid + NAME_SIZE * 0.36, name, { size: NAME_SIZE, bold: true, fill: color, maxWidth: room }));
    if (spec && nameW + 12 + specW <= room) {
        out.push(text(x + width - markW, mid + SPEC_SIZE * 0.36, spec, { size: SPEC_SIZE, fill: PALETTE.muted, anchor: "end" }));
    }
    if (withMark) out.push(mark(status, x + width - 20, mid));
    return out.join("");
}

/** A panel: its head and rows. */
function panel(x, y, height, head, rows) {
    return rect(x, y, PANEL_W, height, { r: 14, fill: PALETTE.panel })
        + text(x + 18, y + 33, head, { size: 18, bold: true, fill: PALETTE.muted, letterSpacing: 1.5, maxWidth: PANEL_W - 36 })
        + rows;
}

/**
 * The picture of an approved setup; null without a group that has anybody in it.
 * @param {object} approved the approved snapshot (setupCore.approvedSetupOf): groups with slots, bench
 * @param {{ confirmations?: object, bench?: boolean, lang?: string }} [o] confirmations: userId -> "confirmed" |
 *   "declined"; bench: whether the bench is posted (#517)
 * @returns {{ svg: string, width: number, height: number } | null}
 */
function setupImageSvg(approved, { confirmations = {}, bench = false, lang = "de" } = {}) {
    const groups = ((approved && approved.groups) || []).filter((g) => (g.slots || []).length).sort((a, b) => a.index - b.index);
    if (!groups.length) return null;
    const benchList = bench ? ((approved && approved.bench) || []) : [];
    const panels = groups.map((g) => ({
        head: tr(lang, "Group {index}", { index: g.index }).toLocaleUpperCase("de-DE"),
        people: g.slots,
        withMark: true,
    }));
    if (benchList.length) {
        const shown = benchList.length > BENCH_ROWS ? benchList.slice(0, BENCH_ROWS - 1) : benchList;
        panels.push({
            head: `${tr(lang, "Bench").toLocaleUpperCase("de-DE")} (${benchList.length})`,
            people: shown,
            more: benchList.length - shown.length,
            withMark: false,
        });
    }
    const cols = columnsFor(panels.length);
    const rowsOfPanels = [];
    for (let i = 0; i < panels.length; i += cols) rowsOfPanels.push(panels.slice(i, i + cols));
    const width = 2 * PAD + cols * PANEL_W + (cols - 1) * GAP;

    const parts = [];
    let y = PAD;
    for (const line of rowsOfPanels) {
        const lines = Math.max(...line.map((p) => p.people.length + (p.more ? 1 : 0)));
        const height = HEAD_H + lines * ROW_H + PANEL_BOTTOM;
        line.forEach((p, i) => {
            const x = PAD + i * (PANEL_W + GAP);
            const rows = p.people.map((person, k) => {
                const top = y + HEAD_H + k * ROW_H;
                const divider = k ? rect(x + 16, top, PANEL_W - 32, 1, { fill: PALETTE.line }) : "";
                const status = confirmations[String(person.userId)] || "";
                return divider + personRow(person, x, top, PANEL_W, { lang, status, withMark: p.withMark });
            });
            if (p.more) {
                const top = y + HEAD_H + p.people.length * ROW_H;
                rows.push(text(x + 44, top + ROW_H / 2 + 7, tr(lang, "+{count} more", { count: p.more }), { size: 19, fill: PALETTE.muted }));
            }
            parts.push(panel(x, y, height, p.head, rows.join("")));
        });
        y += height + GAP;
    }
    const height = y - GAP + PAD;
    return { svg: svgDocument(width, height, parts.join("")), width, height };
}

module.exports = { setupImageSvg, classColor, columnsFor };
