// expectedRaiders (#658): who a raid of a category expects - the roster's core
// and trial members, else the holders of its raider roles.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/services/discord/discord", () => ({
    listMembersWithRoles: jest.fn(async () => ({ members: [], error: null })),
    listHumanMembers: jest.fn(async () => ({ members: [], error: null })),
}));

const fs = require("fs");
const rosterStore = require("../../../src/stores/rosterStore");
const discord = require("../../../src/services/discord/discord");
const { expectedRosterIds, hasExpected, listExpectedMembers, EXPECTED_STATUSES } = require("../../../src/services/roster/expectedRaiders");

const config = { categoryRoles: { c1: ["10"], c2: ["20"] } };
const U = { core: "111111111111111111", trial: "222222222222222222", bench: "333333333333333333", pause: "444444444444444444", gone: "555555555555555555" };

function rosterWithEveryStatus() {
    const r = rosterStore.createRoster({ name: "Donnerstag", guildId: "g1", categoryId: "c1", roleIds: ["99"] });
    rosterStore.upsertMember(r.id, U.core, { status: "core" });
    rosterStore.upsertMember(r.id, U.trial, { status: "trial" });
    rosterStore.upsertMember(r.id, U.bench, { status: "bench" });
    rosterStore.upsertMember(r.id, U.pause, { status: "pause" });
    rosterStore.upsertMember(r.id, U.gone, { status: "core" });
    return r;
}

beforeEach(() => {
    fs.__store.clear();
    jest.clearAllMocks();
});

describe("services/roster/expectedRaiders expectedRosterIds / hasExpected", () => {
    it("expects core and trial of the category's roster - not bench, not pause", () => {
        rosterWithEveryStatus();
        expect(EXPECTED_STATUSES).toEqual(["core", "trial"]);
        expect(expectedRosterIds("c1").sort()).toEqual([U.core, U.trial, U.gone].sort());
    });

    it("answers null without a roster, so the roles decide", () => {
        expect(expectedRosterIds("c2")).toBeNull();
        expect(expectedRosterIds("")).toBeNull();
    });

    it("a roster (even an empty one) or raider roles mean somebody is expected", () => {
        rosterStore.createRoster({ name: "Leer", guildId: "g1", categoryId: "c3", roleIds: [] });
        expect(hasExpected("c3", {})).toBe(true);
        expect(hasExpected("c2", config)).toBe(true);
        expect(hasExpected("c9", config)).toBe(false);
    });
});

describe("services/roster/expectedRaiders listExpectedMembers", () => {
    it("lists the roster's core + trial members with their Discord names and drops who left the server", async () => {
        rosterWithEveryStatus();
        discord.listHumanMembers.mockResolvedValueOnce({
            members: [{ id: U.core, displayName: "Zibbo" }, { id: U.trial, displayName: "Anna" }, { id: U.bench, displayName: "Bank" }],
            error: null,
        });
        const res = await listExpectedMembers("g1", "c1", config);
        expect(res.source).toBe("roster");
        expect(res.error).toBeNull();
        expect(res.members).toEqual([{ id: U.trial, displayName: "Anna" }, { id: U.core, displayName: "Zibbo" }]);
        expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
    });

    it("keeps every core + trial member, named by id, when the member list cannot be read", async () => {
        rosterWithEveryStatus();
        discord.listHumanMembers.mockResolvedValueOnce({ members: [], error: "intent" });
        const res = await listExpectedMembers("g1", "c1", config);
        expect(res.members.map((m) => m.id).sort()).toEqual([U.core, U.trial, U.gone].sort());
        expect(res.members.every((m) => m.displayName === m.id)).toBe(true);
        discord.listHumanMembers.mockRejectedValueOnce(new Error("boom"));
        expect((await listExpectedMembers("g1", "c1", config)).members).toHaveLength(3);
    });

    it("falls back to the role holders without a roster, and to nobody without roles", async () => {
        discord.listMembersWithRoles.mockResolvedValueOnce({ members: [{ id: "7", displayName: "Rolle" }], error: null });
        expect(await listExpectedMembers("g1", "c2", config)).toEqual({ members: [{ id: "7", displayName: "Rolle" }], error: null, roleIds: ["20"], source: "roles" });
        expect(discord.listMembersWithRoles).toHaveBeenCalledWith("g1", ["20"]);
        discord.listMembersWithRoles.mockResolvedValueOnce({ members: [], error: "intent" });
        expect((await listExpectedMembers("g1", "c2", config)).error).toBe("intent");
        expect(await listExpectedMembers("g1", "c9", config)).toEqual({ members: [], error: null, roleIds: [], source: null });
    });
});
