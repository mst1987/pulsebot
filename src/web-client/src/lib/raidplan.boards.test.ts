// Raidplan boards: roles and clamping, empty boards, task rows and tactic profiles.
// The board logic behind the editors (lib/raidplan.ts) runs for real.
import { describe, expect, it } from "vitest";
import * as lib from "./raidplan";

const player = (userId, role = "dps") => ({ userId, character: userId, classId: "", className: "", classColor: "", spec: "", specLabel: "", role, iconUrl: "", group: 1 });
const board = (extra = {}) => ({ ...lib.emptyBoard(), ...extra });
const profile = (extra = {}) => ({ id: "p1", name: "Tanks", category: "Tank", bossKey: "", targets: [{ title: "Main-Tank" }, { title: "Off-Tank" }], notes: "", updatedAt: 0, ...extra });
const look = (extra = {}) => ({ opacity: 1, lock: false, hidden: false, ...extra });

describe("roles and clamping", () => {
    it("tells tank, healer, melee and ranged apart and files everything else as any damage", () => {
        for (const r of ["tank", "healer", "melee", "ranged"]) expect(lib.roleTone(r)).toBe(r);
        for (const r of ["dps", "", "whatever"]) expect(lib.roleTone(r)).toBe("dps");
    });

    it("clamps a coordinate to 0..1 and treats junk as 0", () => {
        expect(lib.clamp01(-2)).toBe(0);
        expect(lib.clamp01(3)).toBe(1);
        expect(lib.clamp01(0.4)).toBe(0.4);
        expect(lib.clamp01(NaN)).toBe(0);
    });

    it("clamps an opacity to 0.1..1 and falls back for junk", () => {
        expect(lib.clampOpacity(0, 1)).toBe(0.1);
        expect(lib.clampOpacity(7, 1)).toBe(1);
        expect(lib.clampOpacity(0.456, 1)).toBe(0.46);
        expect(lib.clampOpacity(NaN, 0.3)).toBe(0.3);
    });
});

describe("boards", () => {
    it("completes the board of an untouched boss", () => {
        expect(lib.boardOf({}, "bt/supremus")).toEqual({ tokens: [], slots: [], marks: [], icons: [], zones: [], lines: [], texts: [], targets: [], assignments: [], steps: [], showMap: true, autoPlace: true, autoPos: {}, autoStyle: {}, autoScale: 1, mobs: [], hiddenCards: [], inheritOff: [], showRings: true, inSheet: true, groupColors: {}, groupMarks: {}, showNames: true, showBadges: true, showRoleRings: true, view: null, counts: null, roles: {}, notes: "", profileId: "", mapOpacity: 1, objectScale: 1 });
        expect(lib.boardOf({ "bt/supremus": { notes: "x" } }, "bt/supremus")).toMatchObject({ notes: "x", tokens: [] });
        expect(lib.boardOf({ a: { mapOpacity: 0.4 } }, "a").mapOpacity).toBe(0.4);
    });

    it("lists who is not placed yet, in setup order", () => {
        const roster = [player("a"), player("b"), player("c")];
        expect(lib.unplaced(roster, board({ tokens: [{ userId: "b", x: 0.5, y: 0.5, ...look() }] })).map((p) => p.userId)).toEqual(["a", "c"]);
    });

    it("places a token once and moves it afterwards, clamped to the board, keeping its look", () => {
        let b = lib.placeToken(board(), "a", 0.3, 0.6);
        expect(b.tokens).toEqual([{ userId: "a", x: 0.3, y: 0.6, size: 38, opacity: 1, lock: false, hidden: false }]);
        b = lib.patchLook(b, "token", "a", { opacity: 0.4 });
        b = lib.placeToken(b, "a", 1.4, -0.2);
        expect(b.tokens).toEqual([{ userId: "a", x: 1, y: 0, size: 38, opacity: 0.4, lock: false, hidden: false }]);
        b = lib.placeToken(b, "b", 0.1, 0.1);
        expect(b.tokens.map((t) => t.userId)).toEqual(["a", "b"]);
    });

    it("takes a token off without touching the rows and nudges within the board", () => {
        const b = board({ tokens: [{ userId: "a", x: 0.5, y: 0.5, ...look() }], targets: [{ id: "r", title: "MT", userIds: ["a"] }] });
        expect(lib.removeToken(b, "a").tokens).toEqual([]);
        expect(lib.removeToken(b, "a").targets[0].userIds).toEqual(["a"]);
        expect(lib.nudgeObject(b, "token", "a", 0.01, -0.01).tokens[0]).toMatchObject({ userId: "a", x: 0.51, y: 0.49 });
        expect(lib.nudgeObject(lib.placeToken(b, "a", 0.999, 0), "token", "a", 0.05, -0.05).tokens[0]).toMatchObject({ x: 1, y: 0 });
        expect(lib.nudgeObject(b, "token", "nobody", 0.1, 0.1)).toBe(b);
    });

    it("counts objects and rows for the boss chips", () => {
        const bosses = { a: { tokens: [{ userId: "x", x: 0, y: 0 }], targets: [{ id: "1", title: "t", userIds: [] }], lines: [{ id: "l" }], texts: [{ id: "x" }] } };
        expect(lib.boardCount(bosses, "a")).toBe(4);
        expect(lib.boardCount(bosses, "b")).toBe(0);
    });

    it("compares what a save would carry, not the incidental shape", () => {
        const keys = ["a", "b"];
        expect(lib.sameBosses({}, { a: undefined }, keys)).toBe(true);
        expect(lib.sameBosses({ a: { notes: "x" } }, { a: { notes: "x", tokens: [], targets: [], profileId: "" } }, keys)).toBe(true);
        expect(lib.sameBosses({ a: { notes: "x" } }, { a: { notes: "y" } }, keys)).toBe(false);
        expect(lib.sameBosses({ a: { mapOpacity: 0.5 } }, { a: {} }, keys)).toBe(false);
        // a boss the event does not have is not part of the save
        expect(lib.sameBosses({ gone: { notes: "x" } }, {}, keys)).toBe(true);
        expect(Object.keys(lib.toSave({ a: { notes: "x" }, gone: { notes: "y" } }, keys))).toEqual(["a"]);
    });
});

describe("task rows", () => {
    it("old target rows are read as assignments: the title is the task, the players do it, nothing is invented", () => {
        const r = lib.boardOf({ k: { targets: [{ id: "r1", title: "Main-Tank", userIds: ["u1", "u2"] }, { id: "r2", title: "Kick", userIds: [] }], assignments: [{ id: "a1", type: "heal", assignees: ["slot:healer:1"], targets: [], note: "", suggested: false }] } }, "k");
        expect(r.targets).toEqual([]);
        expect(r.assignments.map((x) => [x.id, x.type, x.title, x.assignees])).toEqual([["r1", "other", "Main-Tank", ["user:u1", "user:u2"]], ["r2", "other", "Kick", []], ["a1", "heal", "", ["slot:healer:1"]]]);
        // reading it again gives the same (nothing changes until it is edited)
        expect(lib.boardOf({ k: r }, "k")).toEqual(r);
    });

    it("gives every new row its own id", () => {
        expect(new Set(Array.from({ length: 50 }, () => lib.newRowId())).size).toBe(50);
    });
});

describe("tactic profiles", () => {
    it("asks first only when the board holds something", () => {
        expect(lib.hasContent(board())).toBe(false);
        expect(lib.hasContent(board({ notes: "  " }))).toBe(false);
        expect(lib.hasContent(board({ notes: "x" }))).toBe(true);
        expect(lib.hasContent(board({ assignments: [{ id: "a", type: "other", title: "a", assignees: [], targets: [], note: "", suggested: false }] }))).toBe(true);
        expect(lib.hasContent(board({ mapOpacity: 0.5 }))).toBe(true);
    });

    it("applies a profile: its titles become rows, the profile id is kept, typed assignments and players on rows whose title stays are kept", () => {
        const row = (id, type, title, assignees = []) => ({ id, type, title, assignees, targets: [], note: "", suggested: false });
        const b = board({
            tokens: [{ userId: "a", x: 0.5, y: 0.5, ...look() }],
            assignments: [row("keep", "other", "main-tank", ["user:u1"]), row("old", "other", "Something else", ["user:u2"]), row("heal", "heal", "", ["slot:healer:1"])],
            notes: "mine",
        });
        const r = lib.applyProfile(b, profile());
        expect(r.profileId).toBe("p1");
        expect(r.assignments.map((x) => x.title)).toEqual(["", "Main-Tank", "Off-Tank"]);
        expect(r.assignments[0]).toMatchObject({ id: "heal", type: "heal" });
        expect(r.assignments[1]).toMatchObject({ id: "keep", assignees: ["user:u1"] });
        expect(r.assignments[2].assignees).toEqual([]);
        expect(r.tokens).toEqual(b.tokens);
        expect(r.notes).toBe("mine");
        expect(lib.applyProfile(b, profile({ notes: "phase 1" })).notes).toBe("phase 1");
    });

    it("saves only the task titles as a profile", () => {
        const row = (title) => ({ id: title, type: "other", title, assignees: ["user:u1"], targets: [], note: "", suggested: false });
        expect(lib.profileRows(board({ assignments: [row(" MT "), row("  ")] }))).toEqual([{ title: "MT" }]);
    });

    it("offers the profiles for every boss, the boss's instance or exactly this boss", () => {
        const all = profile({ id: "all" });
        const inst = profile({ id: "inst", bossKey: "bt" });
        const here = profile({ id: "here", bossKey: "bt/supremus" });
        const other = profile({ id: "other", bossKey: "bt/illidan-stormrage" });
        const elsewhere = profile({ id: "kara", bossKey: "kara" });
        expect(lib.profilesFor([all, inst, here, other, elsewhere], "bt/supremus").map((p) => p.id)).toEqual(["all", "inst", "here"]);
    });

    it("groups by category, filtered by a search, with the uncategorised last", () => {
        const ps = [profile({ id: "1", name: "Zeta", category: "Tank" }), profile({ id: "2", name: "Alpha", category: "" }), profile({ id: "3", name: "Beta", category: "Heiler" })];
        expect(lib.groupProfiles(ps, "").map((g) => g.category)).toEqual(["Heiler", "Tank", ""]);
        expect(lib.groupProfiles(ps, "  ZETA ").map((g) => g.profiles.map((p) => p.id))).toEqual([["1"]]);
        expect(lib.groupProfiles(ps, "heil").map((g) => g.profiles[0].id)).toEqual(["3"]);
        expect(lib.groupProfiles(ps, "nothing")).toEqual([]);
    });

    it("looks players up by userId", () => {
        const m = lib.rosterMap([player("a"), player("b")]);
        expect(m.get("b").userId).toBe("b");
        expect(m.get("zzz")).toBeUndefined();
    });
});
