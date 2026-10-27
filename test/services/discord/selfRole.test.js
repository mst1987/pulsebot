// Whether a role may be the self-service update role (src/services/discord/selfRole.js):
// never one that grants bot rights (admin, orga, area grants, bot commands, raider role,
// roster, role sync), Discord permissions beyond @everyone or a channel.
jest.mock("../../../src/config/variables", () => ({ adminRoleIds: ["900000000000000009"] }));

const rosterStore = require("../../../src/stores/rosterStore");
const { privilegedReason, roleUses } = require("../../../src/services/discord/selfRole");

const ROLE = "200000000000000002";
const OTHER = "200000000000000003";

/** A server with @everyone's permissions and channels with role overwrites. */
function guild({ everyone = 0n, overwrites = [] } = {}) {
    const channels = overwrites.map(([name, roleId, allow], i) => ({
        id: `c${i}`,
        name,
        permissionOverwrites: { cache: new Map([[roleId, { id: roleId, allow: { bitfield: allow } }]]) },
    }));
    return {
        roles: { everyone: { permissions: { bitfield: everyone } } },
        channels: { cache: new Map(channels.map((c) => [c.id, c])) },
    };
}
const FROM_GUILD = "100000";
const TO_GUILD = "300000";
/** A role-sync pair (#896): fromRoleId on one server, toRoleId on the other. */
const pair = (fromRoleId, toRoleId, direction = "both") => ({ fromGuildId: FROM_GUILD, fromRoleId, toGuildId: TO_GUILD, toRoleId, direction });
const role = (bitfield = 0n) => ({ id: ROLE, permissions: { bitfield } });

afterEach(() => jest.restoreAllMocks());

describe("selfRole privilegedReason", () => {
    it("lets a plain role pass, with or without the Discord role at hand", () => {
        expect(privilegedReason({}, ROLE)).toBe("");
        expect(privilegedReason({}, ROLE, role(0n), guild())).toBe("");
        expect(privilegedReason({ rolePermissions: { [ROLE]: { signup: { read: false } } } }, ROLE)).toBe("");
        expect(privilegedReason({ categoryRoles: { cat: [OTHER] }, roleSync: [pair(OTHER, OTHER)] }, ROLE)).toBe("");
        expect(privilegedReason({ officerRoleId: "" }, ROLE)).toBe("");
        expect(privilegedReason({ officerRoleId: OTHER }, ROLE)).toBe("");
        expect(privilegedReason({}, "")).toBe("");
        expect(privilegedReason(null, ROLE, null)).toBe("");
    });

    it.each([
        ["a full-admin role of the config", { adminRoleIds: [ROLE] }, ROLE, "full-admin"],
        ["a full-admin role of ADMIN_ROLE_IDS", {}, "900000000000000009", "full-admin"],
        ["an orga role", { orgaRoleIds: [ROLE] }, ROLE, "orga role"],
        ["the officer role pinged on applications", { officerRoleId: ROLE }, ROLE, "officer role"],
        ["a role with area grants", { rolePermissions: { [ROLE]: { signup: { read: true } } } }, ROLE, "Berechtigungen"],
        ["a role a bot command allows", { botCommandAccess: { setup: { mode: "roles", roleIds: [OTHER, ROLE] } } }, ROLE, "botCommandAccess"],
        ["a raider role of a category", { categoryRoles: { "cat-1": [ROLE] } }, ROLE, "raider role"],
        ["the target side of the role sync", { roleSync: [pair(OTHER, ROLE, "toTarget")] }, ROLE, "role sync"],
        ["the source side of the role sync", { roleSync: [pair(ROLE, OTHER, "toSource")] }, ROLE, "role sync"],
    ])("refuses %s", (_name, config, roleId, reason) => {
        expect(privilegedReason(config, roleId)).toContain(reason);
    });

    it.each([
        ["its roster role", { roleIds: [OTHER, ROLE] }],
        ["its trial role", { trialRoleId: ROLE }],
        ["its manager role", { managers: { roleIds: [ROLE], userIds: [] } }],
    ])("refuses a role of a roster (%s)", (_name, over) => {
        jest.spyOn(rosterStore, "listRosters").mockReturnValue([
            { id: "r-a", name: "Andere", roleIds: [OTHER], trialRoleId: null, managers: { roleIds: [], userIds: [] } },
            { id: "r-main", name: "Main", roleIds: [], trialRoleId: null, managers: { roleIds: [], userIds: [] }, ...over },
        ]);
        expect(privilegedReason({}, ROLE)).toBe("the role belongs to the roster Main");
    });

    it("counts only Discord permissions beyond those of @everyone", () => {
        const defaults = 0x400n | 0x800n; // ViewChannel, SendMessages
        expect(privilegedReason({}, ROLE, role(defaults), guild({ everyone: defaults }))).toBe("");
        expect(privilegedReason({}, ROLE, role(defaults | 0x8n), guild({ everyone: defaults }))).toBe("the role carries Discord permissions beyond @everyone");
        // the server unknown: every bit counts
        expect(privilegedReason({}, ROLE, role(0x400n))).toBe("the role carries Discord permissions beyond @everyone");
        // the server from the role itself
        expect(privilegedReason({}, ROLE, { ...role(0x400n), guild: guild({ everyone: 0x400n }) })).toBe("");
    });

    it("refuses a role a channel overwrite allows anything (it unlocks the channel)", () => {
        expect(privilegedReason({}, ROLE, role(), guild({ overwrites: [["offiziere", ROLE, 0x400n]] }))).toBe("the role unlocks the channel #offiziere");
        expect(privilegedReason({}, ROLE, null, guild({ overwrites: [["offiziere", ROLE, 0x400n]] }))).toBe("the role unlocks the channel #offiziere");
        // a deny-only overwrite or one of another role is fine
        expect(privilegedReason({}, ROLE, role(), guild({ overwrites: [["laut", ROLE, 0n], ["offiziere", OTHER, 0x400n]] }))).toBe("");
    });

    it("keeps working when the roster store cannot be read", () => {
        jest.spyOn(rosterStore, "listRosters").mockImplementation(() => { throw new Error("broken"); });
        expect(privilegedReason({}, ROLE)).toBe("");
    });
});

describe("selfRole roleUses", () => {
    it("lists every use with its context, in privilegedReason's order", () => {
        jest.spyOn(rosterStore, "listRosters").mockReturnValue([
            { id: "r-a", name: "Andere", roleIds: [OTHER], trialRoleId: null, managers: { roleIds: [], userIds: [] } },
            { id: "r-main", name: "Main", roleIds: [ROLE], trialRoleId: ROLE, managers: { roleIds: [ROLE], userIds: [] } },
        ]);
        const config = {
            adminRoleIds: [ROLE],
            orgaRoleIds: [ROLE],
            officerRoleId: ROLE,
            rolePermissions: { [ROLE]: { signup: { read: true }, loot: { read: true, write: true } } },
            botCommandAccess: { setup: { mode: "roles", roleIds: [ROLE] }, absence: { mode: "roles", roleIds: [OTHER] }, kader: { mode: "roles", roleIds: [ROLE] } },
            categoryRoles: { "cat-1": [ROLE], "cat-2": [OTHER], "cat-3": [ROLE] },
            roleSync: [pair(ROLE, OTHER), pair(OTHER, ROLE)],
        };
        expect(roleUses(config, ROLE)).toEqual([
            { code: "admin" },
            { code: "orga" },
            { code: "officer" },
            { code: "rolePermissions", areas: ["loot", "signup"] },
            { code: "botCommand", commands: ["kader", "setup"] },
            { code: "categoryRaider", categoryIds: ["cat-1", "cat-3"] },
            { code: "roleSync", guildIds: [TO_GUILD, FROM_GUILD] },
            { code: "roster", rosterId: "r-main", name: "Main", kinds: ["member", "trial", "manager"] },
        ]);
        // the first use stays privilegedReason's reason
        expect(privilegedReason(config, ROLE)).toBe("the role is a full-admin role");
    });

    it("names the server on the other side of each role-sync pair, once (#897)", () => {
        jest.spyOn(rosterStore, "listRosters").mockReturnValue([]);
        expect(roleUses({ roleSync: [pair(OTHER, ROLE)] }, ROLE)).toEqual([{ code: "roleSync", guildIds: [FROM_GUILD] }]);
        expect(roleUses({ roleSync: [pair(ROLE, OTHER)] }, ROLE)).toEqual([{ code: "roleSync", guildIds: [TO_GUILD] }]);
        const third = { fromGuildId: "500000", fromRoleId: ROLE, toGuildId: TO_GUILD, toRoleId: OTHER, direction: "both" };
        expect(roleUses({ roleSync: [pair(ROLE, OTHER), third] }, ROLE)).toEqual([{ code: "roleSync", guildIds: [TO_GUILD] }]);
    });

    it("names a PuG version role with its versions; a class role is no use (#906)", () => {
        jest.spyOn(rosterStore, "listRosters").mockReturnValue([]);
        const config = { pugRoles: {
            "g-1": { versions: { tbc: ROLE, forever: OTHER }, classes: { Mage: OTHER } },
            "g-2": { versions: { forever: ROLE, tbc: ROLE }, classes: {} },
            broken: null,
        } };
        expect(roleUses(config, ROLE)).toEqual([{ code: "pugVersion", versionIds: ["tbc", "forever"] }]);
        expect(privilegedReason(config, ROLE)).toBe("the role is a PuG version role (Rollen & Onboarding)");
        expect(roleUses({ pugRoles: { "g-1": { versions: {}, classes: { Mage: ROLE } } } }, ROLE)).toEqual([]);
    });

    it("is empty for a plain role, no id or no config", () => {
        jest.spyOn(rosterStore, "listRosters").mockReturnValue([]);
        expect(roleUses({ categoryRoles: { c: [OTHER] } }, ROLE)).toEqual([]);
        expect(roleUses({}, "")).toEqual([]);
        expect(roleUses(null, ROLE)).toEqual([]);
        expect(roleUses({ botCommandAccess: [], categoryRoles: null, roleSync: [null] }, ROLE)).toEqual([]);
    });

    it("names a roster by its id when it has no name", () => {
        jest.spyOn(rosterStore, "listRosters").mockReturnValue([{ id: "r-x", roleIds: [ROLE] }]);
        expect(roleUses({}, ROLE)).toEqual([{ code: "roster", rosterId: "r-x", name: "", kinds: ["member"] }]);
        expect(privilegedReason({}, ROLE)).toBe("the role belongs to the roster r-x");
    });

    it("reads the given rosters instead of the store (#930)", () => {
        const stored = jest.spyOn(rosterStore, "listRosters").mockReturnValue([{ id: "r-x", roleIds: [ROLE] }]);
        expect(roleUses({}, ROLE, { rosters: [{ id: "r-y", name: "Neu", trialRoleId: ROLE }, null] }))
            .toEqual([{ code: "roster", rosterId: "r-y", name: "Neu", kinds: ["trial"] }]);
        expect(roleUses({}, ROLE, { rosters: [] })).toEqual([]);
        expect(stored).not.toHaveBeenCalled();
    });
});

describe("selfRole changeSelfRole", () => {
    const { changeSelfRole } = require("../../../src/services/discord/selfRole");
    const MANAGE_ROLES = 0x10000000n;

    /** A guild with the bot (Manage Roles, highest role at 10), the role and a member. */
    function setup({ roleOver = {}, has = false, me = {}, fetchRole = null, fetchMember = null } = {}) {
        const theRole = { id: ROLE, name: "Forever", position: 1, managed: false, permissions: { bitfield: 0n }, ...roleOver };
        const roles = new Set(has ? [ROLE] : []);
        const member = {
            id: "u1",
            roles: {
                cache: { has: (id) => roles.has(id) },
                add: jest.fn(async (id) => { roles.add(id); }),
                remove: jest.fn(async (id) => { roles.delete(id); }),
            },
        };
        const bot = { permissions: { has: (flag) => (BigInt(flag) & (me.bits === undefined ? MANAGE_ROLES : me.bits)) !== 0n }, roles: { highest: { position: 10 } } };
        const g = {
            id: "g1",
            roles: { cache: new Map(fetchRole ? [] : [[ROLE, theRole]]), fetch: jest.fn(fetchRole || (async () => null)), everyone: { permissions: { bitfield: 0n } } },
            members: { me: bot, fetch: jest.fn(fetchMember || (async () => member)) },
            channels: { cache: new Map() },
        };
        return { g, member, theRole };
    }

    it("toggles: gives the role to who lacks it, takes it from who has it", async () => {
        const { g, member } = setup();
        expect(await changeSelfRole({ guild: g, roleId: ROLE, userId: "u1", reasons: { add: "A", remove: "R" } })).toMatchObject({ ok: true, on: true, changed: true });
        expect(member.roles.add).toHaveBeenCalledWith(ROLE, "A");
        expect(await changeSelfRole({ guild: g, roleId: ROLE, member, reasons: { add: "A", remove: "R" } })).toMatchObject({ ok: true, on: false, changed: true });
        expect(member.roles.remove).toHaveBeenCalledWith(ROLE, "R");
    });

    it("add and remove only change what is needed", async () => {
        const { g, member } = setup({ has: true });
        expect(await changeSelfRole({ guild: g, roleId: ROLE, member, mode: "add" })).toMatchObject({ ok: true, on: true, changed: false });
        expect(member.roles.add).not.toHaveBeenCalled();
        expect(await changeSelfRole({ guild: g, roleId: ROLE, member, mode: "remove" })).toMatchObject({ ok: true, on: false, changed: true });
        expect(await changeSelfRole({ guild: g, roleId: ROLE, member, mode: "remove" })).toMatchObject({ ok: true, on: false, changed: false });
    });

    it("refuses a privileged role in both directions and touches nothing", async () => {
        for (const has of [false, true]) {
            const { g, member } = setup({ has });
            const result = await changeSelfRole({ guild: g, roleId: ROLE, member, config: { orgaRoleIds: [ROLE] }, mode: has ? "remove" : "add" });
            expect(result).toMatchObject({ ok: false, code: "refused", detail: "the role is an orga role" });
            expect(member.roles.add).not.toHaveBeenCalled();
            expect(member.roles.remove).not.toHaveBeenCalled();
        }
    });

    it.each([
        ["no Manage Roles", { me: { bits: 0n } }, "missing Manage Roles"],
        ["an integration's role", { roleOver: { managed: true } }, "the role belongs to an integration"],
        ["a role above the bot", { roleOver: { editable: false } }, "the role is above the bot's highest role"],
        ["a role at the bot's height", { roleOver: { position: 10 } }, "the role is above the bot's highest role"],
    ])("refuses what Discord would refuse (%s)", async (_name, opts, detail) => {
        const { g } = setup(opts);
        expect(await changeSelfRole({ guild: g, roleId: ROLE, userId: "u1" })).toMatchObject({ ok: false, code: "refused", detail });
    });

    it("a deleted role, an unreadable role, a missing member, Discord refusing: a code, never a throw", async () => {
        expect(await changeSelfRole({ guild: setup({ fetchRole: async () => null }).g, roleId: ROLE, userId: "u1" })).toEqual({ ok: false, code: "role_missing", detail: "" });
        const unknown = Object.assign(new Error("Unknown Role"), { code: 10011 });
        expect(await changeSelfRole({ guild: setup({ fetchRole: async () => { throw unknown; } }).g, roleId: ROLE, userId: "u1" })).toMatchObject({ code: "role_missing" });
        expect(await changeSelfRole({ guild: setup({ fetchRole: async () => { throw new Error("Service Unavailable"); } }).g, roleId: ROLE, userId: "u1" }))
            .toEqual({ ok: false, code: "role_unreadable", detail: "Service Unavailable" });
        expect(await changeSelfRole({ guild: setup({ fetchMember: async () => { throw new Error("Unknown Member"); } }).g, roleId: ROLE, userId: "u1" }))
            .toMatchObject({ ok: false, code: "member_missing", detail: "Unknown Member" });
        const { g, member } = setup();
        member.roles.add.mockRejectedValueOnce(new Error("Missing Permissions"));
        expect(await changeSelfRole({ guild: g, roleId: ROLE, member })).toMatchObject({ ok: false, code: "discord_error", on: true, detail: "Missing Permissions" });
    });
});
