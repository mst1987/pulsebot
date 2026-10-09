// rosterSyncView (#656): the four lists of the Abgleich tab, the roles and the
// role-sync mirrors. Computed on read; a failed member fetch empties only the role lists.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/services/discord/discord", () => ({
    isOnline: jest.fn(() => true),
    getGuild: jest.fn(() => ({ id: "g1" })),
    fetchGuildMembersCached: jest.fn(async () => []),
    listRoles: jest.fn(() => [{ id: "main", name: "Raider", color: "#ff0000" }, { id: "trial", name: "Probe", color: "" }]),
}));
jest.mock("../../../src/services/discord/roleSync", () => ({ canManageRoles: jest.fn(() => true) }));
jest.mock("../../../src/services/discord/memberRoles", () => ({ recentWrite: jest.fn(() => undefined) }));
jest.mock("../../../src/stores/raiderProfileStore", () => ({
    getProfile: jest.fn((userId) => ({ userId, name: userId === "100003" ? "Profilname" : "", characters: [] })),
    firstCharacter: jest.fn(() => null),
    claimsFor: jest.fn(() => []),
}));
jest.mock("../../../src/stores/rosterHiddenStore", () => ({ isHidden: jest.fn(() => false) }));
jest.mock("../../../src/services/characters/rosterAttendance", () => ({
    buildAttendanceContext: jest.fn(() => ({ raidsByCategory: new Map() })),
}));

const fs = require("fs");
const discord = require("../../../src/services/discord/discord");
const memberRoles = require("../../../src/services/discord/memberRoles");
const raiderProfileStore = require("../../../src/stores/raiderProfileStore");
const rosterHidden = require("../../../src/stores/rosterHiddenStore");
const { buildAttendanceContext } = require("../../../src/services/characters/rosterAttendance");
const rosterStore = require("../../../src/stores/rosterStore");
const { rosterSyncView, mirroredRoles, logCharsList, titleCase, MAX_LOG_CHARS } = require("../../../src/services/roster/rosterSyncView");

const member = (id, roleIds = [], { bot = false, name } = {}) => ({
    id, user: { bot, username: `user${id}` }, displayName: name || `N${id}`, roles: { cache: new Map(roleIds.map((r) => [r, {}])) },
});

let roster;
beforeEach(() => {
    fs.__store.clear();
    jest.clearAllMocks();
    discord.isOnline.mockReturnValue(true);
    roster = rosterStore.createRoster({ name: "Donnerstag", guildId: "g1", categoryId: "cat1", roleIds: ["main"], trialRoleId: "trial", versionId: "tbc" });
    rosterStore.upsertMember(roster.id, "100001", { chars: ["Devi"] });
    rosterStore.upsertMember(roster.id, "100002", { status: "pause" });
    rosterStore.upsertMember(roster.id, "100003", { status: "trial" });
    roster = rosterStore.getRoster(roster.id);
});

describe("services/roster/rosterSyncView rosterSyncView", () => {
    it("builds the role lists from the member list, with names and status", async () => {
        discord.fetchGuildMembersCached.mockResolvedValueOnce([
            member("100001", ["main"], { name: "Anna" }),
            member("100002", [], { name: "Bert" }),
            member("100004", ["main"], { name: "Cleo" }),
            member("100005", ["main"], { bot: true }),
        ]);
        const view = await rosterSyncView(roster, { config: {} });
        expect(view.membersError).toBeNull();
        expect(view.inRosterWithoutRole).toEqual([
            { userId: "100002", displayName: "Bert", status: "pause" },
            { userId: "100003", displayName: "Profilname", status: "trial" },
        ]);
        expect(view.roleWithoutRoster).toEqual([{ userId: "100004", displayName: "Cleo", takeFailed: false }]);
        expect(view.roles).toEqual([
            { id: "main", name: "Raider", color: "#ff0000", main: true, trial: false, exists: true },
            { id: "trial", name: "Probe", color: "", main: false, trial: true, exists: true },
        ]);
        expect(view.canManageRoles).toBe(true);
        expect(view.mirrored).toEqual([]);
    });

    it("marks a holder the tool could not take the role from, and trusts the tool's recent writes", async () => {
        rosterStore.upsertMember(roster.id, "100004", {});
        rosterStore.removeMember(roster.id, "100004");
        rosterStore.appendHistory(roster.id, { userId: "100004", what: "role-take-failed", detail: "x" });
        memberRoles.recentWrite.mockImplementation((g, u, r) => (u === "100002" && r === "main" ? true : undefined));
        discord.fetchGuildMembersCached.mockResolvedValueOnce([member("100004", ["main"]), member("100002", [])]);
        const view = await rosterSyncView(rosterStore.getRoster(roster.id));
        expect(view.roleWithoutRoster).toEqual([{ userId: "100004", displayName: "N100004", takeFailed: true }]);
        expect(view.inRosterWithoutRole.map((e) => e.userId)).toEqual(["100001", "100003"]);
    });

    it("a failed or empty member fetch empties only the role lists and says why", async () => {
        discord.fetchGuildMembersCached.mockRejectedValueOnce(new Error("intent"));
        const view = await rosterSyncView(roster);
        expect(view.membersError).toBe("members_unavailable");
        expect(view.inRosterWithoutRole).toEqual([]);
        expect(view.roleWithoutRoster).toEqual([]);
        expect(view.withoutChar.map((e) => e.userId)).toEqual(["100002", "100003"]);
        discord.fetchGuildMembersCached.mockResolvedValueOnce([]);
        expect((await rosterSyncView(roster)).membersError).toBe("members_unavailable");
        discord.isOnline.mockReturnValueOnce(false);
        expect((await rosterSyncView(roster)).membersError).toBe("offline");
    });

    it("a roster without roles lists nobody as missing the role", async () => {
        const bare = rosterStore.createRoster({ name: "Ohne", guildId: "g1" });
        rosterStore.upsertMember(bare.id, "100001", {});
        discord.fetchGuildMembersCached.mockResolvedValueOnce([member("100001", [])]);
        const view = await rosterSyncView(rosterStore.getRoster(bare.id));
        expect(view.inRosterWithoutRole).toEqual([]);
        expect(view.roles).toEqual([]);
    });

    it("suggests the profile's first character of the roster's version for members without one", async () => {
        raiderProfileStore.firstCharacter.mockImplementation((profile, versionId) => (profile.userId === "100002" && versionId === "tbc"
            ? { key: "bert", name: "Bert", className: "Warrior" }
            : null));
        const view = await rosterSyncView(roster);
        expect(view.withoutChar).toEqual([
            { userId: "100002", displayName: "100002", suggestion: { key: "bert", name: "Bert", className: "Warrior" } },
            { userId: "100003", displayName: "Profilname", suggestion: null },
        ]);
    });
});

describe("services/roster/rosterSyncView logCharsList", () => {
    const rep = (keys, classes = {}) => ({ keys: new Set(keys), classes });
    const ctx = () => ({
        raidsByCategory: new Map([["cat1", [
            { startTime: 3000, logs: [rep(["devi", "kael", "zed"], { kael: "mage" }), rep(["kael"])] },
            { startTime: 2000, logs: [rep(["kael", "lia"], { lia: "priest" })] },
            { startTime: 1000, logs: [] },
        ]]]),
    });

    it("lists characters of the category's logs no member plays, most nights first, one count per night", () => {
        raiderProfileStore.claimsFor.mockImplementation((key) => (key === "lia" ? [{ userId: "100009", name: "Lia" }] : []));
        const list = logCharsList(roster, { ctx: ctx() });
        expect(list).toEqual([
            { key: "kael", character: "Kael", className: "mage", nights: 2, lastSeen: 3000, claimedBy: [] },
            { key: "zed", character: "Zed", className: "", nights: 1, lastSeen: 3000, claimedBy: [] },
            { key: "lia", character: "Lia", className: "priest", nights: 1, lastSeen: 2000, claimedBy: [{ userId: "100009", name: "Lia" }] },
        ]);
        expect(raiderProfileStore.claimsFor).toHaveBeenCalledWith("lia", "", "tbc");
    });

    it("leaves out hidden characters, and is empty without category", () => {
        rosterHidden.isHidden.mockImplementation((key) => key === "kael");
        expect(logCharsList(roster, { ctx: ctx() }).map((e) => e.key)).toEqual(["zed", "lia"]);
        expect(logCharsList({ ...roster, categoryId: null }, { ctx: ctx() })).toEqual([]);
    });

    it("reads the attendance context of the roster's server and version when none is handed in", () => {
        logCharsList(roster);
        expect(buildAttendanceContext).toHaveBeenCalledWith("g1", { versionId: "tbc" });
    });

    it("caps the list", () => {
        const keys = Array.from({ length: MAX_LOG_CHARS + 10 }, (_, i) => `c${i}`);
        const big = { raidsByCategory: new Map([["cat1", [{ startTime: 1, logs: [rep(keys)] }]]]) };
        expect(logCharsList(roster, { ctx: big })).toHaveLength(MAX_LOG_CHARS);
    });

    it("titleCase turns a key back into a name", () => {
        expect(titleCase("devi res")).toBe("Devi Res");
        expect(titleCase("ärger")).toBe("Ärger");
    });
});

describe("services/roster/rosterSyncView mirroredRoles", () => {
    it("names every roster role the role sync touches, with the direction seen from this side", () => {
        const config = {
            roleSync: [
                { eventRoleId: "main", talkRoleId: "t1", direction: "toTalk" },
                { eventRoleId: "e2", talkRoleId: "trial", direction: "toEvent" },
                { eventRoleId: "trial", talkRoleId: "t3", direction: "both" },
                { eventRoleId: "x", talkRoleId: "y", direction: "both" },
            ],
        };
        expect(mirroredRoles(roster, config)).toEqual([
            { roleId: "main", otherRoleId: "t1", direction: "toTalk", side: "event", incoming: false, outgoing: true },
            { roleId: "trial", otherRoleId: "e2", direction: "toEvent", side: "talk", incoming: false, outgoing: true },
            { roleId: "trial", otherRoleId: "t3", direction: "both", side: "event", incoming: true, outgoing: true },
        ]);
        expect(mirroredRoles(roster, {})).toEqual([]);
    });
});
