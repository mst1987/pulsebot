// kaderRoster (#657): the one door from the Kaderplaner to the rosters - who, in
// which state, the decision and the active character's name, nothing private.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const kaderStore = require("../../../src/stores/kaderStore");
const { rosterPlayers, kaderSummaries, ROSTER_STATES } = require("../../../src/services/kader/kaderRoster");

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
        expect(kaderSummaries("g1")).toEqual([{ id: "k1", name: "Forever 2027", inRoster: 1, candidates: 3, attendanceCategories: [] }]);
        expect(kaderSummaries("g2")).toEqual([]);
    });
});
