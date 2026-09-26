const { readWorkspace } = require("../clientSource");
// Group rings and role groups (feature/raidplan-14..16) checked on the source:
// the stylesheet and the board. The ring and role group logic runs in Vitest
// (src/web-client/src/lib/raidplan/raidplan.roleGroups.test.ts).
describe("names on a group ring (feature/raidplan-14)", () => {
    it("the stylesheet: the name hangs under its icon at a share of it, the ring caps its width, the group badge sits at the top", () => {
        const css = require("fs").readFileSync(require("path").join(__dirname, "../../../src/web-client/src/styles/raidplan.css"), "utf8");
        expect(css).toContain(".rp-canvas .rp-token .rp-token-name { font-size: var(--rp-nf, calc(var(--rp-s, 38px) * .3)); top: calc(var(--rp-s, 38px) * .58); max-width: var(--rp-nw, calc(var(--rp-s, 38px) * 2.6));");
        expect(css).toContain(".rp-canvas .rp-token-gbadge { right: calc(var(--rp-s, 38px) * -.13); top: calc(var(--rp-s, 38px) * -.13); bottom: auto;");
        const board = require("fs").readFileSync(require("path").join(__dirname, "../../../src/web-client/src/components/raidplan/PlanBoard.tsx"), "utf8");
        expect(board).toContain("\"--rp-nw\": `${Math.round(nameRoom)}px`");
    });
});

describe("a group's own token size (feature/raidplan-15)", () => {
    it("the board uses it for the ring and for the places the facing finds; the token button is exactly its icon (no text line)", () => {
        const fs = require("fs");
        const p = require("path");
        const board = fs.readFileSync(p.join(__dirname, "../../../src/web-client/src/components/raidplan/PlanBoard.tsx"), "utf8");
        expect(board).toContain("const spacePx = ringUnit(memberBase * gs * sp, memberPx);");
        expect(board).toContain("ringOffsets(members.length, size.w, size.h, ringUnit(base * sp, base * ts))");
        const css = fs.readFileSync(p.join(__dirname, "../../../src/web-client/src/styles/raidplan.css"), "utf8");
        expect(css).toContain(".rp-canvas .rp-token > .rp-token-btn:not(.rp-groupchip) { display: block; width: var(--rp-s, 38px); height: var(--rp-s, 38px); line-height: 0; font-size: 0; }");
    });
});

describe("role groups and group chips scale with themselves (feature/raidplan-15)", () => {
    it("the stylesheet: ONE solid outline for a role group (no double lines), the icon without a ring of its own, names never split", () => {
        const fs = require("fs");
        const css = fs.readFileSync(require("path").join(__dirname, "../../../src/web-client/src/styles/raidplan.css"), "utf8");
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
    it("the board: content upright over the outline, the zone's grip turns (not moves), a selected zone lies above the tokens", () => {
        const fs = require("fs");
        const p = require("path");
        const board = fs.readFileSync(p.join(__dirname, "../../../src/web-client/src/components/raidplan/PlanBoard.tsx"), "utf8");
        expect(board).toContain("{size.w > 0 && zones.filter((z) => !z.hidden && z.type === \"role\").map((z) => roleBody(z))}");
        expect(board).toContain("{rest.length > 0 && <span className=\"rp-rg-more\"");
        const ws = readWorkspace();
        expect(ws).toContain("if (cr && (cur || handle === \"rot\")) {");
        expect(ws).toContain("resizeTurned(d.rect0, d.handle as ZoneGrip, dx * bp.w, dy * bp.h, turned, bp.w, bp.h)");
        const css = fs.readFileSync(p.join(__dirname, "../../../src/web-client/src/styles/raidplan.css"), "utf8");
        expect(css).toContain(".rp-canvas .rp-zone.is-selected.is-editable { z-index: 6; }");
        expect(css).toContain(".rp-rg-label.is-left {");
    });
});
