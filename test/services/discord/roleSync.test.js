// Role sync (#264, pairs of any two servers since #896): adds in the configured
// direction, NEVER removes, reports a missing "Rollen verwalten" instead of
// trying, and lists the drift it leaves - per pair.
const fs = require("fs");
const path = require("path");

jest.mock("../../../src/services/discord/discord", () => ({
    getGuild: jest.fn(),
    botPermissionsIn: jest.fn(),
    fetchGuildMembersCached: jest.fn(),
    listRoles: jest.fn(() => []),
}));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));

const discord = require("../../../src/services/discord/discord");
const roleSync = require("../../../src/services/discord/roleSync");

const A = "100000";
const B = "200000";
const C = "300000";
const ROLE_A = "510000";
const ROLE_B = "610000";
const ROLE_C = "710000";
const ROLE_A2 = "520000";

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
const ROLES = [[ROLE_A, "Raider"], [ROLE_A2, "Twink"], [ROLE_B, "Raider B"], [ROLE_C, "Gast"]];
const guild = (id, name) => ({
    id, name,
    roles: { cache: new Map(ROLES.map(([r, n]) => [r, { id: r, name: n, editable: true }])) },
    members: { fetch: jest.fn() },
});
const pair = (from, fromRole, to, toRole, direction = "toTarget") => ({ fromGuildId: from, fromRoleId: fromRole, toGuildId: to, toRoleId: toRole, direction });
const config = (roleSync, ids = [A, B, C]) => ({
    guildId: A,
    discordServers: { servers: ids.map((guildId) => ({ guildId, label: "" })), links: [], talkGuildId: "" },
    roleSync,
});
const allowed = (ok) => [{ key: "ManageRoles", label: "Rollen verwalten", ok }];

let guilds;
beforeEach(() => {
    jest.resetAllMocks();
    roleSync._resetForTests();
    guilds = { [A]: guild(A, "Pulse"), [B]: guild(B, "Pulse Talk"), [C]: guild(C, "Partner") };
    discord.getGuild.mockImplementation((id) => guilds[id] || null);
    discord.botPermissionsIn.mockReturnValue(allowed(true));
    discord.listRoles.mockImplementation(() => ROLES.map(([id, name]) => ({ id, name })));
});

function withMembers(byGuild) {
    discord.fetchGuildMembersCached.mockImplementation(async (id) => byGuild[id] || []);
}

describe("flows", () => {
    it("turns a pair into its directions", () => {
        const p = pair(A, ROLE_A, B, ROLE_B);
        expect(roleSync.flows(p)).toEqual([{ fromGuildId: A, toGuildId: B, fromRoleId: ROLE_A, toRoleId: ROLE_B }]);
        expect(roleSync.flows({ ...p, direction: "toSource" })).toEqual([{ fromGuildId: B, toGuildId: A, fromRoleId: ROLE_B, toRoleId: ROLE_A }]);
        expect(roleSync.flows({ ...p, direction: "both" })).toHaveLength(2);
    });
});

describe("planRoleSync", () => {
    const lite = (list) => list.map(roleSync.liteMember);

    it("gives the target role to source role holders who are on the target server (toTarget)", () => {
        const a = [member("1", [ROLE_A]), member("2", [ROLE_A]), member("3", [])];
        const b = [member("1", []), member("3", [ROLE_B])];
        const adds = roleSync.planRoleSync([pair(A, ROLE_A, B, ROLE_B)], { [A]: lite(a), [B]: lite(b) });
        // 2 is not on B; 3 holds the B role but that flows nowhere here.
        expect(adds).toEqual([{ guildId: B, userId: "1", roleId: ROLE_B, name: "M1" }]);
    });

    it("gives the source role to target role holders (toSource)", () => {
        const a = [member("1", []), member("2", [ROLE_A])];
        const b = [member("1", [ROLE_B]), member("2", [])];
        const adds = roleSync.planRoleSync([pair(A, ROLE_A, B, ROLE_B, "toSource")], { [A]: lite(a), [B]: lite(b) });
        expect(adds).toEqual([{ guildId: A, userId: "1", roleId: ROLE_A, name: "M1" }]);
    });

    it("syncs both ways and skips bots", () => {
        const a = [member("1", [ROLE_A]), member("2", []), member("9", [ROLE_A], { bot: true })];
        const b = [member("1", []), member("2", [ROLE_B]), member("9", [])];
        const adds = roleSync.planRoleSync([pair(A, ROLE_A, B, ROLE_B, "both")], { [A]: lite(a), [B]: lite(b) });
        expect(adds.map((x) => `${x.guildId}:${x.userId}`).sort()).toEqual([`${A}:2`, `${B}:1`]);
    });

    it("keeps several pairs apart, also pairs between other servers", () => {
        const a = [member("1", [ROLE_A, ROLE_A2])];
        const b = [member("1", [])];
        const c = [member("1", [])];
        const adds = roleSync.planRoleSync(
            [pair(A, ROLE_A, B, ROLE_B), pair(A, ROLE_A2, C, ROLE_C), pair(B, ROLE_B, C, ROLE_C)],
            { [A]: lite(a), [B]: lite(b), [C]: lite(c) },
        );
        // B -> C does not fire in the same plan: member 1 does not hold the B role yet.
        expect(adds).toEqual([
            { guildId: B, userId: "1", roleId: ROLE_B, name: "M1" },
            { guildId: C, userId: "1", roleId: ROLE_C, name: "M1" },
        ]);
    });

    it("plans one add for a role two pairs would give", () => {
        const a = [member("1", [ROLE_A, ROLE_A2])];
        const b = [member("1", [])];
        const adds = roleSync.planRoleSync([pair(A, ROLE_A, B, ROLE_B), pair(A, ROLE_A2, B, ROLE_B)], { [A]: lite(a), [B]: lite(b) });
        expect(adds).toHaveLength(1);
    });
});

describe("runRoleSync", () => {
    it("adds the missing roles and never removes one", async () => {
        const a1 = member("1", [ROLE_A]);
        const a2 = member("2", []); // lost the source role
        const b1 = member("1", []);
        const b2 = member("2", [ROLE_B]); // still has the target role
        withMembers({ [A]: [a1, a2], [B]: [b1, b2] });

        const r = await roleSync.runRoleSync({ config: config([pair(A, ROLE_A, B, ROLE_B)]), now: 5 });
        expect(r).toMatchObject({ added: 1, failed: 0, missingPermission: [], error: null, at: 5 });
        expect(b1.roles.add).toHaveBeenCalledWith(ROLE_B, "EventHelper Rollen-Abgleich");
        for (const m of [a1, a2, b1, b2]) expect(m.roles.remove).not.toHaveBeenCalled();
        // the sweep gives roles from the list, so it reads a fresh one, not the pages' cached one
        expect(discord.fetchGuildMembersCached).toHaveBeenCalledWith(A, expect.anything(), { fresh: true });
        expect(discord.fetchGuildMembersCached).toHaveBeenCalledWith(B, expect.anything(), { fresh: true });
        // C is in no pair: its members are not fetched
        expect(discord.fetchGuildMembersCached).not.toHaveBeenCalledWith(C, expect.anything(), expect.anything());
    });

    it("syncs between two servers neither of which is the first one", async () => {
        const c1 = member("1", []);
        withMembers({ [B]: [member("1", [ROLE_B])], [C]: [c1] });
        const r = await roleSync.runRoleSync({ config: config([pair(B, ROLE_B, C, ROLE_C)]) });
        expect(r.added).toBe(1);
        expect(c1.roles.add).toHaveBeenCalledWith(ROLE_C, expect.any(String));
    });

    it("does nothing on a server where the bot may not manage roles, and names it", async () => {
        const b1 = member("1", []);
        withMembers({ [A]: [member("1", [ROLE_A])], [B]: [b1] });
        discord.botPermissionsIn.mockImplementation((id) => (id === B ? allowed(false) : allowed(true)));
        const r = await roleSync.runRoleSync({ config: config([pair(A, ROLE_A, B, ROLE_B)]) });
        expect(r.added).toBe(0);
        expect(r.missingPermission).toEqual([B]);
        expect(b1.roles.add).not.toHaveBeenCalled();
    });

    it("treats unknowable rights as missing", async () => {
        const b1 = member("1", []);
        withMembers({ [A]: [member("1", [ROLE_A])], [B]: [b1] });
        discord.botPermissionsIn.mockReturnValue(null);
        const r = await roleSync.runRoleSync({ config: config([pair(A, ROLE_A, B, ROLE_B)]) });
        expect(r.missingPermission).toEqual([B]);
        expect(b1.roles.add).not.toHaveBeenCalled();
    });

    it("does not try a role above the bot's own", async () => {
        guilds[B].roles.cache.get(ROLE_B).editable = false;
        const b1 = member("1", []);
        withMembers({ [A]: [member("1", [ROLE_A])], [B]: [b1] });
        const r = await roleSync.runRoleSync({ config: config([pair(A, ROLE_A, B, ROLE_B)]) });
        expect(r.failed).toBe(1);
        expect(r.errors[0]).toContain("über der Rolle des Bots");
        expect(b1.roles.add).not.toHaveBeenCalled();
    });

    it("does nothing without pairs", async () => {
        const r = await roleSync.runRoleSync({ config: config([]) });
        expect(r).toMatchObject({ added: 0, error: null });
        expect(discord.fetchGuildMembersCached).not.toHaveBeenCalled();
    });

    it("skips a pair whose server the bot is not on and runs the others", async () => {
        delete guilds[C];
        const b1 = member("1", []);
        withMembers({ [A]: [member("1", [ROLE_A])], [B]: [b1] });
        const r = await roleSync.runRoleSync({ config: config([pair(A, ROLE_A, B, ROLE_B), pair(A, ROLE_A, C, ROLE_C)]) });
        expect(r.added).toBe(1);
        expect(r.error).toBeNull();
        expect(r.errors).toEqual([`Der Bot ist nicht auf ${C}.`]);
    });

    it("says so when no pair can run", async () => {
        delete guilds[B];
        const r = await roleSync.runRoleSync({ config: config([pair(A, ROLE_A, B, ROLE_B)]) });
        expect(r.error).toBe(`Der Bot ist nicht auf ${B}.`);
        expect(discord.fetchGuildMembersCached).not.toHaveBeenCalled();
    });

    it("keeps going when one server's member list fails", async () => {
        const b1 = member("1", []);
        discord.fetchGuildMembersCached.mockImplementation(async (id) => {
            if (id === C) throw new Error("Intent fehlt");
            return id === A ? [member("1", [ROLE_A])] : [b1];
        });
        const r = await roleSync.runRoleSync({ config: config([pair(A, ROLE_A, B, ROLE_B), pair(A, ROLE_A, C, ROLE_C)]) });
        expect(r.added).toBe(1);
        expect(r.errors.join(" ")).toContain("Intent fehlt");
    });
});

describe("member events", () => {
    const cfgModule = require("../../../src/stores/settingsStore");

    it("syncs the one member whose roles changed", async () => {
        cfgModule.getConfig.mockReturnValue(config([pair(A, ROLE_A, B, ROLE_B)]));
        const before = member("1", []);
        const after = member("1", [ROLE_A]);
        after.guild = guilds[A];
        const onB = member("1", []);
        guilds[B].members.fetch.mockResolvedValue(onB);

        const r = await roleSync.handleMemberUpdate(before, after);
        expect(r.added).toBe(1);
        expect(onB.roles.add).toHaveBeenCalledWith(ROLE_B, expect.any(String));
        expect(discord.fetchGuildMembersCached).not.toHaveBeenCalled();
    });

    it("only looks at the pairs of the member's server", async () => {
        cfgModule.getConfig.mockReturnValue(config([pair(A, ROLE_A, B, ROLE_B), pair(B, ROLE_B, C, ROLE_C)]));
        const after = member("1", [ROLE_A]);
        after.guild = guilds[A];
        guilds[B].members.fetch.mockResolvedValue(member("1", []));
        await roleSync.handleMemberUpdate(member("1", []), after);
        expect(guilds[C].members.fetch).not.toHaveBeenCalled();
    });

    it("ignores an update that did not touch the roles", async () => {
        cfgModule.getConfig.mockReturnValue(config([pair(A, ROLE_A, B, ROLE_B)]));
        const a = member("1", [ROLE_A]);
        const b = member("1", [ROLE_A]);
        b.guild = guilds[A];
        expect(await roleSync.handleMemberUpdate(a, b)).toBeNull();
        expect(guilds[B].members.fetch).not.toHaveBeenCalled();
    });

    it("gives a new member the role they hold on the partner server", async () => {
        cfgModule.getConfig.mockReturnValue(config([pair(A, ROLE_A, B, ROLE_B)]));
        const joined = member("1", []);
        joined.guild = guilds[B];
        guilds[A].members.fetch.mockResolvedValue(member("1", [ROLE_A]));
        const r = await roleSync.handleMemberAdd(joined);
        expect(r.added).toBe(1);
        expect(joined.roles.add).toHaveBeenCalledWith(ROLE_B, expect.any(String));
    });

    it("does nothing for someone who is not on the other server", async () => {
        cfgModule.getConfig.mockReturnValue(config([pair(A, ROLE_A, B, ROLE_B)]));
        const joined = member("1", [ROLE_A]);
        joined.guild = guilds[A];
        guilds[B].members.fetch.mockRejectedValue(new Error("Unknown Member"));
        expect(await roleSync.handleMemberAdd(joined)).toBeNull();
    });

    it("does nothing on a server no pair names", async () => {
        cfgModule.getConfig.mockReturnValue(config([pair(A, ROLE_A, B, ROLE_B)]));
        const joined = member("1", [ROLE_C]);
        joined.guild = guilds[C];
        expect(await roleSync.handleMemberAdd(joined)).toBeNull();
    });
});

describe("drift", () => {
    it("lists per pair who kept the synced role but lost the source role, and who left the source server", async () => {
        withMembers({
            [A]: [member("1", [ROLE_A]), member("2", [])],
            [B]: [member("1", [ROLE_B]), member("2", [ROLE_B], { name: "Bruno" }), member("3", [ROLE_B], { name: "Anna" })],
        });
        const drift = await roleSync.loadDrift(config([pair(A, ROLE_A, B, ROLE_B)]));
        expect(drift.error).toBeNull();
        // a page: the cached list is good enough
        expect(discord.fetchGuildMembersCached.mock.calls.every((c) => c.length === 2)).toBe(true);
        expect(drift.total).toBe(2);
        expect(drift.groups).toHaveLength(1);
        expect(drift.groups[0]).toMatchObject({
            ruleIndex: 0, guildId: B, sourceGuildId: A,
            roleName: "Raider B", sourceRoleName: "Raider", guildName: "Pulse Talk", sourceGuildName: "Pulse",
        });
        expect(drift.groups[0].members).toEqual([
            { userId: "3", name: "Anna", notOnSource: true, profileUrl: "https://discord.com/users/3" },
            { userId: "2", name: "Bruno", notOnSource: false, profileUrl: "https://discord.com/users/2" },
        ]);
    });

    it("points ruleIndex into the full list and reads toSource the other way round", async () => {
        withMembers({ [A]: [member("4", [ROLE_A])], [C]: [member("4", [])] });
        const cfg = config([pair(A, ROLE_A, B, ROLE_B, "both"), pair(C, ROLE_C, A, ROLE_A, "toSource")]);
        // toSource: C gets its role from A, so A holding the role without C's role is no drift ...
        expect((await roleSync.loadDrift(cfg)).groups).toEqual([]);
        // ... but C holding the role without A's is.
        withMembers({ [A]: [member("4", [])], [C]: [member("4", [ROLE_C])] });
        const drift = await roleSync.loadDrift(cfg);
        expect(drift.groups).toHaveLength(1);
        expect(drift.groups[0]).toMatchObject({ ruleIndex: 1, guildId: C, sourceGuildId: A, roleId: ROLE_C });
    });

    it("has no drift for a two-way pair, since the sync gives the role back", async () => {
        withMembers({ [A]: [member("2", [])], [B]: [member("2", [ROLE_B])] });
        expect(await roleSync.loadDrift(config([pair(A, ROLE_A, B, ROLE_B, "both")]))).toEqual({ groups: [], total: 0, errors: [], error: null });
        expect(discord.fetchGuildMembersCached).not.toHaveBeenCalled();
    });

    it("reports a failed member fetch instead of throwing", async () => {
        discord.fetchGuildMembersCached.mockRejectedValue(new Error("Intent fehlt"));
        const drift = await roleSync.loadDrift(config([pair(A, ROLE_A, B, ROLE_B)]));
        expect(drift.groups).toEqual([]);
        expect(drift.error).toContain("Intent fehlt");
        expect(drift.errors).toEqual([]);
    });

    // One unreadable server must not turn the whole badge into "unknown".
    it("keeps the groups and names partial failures apart", async () => {
        delete guilds[C];
        discord.fetchGuildMembersCached.mockImplementation(async (id) => {
            if (id === B) return [member("2", [ROLE_B])];
            return [member("2", [])];
        });
        const cfg = config([pair(A, ROLE_A, B, ROLE_B), pair(A, ROLE_A2, C, ROLE_C)]);
        const drift = await roleSync.loadDrift(cfg);
        expect(drift.error).toBeNull();
        expect(drift.total).toBe(1);
        expect(drift.errors).toEqual([`Der Bot ist nicht auf ${C}.`]);
        const view = await roleSync.roleSyncView(cfg);
        expect(view.driftError).toBeNull();
        expect(view.driftErrors).toEqual([`Der Bot ist nicht auf ${C}.`]);
    });

    it("names a failed member list among partial failures when another loaded", async () => {
        discord.fetchGuildMembersCached.mockImplementation(async (id) => {
            if (id === C) throw new Error("Intent fehlt");
            return id === B ? [member("2", [ROLE_B])] : [member("2", [])];
        });
        const drift = await roleSync.loadDrift(config([pair(A, ROLE_A, B, ROLE_B), pair(A, ROLE_A2, C, ROLE_C)]));
        expect(drift.error).toBeNull();
        expect(drift.total).toBe(1);
        expect(drift.errors.join(" ")).toContain("Intent fehlt");
    });
});

describe("roleSyncView", () => {
    it("shows every server with its roles and the overlap per pair", async () => {
        withMembers({ [A]: [member("1", [ROLE_A]), member("2", [])], [B]: [member("1", [ROLE_B])] });
        const view = await roleSync.roleSyncView(config([pair(A, ROLE_A, B, ROLE_B), pair(B, ROLE_B, A, ROLE_A2)]));
        expect(view.servers.map((s) => s.guildId)).toEqual([A, B, C]);
        expect(view.servers[0]).toMatchObject({ name: "Pulse", connected: true, canManage: true });
        expect(view.servers[0].roles).toHaveLength(ROLES.length);
        // two pairs over the same servers: one overlap
        expect(view.overlaps).toEqual([{ fromGuildId: A, toGuildId: B, fromCount: 2, toCount: 1, both: 1, error: null }]);
        expect(view.driftError).toBeNull();
    });
});

describe("source", () => {
    it("contains no call that removes a role", () => {
        const src = fs.readFileSync(path.join(__dirname, "..", "..", "..", "src", "services", "discord", "roleSync.js"), "utf8");
        expect(src).not.toMatch(/\.remove\s*\(/);
        expect(src).not.toMatch(/roles\.set\s*\(/);
        expect(src).not.toMatch(/\.edit\s*\(\s*\{\s*roles/);
    });
});
