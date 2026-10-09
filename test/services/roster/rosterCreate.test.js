// rosterCreate (#657): a new roster and its first members from one source -
// the role holders, a Kader, the last raids, or nobody.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/services/roster/rosterRoleSync", () => ({
    applyMemberAdded: jest.fn(async () => ({ ok: true, results: [{ roleId: "r", give: true, ok: true, code: "done", changed: true }] })),
    applyMemberRemoved: jest.fn(async () => ({ ok: true, results: [] })),
    applyStatusChange: jest.fn(async () => ({ ok: true, results: [] })),
}));
jest.mock("../../../src/services/discord/discord", () => ({
    isOnline: jest.fn(() => true),
    getGuild: jest.fn(() => ({ id: "g1" })),
    listMembersWithRoles: jest.fn(async () => ({ members: [], error: null })),
}));
jest.mock("../../../src/services/discord/categoryNames", () => ({
    listKnownCategories: jest.fn(() => [{ id: "700000000000000001", name: "Donnerstag Raid" }]),
}));
jest.mock("../../../src/services/characters/rosterAttendance", () => ({ buildAttendanceContext: jest.fn() }));

const fs = require("fs");
const rosterStore = require("../../../src/stores/rosterStore");
const raiderProfileStore = require("../../../src/stores/raiderProfileStore");
const kaderStore = require("../../../src/stores/kaderStore");
const configStore = require("../../../src/stores/configStore");
const discord = require("../../../src/services/discord/discord");
const rosterRoleSync = require("../../../src/services/roster/rosterRoleSync");
const { buildAttendanceContext } = require("../../../src/services/characters/rosterAttendance");
const {
    createRosterWithSource, createRosterFromKader, kaderChoices, presentInRaids, kaderCharacter,
    rosterOfKader, kaderRosterState, syncRosterFromKader,
} = require("../../../src/services/roster/rosterCreate");

const CAT = "700000000000000001";
const ROLE = "900000000000000001";
const TRIAL = "900000000000000002";
const U = { a: "111111111111111111", b: "222222222222222222", c: "333333333333333333", d: "444444444444444444" };
const SECRET = "GEHEIM";

function kaderPlanner() {
    const secret = { wishes: [{ className: "Mage", spec: "Mage-Frost" }], interview: { answers: { q1: SECRET }, note: SECRET }, votes: { [U.d]: "no" }, comments: [{ id: "c1", by: U.d, at: "x", text: SECRET }] };
    return {
        v: 2,
        accounts: [],
        assignments: { [U.b]: { characters: [{ id: "x1", name: "Handname", className: "Mage", specs: [] }], activeCharacterId: "x1" } },
        kaders: [{
            id: "k1",
            name: "Forever-Kader",
            leads: [U.d],
            questions: [{ id: "q1", text: "?", type: "text", options: [] }],
            players: {
                [U.a]: { state: "roster", decision: { className: "Priest", spec: "Priest-Holy" }, ...secret },
                [U.b]: { state: "bench", ...secret },
                [U.c]: { state: "tentative", ...secret },
                [U.d]: { state: "selected", ...secret },
            },
        }],
    };
}

beforeEach(() => {
    fs.__store.clear();
    jest.clearAllMocks();
    discord.isOnline.mockReturnValue(true);
    discord.getGuild.mockReturnValue({ id: "g1" });
    raiderProfileStore.addCharacter(U.a, { name: "Keslight", className: "Mage", specs: ["Mage-Frost"] });
    raiderProfileStore.addCharacter(U.a, { name: "Devi", className: "Priest", specs: ["Priest-Holy"] });
    raiderProfileStore.addCharacter(U.c, { name: "Brumm", className: "Warrior", specs: ["Warrior-Protection"] });
    kaderStore.writePlanner("g1", kaderPlanner());
});

describe("services/roster/rosterCreate settings", () => {
    it("creates a roster with the category's name and version, mirrors its roles, and marks the category migrated", async () => {
        const res = await createRosterWithSource({ categoryId: CAT, roleIds: [ROLE], slots: { total: 25, tank: 3, healer: 6 } }, { guildId: "g1", actor: "1" });
        expect(res.ok).toBe(true);
        expect(res.roster).toEqual(expect.objectContaining({ name: "Donnerstag Raid", guildId: "g1", categoryId: CAT, versionId: "tbc", roleIds: [ROLE], createdBy: "1", source: { kind: "manual" } }));
        expect(res.initial).toEqual({ source: "none", added: 0, skipped: 0, roleFailures: [], error: null });
        expect(configStore.getConfig().categoryRoles).toEqual({ [CAT]: [ROLE] });
        expect(rosterStore.normalizeFile(JSON.parse(fs.__store.get(rosterStore.ROSTERS_FILE))).migratedCategories).toContain(CAT);
    });

    it("refuses with a code: taken category, missing name, unknown source, source without what it needs", async () => {
        await createRosterWithSource({ categoryId: CAT }, { guildId: "g1" });
        const cases = [
            [{ categoryId: CAT }, "category_taken"],
            [{}, "invalid_name"],
            [{ name: "X", source: "magic" }, "invalid_source"],
            [{ name: "X", source: "role" }, "no_role"],
            [{ name: "X", source: "raids" }, "no_category"],
            [{ name: "X", source: "kader", kaderId: "nope" }, "kader_not_found"],
            [{ name: "X", versionId: "wotlk" }, "invalid_version"],
        ];
        for (const [input, code] of cases) expect({ input, code: (await createRosterWithSource(input, { guildId: "g1" })).code }).toEqual({ input, code });
    });

    it("answers the store's conflict as a code and passes other errors on", async () => {
        const spy = jest.spyOn(rosterStore, "createRoster").mockImplementationOnce(() => { throw new rosterStore.RosterError("category_taken"); });
        expect((await createRosterWithSource({ name: "X" }, { guildId: "g1" })).code).toBe("category_taken");
        spy.mockImplementationOnce(() => { throw new Error("disk"); });
        await expect(createRosterWithSource({ name: "X" }, { guildId: "g1" })).rejects.toThrow("disk");
        spy.mockRestore();
    });
});

describe("services/roster/rosterCreate source role", () => {
    it("takes every holder as core with the profile's first character and gives no role", async () => {
        discord.listMembersWithRoles.mockResolvedValueOnce({ members: [{ id: U.a, displayName: "A" }, { id: U.b, displayName: "B" }], error: null });
        const res = await createRosterWithSource({ name: "Raid", roleIds: [ROLE], source: "role" }, { guildId: "g1", actor: "1" });
        expect(discord.listMembersWithRoles).toHaveBeenCalledWith("g1", [ROLE]);
        expect(res.initial).toEqual(expect.objectContaining({ source: "role", added: 2, error: null }));
        expect(res.roster.members[U.a]).toEqual(expect.objectContaining({ status: "core", chars: ["keslight"] }));
        expect(res.roster.members[U.b]).toEqual(expect.objectContaining({ status: "core", chars: [] }));
        expect(rosterRoleSync.applyMemberAdded).not.toHaveBeenCalled();
    });

    it("still creates the roster when the members cannot be read, and says why", async () => {
        discord.listMembersWithRoles.mockResolvedValueOnce({ members: [], error: "intent" });
        expect((await createRosterWithSource({ name: "A", roleIds: [ROLE], source: "role" }, { guildId: "g1" })).initial.error).toBe("members_unavailable");
        discord.isOnline.mockReturnValue(false);
        const res = await createRosterWithSource({ name: "B", roleIds: [ROLE], source: "role" }, { guildId: "g1" });
        expect(res.ok).toBe(true);
        expect(res.initial).toEqual(expect.objectContaining({ added: 0, error: "offline" }));
    });
});

describe("services/roster/rosterCreate source kader", () => {
    it("maps the states, picks the characters and gives the roles through rosterMembers", async () => {
        rosterRoleSync.applyMemberAdded.mockResolvedValueOnce({ ok: false, results: [{ roleId: ROLE, give: true, ok: false, code: "no_permission" }] });
        // the profiles here are TBC characters; a Kader roster without category would play Forever (next test)
        const res = await createRosterFromKader("k1", { guildId: "g1", actor: "1", roleIds: [ROLE], trialRoleId: TRIAL, versionId: "tbc" });
        expect(res.ok).toBe(true);
        expect(res.roster).toEqual(expect.objectContaining({ name: "Forever-Kader", source: { kind: "kader", kaderId: "k1" } }));
        const m = res.roster.members;
        expect(Object.keys(m).sort()).toEqual([U.a, U.b, U.c]);
        // decided class Priest -> the profile's priest, not the first character (a mage)
        expect(m[U.a]).toEqual(expect.objectContaining({ status: "core", chars: ["devi"], charNames: { devi: "Devi" } }));
        // the planner's own character, no profile character of that name: kept as typed
        expect(m[U.b]).toEqual(expect.objectContaining({ status: "bench", chars: ["handname"], charNames: { handname: "Handname" } }));
        // nothing from the planner: the profile's first
        expect(m[U.c]).toEqual(expect.objectContaining({ status: "trial", chars: ["brumm"] }));
        expect(rosterRoleSync.applyMemberAdded).toHaveBeenCalledTimes(3);
        expect(res.initial).toEqual(expect.objectContaining({ source: "kader", added: 3, skipped: 0 }));
        expect(res.initial.roleFailures).toEqual([{ userId: expect.any(String), roleId: ROLE, code: "no_permission" }]);
    });

    it("plays the Kaderplaner's version (Forever) without a category, the category's version with one (#658)", async () => {
        expect((await createRosterFromKader("k1", { guildId: "g1" })).roster.versionId).toBe("forever");
        expect((await createRosterFromKader("k1", { guildId: "g1", categoryId: CAT })).roster.versionId).toBe("tbc");
    });

    it("copies nothing private of the Kader into the roster file", async () => {
        await createRosterFromKader("k1", { guildId: "g1" });
        const file = fs.__store.get(rosterStore.ROSTERS_FILE);
        expect(file).not.toContain(SECRET);
        expect(file).not.toContain("Mage-Frost");
        expect(file).not.toContain("wishes");
        expect(file).not.toContain("votes");
    });

    it("kaderCharacter prefers the planner's name, then the decided class, else leaves it to the profile", () => {
        expect(kaderCharacter({ userId: U.a, characterName: "Neu Name", decision: null }, "tbc")).toEqual(["Neu Name"]);
        expect(kaderCharacter({ userId: U.a, characterName: "", decision: { className: "Priest" } }, "tbc")).toEqual(["devi"]);
        expect(kaderCharacter({ userId: U.a, characterName: "", decision: { className: "Rogue" } }, "tbc")).toBeUndefined();
        expect(kaderCharacter({ userId: U.d, characterName: "", decision: null }, "tbc")).toBeUndefined();
    });

    it("kaderChoices hands the create dialog counts only", () => {
        expect(kaderChoices("g1")).toEqual([{ id: "k1", name: "Forever-Kader", inRoster: 1, candidates: 3 }]);
    });
});

describe("services/roster/rosterCreate source raids", () => {
    const night = (id, startTime, { keys = [], signUps = [] } = {}) => ({ id, startTime, signUps, logs: keys.length ? [{ keys: new Set(keys) }] : [] });
    const ctx = {
        allRaidsByCategory: new Map([[CAT, [
            night("e5", 50, { keys: ["keslight", "fremd"] }),
            night("e4", 40, { signUps: [{ userId: U.b, status: "signed" }, { userId: U.d, status: "absence" }] }),
            night("e3", 30, { signUps: [{ userId: U.d, status: "late" }] }),
            night("e2", 20, { keys: ["brumm"] }),
            night("e1", 10, { keys: ["nobody"], signUps: [{ userId: "555555555555555555", status: "signed" }] }),
        ]]]),
    };

    it("takes everyone present in the last four nights: in a log, or signed up where no log exists", () => {
        expect(presentInRaids("g1", CAT, "tbc", { ctx }).sort()).toEqual([U.a, U.b, U.c, U.d].sort());
        expect(presentInRaids("g1", "other", "tbc", { ctx })).toEqual([]);
    });

    it("builds the context for the roster's version and gives the roles", async () => {
        buildAttendanceContext.mockReturnValueOnce(ctx);
        const res = await createRosterWithSource({ categoryId: CAT, roleIds: [ROLE], source: "raids" }, { guildId: "g1" });
        expect(buildAttendanceContext).toHaveBeenCalledWith("g1", { versionId: "tbc" });
        expect(res.initial).toEqual(expect.objectContaining({ source: "raids", added: 4 }));
        expect(res.roster.members[U.a]).toEqual(expect.objectContaining({ status: "core", chars: ["keslight"] }));
        expect(rosterRoleSync.applyMemberAdded).toHaveBeenCalledTimes(4);
    });
});

describe("services/roster/rosterCreate syncRosterFromKader (#658)", () => {
    it("takes the newly decided players over and leaves every member already in the roster as it is", async () => {
        const created = await createRosterFromKader("k1", { guildId: "g1", roleIds: [ROLE] });
        rosterStore.upsertMember(created.roster.id, U.a, { status: "pause", note: "vom Manager" });
        // U.d is decided later (roster), U.b moved back to the pool in the Kader
        const planner = kaderPlanner();
        planner.kaders[0].players[U.d].state = "roster";
        planner.kaders[0].players[U.b].state = "pool";
        kaderStore.writePlanner("g1", planner);
        expect(kaderRosterState("g1", "k1")).toEqual({ roster: { id: created.roster.id, name: "Forever-Kader", members: 3 }, candidates: 3, pending: 1 });
        rosterRoleSync.applyMemberAdded.mockClear();

        const res = await syncRosterFromKader("k1", { guildId: "g1", actor: "9" });
        expect(res).toEqual(expect.objectContaining({ ok: true, added: 1, skipped: 0, kept: 2, roleFailures: [] }));
        const m = res.roster.members;
        expect(m[U.d]).toEqual(expect.objectContaining({ status: "core", by: "9" }));
        // untouched: status, note - and nobody is taken out because the Kader moved them back
        expect(m[U.a]).toEqual(expect.objectContaining({ status: "pause", note: "vom Manager" }));
        expect(m[U.b]).toEqual(expect.objectContaining({ status: "bench" }));
        expect(rosterRoleSync.applyMemberAdded).toHaveBeenCalledTimes(1);
        expect(kaderRosterState("g1", "k1").pending).toBe(0);
    });

    it("copies nothing private of the Kader into the roster file when taking players over", async () => {
        await createRosterFromKader("k1", { guildId: "g1" });
        const planner = kaderPlanner();
        planner.kaders[0].players[U.d].state = "tentative";
        kaderStore.writePlanner("g1", planner);
        expect((await syncRosterFromKader("k1", { guildId: "g1" })).added).toBe(1);
        const file = fs.__store.get(rosterStore.ROSTERS_FILE);
        for (const marker of [SECRET, "Mage-Frost", "wishes", "votes", "interview", "comments"]) expect(file).not.toContain(marker);
    });

    it("answers a code: no roster for the Kader, a roster from elsewhere, a Kader that is gone", async () => {
        expect(await syncRosterFromKader("k1", { guildId: "g1" })).toEqual({ ok: false, code: "not_found" });
        expect(kaderRosterState("g1", "k1")).toEqual({ roster: null, candidates: 3, pending: 3 });
        expect(kaderRosterState("g1", "nope")).toBeNull();
        const other = await createRosterWithSource({ name: "Manuell" }, { guildId: "g1" });
        expect(await syncRosterFromKader("k1", { guildId: "g1", rosterId: other.roster.id })).toEqual({ ok: false, code: "not_from_kader" });
        const fromKader = await createRosterFromKader("k1", { guildId: "g1" });
        expect(rosterOfKader("g1", "k1").id).toBe(fromKader.roster.id);
        expect(rosterOfKader("g2", "k1")).toBeNull();
        expect(rosterOfKader("g1", "")).toBeNull();
        kaderStore.writePlanner("g1", { ...kaderPlanner(), kaders: [] });
        expect(await syncRosterFromKader("k1", { guildId: "g1" })).toEqual({ ok: false, code: "kader_not_found" });
    });
});
