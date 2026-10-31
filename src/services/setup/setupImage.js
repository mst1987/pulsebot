// The setup as a drawn picture (design "F · Setup als Grafik", Oct 2026, a test behind
// `config.discordVisuals.setupImage`). Pure: the approved lineup in, an SVG string out;
// setupMessage.js puts it into its embed as the image and services/discord/discordImage.js
// renders it.
//
//   GROUP 1              GROUP 2              ┌ ─ BENCH (2) ─ ┐
//   ▓[▣] Zibbo     (✓)▓   [▣] Kalu       ( )    [▣] Thrall
//    [▣] Brokk     ( )    [▣] Nera       (✗)   └ ─ ─ ─ ─ ─ ─ ┘
//
// One panel per group, three to a row (two for two or four panels, four from seven on);
// a raider is a row with their spec icon (the class icon without a spec, a square in the
// class colour without either - assets/specs/, utils/image/specIcons.js) and the character
// name in their class colour - no spec text, the icon says it (design canvas "Setup-Post
// mit Spec-Icons", Oct 2026). The answer is a big circle on the right of the row (round 2
// of the canvas, variant C: an icon badge was too small once a 25-man picture is shrunk
// into the embed): a green tick with the row tinted green, a red cross with icon and name
// greyed out, an empty grey ring while unanswered - so the open ones show too. The bench -
// only when it is posted - is the last panel, drawn apart (round 2, A): a dashed outline
// without fill, the names a little faded, no answers. Names are cut with "…" to their
// panel; buffs are not drawn (the approved snapshot carries none).
const { buildClasses } = require("../../config/gameVersions/classes");
const { tr } = require("../../utils/i18n/botText");
const { PALETTE, text, rect, image, svgDocument } = require("../../utils/image/svg");
const { specIconDataUri } = require("../../utils/image/specIcons");

const PAD = 24;
const GAP = 16;
const PANEL_W = 270;
const HEAD_H = 50;
const ROW_H = 48;
const PANEL_BOTTOM = 12;
/** More names than this in the bench panel are summed up as "+n". */
const BENCH_ROWS = 8;
const NAME_SIZE = 24;
const ICON = 34;
const ICON_X = 14;
const NAME_X = 62;
/** The answer circle's radius and its room on the right of a row. */
const CIRCLE_R = 13;
const CIRCLE_ROOM = 50;
/** A declined raider's icon and name; the bench's. */
const DIMMED = 0.4;
const BENCH_FADED = 0.7;
/** The green behind a confirmed row. */
const CONFIRMED_TINT = 0.13;

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

/** The answer centred on (cx, cy): a white tick on green, a white cross on red, an empty grey ring while unanswered. */
function answerCircle(status, cx, cy) {
    const r = CIRCLE_R;
    if (status === "confirmed") {
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${PALETTE.green}"/>`
            + `<path d="M${cx - 6} ${cy + 0.5}l4 4L${cx + 6.5} ${cy - 5}" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    if (status === "declined") {
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${PALETTE.red}"/>`
            + `<path d="M${cx - 4.8} ${cy - 4.8}l9.6 9.6M${cx + 4.8} ${cy - 4.8}l-9.6 9.6" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>`;
    }
    return `<circle cx="${cx}" cy="${cy}" r="${r - 1.5}" fill="none" stroke="${PALETTE.line}" stroke-width="3"/>`;
}

/**
 * The raid leader's small crown (#1036), centred at (cx, cy) over the spec icon's top-left corner:
 * three points on a band, outlined in the panel's colour so it stands off the icon.
 */
function leaderCrown(cx, cy) {
    const w = 18;
    const h = 13;
    const x = cx - w / 2;
    const y = cy - h / 2;
    const d = `M${x} ${y + h}L${x} ${y + 3}L${x + w * 0.27} ${y + h * 0.55}L${x + w / 2} ${y}`
        + `L${x + w * 0.73} ${y + h * 0.55}L${x + w} ${y + 3}L${x + w} ${y + h}Z`;
    return `<path class="leader-crown" d="${d}" fill="${PALETTE.orange}" stroke="${PALETTE.panel}" stroke-width="2.5" stroke-linejoin="round" paint-order="stroke"/>`;
}

/**
 * One raider row: spec icon and the name in the class colour; in a group the answer's circle on the
 * right (the row tinted green when confirmed, greyed out when declined), on the bench a little faded
 * and nothing else. `clipId` names the icon's clip path.
 */
function personRow(p, x, y, width, { status = "", inGroup = true, clipId = "" }) {
    const out = [];
    const color = classColor(p);
    const mid = y + ROW_H / 2;
    const ix = x + ICON_X;
    const iy = mid - ICON / 2;
    const opacity = !inGroup ? BENCH_FADED : status === "declined" ? DIMMED : 1;
    if (inGroup && status === "confirmed") out.push(rect(x + 6, y + 3, width - 12, ROW_H - 6, { r: 9, fill: PALETTE.green, opacity: CONFIRMED_TINT }));
    const href = specIconDataUri(p && p.spec, p && p.classId);
    out.push(href
        ? image(href, ix, iy, ICON, ICON, { r: 6, id: clipId, opacity })
        : rect(ix + 7, iy + 7, ICON - 14, ICON - 14, { r: 5, fill: color, opacity }));
    if (inGroup && p && p.leader) out.push(leaderCrown(ix + 2, iy + 2));
    const name = String((p && p.character) || "").trim() || "Raider";
    const room = width - NAME_X - (inGroup ? CIRCLE_ROOM : 16);
    out.push(text(x + NAME_X, mid + NAME_SIZE * 0.36, name, { size: NAME_SIZE, bold: true, fill: color, maxWidth: room, opacity }));
    if (inGroup) out.push(answerCircle(status, x + width - 28, mid));
    return out.join("");
}

/** A panel: its head and rows; the bench's is a dashed outline without fill, set apart from the groups. */
function panel(x, y, height, head, rows, { bench = false } = {}) {
    const box = bench
        ? `<rect x="${x + 1}" y="${y + 1}" width="${PANEL_W - 2}" height="${height - 2}" rx="14" fill="none" stroke="${PALETTE.muted}" stroke-width="2" stroke-dasharray="8 6" opacity="0.6"/>`
        : rect(x, y, PANEL_W, height, { r: 14, fill: PALETTE.panel });
    return box
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
        inGroup: true,
    }));
    if (benchList.length) {
        const shown = benchList.length > BENCH_ROWS ? benchList.slice(0, BENCH_ROWS - 1) : benchList;
        panels.push({
            head: `${tr(lang, "Bench").toLocaleUpperCase("de-DE")} (${benchList.length})`,
            people: shown,
            more: benchList.length - shown.length,
            inGroup: false,
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
                // the bench's rows stand without lines, like its panel without fill
                const divider = k && p.inGroup ? rect(x + 16, top, PANEL_W - 32, 1, { fill: PALETTE.line }) : "";
                const status = confirmations[String(person.userId)] || "";
                return divider + personRow(person, x, top, PANEL_W, { status, inGroup: p.inGroup, clipId: `icon${clips++}` });
            });
            if (p.more) {
                const top = y + HEAD_H + p.people.length * ROW_H;
                rows.push(text(x + NAME_X, top + ROW_H / 2 + 7, tr(lang, "+{count} more", { count: p.more }), { size: 19, fill: PALETTE.muted }));
            }
            parts.push(panel(x, y, height, p.head, rows.join(""), { bench: !p.inGroup }));
        });
        y += height + GAP;
    }
    const height = y - GAP + PAD;
    return { svg: svgDocument(width, height, parts.join("")), width, height };
}

module.exports = { setupImageSvg, classColor, columnsFor };
