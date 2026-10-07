// Who is in an event's setup editor and what they just did (setupPresence.js): in
// memory, a heartbeat with a TTL, a soft hold on a raider, and the activity the
// other editors show ("Taccop hat Cherrylol in Gruppe 2 gesetzt").
const presence = require("../../../src/services/setup/setupPresence");

const EXITUS = { id: "u-ex", name: "Exitus" };
const TACCOP = { id: "u-ta", name: "Taccop" };
const T0 = 1_000_000;

const lineup = (groups, bench = []) => ({
    groups: groups.map((slots, i) => ({ index: i + 1, slots: slots.map(([userId, character]) => ({ userId, character })) })),
    bench: bench.map(([userId, character]) => ({ userId, character })),
});

beforeEach(() => presence._resetForTests());

describe("who is in the editor", () => {
    it("lists the others with what they hold, and forgets them after the TTL or on leaving", () => {
        presence.beat("eh-1", EXITUS, { action: { kind: "drag", userId: "u1" }, now: T0 });
        presence.beat("eh-1", TACCOP, { now: T0 + 1000 });
        expect(presence.editorsOf("eh-1", { exceptUserId: "u-ta", now: T0 + 2000 })).toEqual([
            { userId: "u-ex", name: "Exitus", action: { kind: "drag", userId: "u1" } },
        ]);
        expect(presence.editorsOf("eh-1", { now: T0 + 2000 }).map((e) => e.name)).toEqual(["Exitus", "Taccop"]);
        // another event knows nothing of it
        expect(presence.editorsOf("eh-2", { now: T0 })).toEqual([]);
        presence.leave("eh-1", "u-ta");
        expect(presence.editorsOf("eh-1", { now: T0 + 2000 }).map((e) => e.name)).toEqual(["Exitus"]);
        // no heartbeat for longer than the TTL: gone
        presence.beat("eh-1", TACCOP, { now: T0 + 1000 });
        expect(presence.editorsOf("eh-1", { now: T0 + presence.PRESENCE_TTL_MS + 500 }).map((e) => e.name)).toEqual(["Taccop"]);
    });

    it("keeps only a known action from the page", () => {
        expect(presence.cleanAction({ kind: "edit", userId: "u2" })).toEqual({ kind: "edit", userId: "u2" });
        expect(presence.cleanAction({ kind: "delete", userId: "u2" })).toBeNull();
        expect(presence.cleanAction({ kind: "drag", userId: "" })).toBeNull();
        expect(presence.cleanAction({ kind: "drag", userId: "x".repeat(60) })).toBeNull();
        expect(presence.cleanAction("drag")).toBeNull();
        presence.beat("eh-1", EXITUS, { action: { kind: "nope" }, now: T0 });
        expect(presence.editorsOf("eh-1", { now: T0 })[0].action).toBeNull();
    });
});

describe("what changed", () => {
    it("records one entry per raider who went somewhere else, with the character", () => {
        const before = lineup([[["u1", "Cosma"]], []], [["u3", "Hypnos"]]);
        const after = lineup([[["u1", "Cosma"]], [["u2", "Cherrylol"]]], []);
        const moves = presence.recordMoves("eh-1", before, after, { by: "u-ta", byName: "Taccop", names: { u3: "Hypnos" }, now: T0 });
        expect(moves).toEqual([
            { userId: "u3", character: "Hypnos", to: { pool: true } },
            { userId: "u2", character: "Cherrylol", to: { group: 2 } },
        ]);
        const log = presence.activityOf("eh-1", { now: T0 });
        expect(log.map((e) => [e.kind, e.byName, e.character, e.to])).toEqual([
            ["move", "Taccop", "Hypnos", { pool: true }],
            ["move", "Taccop", "Cherrylol", { group: 2 }],
        ]);
        // only what came after the last id the page has
        expect(presence.activityOf("eh-1", { since: log[0].id, now: T0 }).map((e) => e.character)).toEqual(["Cherrylol"]);
    });

    it("says a move onto the bench, nothing for a raider who stayed, and one line for many moves", () => {
        expect(presence.recordMoves("eh-1", lineup([[["u1", "A"]]]), lineup([[["u1", "A"]]]), { now: T0 })).toEqual([]);
        presence.recordMoves("eh-1", lineup([[["u1", "A"]]]), lineup([[]], [["u1", "A"]]), { by: "x", byName: "X", now: T0 });
        expect(presence.activityOf("eh-1", { now: T0 })[0].to).toEqual({ bench: true });
        presence._resetForTests();
        const many = lineup([Array.from({ length: 5 }, (_, i) => [`u${i}`, `R${i}`])]);
        presence.recordMoves("eh-1", null, many, { by: "x", byName: "X", now: T0 });
        expect(presence.activityOf("eh-1", { now: T0 })).toEqual([
            expect.objectContaining({ kind: "many", count: 5, userIds: ["u0", "u1", "u2", "u3", "u4"] }),
        ]);
    });

    it("keeps notes, drops what is older than ten minutes and keeps at most twenty lines", () => {
        presence.recordNote("eh-1", "fill", { by: "u-ex", byName: "Exitus", count: 10, now: T0 });
        expect(presence.activityOf("eh-1", { now: T0 })[0]).toMatchObject({ kind: "fill", count: 10, byName: "Exitus" });
        expect(presence.activityOf("eh-1", { now: T0 + 11 * 60 * 1000 })).toEqual([]);
        for (let i = 0; i < 30; i++) presence.recordNote("eh-2", "post", { by: "u", byName: "U", now: T0 + i });
        expect(presence.activityOf("eh-2", { now: T0 + 40 })).toHaveLength(presence.ACTIVITY_MAX);
    });
});
