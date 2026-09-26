// Role sync (#264): adds in the configured direction, NEVER removes, reports a
// missing "Rollen verwalten" instead of trying, and lists the drift it leaves.
const fs = require("fs");
const path = require("path");

jest.mock("../../src/web/discord", () => ({
    getGuild: jest.fn(),
    botPermissionsIn: jest.fn(),
    fetchGuildMembersCached: jest.fn(),
    listRoles: jest.fn(() => []),
}));
jest.mock("../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));

const discord = require("../../src/web/discord");
const roleSync = require("../../src/web/roleSync");

const EVENT = "100000";
const TALK = "200000";
const RAIDER_E = "510000";
const RAIDER_T = "610000";

/** A discord.js-like member with spies on both role calls. */
function member(id, roleIds, { bot = false, name } = {}) {
    const cache = new Map(roleIds.map((r) => [r, { id: r }]));
    return {
        id,
        displayName: name || `M${id}`,
        user: { bot },
        roles: { cache, add: jest.fn(async () => {}), remove: jest.fn(async () => {}) },
    };
}
const guild = (id, name) => ({
    id, name,
    roles: { cache: new Map([[RAIDER_E, { id: RAIDER_E, name: "Raider", editable: true }], [RAIDER_T, { id: RAIDER_T, name: "Raider", editable: true }]]) },
    members: { fetch: jest.fn() },
});
const config = (direction) => ({
    guildId: EVENT,
    discordServers: { eventGuildId: EVENT, talkGuildId: TALK, talkOverviewChannelId: "", talkPingChannelId: "" },
    roleSync: [{ eventRoleId: RAIDER_E, talkRoleId: RAIDER_T, direction }],
});
const allowed = (ok) => [{ key: "ManageRoles", label: "Rollen verwalten", ok }];

let guilds;
beforeEach(() => {
    jest.resetAllMocks();
    roleSync._resetForTests();
    guilds = { [EVENT]: guild(EVENT, "Pulse"), [TALK]: guild(TALK, "Pulse Talk") };
    discord.getGuild.mockImplementation((id) => guilds[id] || null);
    discord.botPermissionsIn.mockReturnValue(allowed(true));
    discord.listRoles.mockImplementation((id) => [{ id: id === EVENT ? RAIDER_E : RAIDER_T, name: "Raider" }]);
});

function withMembers(eventMembers, talkMembers) {
    discord.fetchGuildMembersCached.mockImplementation(async (id) => (id === EVENT ? eventMembers : talkMembers));
}

describe("planRoleSync", () => {
    const lite = (list) => list.map(roleSync.liteMember);

    it("gives the talk role to event role holders who are on the talk server (toTalk)", () => {
        const ev = [member("1", [RAIDER_E]), member("2", [RAIDER_E]), member("3", [])];
        const tk = [member("1", []), member("3", [RAIDER_T])];
        const adds = roleSync.planRoleSync(config("toTalk").roleSync, { event: lite(ev), talk: lite(tk) });
        // 2 is not on the talk server; 3 holds the talk role but that flows nowhere here.
        expect(adds).toEqual([{ side: "talk", userId: "1", roleId: RAIDER_T, name: "M1" }]);
    });

    it("gives the event role to talk role holders (toEvent)", () => {
        const ev = [member("1", []), member("2", [RAIDER_E])];
        const tk = [member("1", [RAIDER_T]), member("2", [])];
        const adds = roleSync.planRoleSync(config("toEvent").roleSync, { event: lite(ev), talk: lite(tk) });
        expect(adds).toEqual([{ side: "event", userId: "1", roleId: RAIDER_E, name: "M1" }]);
    });

    it("syncs both ways and skips bots", () => {
        const ev = [member("1", [RAIDER_E]), member("2", []), member("9", [RAIDER_E], { bot: true })];
        const tk = [member("1", []), member("2", [RAIDER_T]), member("9", [])];
        const adds = roleSync.planRoleSync(config("both").roleSync, { event: lite(ev), talk: lite(tk) });
        expect(adds.map((a) => `${a.side}:${a.userId}`).sort()).toEqual(["event:2", "talk:1"]);
    });
});

describe("runRoleSync", () => {
    it("adds the missing roles and never removes one", async () => {
        const e1 = member("1", [RAIDER_E]);
        const e2 = member("2", []); // lost the event role
        const t1 = member("1", []);
        const t2 = member("2", [RAIDER_T]); // still has the talk role
        withMembers([e1, e2], [t1, t2]);

        const r = await roleSync.runRoleSync({ config: config("toTalk"), now: 5 });
        expect(r).toMatchObject({ added: 1, failed: 0, missingPermission: [], error: null });
        expect(t1.roles.add).toHaveBeenCalledWith(RAIDER_T, "EventHelper Rollen-Abgleich");
        for (const m of [e1, e2, t1, t2]) expect(m.roles.remove).not.toHaveBeenCalled();
    });

    it("does nothing on a server where the bot may not manage roles, and says so", async () => {
        const t1 = member("1", []);
        withMembers([member("1", [RAIDER_E])], [t1]);
        discord.botPermissionsIn.mockImplementation((id) => (id === TALK ? allowed(false) : allowed(true)));
        const r = await roleSync.runRoleSync({ config: config("toTalk") });
        expect(r.added).toBe(0);
        expect(r.missingPermission).toEqual(["talk"]);
        expect(t1.roles.add).not.toHaveBeenCalled();
    });

    it("treats unknowable rights as missing", async () => {
        const t1 = member("1", []);
        withMembers([member("1", [RAIDER_E])], [t1]);
        discord.botPermissionsIn.mockReturnValue(null);
        const r = await roleSync.runRoleSync({ config: config("toTalk") });
        expect(r.missingPermission).toEqual(["talk"]);
        expect(t1.roles.add).not.toHaveBeenCalled();
    });

    it("does not try a role above the bot's own", async () => {
        guilds[TALK].roles.cache.get(RAIDER_T).editable = false;
        const t1 = member("1", []);
        withMembers([member("1", [RAIDER_E])], [t1]);
        const r = await roleSync.runRoleSync({ config: config("toTalk") });
        expect(r.failed).toBe(1);
        expect(r.errors[0]).toContain("über der Rolle des Bots");
        expect(t1.roles.add).not.toHaveBeenCalled();
    });

    it("needs both servers and a mapping", async () => {
        expect((await roleSync.runRoleSync({ config: { ...config("toTalk"), roleSync: [] } })).added).toBe(0);
        const oneServer = { ...config("toTalk"), discordServers: { eventGuildId: EVENT, talkGuildId: "" } };
        expect((await roleSync.runRoleSync({ config: oneServer })).error).toBe("Kein zweiter Server eingestellt.");
        expect(discord.fetchGuildMembersCached).not.toHaveBeenCalled();
    });
});

describe("member events", () => {
    const cfgModule = require("../../src/stores/settingsStore");

    it("syncs the one member whose roles changed", async () => {
        cfgModule.getConfig.mockReturnValue(config("toTalk"));
        const before = member("1", []);
        const after = member("1", [RAIDER_E]);
        after.guild = guilds[EVENT];
        const onTalk = member("1", []);
        guilds[TALK].members.fetch.mockResolvedValue(onTalk);

        const r = await roleSync.handleMemberUpdate(before, after);
        expect(r.added).toBe(1);
        expect(onTalk.roles.add).toHaveBeenCalledWith(RAIDER_T, expect.any(String));
        expect(discord.fetchGuildMembersCached).not.toHaveBeenCalled();
    });

    it("ignores an update that did not touch the roles", async () => {
        cfgModule.getConfig.mockReturnValue(config("toTalk"));
        const a = member("1", [RAIDER_E]);
        const b = member("1", [RAIDER_E]);
        b.guild = guilds[EVENT];
        expect(await roleSync.handleMemberUpdate(a, b)).toBeNull();
        expect(guilds[TALK].members.fetch).not.toHaveBeenCalled();
    });

    it("gives a new talk member the role they hold on the event server", async () => {
        cfgModule.getConfig.mockReturnValue(config("toTalk"));
        const joined = member("1", []);
        joined.guild = guilds[TALK];
        guilds[EVENT].members.fetch.mockResolvedValue(member("1", [RAIDER_E]));
        const r = await roleSync.handleMemberAdd(joined);
        expect(r.added).toBe(1);
        expect(joined.roles.add).toHaveBeenCalledWith(RAIDER_T, expect.any(String));
    });

    it("does nothing for someone who is not on the other server", async () => {
        cfgModule.getConfig.mockReturnValue(config("toTalk"));
        const joined = member("1", [RAIDER_E]);
        joined.guild = guilds[EVENT];
        guilds[TALK].members.fetch.mockRejectedValue(new Error("Unknown Member"));
        expect(await roleSync.handleMemberAdd(joined)).toBeNull();
    });
});

describe("drift", () => {
    it("lists who kept the synced role but lost the source role, and who left the source server", async () => {
        withMembers(
            [member("1", [RAIDER_E]), member("2", [])],
            [member("1", [RAIDER_T]), member("2", [RAIDER_T], { name: "Bruno" }), member("3", [RAIDER_T], { name: "Anna" })],
        );
        const drift = await roleSync.loadDrift(config("toTalk"));
        expect(drift.error).toBeNull();
        expect(drift.total).toBe(2);
        expect(drift.groups).toHaveLength(1);
        expect(drift.groups[0]).toMatchObject({ side: "talk", roleName: "Raider", guildName: "Pulse Talk" });
        expect(drift.groups[0].members).toEqual([
            { userId: "3", name: "Anna", notOnSource: true, profileUrl: "https://discord.com/users/3" },
            { userId: "2", name: "Bruno", notOnSource: false, profileUrl: "https://discord.com/users/2" },
        ]);
    });

    it("has no drift for a two-way mapping, since the sync gives the role back", async () => {
        withMembers([member("2", [])], [member("2", [RAIDER_T])]);
        expect(await roleSync.loadDrift(config("both"))).toEqual({ groups: [], total: 0, error: null });
        expect(discord.fetchGuildMembersCached).not.toHaveBeenCalled();
    });

    it("reports a failed member fetch instead of throwing", async () => {
        discord.fetchGuildMembersCached.mockRejectedValue(new Error("Intent fehlt"));
        expect(await roleSync.loadDrift(config("toTalk"))).toEqual({ groups: [], total: 0, error: "Intent fehlt" });
    });
});

describe("source", () => {
    it("contains no call that removes a role", () => {
        const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "web", "roleSync.js"), "utf8");
        expect(src).not.toMatch(/\.remove\s*\(/);
        expect(src).not.toMatch(/roles\.set\s*\(/);
        expect(src).not.toMatch(/\.edit\s*\(\s*\{\s*roles/);
    });
});
