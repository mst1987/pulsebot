// Group rings and role groups: names on a ring, a group's own token size,
// scaling with themselves and turned role groups (feature/raidplan-14..16).
// The board logic behind the editors (src/web-client/src/lib/raidplan.ts) runs for real,
// the pages' structure is checked on the source - the client is TSX without a React renderer here (docs/raidplan.md).
const { loadTs, makeT } = require("./i18nHelper");

describe("names on a group ring (feature/raidplan-14)", () => {
    const lib2 = loadTs("lib/raidplan.ts", { t: makeT("de") });
    it("neighbours on a ring stand at least RING_CHORD tokens apart, whatever their number", () => {
        for (const n of [2, 3, 4, 5, 6, 8]) {
            const r = lib2.ringRadius(n, 38);
            expect(2 * r * Math.sin(Math.PI / n)).toBeGreaterThanOrEqual(lib2.RING_CHORD * 38 - 1e-9);
        }
        expect(lib2.ringRadius(0, 38)).toBe(0);
        // few raiders keep the old minimum radius
        expect(lib2.ringRadius(3, 38)).toBeCloseTo(38 * 1.7, 9);
    });
    it("a member's name is never wider than the room to its neighbour (and never more than 2.6 icons)", () => {
        for (const n of [2, 3, 5, 8]) {
            const w = lib2.ringNameWidth(n, 38, 38);
            const chord = 2 * lib2.ringRadius(n, 38) * Math.sin(Math.PI / n);
            expect(w).toBeLessThanOrEqual(chord - 38 * 0.25 + 1e-9);
            expect(w).toBeLessThanOrEqual(38 * 2.6);
        }
        expect(lib2.ringNameWidth(1, 38, 38)).toBe(38 * 2.6);
        // members drawn bigger than the ring spacing: the name gets at least a little room
        expect(lib2.ringNameWidth(5, 20, 60)).toBeGreaterThanOrEqual(60 * 1.2);
    });
    it("the stylesheet: the name hangs under its icon at a share of it, the ring caps its width, the group badge sits at the top", () => {
        const css = require("fs").readFileSync(require("path").join(__dirname, "../../src/web-client/src/styles/raidplan.css"), "utf8");
        expect(css).toContain(".rp-canvas .rp-token .rp-token-name { font-size: var(--rp-nf, calc(var(--rp-s, 38px) * .3)); top: calc(var(--rp-s, 38px) * .58); max-width: var(--rp-nw, calc(var(--rp-s, 38px) * 2.6));");
        expect(css).toContain(".rp-canvas .rp-token-gbadge { right: calc(var(--rp-s, 38px) * -.13); top: calc(var(--rp-s, 38px) * -.13); bottom: auto;");
        const board = require("fs").readFileSync(require("path").join(__dirname, "../../src/web-client/src/components/raidplan/PlanBoard.tsx"), "utf8");
        expect(board).toContain("\"--rp-nw\": `${Math.round(nameRoom)}px`");
    });
});

describe("a group's own token size (feature/raidplan-15)", () => {
    const lib3 = loadTs("lib/raidplan.ts", { t: makeT("de") });
    it("the ring is laid out for the tokens it carries: never tighter than their size, the spacing wins when it is bigger", () => {
        expect(lib3.ringUnit(38, 11)).toBe(38);
        expect(lib3.ringUnit(11, 27)).toBe(27);
        expect(lib3.ringUnit(0, 0)).toBe(0);
        // spacing 30 %, tokens 70 %: neighbours stand 2.2 tokens of 70 % apart, not of 30 %
        const r = lib3.ringRadius(5, lib3.ringUnit(38 * 0.3, 38 * 0.7));
        expect(2 * r * Math.sin(Math.PI / 5)).toBeGreaterThanOrEqual(lib3.RING_CHORD * 38 * 0.7 - 1e-9);
    });
    it("the board uses it for the ring and for the places the facing finds; the token button is exactly its icon (no text line)", () => {
        const fs = require("fs");
        const p = require("path");
        const board = fs.readFileSync(p.join(__dirname, "../../src/web-client/src/components/raidplan/PlanBoard.tsx"), "utf8");
        expect(board).toContain("const spacePx = ringUnit(memberBase * gs * sp, memberPx);");
        expect(board).toContain("ringOffsets(members.length, size.w, size.h, ringUnit(base * sp, base * ts))");
        const css = fs.readFileSync(p.join(__dirname, "../../src/web-client/src/styles/raidplan.css"), "utf8");
        expect(css).toContain(".rp-canvas .rp-token > .rp-token-btn:not(.rp-groupchip) { display: block; width: var(--rp-s, 38px); height: var(--rp-s, 38px); line-height: 0; font-size: 0; }");
    });
});

describe("role groups and group chips scale with themselves (feature/raidplan-15)", () => {
    const lib4 = loadTs("lib/raidplan.ts", { t: makeT("de") });
    it("a role group's icon, outline, label, count and names are shares of the zone: twice the zone, twice everything (within limits)", () => {
        const a = lib4.roleZoneMetrics(100, 100, false, 0);
        const b = lib4.roleZoneMetrics(200, 200, false, 0);
        expect(b.icon / a.icon).toBeCloseTo(2, 5);
        expect(b.label).toBeGreaterThan(a.label);
        expect(b.border).toBeGreaterThan(a.border);
        expect(b.names).toBeGreaterThan(a.names);
        // the icon is a circle of the zone's smaller side: a narrow strip gets an undistorted, smaller icon
        const strip = lib4.roleZoneMetrics(50, 250, false, 0);
        expect(strip.icon).toBeLessThanOrEqual(50 * 0.45 + 1e-9);
        // names go by the area: the strip still has readable names, never more than a token name (11.4)
        expect(strip.names).toBeGreaterThan(8);
        expect(lib4.roleZoneMetrics(900, 900, false, 0).names).toBe(11.4);
        expect(lib4.roleZoneMetrics(900, 900, false, 0).icon).toBe(96);
        // limits of the outline
        expect(lib4.roleZoneMetrics(10, 10, false, 0).border).toBe(1);
        expect(lib4.roleZoneMetrics(900, 900, false, 0).border).toBe(4);
        // a cluster: several smaller icons
        expect(lib4.roleZoneMetrics(200, 200, true, 5).icon).toBeLessThan(lib4.roleZoneMetrics(200, 200, false, 0).icon);
    });
    it("a zone's edge grips move one side only; the corners two", () => {
        const r = { x: 0.2, y: 0.2, w: 0.2, h: 0.2 };
        expect(lib4.resizeRect(r, "e", 0.1, 0.3)).toEqual({ x: 0.2, y: 0.2, w: expect.closeTo(0.3, 9), h: 0.2 });
        expect(lib4.resizeRect(r, "s", 0.3, 0.1)).toEqual({ x: 0.2, y: 0.2, w: 0.2, h: expect.closeTo(0.3, 9) });
        expect(lib4.resizeRect(r, "n", 0, -0.1).y).toBeCloseTo(0.1, 9);
        expect(lib4.resizeRect(r, "w", -0.1, 0).x).toBeCloseTo(0.1, 9);
        expect(lib4.resizeRect(r, "se", 0.1, 0.1)).toEqual({ x: 0.2, y: 0.2, w: expect.closeTo(0.3, 9), h: expect.closeTo(0.3, 9) });
    });
    it("a group chip: automatic width (0) or the width set for it, 60 .. 400", () => {
        expect(lib4.chipWidthOf({})).toBe(0);
        expect(lib4.chipWidthOf({ chipWidth: 0 })).toBe(0);
        expect(lib4.chipWidthOf({ chipWidth: 30 })).toBe(60);
        expect(lib4.chipWidthOf({ chipWidth: 150.4 })).toBe(150);
        expect(lib4.chipWidthOf({ chipWidth: 999 })).toBe(400);
    });
    it("the stylesheet: ONE solid outline for a role group (no double lines), the icon without a ring of its own, names never split", () => {
        const fs = require("fs");
        const css = fs.readFileSync(require("path").join(__dirname, "../../src/web-client/src/styles/raidplan.css"), "utf8");
        expect(css).toContain(".rp-zone-role { border-style: solid; border-width: var(--rp-zb, 2px); background-image: none; }");
        // no zone draws double / parallel lines any more (the double ring of a RANGED TOKEN is its role mark, not a zone)
        expect(css).not.toMatch(/\.rp-zone[^{]*\{[^}]*double/);
        expect(css).not.toMatch(/\.rp-rg-ico[^{]*\{[^}]*double/);
        expect(css).toMatch(/\.rp-rg-names > \* \{ white-space: nowrap;/);
        expect(css).toContain(".rp-canvas .rp-groupchip-names > * { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }");
        expect(css).toContain(".rp-canvas .rp-groupchip { width: max-content; max-width: 220px; }");
    });
});

describe("role groups turned, their names inside (feature/raidplan-16)", () => {
    const lib5 = loadTs("lib/raidplan.ts", { t: makeT("de") });
    it("the upright box of a turned zone: a rectangle, and an ellipse (smaller)", () => {
        expect(lib5.turnedBox(100, 20, 0)).toEqual({ w: 100, h: 20 });
        const r = lib5.turnedBox(100, 20, 90);
        expect(r.w).toBeCloseTo(20, 6);
        expect(r.h).toBeCloseTo(100, 6);
        const d = lib5.turnedBox(100, 20, 45);
        expect(d.w).toBeCloseTo(120 / Math.SQRT2, 6);
        const e = lib5.turnedBox(100, 20, 45, "ellipse");
        expect(e.w).toBeLessThan(d.w);
        expect(lib5.turnedBox(100, 100, 45, "ellipse").w).toBeCloseTo(100, 6);
    });
    it("the area for the content stays upright: swapped on its side, a square when turned diagonally, inside an ellipse", () => {
        expect(lib5.uprightInner(40, 200, 0)).toEqual({ w: 40, h: 200 });
        expect(lib5.uprightInner(40, 200, 90)).toEqual({ w: 200, h: 40 });
        expect(lib5.uprightInner(40, 200, 180)).toEqual({ w: 40, h: 200 });
        expect(lib5.uprightInner(40, 200, 45).w).toBeCloseTo(40 * 0.78, 6);
        expect(lib5.uprightInner(100, 100, 0, "ellipse").w).toBeCloseTo(70, 6);
    });
    it("names inside: as many as fit, the rest one '+N' chip; the font scales with the area, at most 11.4", () => {
        const names = ["Schleich", "Meuchler", "Schatten", "Berserker", "Richter", "Donnerfaust", "Klingentanz", "Katzenauge"];
        const big = lib5.roleNamesLayout(300, 300, names, 1);
        expect(big.shown).toBe(8);
        expect(big.more).toBe(0);
        expect(big.font).toBe(11.4);
        const small = lib5.roleNamesLayout(60, 45, names, 1);
        expect(small.shown).toBeLessThan(8);
        expect(small.shown + small.more).toBe(8);
        expect(small.font).toBeLessThan(big.font);
        // no room at all: nothing shown, all counted
        expect(lib5.roleNamesLayout(10, 10, names, 1)).toMatchObject({ shown: 0, more: 8 });
        // the symbol's own scale on top of the automatic size
        expect(lib5.roleNamesLayout(300, 300, names, 2).icon).toBeCloseTo(lib5.roleNamesLayout(300, 300, names, 1).icon * 2, 5);
    });
    it("a turned zone resized at an edge grip: along its own axis, the opposite side stays", () => {
        const start = { x: 0.4, y: 0.1, w: 0.1, h: 0.5 };
        const W = 1000;
        const H = 625;
        // not turned: like resizeRect
        const flat = lib5.resizeTurned(start, "s", 0, 50, 0, W, H);
        expect(flat.h).toBeCloseTo(0.5 + 50 / H, 6);
        expect(flat.y).toBeCloseTo(0.1, 6);
        // turned 90 degrees: "s" (its own bottom) points to the left of the board - a move left makes it longer
        const t = lib5.resizeTurned(start, "s", -50, 0, 90, W, H);
        expect(t.h * H).toBeCloseTo(0.5 * H + 50, 4);
        // the far end (its top, on the board: the right end) stays where it was
        const farBefore = { x: (0.45) * W + (0.25 * H) * 1, y: 0.35 * H };
        const cx = (t.x + t.w / 2) * W;
        const farAfter = { x: cx + (t.h * H) / 2, y: (t.y + t.h / 2) * H };
        expect(farAfter.x).toBeCloseTo(farBefore.x, 3);
        expect(farAfter.y).toBeCloseTo(farBefore.y, 3);
    });
    it("the board: content upright over the outline, the zone's grip turns (not moves), a selected zone lies above the tokens", () => {
        const fs = require("fs");
        const p = require("path");
        const board = fs.readFileSync(p.join(__dirname, "../../src/web-client/src/components/raidplan/PlanBoard.tsx"), "utf8");
        expect(board).toContain("{size.w > 0 && zones.filter((z) => !z.hidden && z.type === \"role\").map((z) => roleBody(z))}");
        expect(board).toContain("{rest.length > 0 && <span className=\"rp-rg-more\"");
        const ws = fs.readFileSync(p.join(__dirname, "../../src/web-client/src/pages/raid-detail/raidplan/BoardWorkspace.tsx"), "utf8");
        expect(ws).toContain("if (cr && (cur || handle === \"rot\")) {");
        expect(ws).toContain("resizeTurned(d.rect0, d.handle as ZoneGrip, dx * bp.w, dy * bp.h, turned, bp.w, bp.h)");
        const css = fs.readFileSync(p.join(__dirname, "../../src/web-client/src/styles/raidplan.css"), "utf8");
        expect(css).toContain(".rp-canvas .rp-zone.is-selected.is-editable { z-index: 6; }");
        expect(css).toContain(".rp-rg-label.is-left {");
    });
});
