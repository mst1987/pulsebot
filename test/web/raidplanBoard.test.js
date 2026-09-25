// The shared board (src/web/raidplanBoard.js): slots, marks, zones, cleaning, the
// slot auto-fill and copying a board with fresh ids.
const board = require("../../src/web/raidplanBoard");

const clean = (raw, opts = {}) => board.cleanBoard(raw, { allowedUserIds: ["u1", "u2", "u3"], ...opts });
const p = (userId, role, group = 1) => ({ userId, role, group });

describe("slots", () => {
    it("keeps the five kinds, clamps the position and limits n and the label", () => {
        const r = clean({ slots: [
            { id: "a", kind: "tank", n: 2, x: -1, y: 5 },
            { kind: "healer", n: 0 },
            { kind: "dps", n: 500 },
            { kind: "group", n: 3, label: "G".repeat(90) },
            { kind: "label", label: " Boss-Tank " },
        ] });
        expect(r.board.slots.map((s) => [s.kind, s.n])).toEqual([["tank", 2], ["healer", 1], ["dps", 99], ["group", 3], ["label", 1]]);
        expect(r.board.slots[0]).toMatchObject({ id: "a", x: 0, y: 1, userId: "" });
        expect(r.board.slots[3].label).toHaveLength(board.LIMITS.label);
        expect(r.board.slots[4].label).toBe("Boss-Tank");
    });

    it("drops an unknown kind and a label slot without a label", () => {
        const r = clean({ slots: [{ kind: "boss" }, { kind: "label", label: "  " }, { kind: "tank" }] });
        expect(r.board.slots).toHaveLength(1);
        expect(r.dropped).toBe(2);
    });

    it("lets a known player stand in one slot only, never in a group marker, never a stranger", () => {
        const r = clean({ slots: [
            { kind: "tank", userId: "u1" }, { kind: "healer", userId: "u1" }, { kind: "dps", userId: "stranger" }, { kind: "group", n: 1, userId: "u2" },
        ] });
        expect(r.board.slots.map((s) => s.userId)).toEqual(["u1", "", "", ""]);
    });

    it("gives clashing ids a new one", () => {
        const r = clean({ slots: [{ id: "x", kind: "tank" }, { id: "x", kind: "tank" }] });
        expect(new Set(r.board.slots.map((s) => s.id)).size).toBe(2);
    });

    it("refuses more than 60", () => {
        expect(clean({ slots: Array.from({ length: 61 }, () => ({ kind: "dps" })) }).code).toBe("invalid");
    });
});

describe("marks", () => {
    it("knows the eight raid marks and nothing else", () => {
        const r = clean({ marks: [...board.MARKS, "poop"].map((m) => ({ mark: m, x: 2, y: -2 })) });
        expect(r.board.marks.map((m) => m.mark)).toEqual(["skull", "cross", "square", "moon", "triangle", "diamond", "circle", "star"]);
        expect(r.board.marks[0]).toMatchObject({ x: 1, y: 0 });
        expect(r.dropped).toBe(1);
    });

    it("refuses more than 40", () => {
        expect(clean({ marks: Array.from({ length: 41 }, () => ({ mark: "star" })) }).code).toBe("invalid");
    });
});

describe("zones", () => {
    it("starts a zone with the colour of its type and a moderate opacity", () => {
        const r = clean({ zones: [{ type: "danger", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { type: "healthy" }, { type: "weird", shape: "star" }] });
        expect(r.board.zones.map((z) => [z.type, z.color, z.shape, z.opacity])).toEqual([
            ["danger", "#ef4444", "rect", 0.3], ["healthy", "#22c55e", "rect", 0.3], ["neutral", "#60a5fa", "rect", 0.3],
        ]);
    });

    it("keeps a valid colour, cuts the opacity into 0.1..1 and rejects junk colours", () => {
        const r = clean({ zones: [{ type: "custom", color: "#ABCDEF", opacity: 0.9 }, { type: "custom", color: "red", opacity: 0 }, { type: "custom", color: "#12345", opacity: "x" }] });
        expect(r.board.zones.map((z) => [z.color, z.opacity])).toEqual([["#abcdef", 0.9], ["#a78bfa", 0.1], ["#a78bfa", 0.3]]);
    });

    it("keeps a zone inside the board with a minimum size", () => {
        const r = clean({ zones: [{ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, { x: 0, y: 0, w: 0, h: -1 }, { x: 0, y: 0, w: 9, h: 9 }] });
        expect(r.board.zones[0]).toMatchObject({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
        expect(r.board.zones[1]).toMatchObject({ w: board.MIN_ZONE, h: board.MIN_ZONE });
        expect(r.board.zones[2]).toMatchObject({ w: 1, h: 1, x: 0, y: 0 });
    });

    it("cuts the label and refuses more than 30", () => {
        expect(clean({ zones: [{ label: "z".repeat(99) }] }).board.zones[0].label).toHaveLength(board.LIMITS.label);
        expect(clean({ zones: Array.from({ length: 31 }, () => ({})) }).code).toBe("invalid");
    });
});

describe("the rest of a board", () => {
    it("has every field even for nothing and reports no content", () => {
        const r = clean(undefined);
        expect(r.board).toEqual({ tokens: [], slots: [], marks: [], zones: [], icons: [], lines: [], texts: [], targets: [], assignments: [], steps: [], showMap: true, mobs: [], hiddenCards: [], inheritOff: [], showRings: true, inSheet: true, groupColors: {}, groupMarks: {}, showNames: true, showBadges: true, showRoleRings: true, view: null, counts: null, roles: {}, notes: "", profileId: "", mapOpacity: 1, objectScale: 1 });
        expect(board.boardHasContent(r.board)).toBe(false);
        expect(board.boardHasContent(clean({ zones: [{}] }).board)).toBe(true);
        expect(board.boardHasContent(clean({ notes: "x" }).board)).toBe(true);
    });

    it("shows the map unless it is switched off: an old board (no flag) keeps it, a hidden map alone is content", () => {
        expect(clean({ notes: "x" }).board.showMap).toBe(true);
        expect(clean({ showMap: true }).board.showMap).toBe(true);
        expect(clean({ showMap: "nope" }).board.showMap).toBe(true);
        const off = clean({ showMap: false, tokens: [{ userId: "u1", x: 0.2, y: 0.3 }] }).board;
        // the objects on the map stay stored while it is hidden
        expect(off).toMatchObject({ showMap: false, tokens: [{ userId: "u1" }] });
        expect(board.boardHasContent(clean({ showMap: false }).board)).toBe(true);
    });

    it("keeps hidden default cards: known types once each, and a hidden card alone counts as content", () => {
        const r = clean({ hiddenCards: ["tank", "tank", "nonsense", "heal", 5] });
        expect(r.board.hiddenCards).toEqual(["tank", "heal"]);
        expect(board.boardHasContent(r.board)).toBe(true);
        expect(clean({ hiddenCards: "tank" }).board.hiddenCards).toEqual([]);
    });

    it("takes no free tokens when they are switched off (a template)", () => {
        const r = clean({ tokens: [{ userId: "u1", x: 0.5, y: 0.5 }] }, { allowTokens: false });
        expect(r.board.tokens).toEqual([]);
    });
});

describe("fillSlots", () => {
    const slots = [
        { id: "1", kind: "tank", n: 2, userId: "" }, { id: "2", kind: "tank", n: 1, userId: "" },
        { id: "3", kind: "healer", n: 1, userId: "" }, { id: "4", kind: "dps", n: 1, userId: "" },
        { id: "5", kind: "dps", n: 2, userId: "" }, { id: "6", kind: "group", n: 1, userId: "" }, { id: "7", kind: "label", n: 1, label: "MT", userId: "" },
    ];
    const roster = [p("t1", "tank"), p("h1", "healer"), p("t2", "tank"), p("d1", "melee"), p("d2", "ranged"), p("d3", "dps")];

    it("gives tank 1..n the tanks, healers the healers and dps the rest, in setup order", () => {
        const out = board.fillSlots(slots, roster);
        const by = Object.fromEntries(out.map((s) => [s.id, s.userId]));
        expect(by).toEqual({ 1: "t2", 2: "t1", 3: "h1", 4: "d1", 5: "d2", 6: "", 7: "" });
    });

    it("leaves a slot open when nobody fits and never uses a player twice", () => {
        const out = board.fillSlots([{ id: "a", kind: "tank", n: 1, userId: "" }, { id: "b", kind: "tank", n: 2, userId: "" }], [p("t1", "tank")]);
        expect(out.map((s) => s.userId)).toEqual(["t1", ""]);
    });

    it("keeps a player who is already placed and does not put them into a second slot", () => {
        const out = board.fillSlots([{ id: "a", kind: "tank", n: 1, userId: "" }, { id: "b", kind: "tank", n: 2, userId: "t1" }], [p("t1", "tank"), p("t2", "tank")]);
        expect(out.map((s) => s.userId)).toEqual(["t2", "t1"]);
    });

    it("does not change its input", () => {
        const before = JSON.stringify(slots);
        board.fillSlots(slots, roster);
        expect(JSON.stringify(slots)).toBe(before);
    });
});

describe("reidBoard", () => {
    it("gives every object a new id, empties tokens and row assignments", () => {
        const b = { tokens: [{ userId: "u1", x: 0, y: 0 }], slots: [{ id: "s", kind: "tank", n: 1 }], marks: [{ id: "m", mark: "star", x: 0, y: 0 }], zones: [{ id: "z" }], targets: [{ id: "t", title: "MT", userIds: ["u1"] }], notes: "n" };
        const r = board.reidBoard(b);
        expect(r.tokens).toEqual([]);
        expect(r.slots[0].id).not.toBe("s");
        expect(r.marks[0].id).not.toBe("m");
        expect(r.zones[0].id).not.toBe("z");
        expect(r.targets[0]).toMatchObject({ title: "MT", userIds: [] });
        expect(r.targets[0].id).not.toBe("t");
        expect(r.notes).toBe("n");
    });
});

describe("opacity, lock and hidden on every object", () => {
    const OBJ = { x: 0.5, y: 0.5 };

    it("defaults to fully visible (zones to 0.3), unlocked and shown", () => {
        const r = clean({
            tokens: [{ userId: "u1", ...OBJ }], slots: [{ kind: "tank", ...OBJ }], marks: [{ mark: "star", ...OBJ }],
            zones: [{ type: "danger", ...OBJ, w: 0.2, h: 0.2 }], lines: [{ x2: 1 }], texts: [{ text: "Hi" }],
        }).board;
        for (const list of [r.tokens, r.slots, r.marks, r.lines, r.texts]) expect(list[0]).toMatchObject({ opacity: 1, lock: false, hidden: false });
        expect(r.zones[0]).toMatchObject({ opacity: 0.3, lock: false, hidden: false });
    });

    it("clamps the opacity to 0.1..1 and keeps colour and opacity separate", () => {
        const r = clean({
            marks: [{ mark: "star", opacity: 0 }, { mark: "star", opacity: 7 }, { mark: "star", opacity: "abc" }, { mark: "star", opacity: 0.456 }],
            zones: [{ color: "#ff0000", opacity: 0.55 }],
        }).board;
        expect(r.marks.map((m) => m.opacity)).toEqual([0.1, 1, 1, 0.46]);
        expect(r.zones[0]).toMatchObject({ color: "#ff0000", opacity: 0.55 });
    });

    it("keeps lock and hidden only when they are exactly true", () => {
        const r = clean({ marks: [{ mark: "star", lock: true, hidden: true }, { mark: "star", lock: "yes", hidden: 1 }] }).board;
        expect(r.marks.map((m) => [m.lock, m.hidden])).toEqual([[true, true], [false, false]]);
    });

    it("clamps the map's opacity and counts a dimmed map as content", () => {
        expect(clean({ mapOpacity: 0.4 }).board.mapOpacity).toBe(0.4);
        expect(clean({ mapOpacity: 5 }).board.mapOpacity).toBe(1);
        expect(clean({ mapOpacity: 0 }).board.mapOpacity).toBe(0.1);
        expect(clean({}).board.mapOpacity).toBe(1);
        expect(board.boardHasContent(clean({ mapOpacity: 0.5 }).board)).toBe(true);
        expect(board.boardHasContent(clean({ mapOpacity: 1 }).board)).toBe(false);
    });
});

describe("lines and texts", () => {
    it("keeps arrows and lines on the board with a colour and a width", () => {
        const r = clean({ lines: [
            { kind: "arrow", x1: -1, y1: 0.2, x2: 3, y2: 0.8, color: "#FF0000", width: 20 },
            { kind: "weird", width: 0, color: "red" },
        ] }).board;
        expect(r.lines[0]).toMatchObject({ kind: "arrow", x1: 0, y1: 0.2, x2: 1, y2: 0.8, color: "#ff0000", width: 16 });
        expect(r.lines[1]).toMatchObject({ kind: "line", color: "#f8fafc", width: 4 });
    });

    it("keeps texts with a size between 10 and 48, drops empty ones and cuts long ones", () => {
        const r = clean({ texts: [{ text: "  Hallo ", size: 99, color: "#00ff00" }, { text: "   " }, { text: "x".repeat(200), size: 1 }] });
        expect(r.board.texts).toHaveLength(2);
        expect(r.board.texts[0]).toMatchObject({ text: "Hallo", size: 72, color: "#00ff00" });
        expect(r.board.texts[1].text).toHaveLength(board.LIMITS.text);
        expect(r.board.texts[1].size).toBe(5);
        expect(r.dropped).toBe(1);
    });

    it("refuses more than 40 of either", () => {
        expect(clean({ lines: Array.from({ length: 41 }, () => ({})) }).code).toBe("invalid");
        expect(clean({ texts: Array.from({ length: 41 }, () => ({ text: "a" })) }).code).toBe("invalid");
    });

    it("gives copied lines and texts new ids", () => {
        const r = board.reidBoard({ lines: [{ id: "l" }], texts: [{ id: "t" }] });
        expect(r.lines[0].id).not.toBe("l");
        expect(r.texts[0].id).not.toBe("t");
    });
});

describe("melee and ranged slots", () => {
    const at = (kind, n) => ({ id: kind + n, kind, n, userId: "" });
    const roster = [
        { userId: "t1", role: "tank" }, { userId: "h1", role: "healer" },
        { userId: "m1", role: "melee" }, { userId: "r1", role: "ranged" }, { userId: "m2", role: "melee" }, { userId: "x1", role: "dps" }, { userId: "r2", role: "ranged" },
    ];

    it("keeps melee and ranged as slot kinds", () => {
        const r = clean({ slots: [{ kind: "melee", n: 2 }, { kind: "ranged" }, { kind: "dps" }, { kind: "caster" }] });
        expect(r.board.slots.map((x) => [x.kind, x.n])).toEqual([["melee", 2], ["ranged", 1], ["dps", 1]]);
        expect(r.dropped).toBe(1);
    });

    it("gives melee slots the melee players, ranged slots the ranged ones, and never the wrong kind", () => {
        const slots = [at("ranged", 1), at("melee", 1), at("melee", 2), at("ranged", 2), at("ranged", 3)];
        const out = board.fillSlots(slots, roster);
        expect(out.map((s) => [s.id, s.userId])).toEqual([["ranged1", "r1"], ["melee1", "m1"], ["melee2", "m2"], ["ranged2", "r2"], ["ranged3", ""]]);
    });

    it("lets a generic DPS slot take only what no exact slot wants, and the unclassified last", () => {
        const slots = [at("dps", 1), at("dps", 2), at("melee", 1), at("ranged", 1)];
        const out = board.fillSlots(slots, roster);
        const by = Object.fromEntries(out.map((s) => [s.id, s.userId]));
        expect(by.melee1).toBe("m1");
        expect(by.ranged1).toBe("r1");
        expect(by.dps1).toBe("m2");
        expect(by.dps2).toBe("x1");
    });

    it("leaves a melee or ranged slot open for a player whose role is unknown", () => {
        const out = board.fillSlots([at("melee", 1), at("ranged", 1)], [{ userId: "x1", role: "dps" }]);
        expect(out.map((s) => s.userId)).toEqual(["", ""]);
    });
});

describe("group markers", () => {
    it("keeps hideMembers, split and the per-raider offsets of a group only, and only for known players", () => {
        const r = clean({ slots: [
            { kind: "group", n: 1, hideMembers: true, split: true, offsets: { u1: { dx: 0.1, dy: -2, size: 500 }, stranger: { dx: 0.1, dy: 0.1 }, u2: { dx: "x", dy: null } } },
            { kind: "tank", hideMembers: true, split: true, offsets: { u1: { dx: 0.1, dy: 0.1 } } },
        ] });
        expect(r.board.slots[0]).toMatchObject({ hideMembers: true, split: true });
        expect(r.board.slots[0].offsets).toEqual({ u1: { dx: 0.1, dy: -1, size: 152 }, u2: { dx: 0, dy: 0, size: 38 } });
        expect(r.board.slots[1]).toMatchObject({ hideMembers: false, split: false, offsets: {} });
        expect(r.dropped).toBe(1);
    });

    it("keeps the flags of a group in a template but no raiders", () => {
        const r = clean({ slots: [{ kind: "group", n: 2, split: true, offsets: { u1: { dx: 0.1, dy: 0.1 } } }] }, { allowedUserIds: [] });
        expect(r.board.slots[0]).toMatchObject({ split: true, offsets: {} });
    });
});

describe("sizes and icons", () => {
    it("clamps the size of tokens, slots and marks into their range and defaults the rest", () => {
        const r = clean({
            tokens: [{ userId: "u1", size: 5 }, { userId: "u2", size: 500 }, { userId: "u3" }],
            slots: [{ kind: "tank", size: 60.4 }],
            marks: [{ mark: "star", size: 2 }, { mark: "star", size: "abc" }],
        }).board;
        expect(r.tokens.map((t) => t.size)).toEqual([10, 152, 38]);
        expect(r.slots[0].size).toBe(60);
        expect(r.marks.map((m) => m.size)).toEqual([9, 34]);
    });

    it("keeps icons of the three sources and drops anything else", () => {
        const r = clean({ icons: [
            { iconKey: "boss:609", label: "Illidan", size: 999, rotation: 400, showLabel: true },
            { iconKey: "wow:spell_fire_fireball", size: 1 },
            { iconKey: "enemy" }, { iconKey: "bosspos" },
            { iconKey: "http://evil/x.png" }, { iconKey: "wow:../x" }, { iconKey: "" },
        ] });
        expect(r.board.icons.map((i) => i.iconKey)).toEqual(["boss:609", "wow:spell_fire_fireball", "enemy", "bosspos"]);
        expect(r.board.icons[0]).toMatchObject({ label: "Illidan", size: 192, rotation: 40, showLabel: true, opacity: 1, lock: false, hidden: false });
        expect(r.board.icons[1].size).toBe(12);
        expect(r.board.icons[2]).toMatchObject({ size: 48, rotation: 0, showLabel: false });
        expect(r.dropped).toBe(3);
        expect(clean({ icons: Array.from({ length: 61 }, () => ({ iconKey: "enemy" })) }).code).toBe("invalid");
    });

    it("clamps the board's object scale to 0.5..2 and counts a changed one as content", () => {
        expect(clean({ objectScale: 1.5 }).board.objectScale).toBe(1.5);
        expect(clean({ objectScale: 9 }).board.objectScale).toBe(2);
        expect(clean({ objectScale: 0 }).board.objectScale).toBe(0.4);
        expect(clean({}).board.objectScale).toBe(1);
        expect(board.boardHasContent(clean({ objectScale: 1.2 }).board)).toBe(true);
        expect(board.boardHasContent(clean({ icons: [{ iconKey: "enemy" }] }).board)).toBe(true);
        expect(board.reidBoard({ icons: [{ id: "i" }] }).icons[0].id).not.toBe("i");
    });
});

describe("icon facing", () => {
    it("normalises the angle to 0..359 and keeps the label switch", () => {
        const r = clean({ icons: [
            { iconKey: "boss:1", rotation: -90 }, { iconKey: "boss:2", rotation: 360 }, { iconKey: "boss:3", rotation: 725.6 },
            { iconKey: "boss:4", rotation: "x" }, { iconKey: "enemy", rotation: 359, showLabel: "yes" },
        ] });
        expect(r.board.icons.map((i) => i.rotation)).toEqual([270, 0, 6, 0, 359]);
        expect(r.board.icons.map((i) => i.showLabel)).toEqual([false, false, false, false, false]);
    });
});

describe("group styles", () => {
    const { cleanGroupStyles } = require("../../src/web/raidplanBoard");
    it("keeps valid colours (lower case) and marks once, drops the rest", () => {
        const r = cleanGroupStyles({ 1: "#ABCDEF", 2: "red", 21: "#000000", x: "#000000" }, { 1: "skull", 2: "skull", 3: "star", 4: "banana" });
        expect(r).toEqual({ groupColors: { 1: "#abcdef" }, groupMarks: { 1: "skull", 3: "star" } });
        expect(cleanGroupStyles(null, undefined)).toEqual({ groupColors: {}, groupMarks: {} });
    });
});

describe("group styles for groups 10 to 20", () => {
    const { cleanGroupStyles } = require("../../src/web/raidplanBoard");
    it("keep the two-digit group numbers up to 20", () => {
        expect(cleanGroupStyles({ 10: "#112233", 19: "#445566", 20: "#778899" }, { 12: "moon" })).toEqual({ groupColors: { 10: "#112233", 19: "#445566", 20: "#778899" }, groupMarks: { 12: "moon" } });
    });
});

describe("ring switch and group scales", () => {
    const cleanBoard = (input) => clean(input);
    it("keeps `ring: false` on an object and stores nothing for a shown ring", () => {
        const r = cleanBoard({ tokens: [{ userId: "u1", x: 0.5, y: 0.5, ring: false }], zones: [{ type: "danger", shape: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2, ring: false }], icons: [{ iconKey: "enemy", x: 0.3, y: 0.3 }] }).board;
        expect(r.tokens[0].ring).toBe(false);
        expect(r.zones[0].ring).toBe(false);
        expect(r.icons[0].ring).toBeUndefined();
    });
    it("clamps the three group scales to 25 % .. 400 %, 100 % when missing, and leaves other slots at 1", () => {
        const r = cleanBoard({ slots: [{ kind: "group", n: 1, x: 0.5, y: 0.5, groupScale: 9, ringSpread: 0.01, tokenScale: "x" }, { kind: "tank", n: 1, x: 0.2, y: 0.2, groupScale: 3 }] }).board;
        expect(r.slots[0]).toMatchObject({ groupScale: 4, ringSpread: 0.25, tokenScale: 1 });
        expect(r.slots[1]).toMatchObject({ groupScale: 1, ringSpread: 1, tokenScale: 1 });
        expect(require("../../src/web/raidplanBoard").cleanFactor(1.234)).toBe(1.23);
    });
});

describe("saved default view", () => {
    const { cleanView } = require("../../src/web/raidplanBoard");
    it("keeps a zoom above 100 % (at most 400 %) with its centre inside the board, else nothing", () => {
        expect(cleanView({ zoom: 2.5, cx: 0.3, cy: 0.6 })).toEqual({ zoom: 2.5, cx: 0.3, cy: 0.6 });
        expect(cleanView({ zoom: 9, cx: 3, cy: -1 })).toEqual({ zoom: 4, cx: 1, cy: 0 });
        expect(cleanView({ zoom: 1, cx: 0.5, cy: 0.5 })).toBe(null);
        expect(cleanView({ zoom: 2, cx: "x", cy: 0.5 })).toBe(null);
        expect(cleanView(null)).toBe(null);
    });
    it("is part of the board and makes it non-empty", () => {
        const r = clean({ view: { zoom: 2, cx: 0.4, cy: 0.4 } });
        expect(r.board.view).toEqual({ zoom: 2, cx: 0.4, cy: 0.4 });
        expect(board.isEmptyBoard ? board.isEmptyBoard(r.board) : false).toBe(false);
        expect(clean({}).board.view).toBe(null);
    });
});
