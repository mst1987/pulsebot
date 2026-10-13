// The setup as a drawn picture (design "F · Setup als Grafik", Oct 2026, a test behind
// `config.discordVisuals.setupImage`). Pure: the approved lineup in, an SVG string out;
// setupMessage.js puts it into its embed as the image and services/discord/discordImage.js
// renders it.
//
//   GROUP 1            GROUP 2            GROUP 3
//   [▣] Zibbo          [▣] Kalu           [▣] Thrall
//     ✓                                     ✗
//   GROUP 4            GROUP 5            BENCH (2)
//
// One panel per group, three to a row (two for two or four panels, four from seven on);
// a raider is a row with their spec icon (the class icon without a spec, a square in the
// class colour without either - assets/specs/, utils/image/specIcons.js) and the character
// name in their class colour - no spec text, the icon says it (design canvas "Setup-Post
// mit Spec-Icons", variant C, Oct 2026). The answer sits on the icon as a badge, the way
// the setup editor on the web shows it: a green tick, a red cross with icon and name
// dimmed, nothing while unanswered. The bench - only when it is posted - is the last panel,
// without badges. Names are cut with "…" to their panel; buffs are not drawn (the
// approved snapshot carries none).
const { buildClasses } = require("../../config/gameVersions/classes");
const { tr } = require("../../utils/i18n/botText");
const { PALETTE, text, rect, image, svgDocument } = require("../../utils/image/svg");
const { specIconDataUri } = require("../../utils/image/specIcons");

const PAD = 24;
const GAP = 16;
const PANEL_W = 260;
const HEAD_H = 50;
const ROW_H = 48;
const PANEL_BOTTOM = 12;
/** More names than this in the bench panel are summed up as "+n". */
const BENCH_ROWS = 8;
const NAME_SIZE = 24;
const ICON = 34;
const ICON_X = 14;
const NAME_X = 64;
/** A declined raider's icon and name. */
const DIMMED = 0.45;

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

/** The answer as a badge centred on (cx, cy): a white tick on green, a white cross on red, nothing while unanswered. */
function badge(status, cx, cy) {
    if (status !== "confirmed" && status !== "declined") return "";
    const ring = `<circle cx="${cx}" cy="${cy}" r="11" fill="${PALETTE.panel}"/>`
        + `<circle cx="${cx}" cy="${cy}" r="8.5" fill="${status === "confirmed" ? PALETTE.green : PALETTE.red}"/>`;
    if (status === "confirmed") {
        return `${ring}<path d="M${cx - 4} ${cy}l2.8 2.8L${cx + 4.2} ${cy - 3.5}" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    return `${ring}<path d="M${cx - 3.2} ${cy - 3.2}l6.4 6.4M${cx + 3.2} ${cy - 3.2}l-6.4 6.4" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>`;
}

/** One raider row: spec icon (with the answer's badge), the name in the class colour. `clipId` names the icon's clip path. */
function personRow(p, x, y, width, { status = "", withMark = true, clipId = "" }) {
    const out = [];
    const color = classColor(p);
    const mid = y + ROW_H / 2;
    const ix = x + ICON_X;
    const iy = mid - ICON / 2;
    const opacity = withMark && status === "declined" ? DIMMED : 1;
    const href = specIconDataUri(p && p.spec, p && p.classId);
    out.push(href
        ? image(href, ix, iy, ICON, ICON, { r: 6, id: clipId, opacity })
        : rect(ix + 7, iy + 7, ICON - 14, ICON - 14, { r: 5, fill: color, opacity }));
    if (withMark) out.push(badge(status, ix + ICON - 2, iy + ICON - 2));
    const name = String((p && p.character) || "").trim() || "Raider";
    out.push(text(x + NAME_X, mid + NAME_SIZE * 0.36, name, { size: NAME_SIZE, bold: true, fill: color, maxWidth: width - NAME_X - 16, opacity }));
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
    let clips = 0;
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
                return divider + personRow(person, x, top, PANEL_W, { status, withMark: p.withMark, clipId: `icon${clips++}` });
            });
            if (p.more) {
                const top = y + HEAD_H + p.people.length * ROW_H;
                rows.push(text(x + NAME_X, top + ROW_H / 2 + 7, tr(lang, "+{count} more", { count: p.more }), { size: 19, fill: PALETTE.muted }));
            }
            parts.push(panel(x, y, height, p.head, rows.join("")));
        });
        y += height + GAP;
    }
    const height = y - GAP + PAD;
    return { svg: svgDocument(width, height, parts.join("")), width, height };
}

module.exports = { setupImageSvg, classColor, columnsFor };
