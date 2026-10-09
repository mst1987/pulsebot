// memberRoles (#656): gives and takes only roster roles, checks the bot's right
// and the role hierarchy, answers with a code instead of throwing.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/services/discord/discord", () => ({
    isOnline: jest.fn(() => true),
    getGuild: jest.fn(() => null),
}));
jest.mock("../../../src/services/discord/roleSync", () => ({ canManageRoles: jest.fn(() => true) }));

const fs = require("fs");
const discord = require("../../../src/services/discord/discord");
const { canManageRoles } = require("../../../src/services/discord/roleSync");
const rosterStore = require("../../../src/stores/rosterStore");
const memberRoles = require("../../../src/services/discord/memberRoles");

const { giveRole, takeRole, rosterRoleIds, recentWrite, roleBelowBot, codeOfError, WRITE_MEMORY_MS } = memberRoles;

/** A member whose roles live in a Map; add/remove change it like Discord would. */
function makeMember(id, roleIds = []) {
    const cache = new Map(roleIds.map((r) => [r, { id: r }]));
    return {
        id,
        roles: {
            cache,
            add: jest.fn(async (roleId) => { cache.set(roleId, { id: roleId }); }),
            remove: jest.fn(async (roleId) => { cache.delete(roleId); }),
        },
    };
}

/** A guild with roles { id: { name, position, managed } }, members and the bot's highest role position. */
function makeGuild({ roles = {}, members = [], botPosition = 10 } = {}) {
    const byId = new Map(members.map((m) => [m.id, m]));
    return {
        id: "g1",
        roles: { cache: new Map(Object.entries(roles).map(([id, r]) => [id, { id, ...r }])) },
        members: {
            me: { roles: { highest: { position: botPosition } } },
            cache: new Map(),
            fetch: jest.fn(async (id) => {
                if (byId.has(id)) return byId.get(id);
                throw Object.assign(new Error("Unknown Member"), { code: 10007 });
            }),
        },
    };
}

const ROLES = {
    main: { name: "Raider", position: 5 },
    trial: { name: "Probe", position: 4 },
    high: { name: "Officer", position: 20 },
    admin: { name: "Admin", position: 3 },
};

beforeEach(() => {
    fs.__store.clear();
    memberRoles._resetForTests();
    jest.clearAllMocks();
    discord.isOnline.mockReturnValue(true);
    canManageRoles.mockReturnValue(true);
    rosterStore.createRoster({ name: "Donnerstag", guildId: "g1", roleIds: ["main", "high"], trialRoleId: "trial" });
    rosterStore.createRoster({ name: "Anderer Server", guildId: "g2", roleIds: ["admin"] });
});

describe("services/discord/memberRoles rosterRoleIds", () => {
    it("collects roleIds and trialRoleId of the rosters of that server only", () => {
        expect([...rosterRoleIds("g1")].sort()).toEqual(["high", "main", "trial"]);
        expect([...rosterRoleIds("g2")]).toEqual(["admin"]);
        expect(rosterRoleIds("").size).toBe(0);
    });
});

describe("services/discord/memberRoles giveRole / takeRole", () => {
    it("gives a roster role and remembers the write", async () => {
        const m = makeMember("u1");
        discord.getGuild.mockReturnValue(makeGuild({ roles: ROLES, members: [m] }));
        const res = await giveRole("g1", "u1", "main");
        expect(res).toEqual(expect.objectContaining({ ok: true, code: "done", changed: true, roleName: "Raider" }));
        expect(m.roles.add).toHaveBeenCalledWith("main", memberRoles.REASON);
        expect(recentWrite("g1", "u1", "main")).toBe(true);
        expect(recentWrite("g1", "u1", "main", Date.now() + WRITE_MEMORY_MS + 1)).toBeUndefined();
        expect(recentWrite("g1", "u2", "main")).toBeUndefined();
    });

    it("takes a roster role", async () => {
        const m = makeMember("u1", ["trial"]);
        discord.getGuild.mockReturnValue(makeGuild({ roles: ROLES, members: [m] }));
        const res = await takeRole("g1", "u1", "trial");
        expect(res).toEqual(expect.objectContaining({ ok: true, code: "done", changed: true }));
        expect(m.roles.remove).toHaveBeenCalledWith("trial", memberRoles.REASON);
        expect(recentWrite("g1", "u1", "trial")).toBe(false);
    });

    it("does nothing when the member already has / lacks the role", async () => {
        const m = makeMember("u1", ["main"]);
        discord.getGuild.mockReturnValue(makeGuild({ roles: ROLES, members: [m] }));
        expect(await giveRole("g1", "u1", "main")).toEqual(expect.objectContaining({ ok: true, code: "unchanged", changed: false }));
        expect(await takeRole("g1", "u1", "trial")).toEqual(expect.objectContaining({ ok: true, code: "unchanged" }));
        expect(m.roles.add).not.toHaveBeenCalled();
        expect(m.roles.remove).not.toHaveBeenCalled();
    });

    it("refuses a role no roster of that server lists - even one another server's roster lists", async () => {
        const m = makeMember("u1", ["admin"]);
        discord.getGuild.mockReturnValue(makeGuild({ roles: ROLES, members: [m] }));
        expect(await takeRole("g1", "u1", "admin")).toEqual(expect.objectContaining({ ok: false, code: "not_roster_role" }));
        expect(await giveRole("g1", "u1", "everyone-else")).toEqual(expect.objectContaining({ ok: false, code: "not_roster_role" }));
        expect(m.roles.remove).not.toHaveBeenCalled();
        expect(discord.getGuild).not.toHaveBeenCalled();
    });

    it("refuses without ids", async () => {
        expect((await giveRole("", "u1", "main")).code).toBe("bad_request");
        expect((await giveRole("g1", "", "main")).code).toBe("bad_request");
        expect((await giveRole("g1", "u1", "")).code).toBe("bad_request");
    });

    it("answers offline when the bot is not connected or not on the server", async () => {
        discord.isOnline.mockReturnValue(false);
        expect((await giveRole("g1", "u1", "main")).code).toBe("offline");
        discord.isOnline.mockReturnValue(true);
        discord.getGuild.mockReturnValue(null);
        expect((await giveRole("g1", "u1", "main")).code).toBe("offline");
    });

    it("answers no_permission without \"Rollen verwalten\"", async () => {
        const m = makeMember("u1");
        discord.getGuild.mockReturnValue(makeGuild({ roles: ROLES, members: [m] }));
        canManageRoles.mockReturnValue(false);
        expect(await giveRole("g1", "u1", "main")).toEqual(expect.objectContaining({ ok: false, code: "no_permission" }));
        expect(m.roles.add).not.toHaveBeenCalled();
    });

    it("answers role_too_high for a role at or above the bot's highest role, and for a managed role", async () => {
        const m = makeMember("u1");
        discord.getGuild.mockReturnValue(makeGuild({ roles: { ...ROLES, main: { name: "Raider", position: 5, managed: true } }, members: [m] }));
        expect((await giveRole("g1", "u1", "high")).code).toBe("role_too_high");
        expect((await giveRole("g1", "u1", "main")).code).toBe("role_too_high");
        expect(m.roles.add).not.toHaveBeenCalled();
    });

    it("answers unknown_role for a role the server no longer has", async () => {
        discord.getGuild.mockReturnValue(makeGuild({ roles: { high: ROLES.high }, members: [makeMember("u1")] }));
        expect((await giveRole("g1", "u1", "main")).code).toBe("unknown_role");
    });

    it("answers not_member for someone not on the server", async () => {
        discord.getGuild.mockReturnValue(makeGuild({ roles: ROLES, members: [] }));
        expect((await giveRole("g1", "u9", "main")).code).toBe("not_member");
    });

    it("prefers the cached member over a fetch", async () => {
        const m = makeMember("u1");
        const guild = makeGuild({ roles: ROLES });
        guild.members.cache.set("u1", m);
        discord.getGuild.mockReturnValue(guild);
        expect((await giveRole("g1", "u1", "main")).code).toBe("done");
        expect(guild.members.fetch).not.toHaveBeenCalled();
    });

    it("turns a Discord error into a code, never a throw", async () => {
        const m = makeMember("u1");
        m.roles.add.mockRejectedValueOnce(Object.assign(new Error("Missing Permissions"), { code: 50013 }));
        discord.getGuild.mockReturnValue(makeGuild({ roles: ROLES, members: [m] }));
        expect(await giveRole("g1", "u1", "main")).toEqual(expect.objectContaining({ ok: false, code: "no_permission", error: "Missing Permissions" }));
        m.roles.add.mockRejectedValueOnce(new Error("boom"));
        expect(await giveRole("g1", "u1", "main")).toEqual(expect.objectContaining({ ok: false, code: "failed", error: "boom" }));
        expect(recentWrite("g1", "u1", "main")).toBeUndefined();
    });
});

describe("services/discord/memberRoles helpers", () => {
    it("roleBelowBot uses comparePositionTo when discord.js offers it, editable=false wins", () => {
        const guild = { members: { me: { roles: { highest: { comparePositionTo: (r) => 10 - r.position } } } } };
        expect(roleBelowBot(guild, { position: 5 })).toBe(true);
        expect(roleBelowBot(guild, { position: 10 })).toBe(false);
        expect(roleBelowBot(guild, { position: 1, editable: false })).toBe(false);
        expect(roleBelowBot({ members: {} }, { position: 1 })).toBe(true);
    });

    it("codeOfError maps the Discord API codes", () => {
        expect(codeOfError({ code: 50013 })).toBe("no_permission");
        expect(codeOfError({ rawError: { code: 10011 } })).toBe("unknown_role");
        expect(codeOfError({ code: 10007 })).toBe("not_member");
        expect(codeOfError(null)).toBe("failed");
    });
});
