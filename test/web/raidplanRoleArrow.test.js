// Server side of the facing wedge per icon (arrowScale, arrowHidden, arrowColor, arrowOpacity) and of the role group placeholder (a zone of
// type "role") and role references ("role:melee") in rows and steps: validated and clamped, an older board keeps its look, nothing resolves.
const board = require("../../src/web/raidplanBoard");
const assign = require("../../src/web/raidplanAssign");
const steps = require("../../src/web/raidplanSteps");

const clean = (b) => board.cleanBoard(b, { allowedUserIds: [] });
const icon = (extra = {}) => ({ iconKey: "boss:609", x: 0.5, y: 0.5, ...extra });

describe("the facing wedge of an icon", () => {
    it("an older icon has none of the fields (100 %, shown, amber); set values are clamped and only kept when they differ", () => {
        const plain = clean({ icons: [icon()] }).board.icons[0];
        expect(plain).not.toHaveProperty("arrowScale");
        expect(plain).not.toHaveProperty("arrowHidden");
        const r = clean({ icons: [icon({ arrowScale: 9, arrowHidden: true, arrowColor: "#22C55E", arrowOpacity: 0.01 }), icon({ arrowScale: 0.01 }), icon({ arrowScale: 1, arrowColor: "#ffb020", arrowOpacity: 1, arrowHidden: "yes" }), icon({ arrowScale: "x", arrowColor: "red" })] }).board.icons;
        expect(r[0]).toMatchObject({ arrowScale: 3, arrowHidden: true, arrowColor: "#22c55e", arrowOpacity: 0.1 });
        expect(r[1].arrowScale).toBe(0.25);
        for (const i of [r[2], r[3]]) for (const k of ["arrowScale", "arrowHidden", "arrowColor", "arrowOpacity"]) expect(i).not.toHaveProperty(k);
    });

    it("an auto mob keeps the same fields in autoStyle; a copy of the board keeps them (apply / duplicate)", () => {
        const b = clean({ icons: [icon({ arrowScale: 0.5 })], autoStyle: { "m:d:flame#1": { arrowScale: 2.5, arrowHidden: true }, "t:r1:1": { arrowScale: 1 } } }).board;
        expect(b.autoStyle).toEqual({ "m:d:flame#1": { arrowScale: 2.5, arrowHidden: true } });
        const copy = board.reidBoard(b);
        expect(copy.icons[0].arrowScale).toBe(0.5);
        expect(copy.autoStyle["m:d:flame#1"]).toEqual({ arrowScale: 2.5, arrowHidden: true });
    });
});

describe("a role group placeholder", () => {
    it("a zone of type role: its role (default melee), its role colour, a count 0..40, names off by default, the cluster shape only for it", () => {
        const z = clean({ zones: [
            { type: "role", role: "ranged", shape: "cluster", x: 0.1, y: 0.1, w: 0.2, h: 0.2, count: 99, showNames: true, label: "Alle Ranged" },
            { type: "role", role: "bogus", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
            { type: "neutral", shape: "cluster", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        ] }).board.zones;
        expect(z[0]).toMatchObject({ type: "role", role: "ranged", shape: "cluster", color: "#a78bfa", count: 40, showNames: true, label: "Alle Ranged" });
        expect(z[1]).toMatchObject({ type: "role", role: "melee", shape: "ellipse", color: "#f97316", count: 0, showNames: false });
        expect(z[2]).toMatchObject({ type: "neutral", shape: "rect" });
        expect(z[2]).not.toHaveProperty("role");
        expect(board.ZONE_ROLES).toEqual(["melee", "ranged", "healer", "tank", "dps"]);
        // a role group can be turned (0..359, 0 = as drawn); other zones have no rotation
        expect(z[0].rotation).toBe(0);
        expect(clean({ zones: [{ type: "role", x: 0, y: 0, w: 0.2, h: 0.2, rotation: -30 }] }).board.zones[0].rotation).toBe(330);
        expect(z[2]).not.toHaveProperty("rotation");
    });
});

describe("role references", () => {
    it("a row may name a whole role group as who and as target; nothing else, and it never resolves into players", () => {
        const r = assign.cleanAssignments([{ id: "a", type: "other", assignees: ["role:melee", "role:nope", "role:ranged"], targets: [{ kind: "role", ref: "healer" }, { kind: "role", ref: "x" }] }]);
        expect(r.assignments[0].assignees).toEqual(["role:melee", "role:ranged"]);
        expect(r.assignments[0].targets).toEqual([{ kind: "role", ref: "healer" }]);
        const roster = [{ userId: "m1", classId: "Rogue", role: "melee", group: 1 }];
        const out = assign.expandClassRefs([{ id: "a", type: "other", assignees: ["role:melee"], targets: [{ kind: "role", ref: "melee" }] }], [], roster, {});
        expect(out[0].assignees).toEqual(["role:melee"]);
        expect(out[0].targets).toEqual([{ kind: "role", ref: "melee" }]);
    });

    it("a step keeps a role group as participant and as target, also when it is resolved for the sheet", () => {
        const r = steps.cleanSteps([{ id: "s", action: "note", participants: ["role:ranged", "role:bad", "class:Hunter:1"], sentence: "soaken", targets: [{ kind: "role", ref: "ranged" }, { kind: "role", ref: "?" }] }], new Set());
        expect(r.steps[0].participants).toEqual(["role:ranged", "class:Hunter:1"]);
        expect(r.steps[0].targets).toEqual([{ kind: "role", ref: "ranged" }]);
        const roster = [{ userId: "h1", classId: "Hunter", role: "ranged", group: 1 }];
        expect(steps.resolveSteps(r.steps, { roster })[0].participants).toEqual(["role:ranged", "user:h1"]);
    });
});
