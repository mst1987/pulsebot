// One instance per raid ID: who already stands in another raid of the same
// instance and raid ID - and what the hint may say about it.
const mockEvents = [];
const mockCalls = [];
jest.mock("../../../src/stores/events/eventStore", () => ({
    listEvents: (guildId, opts) => {
        mockCalls.push({ guildId, opts });
        return mockEvents.map((e) => JSON.parse(JSON.stringify(e)));
    },
}));

const mockProfiles = {};
jest.mock("../../../src/stores/roster/raiderProfileStore", () => ({
    getProfile: (userId) => mockProfiles[userId] || { userId, characters: [] },
    firstCharacter: (profile, versionId) => (profile.characters || []).find((c) => !versionId || c.versionId === versionId) || null,
}));
jest.mock("../../../src/services/versions/mainVersion", () => ({ versionOfEvent: (e) => (e && e.versionId) || "tbc" }));

const { takenInRaidId, markLineup, takenKeysFor } = require("../../../src/services/setup/raidIdConflicts");
const { raidIdOf } = require("../../../src/utils/time/raidId");

// Wednesday 2026-12-09 20:00 Berlin and the days around it
const WED = Date.UTC(2026, 11, 9, 19, 0) / 1000;
const DAY = 86400;
const slot = (character, extra = {}) => ({ userId: `u-${character}`, character, spec: "s", role: "tank", ...extra });
const setupOf = (names, bench = []) => ({ groups: [{ index: 1, slots: names.map((n) => slot(n)) }], bench: bench.map((n) => slot(n)) });
const ev = (over = {}) => ({
    id: "eh-a", guildId: "g1", title: "Hyjal", status: "active", instanceIds: ["hyjal"], startTime: WED,
    raidGroupId: "", raidGroupIndex: 0, setup: null, ...over,
});

beforeEach(() => {
    mockEvents.length = 0;
    mockCalls.length = 0;
    for (const k of Object.keys(mockProfiles)) delete mockProfiles[k];
});

describe("takenInRaidId", () => {
    test("the same instance in the same ID counts with its details on the same server", () => {
        mockEvents.push(ev({ id: "eh-b", title: "Hyjal F", startTime: WED + 2 * DAY, setup: setupOf(["Thrall Hellscream"]) }));
        const taken = takenInRaidId(ev());
        expect(taken.get("thrall hellscream")).toEqual({ local: true, title: "Hyjal F", raidNo: 0, startTime: WED + 2 * DAY });
    });

    test("reads only the week around the raid from the store, across every server and with the further raids", () => {
        takenInRaidId(ev());
        expect(mockCalls).toHaveLength(1);
        expect(mockCalls[0].guildId).toBe("");
        expect(mockCalls[0].opts.siblings).toBe(true);
        expect(mockCalls[0].opts.untilSeconds - mockCalls[0].opts.sinceSeconds).toBeLessThanOrEqual(9 * DAY);
    });

    test("a past raid of the ID counts too (Tuesday after, Wednesday before)", () => {
        // the raid on Tuesday: the earlier raid of the week on Wednesday counts for it
        mockEvents.push(ev({ id: "eh-b", startTime: WED, setup: setupOf(["Jaina"]) }));
        expect(takenInRaidId(ev({ id: "eh-a", startTime: WED + 6 * DAY })).has("jaina")).toBe(true);
    });

    test("another raid ID does not count", () => {
        mockEvents.push(ev({ id: "eh-b", startTime: WED + 7 * DAY, setup: setupOf(["Jaina"]) }));
        mockEvents.push(ev({ id: "eh-c", startTime: WED - 1 * DAY, setup: setupOf(["Arthas"]) }));
        expect(raidIdOf((WED - DAY) * 1000)).not.toBe(raidIdOf(WED * 1000));
        expect(takenInRaidId(ev()).size).toBe(0);
    });

    test("another instance does not count, overlapping instance lists do", () => {
        mockEvents.push(ev({ id: "eh-b", instanceIds: ["bt"], setup: setupOf(["Jaina"]) }));
        mockEvents.push(ev({ id: "eh-c", instanceIds: ["bt", "hyjal"], setup: setupOf(["Arthas"]) }));
        const taken = takenInRaidId(ev());
        expect(taken.has("jaina")).toBe(false);
        expect(taken.has("arthas")).toBe(true);
    });

    test("an event without an instance neither counts nor is checked", () => {
        mockEvents.push(ev({ id: "eh-b", instanceIds: [], setup: setupOf(["Jaina"]) }));
        expect(takenInRaidId(ev()).size).toBe(0);
        expect(takenInRaidId(ev({ instanceIds: [] })).size).toBe(0);
        expect(mockCalls).toHaveLength(1);
    });

    test("the bench, the pool and empty slots of the other raid do not count", () => {
        mockEvents.push(ev({ id: "eh-b", setup: { ...setupOf(["Jaina"], ["Arthas"]), pool: [slot("Uther")], groups: [{ index: 1, slots: [slot("Jaina"), { userId: "x" }] }] } }));
        const taken = takenInRaidId(ev());
        expect([...taken.keys()]).toEqual(["jaina"]);
    });

    test("a slot without a character name plays the raider's first character of the raid's version", () => {
        mockProfiles.p1 = { userId: "p1", characters: [{ name: "Classicchar", versionId: "classic" }, { name: "Tbcchar", versionId: "tbc" }] };
        mockEvents.push(ev({ id: "eh-b", setup: { groups: [{ index: 1, slots: [{ userId: "p1", spec: "s", role: "tank" }] }] } }));
        expect([...takenInRaidId(ev()).keys()]).toEqual(["tbcchar"]);
    });

    test("a raid without a server is always foreign - even against an event without one", () => {
        mockEvents.push(ev({ id: "eh-b", guildId: "", setup: setupOf(["Jaina"]) }));
        expect(takenInRaidId(ev({ guildId: "" })).get("jaina")).toEqual({ other: true });
        expect(takenInRaidId(ev()).get("jaina")).toEqual({ other: true });
        mockEvents[0].guildId = "g1";
        expect(takenInRaidId(ev({ guildId: "" })).get("jaina")).toEqual({ other: true });
    });

    test("signed up as Ersatz without a place is no conflict - only a group slot is", () => {
        // the other raid has no setup at all: its signups never count
        mockEvents.push(ev({ id: "eh-b", setup: null }));
        expect(takenInRaidId(ev()).size).toBe(0);
    });

    test("a cancelled raid does not count, the raid itself never", () => {
        mockEvents.push(ev({ id: "eh-b", status: "cancelled", setup: setupOf(["Jaina"]) }));
        mockEvents.push(ev({ id: "eh-a", setup: setupOf(["Arthas"]) }));
        expect(takenInRaidId(ev()).size).toBe(0);
    });

    test("a raid of another server says only that there is one - no title, no id", () => {
        mockEvents.push(ev({ id: "eh-x", guildId: "g2", title: "Geheim", setup: setupOf(["Jaina"]) }));
        const hint = takenInRaidId(ev()).get("jaina");
        expect(hint).toEqual({ other: true });
        expect(JSON.stringify(hint)).not.toMatch(/eh-x|Geheim|g2/);
    });

    test("the own server's raid wins over a foreign one, the earlier raid over the later", () => {
        mockEvents.push(ev({ id: "eh-x", guildId: "g2", setup: setupOf(["Jaina"]) }));
        mockEvents.push(ev({ id: "eh-c", title: "Später", startTime: WED + 3 * DAY, setup: setupOf(["Jaina"]) }));
        mockEvents.push(ev({ id: "eh-b", title: "Früher", startTime: WED + DAY, setup: setupOf(["Jaina"]) }));
        expect(takenInRaidId(ev()).get("jaina").title).toBe("Früher");
    });

    test("the other raid of a raid group counts, with its raid number", () => {
        mockEvents.push(ev({ id: "eh-a2", raidGroupId: "eh-a", raidGroupIndex: 2, title: "Hyjal", setup: setupOf(["Jaina"]) }));
        const hint = takenInRaidId(ev({ raidGroupId: "eh-a", raidGroupIndex: 1 })).get("jaina");
        expect(hint).toMatchObject({ local: true, raidNo: 2 });
    });

    test("per character, not per person: another character of the same player is free", () => {
        mockEvents.push(ev({ id: "eh-b", setup: { groups: [{ index: 1, slots: [slot("Jaina", { userId: "p1" })] }] } }));
        const taken = takenInRaidId(ev());
        expect(taken.has("jaina")).toBe(true);
        expect(taken.has("arthas")).toBe(false);
    });

    test("excludeIds leaves raids out", () => {
        mockEvents.push(ev({ id: "eh-b", setup: setupOf(["Jaina"]) }));
        expect(takenInRaidId(ev(), { excludeIds: ["eh-b"] }).size).toBe(0);
    });

    test("no event, no start: nothing taken", () => {
        expect(takenInRaidId(null).size).toBe(0);
        expect(takenInRaidId(ev({ startTime: 0 })).size).toBe(0);
    });
});

describe("markLineup", () => {
    const taken = new Map([["jaina", { other: true }], ["arthas menethil", { local: true, title: "Hyjal F", raidNo: 1, startTime: WED }]]);

    test("marks slots, bench, pool and the character choices", () => {
        const lineup = {
            groups: [{ index: 1, slots: [slot("Jaina"), slot("Uther")] }],
            bench: [slot("Arthas Menethil")],
            pool: [{ ...slot("Uther"), characters: [{ character: "Uther" }, { character: "Jaina" }] }],
        };
        const out = markLineup(lineup, taken);
        expect(out.groups[0].slots[0].raidIdTaken).toEqual({ other: true });
        expect(out.groups[0].slots[1].raidIdTaken).toBeUndefined();
        expect(out.bench[0].raidIdTaken).toMatchObject({ title: "Hyjal F" });
        expect(out.pool[0].raidIdTaken).toBeUndefined();
        expect(out.pool[0].characters[1].raidIdTaken).toEqual({ other: true });
        expect(out.pool[0].characters[0].raidIdTaken).toBeUndefined();
    });

    test("leaves the lineup alone when nothing is taken", () => {
        const lineup = { groups: [], bench: [], pool: [] };
        expect(markLineup(lineup, new Map())).toBe(lineup);
        expect(markLineup(null, taken)).toBeNull();
    });
});

describe("takenKeysFor", () => {
    test("per raid the keys to leave out - the raids planned together do not count against each other", () => {
        mockEvents.push(ev({ id: "eh-a", setup: setupOf(["Uther"]) }));
        mockEvents.push(ev({ id: "eh-a2", raidGroupId: "eh-a", raidGroupIndex: 2, setup: setupOf(["Arthas"]) }));
        mockEvents.push(ev({ id: "eh-b", setup: setupOf(["Jaina"]) }));
        const out = takenKeysFor([ev({ id: "eh-a" }), ev({ id: "eh-a2" })]);
        expect(out).toEqual({ "eh-a": ["jaina"], "eh-a2": ["jaina"] });
    });

    test("an empty object when nothing is taken", () => {
        expect(takenKeysFor([ev()])).toEqual({});
        expect(takenKeysFor([])).toEqual({});
    });
});
