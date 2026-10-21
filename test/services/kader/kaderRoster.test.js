// kaderRoster (#657): the one door from the Kaderplaner to the rosters - who, in
// which state, the decision and the active character's name, nothing private.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const kaderStore = require("../../../src/stores/kaderStore");
const kaderRoster = require("../../../src/services/kader/kaderRoster");
const { rosterPlayers, kaderSummaries, ROSTER_STATES } = kaderRoster;

const U = { a: "111111111111111111", b: "222222222222222222", c: "333333333333333333", d: "444444444444444444" };
const SECRET = "GEHEIM-Antwort";

/** A planner with every private field filled, so a leak shows up in the answer. */
function plannerWithSecrets() {
    const entry = (state, extra = {}) => ({
        state,
        since: "2026-10-01T10:00:00.000Z",
        by: U.d,
        wishes: [{ className: "Mage", spec: "Mage-Frost" }],
        interview: { lead: U.d, answers: { q1: SECRET }, note: `${SECRET} Notiz` },
        votes: { [U.d]: "yes" },
        comments: [{ id: "c1", by: U.d, at: "2026-10-01T10:00:00.000Z", text: `${SECRET} Kommentar` }],
        history: [{ at: "2026-10-01T10:00:00.000Z", by: U.d, type: "added" }],
        ...extra,
    });
    return {
        v: 2,
        accounts: [],
        assignments: {
            [U.a]: { characters: [{ id: "x1", name: "Aldric Sturmwind", className: "Warrior", specs: [{ spec: "Warrior-Fury", main: true }] }, { id: "x2", name: "Zweit Name", className: "Mage", specs: [] }], activeCharacterId: "x2" },
        },
        kaders: [{
            id: "k1",
            name: "Forever 2027",
            leads: [U.d],
            questions: [{ id: "q1", text: "Frage?", type: "text", options: [] }],
            players: {
                [U.a]: entry("roster", { decision: { className: "Mage", spec: "Mage-Frost" } }),
                [U.b]: entry("bench"),
                [U.c]: entry("tentative"),
                [U.d]: entry("pool"),
            },
            // the composition draft ("Planspiel") stays in the planner, too
            plan: { specs: { [U.b]: { className: "Mage", spec: "Mage-Frost" } }, excluded: [U.c], by: "PLANSPIEL-Autor", at: "2026-10-02T10:00:00.000Z" },
        }],
    };
}

beforeEach(() => {
    fs.__store.clear();
    kaderStore.writePlanner("g1", plannerWithSecrets());
});

describe("services/kader/kaderRoster rosterPlayers", () => {
    it("answers only the players a roster takes, with four fields each", () => {
        const kader = rosterPlayers("g1", "k1");
        expect(kader).toEqual({
            id: "k1",
            name: "Forever 2027",
            versionId: "forever",
            players: [
                { userId: U.a, state: "roster", decision: { className: "Mage", spec: "Mage-Frost" }, characterName: "Zweit Name" },
                { userId: U.b, state: "bench", decision: null, characterName: "" },
                { userId: U.c, state: "tentative", decision: null, characterName: "" },
            ],
        });
        for (const p of kader.players) expect(Object.keys(p).sort()).toEqual(["characterName", "decision", "state", "userId"]);
    });

    it("lets nothing private through: no wish, answer, note, vote or comment", () => {
        const text = JSON.stringify(rosterPlayers("g1", "k1"));
        expect(text).not.toContain(SECRET);
        for (const word of ["wishes", "interview", "votes", "comments", "history", "Mage-Frost\"}]"]) expect(text).not.toContain(word);
    });

    it("keeps the composition draft inside the planner: neither a planned spec nor a left-out player reaches a roster", () => {
        expect(kaderStore.readPlanner("g1").kaders[0].plan).toMatchObject({ excluded: [U.c], by: "PLANSPIEL-Autor" });
        const kader = rosterPlayers("g1", "k1");
        const text = JSON.stringify(kader);
        for (const word of ["plan", "excluded", "PLANSPIEL"]) expect(text).not.toContain(word);
        // b's planned Mage-Frost is no decision, c is still in the roster list
        expect(kader.players.find((p) => p.userId === U.b).decision).toBeNull();
        expect(kader.players.map((p) => p.userId)).toContain(U.c);
        expect(JSON.stringify(kaderSummaries("g1"))).not.toContain("PLANSPIEL");
    });

    it("answers null for an unknown Kader or server", () => {
        expect(rosterPlayers("g1", "nope")).toBeNull();
        expect(rosterPlayers("g2", "k1")).toBeNull();
    });

    it("takes roster, bench and tentative", () => {
        expect(ROSTER_STATES).toEqual(["roster", "bench", "tentative"]);
    });
});

describe("services/kader/kaderRoster kaderSummaries", () => {
    it("counts only", () => {
        expect(kaderSummaries("g1")).toEqual([{ id: "k1", name: "Forever 2027", versionId: "forever", inRoster: 1, candidates: 3, attendanceCategories: [], takenOver: false }]);
        expect(kaderSummaries("g2")).toEqual([]);
    });
});

describe("services/kader/kaderRoster takeover", () => {
    const save = () => kaderRoster.saveTakeover("g1", "k1", { rosterId: "r1", roleId: "role1", roleName: "Raider", categoryId: "c1", channelIds: ["ch1"] }, { actor: "o1" });
    const kader = () => kaderStore.readPlanner("g1").kaders[0];

    it("takes provisional upwards and lets nothing private through", () => {
        const p = kaderStore.readPlanner("g1");
        p.kaders[0].players[U.d].state = "provisional";
        kaderStore.writePlanner("g1", p);
        const t = kaderRoster.takeoverPlayers("g1", "k1");
        expect(t.players.map((x) => x.userId)).toEqual([U.a, U.b, U.c, U.d]);
        expect(t).toMatchObject({ rev: 0, takeover: null, pending: [] });
        expect(JSON.stringify(t)).not.toContain(SECRET);
        expect(kaderRoster.takeoverPlayers("g1", "nope")).toBeNull();
    });

    it("records a takeover once, with one activity line", () => {
        const stored = save();
        expect(stored.takeover).toMatchObject({ rosterId: "r1", roleId: "role1", by: "o1", status: "running", results: {} });
        expect(stored.rev).toBe(1);
        expect(stored.activity.slice(-1)[0]).toMatchObject({ type: "takeover", by: "o1" });
        expect(save).toThrow(expect.objectContaining({ status: 409 }));
        expect(kaderRoster.saveTakeover("g1", "nope", {})).toBeNull();
    });

    it("refuses a takeover confirmed on an older rev", () => {
        save();
        const t = kaderRoster.takeoverPlayers("g1", "k1");
        expect(() => kaderRoster.assertTakeoverFresh(t, { baseRev: 0 })).toThrow(expect.objectContaining({ code: "stale", status: 409 }));
        expect(() => kaderRoster.assertTakeoverFresh(t, { baseRev: 1 })).not.toThrow();
    });

    it("finishes with the results, history lines and a counted activity line; pending is the rest", () => {
        save();
        kaderRoster.finishTakeover("g1", "k1", { [U.a]: "ok", [U.b]: "ok", [U.c]: "missing" }, { actor: "o1" });
        expect(kader().takeover).toMatchObject({ status: "done", results: { [U.a]: "ok", [U.b]: "ok", [U.c]: "missing" } });
        expect(kader().activity.slice(-1)[0]).toMatchObject({ type: "role_given", count: 2 });
        expect(kader().players[U.a].history.slice(-1)[0]).toMatchObject({ type: "role_given", by: "o1" });
        expect(kaderRoster.pendingOf(kader())).toEqual([U.c]);
        kaderRoster.markRoleGiven("g1", "k1", { [U.c]: "ok" }, { actor: "o1" });
        expect(kader().activity.slice(-1)[0]).toMatchObject({ type: "role_given", playerId: U.c });
        expect(kaderRoster.pendingOf(kader())).toEqual([]);
        expect(kaderRoster.pendingOf(null)).toEqual([]);
    });

    it("does nothing without a takeover", () => {
        kaderRoster.finishTakeover("g1", "k1", { [U.a]: "ok" });
        kaderRoster.markRoleGiven("g1", "k1", { [U.a]: "ok" });
        expect(kader().takeover).toBeNull();
        expect(kaderRoster.backToProvisional("g1", "k1", U.a)).toBe(false);
    });

    it("back to provisional once; a pool player is left alone", () => {
        save();
        expect(kaderRoster.backToProvisional("g1", "k1", U.b, { actor: "discord" })).toBe(true);
        expect(kader().players[U.b]).toMatchObject({ state: "provisional", by: "discord" });
        expect(kader().players[U.b].history.slice(-1)[0]).toMatchObject({ type: "role_removed_discord", from: "bench", to: "provisional" });
        expect(kaderRoster.backToProvisional("g1", "k1", U.b)).toBe(false);
        expect(kaderRoster.backToProvisional("g1", "k1", U.d)).toBe(false);
    });

    it("back to provisional writes exactly one activity line (no extra state line)", () => {
        save();
        const before = kader().activity.length;
        kaderRoster.backToProvisional("g1", "k1", U.a, { actor: "" });
        const added = kader().activity.slice(before);
        expect(added.map((a) => [a.type, a.playerId])).toEqual([["role_removed_discord", U.a]]);
    });

    it("stillPlanned: only takeover states, not removed, only after a takeover", () => {
        expect(kaderRoster.stillPlanned("g1", "k1", U.a)).toBe(false);
        save();
        expect(kaderRoster.stillPlanned("g1", "k1", U.a)).toBe(true);
        expect(kaderRoster.stillPlanned("g1", "k1", U.d)).toBe(false);
        expect(kaderRoster.stillPlanned("g1", "k1", "999")).toBe(false);
        expect(kaderRoster.stillPlanned("g1", "nope", U.a)).toBe(false);
        kaderRoster.backToProvisional("g1", "k1", U.b);
        expect(kaderRoster.stillPlanned("g1", "k1", U.b)).toBe(false);
    });

    it("finish and nachziehen keep only results of players still planned and never overwrite removed", () => {
        save();
        kaderRoster.backToProvisional("g1", "k1", U.b);
        const p = kaderStore.readPlanner("g1");
        p.kaders[0].players[U.c].state = "pool";
        kaderStore.writePlanner("g1", p);
        kaderRoster.finishTakeover("g1", "k1", { [U.a]: "ok", [U.b]: "ok", [U.c]: "ok", [U.d]: "ok" }, { actor: "o1" });
        expect(kader().takeover.results).toEqual({ [U.a]: "ok", [U.b]: "removed" });
        expect(kader().activity.slice(-1)[0]).toMatchObject({ type: "role_given", playerId: U.a });
        expect(kader().players[U.c].history.map((h) => h.type)).not.toContain("role_given");
        kaderRoster.markRoleGiven("g1", "k1", { [U.b]: "ok" });
        expect(kader().takeover.results[U.b]).toBe("removed");
    });

    it("nachziehen ends a takeover a restart broke off", () => {
        save();
        expect(kader().takeover.status).toBe("running");
        kaderRoster.markRoleGiven("g1", "k1", { [U.a]: "ok" }, { actor: "o1" });
        expect(kader().takeover.status).toBe("done");
        expect(kaderRoster.markRoleGiven("g1", "nope", {})).toBeNull();
    });

    describe("role given in Discord", () => {
        it("does nothing before a takeover or for a player already planned", () => {
            expect(kaderRoster.roleGainedFromDiscord("g1", "k1", "999")).toBe(false);
            save();
            const rev = kader().rev;
            expect(kaderRoster.roleGainedFromDiscord("g1", "k1", U.a)).toBe(false);
            expect(kaderRoster.roleGainedFromDiscord("g1", "k1", "")).toBe(false);
            expect(kader().rev).toBe(rev);
        });

        it("a newcomer joins as provisional with history and one activity line", () => {
            save();
            const before = kader().activity.length;
            expect(kaderRoster.roleGainedFromDiscord("g1", "k1", "999", { name: "Neuling", now: "2026-10-21T10:00:00.000Z" })).toBe(true);
            const e = kader().players["999"];
            expect(e).toMatchObject({ name: "Neuling", state: "provisional", since: "2026-10-21T10:00:00.000Z" });
            expect(e.history).toEqual([expect.objectContaining({ type: "role_added_discord", to: "provisional" })]);
            expect(kader().takeover.results["999"]).toBe("ok");
            expect(kader().activity.slice(before).map((a) => [a.type, a.playerId])).toEqual([["role_added_discord", "999"]]);
            // not nachzuziehen, he has the role
            expect(kaderRoster.pendingOf(kader())).not.toContain("999");
            expect(kaderRoster.roleGainedFromDiscord("g1", "k1", "999")).toBe(false);
        });

        it("a pool player moves up to provisional", () => {
            save();
            expect(kaderRoster.roleGainedFromDiscord("g1", "k1", U.d)).toBe(true);
            expect(kader().players[U.d].state).toBe("provisional");
            expect(kader().players[U.d].history.slice(-1)[0]).toMatchObject({ type: "role_added_discord", from: "pool", to: "provisional" });
            // the private fields stay
            expect(kader().players[U.d].interview.note).toContain(SECRET);
        });

        it("a player marked removed who gets the role back only counts as having it", () => {
            save();
            kaderRoster.backToProvisional("g1", "k1", U.b);
            const lines = kader().activity.length;
            expect(kaderRoster.roleGainedFromDiscord("g1", "k1", U.b)).toBe(true);
            expect(kader().takeover.results[U.b]).toBe("ok");
            expect(kader().players[U.b].state).toBe("provisional");
            expect(kader().activity.length).toBe(lines);
        });

        it("respects the player limit", () => {
            save();
            const p = kaderStore.readPlanner("g1");
            for (let i = 0; i < 500; i += 1) p.kaders[0].players[`1000000000000${String(i).padStart(5, "0")}`] = { state: "pool" };
            kaderStore.writePlanner("g1", p);
            expect(kaderRoster.roleGainedFromDiscord("g1", "k1", "999")).toBe(false);
        });
    });

    it("drops nobody for a deleted Kader or one without a takeover", () => {
        const before = kaderStore.readPlanner("g1");
        expect(kaderRoster.takeoverDrops(before, { ...before, kaders: [] })).toEqual({ drops: [], lines: {} });
        const after = JSON.parse(JSON.stringify(before));
        after.kaders[0].players[U.a].state = "pool";
        expect(kaderRoster.takeoverDrops(before, after).drops).toEqual([]);
    });
});
