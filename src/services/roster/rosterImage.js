// The roster as a drawn picture ("Roster als Bild", design canvas variant A, Oct 2026: the
// composition of a Raid-Helper roster post). Pure: the roster in, an SVG string out; the web
// route renders it to a PNG through services/discord/discordImage.js and offers it as a
// download or posts it into a channel - a fixed snapshot, it does not update itself.
//
//   Kern-Roster                                                          23/25
//   TBC · Stand 30.10.2026                                              Plätze
//   ┌ TANK      2/2 ┐ ┌ HEILER    5/6 ┐ ┌ NAHKAMPF    9 ┐ ┌ FERNKAMPF   7 ┐
//   │ [▣] Brokk     │ │ [▣] Nera      │ │ [▣] Zibbo  ▫▫ │ │ [▣] Kalu      │
//   │ [▣] Thrall    │ │ PROBE         │ │ ...           │ │ [ ] 2 DD-     │
//   │               │ │ [▣] Ilsa  bis │ │               │ │   Plätze frei │
//   └───────────────┘ └───────────────┘ └───────────────┘ └───────────────┘
//   ┌ ─ ERSATZ (2)  [▣] Morn  [▣] Vex ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
//
// Four role panels; a person is one row with their spec icon (the class icon without a spec, a
// square in the class colour without either - utils/image/specIcons.js) and the name in the
// class colour, no spec text. Trial members stand under a "Probe" subhead with the date their
// trial ends. A tank or healer panel counts "have/target" against the roster's slots (orange
// while short) and shows the open places as a dashed box; the damage dealers share what the
// total leaves after tanks and healers, shown once in the shorter of the two panels. Only the
// first char of a person counts - further chars are small spec icons on the right of the row,
// only when asked for (`showMoreChars`). Bench and pause stay out by default and come, when
// asked for (`showReserve`), as a dashed box at the bottom like the setup picture's bench.
// Somebody whose role cannot be told (no spec, no role, a hybrid class) is never dropped: a
// strip "Rolle offen" below the panels holds them. Names are cut with "…" to their room.
const { buildClasses } = require("../../config/gameVersions/classes");
const { TIMEZONE } = require("../../config/timezone");
const { tr } = require("../../utils/i18n/botText");
const { PALETTE, text, rect, image, svgDocument } = require("../../utils/image/svg");
const { textWidth } = require("../../utils/image/fontMetrics");
const { specIconDataUri } = require("../../utils/image/specIcons");

const PAD = 28;
const GAP = 16;
const PANEL_W = 290;
const HEAD_H = 50;
const ROW_H = 46;
const SUBHEAD_H = 30;
const PANEL_BOTTOM = 12;
const ICON = 32;
const ICON_X = 14;
const NAME_X = 58;
const NAME_SIZE = 22;
/** The further chars' icons, the room between them, and how many before "+n". */
const MORE_ICON = 22;
const MORE_GAP = 4;
const MORE_MAX = 4;
const DATE_SIZE = 16;
/** The bottom boxes (reserve, role open): label column, entry icon, name size, line height. */
const BOX_LABEL_W = 150;
const BOX_ICON = 30;
const BOX_NAME = 20;
const BOX_LINE = 42;
const FADED = 0.7;
/** The room a name keeps at least next to the further chars. */
const NAME_MIN = 100;
const WIDTH = 2 * PAD + 4 * PANEL_W + 3 * GAP;

const ROLES = [
    { key: "tank", label: "Tank" },
    { key: "healer", label: "Healer" },
    { key: "melee", label: "Melee" },
    { key: "ranged", label: "Ranged" },
];

/** The damage role of the pure-damage classes, for a dps member without a spec. */
const DPS_CLASS_ROLE = {
    Warrior: "melee", Rogue: "melee", DeathKnight: "melee", DemonHunter: "melee",
    Mage: "ranged", Warlock: "ranged", Hunter: "ranged", Evoker: "ranged",
};

const CLASSES = buildClasses();
const CLASS_BY_ID = new Map(CLASSES.map((c) => [c.id, c]));

/** The colour of a person: what the caller passed, else the class's, white without either. */
function colorOf(p) {
    if (p && p.color) return p.color;
    const cls = CLASS_BY_ID.get(p && p.classId);
    return (cls && cls.color) || PALETTE.text;
}

/**
 * The panel a person goes into: the spec's role first, then the roster role (tank, healer), and
 * for a damage dealer without a spec the role of a pure-damage class; "" when it cannot be told.
 */
function panelOf(p) {
    if (["tank", "healer", "melee", "ranged"].includes(p.specRole)) return p.specRole;
    if (p.role === "tank" || p.role === "healer") return p.role;
    if (p.role === "dps" || !p.role) return DPS_CLASS_ROLE[p.classId] || "";
    return "";
}

/** "14.11." in German, "14 Nov" in English - the day a trial ends, in server time. */
function shortDate(value, lang) {
    const d = new Date(value);
    if (!value || Number.isNaN(d.getTime())) return "";
    return lang === "en"
        ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: TIMEZONE }).format(d)
        : new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", timeZone: TIMEZONE }).format(d);
}

/** "30.10.2026" / "30 Oct 2026" - the day the picture was made. */
function longDate(value, lang) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return lang === "en"
        ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TIMEZONE }).format(d)
        : new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TIMEZONE }).format(d);
}

/** A spec icon (class icon, else a square in the colour) at (x, y), size `size`. */
function personIcon(p, x, y, size, { clipId, opacity = 1, r = 6 }) {
    const href = specIconDataUri(p && p.spec, p && p.classId);
    if (href) return image(href, x, y, size, size, { r, id: clipId, opacity });
    const inset = Math.round(size * 0.2);
    return rect(x + inset, y + inset, size - 2 * inset, size - 2 * inset, { r: 4, fill: colorOf(p), opacity });
}

/** A dashed outline without fill (free places, the reserve box). */
function dashedBox(x, y, w, h, { r = 14, opacity = 0.6 } = {}) {
    return `<rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${h - 2}" rx="${r}" fill="none" stroke="${PALETTE.muted}" stroke-width="2" stroke-dasharray="8 6" opacity="${opacity}"/>`;
}

/**
 * The further chars of a row: as many icons as fit (`fit`, at most MORE_MAX); with more chars than
 * that one icon fewer and "+n" for the rest.
 */
function moreCharsOf(p, fit = MORE_MAX) {
    const list = (p.extraChars || []).filter(Boolean);
    const max = Math.max(1, Math.min(MORE_MAX, fit));
    if (list.length <= max) return { icons: list, rest: 0 };
    return { icons: list.slice(0, max - 1), rest: list.length - (max - 1) };
}

/** Breaks entries of a known width into lines of at most `width` (`gap` between entries). */
function flow(entries, width, gap) {
    const lines = [];
    let line = [];
    let x = 0;
    for (const e of entries) {
        const w = Math.min(e.w, width);
        if (line.length && x + w > width) {
            lines.push(line);
            line = [];
            x = 0;
        }
        line.push({ ...e, x, w });
        x += w + gap;
    }
    if (line.length) lines.push(line);
    return lines;
}

/**
 * The picture of a roster.
 * @param {{ name?: string, versionLabel?: string, stand?: number|string|Date,
 *   slots?: { total?: number, tank?: number, healer?: number },
 *   members?: Array<{ name: string, status: "core"|"trial"|"bench"|"pause", trialUntil?: string|null,
 *     classId?: string, color?: string, spec?: string, specRole?: string, role?: string,
 *     extraChars?: Array<{ classId?: string, color?: string, spec?: string }> }> }} model
 *   members in the order they are drawn; only the first char of a person is the row
 * @param {{ showReserve?: boolean, showMoreChars?: boolean, lang?: string }} [o]
 * @returns {{ svg: string, width: number, height: number }}
 */
function rosterImageSvg(model, { showReserve = false, showMoreChars = false, lang = "de" } = {}) {
    const m = model || {};
    const slots = m.slots || {};
    const members = (m.members || []).filter(Boolean);
    const active = members.filter((p) => p.status === "core" || p.status === "trial" || !p.status);
    const upper = (s) => s.toLocaleUpperCase(lang === "en" ? "en-GB" : "de-DE");
    const parts = [];
    let clips = 0;
    const clip = () => `ri${clips++}`;

    // the head: name, version and day on the left, placed/target on the right
    const placed = active.length;
    const total = Math.max(0, Number(slots.total) || 0);
    const countText = total ? `${placed}/${total}` : String(placed);
    const countLabel = total ? tr(lang, "slots") : tr(lang, "players");
    const countW = Math.max(textWidth(countText, 34, { bold: true }), textWidth(countLabel, 18));
    parts.push(text(PAD, PAD + 32, String(m.name || "Roster"), { size: 34, bold: true, fill: PALETTE.text, maxWidth: WIDTH - 2 * PAD - countW - 32 }));
    const sub = [m.versionLabel, tr(lang, "As of {date}", { date: longDate(m.stand || Date.now(), lang) })].filter(Boolean).join("  ·  ");
    parts.push(text(PAD, PAD + 62, sub, { size: 18, fill: PALETTE.muted, maxWidth: WIDTH - 2 * PAD - countW - 32 }));
    parts.push(text(WIDTH - PAD, PAD + 32, countText, { size: 34, bold: true, fill: PALETTE.text, anchor: "end" }));
    parts.push(text(WIDTH - PAD, PAD + 62, countLabel, { size: 18, fill: PALETTE.muted, anchor: "end" }));
    let y = PAD + 90;

    // the role panels
    const unplaced = [];
    const byPanel = new Map(ROLES.map((r) => [r.key, []]));
    for (const p of active) {
        const key = panelOf(p);
        if (key) byPanel.get(key).push(p);
        else unplaced.push(p);
    }
    const targets = { tank: Math.max(0, Number(slots.tank) || 0), healer: Math.max(0, Number(slots.healer) || 0) };
    const dpsTarget = total ? Math.max(0, total - targets.tank - targets.healer) : 0;
    const dpsHave = byPanel.get("melee").length + byPanel.get("ranged").length;
    const dpsFree = Math.max(0, dpsTarget - dpsHave);
    const dpsFreeIn = byPanel.get("ranged").length < byPanel.get("melee").length ? "ranged" : "melee";
    const cols = ROLES.map((r) => {
        const list = byPanel.get(r.key);
        const core = list.filter((p) => p.status !== "trial");
        const trial = list.filter((p) => p.status === "trial");
        const target = targets[r.key] || 0;
        const free = r.key === "tank" || r.key === "healer"
            ? Math.max(0, target - list.length)
            : (r.key === dpsFreeIn ? dpsFree : 0);
        const empty = !list.length && !free;
        const rows = core.length + trial.length + (free ? 1 : 0) + (empty ? 1 : 0);
        return { r, core, trial, target, free, empty, h: HEAD_H + rows * ROW_H + (trial.length ? SUBHEAD_H : 0) + PANEL_BOTTOM };
    });
    const panelH = Math.max(...cols.map((c) => c.h));
    cols.forEach((c, i) => {
        const x = PAD + i * (PANEL_W + GAP);
        parts.push(rect(x, y, PANEL_W, panelH, { r: 14, fill: PALETTE.panel }));
        const have = c.core.length + c.trial.length;
        const count = c.target ? `${have}/${c.target}` : String(have);
        const countWidth = textWidth(count, 20, { bold: true });
        parts.push(text(x + 18, y + 33, upper(tr(lang, c.r.label)), { size: 18, bold: true, fill: PALETTE.muted, letterSpacing: 1.5, maxWidth: PANEL_W - 36 - countWidth - 10 }));
        parts.push(text(x + PANEL_W - 18, y + 33, count, { size: 20, bold: true, fill: c.target && have < c.target ? PALETTE.orange : PALETTE.text, anchor: "end" }));
        let ry = y + HEAD_H;
        const row = (p, k) => {
            const mid = ry + ROW_H / 2;
            if (k) parts.push(rect(x + 16, ry, PANEL_W - 32, 1, { fill: PALETTE.line }));
            parts.push(personIcon(p, x + ICON_X, mid - ICON / 2, ICON, { clipId: clip() }));
            // the right of the row, from the edge inwards: trial date, then the further chars
            let right = x + PANEL_W - 16;
            if (p.status === "trial") {
                const date = shortDate(p.trialUntil, lang);
                if (date) {
                    const label = tr(lang, "until {date}", { date });
                    parts.push(text(right, mid + 6, label, { size: DATE_SIZE, fill: PALETTE.muted, anchor: "end" }));
                    right -= textWidth(label, DATE_SIZE) + 10;
                }
            }
            if (showMoreChars) {
                const fit = Math.floor((right - (x + NAME_X) - NAME_MIN - 6) / (MORE_ICON + MORE_GAP));
                const { icons, rest } = moreCharsOf(p, fit);
                if (rest) {
                    const more = `+${rest}`;
                    parts.push(text(right, mid + 6, more, { size: DATE_SIZE, bold: true, fill: PALETTE.muted, anchor: "end" }));
                    right -= textWidth(more, DATE_SIZE, { bold: true }) + MORE_GAP;
                }
                for (let j = icons.length - 1; j >= 0; j--) {
                    right -= MORE_ICON;
                    parts.push(personIcon(icons[j], right, mid - MORE_ICON / 2, MORE_ICON, { clipId: clip(), opacity: 0.85, r: 4 }));
                    right -= MORE_GAP;
                }
                if (icons.length || rest) right -= 6;
            }
            parts.push(text(x + NAME_X, mid + NAME_SIZE * 0.36, String(p.name || "Raider"), { size: NAME_SIZE, bold: true, fill: colorOf(p), maxWidth: right - (x + NAME_X) }));
            ry += ROW_H;
        };
        c.core.forEach((p, k) => row(p, k));
        if (c.trial.length) {
            parts.push(text(x + 18, ry + 22, upper(tr(lang, "Trial")), { size: 14, bold: true, fill: PALETTE.muted, letterSpacing: 1.5 }));
            ry += SUBHEAD_H;
            c.trial.forEach((p, k) => row(p, k));
        }
        if (c.free) {
            const mid = ry + ROW_H / 2;
            parts.push(dashedBox(x + ICON_X, mid - ICON / 2, ICON, ICON, { r: 6, opacity: 0.7 }));
            const dps = c.r.key === "melee" || c.r.key === "ranged";
            const label = c.free === 1
                ? tr(lang, dps ? "1 DPS slot free" : "1 slot free")
                : tr(lang, dps ? "{count} DPS slots free" : "{count} slots free", { count: c.free });
            parts.push(text(x + NAME_X, mid + 7, label, { size: 20, fill: PALETTE.orange, maxWidth: PANEL_W - NAME_X - 16 }));
        }
        if (c.empty) parts.push(text(x + 18, ry + ROW_H / 2 + 7, tr(lang, "Nobody yet"), { size: 18, fill: PALETTE.muted }));
    });
    y += panelH + GAP;

    // the bottom boxes: who has no role yet (a filled panel), bench and pause (dashed, faded)
    const entry = (p) => ({ p, w: BOX_ICON + 8 + Math.ceil(textWidth(String(p.name || "Raider"), BOX_NAME, { bold: true })) + 2 });
    const box = (groups, { dashed }) => {
        const heads = groups.map((g) => `${upper(g.label)} (${g.list.length})`);
        const labelW = Math.max(BOX_LABEL_W, ...heads.map((h) => Math.ceil(textWidth(h, 16, { bold: true, letterSpacing: 1.5 })) + 16));
        const inner = WIDTH - 2 * PAD - 36 - labelW;
        const laid = groups.map((g, i) => ({ ...g, head: heads[i], lines: flow(g.list.map(entry), inner, 28) }));
        const h = 18 + laid.reduce((s, g) => s + g.lines.length * BOX_LINE, 0) + 12;
        parts.push(dashed ? dashedBox(PAD, y, WIDTH - 2 * PAD, h) : rect(PAD, y, WIDTH - 2 * PAD, h, { r: 14, fill: PALETTE.panel }));
        const opacity = dashed ? FADED : 1;
        let by = y + 18;
        for (const g of laid) {
            parts.push(text(PAD + 18, by + 27, g.head, { size: 16, bold: true, fill: PALETTE.muted, letterSpacing: 1.5 }));
            for (const line of g.lines) {
                for (const it of line) {
                    const ex = PAD + 18 + labelW + it.x;
                    parts.push(personIcon(it.p, ex, by + 6, BOX_ICON, { clipId: clip(), opacity, r: 5 }));
                    parts.push(text(ex + BOX_ICON + 8, by + 28, String(it.p.name || "Raider"), { size: BOX_NAME, bold: true, fill: colorOf(it.p), opacity, maxWidth: it.w - BOX_ICON - 8 }));
                }
                by += BOX_LINE;
            }
        }
        y += h + GAP;
    };
    if (unplaced.length) box([{ label: tr(lang, "Role open"), list: unplaced }], { dashed: false });
    if (showReserve) {
        const groups = [
            { label: tr(lang, "Substitutes"), list: members.filter((p) => p.status === "bench") },
            { label: tr(lang, "On break"), list: members.filter((p) => p.status === "pause") },
        ].filter((g) => g.list.length);
        if (groups.length) box(groups, { dashed: true });
    }
    const height = Math.ceil(y - GAP + PAD);
    return { svg: svgDocument(WIDTH, height, parts.join("")), width: WIDTH, height };
}

module.exports = { rosterImageSvg, panelOf, shortDate, longDate, WIDTH };
