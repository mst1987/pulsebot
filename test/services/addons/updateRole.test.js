// Whether a role may be the self-service update role (src/services/addons/updateRole.js):
// never one that grants bot rights (admin, orga, area grants, bot commands, raider role,
// roster, role sync), Discord permissions beyond @everyone or a channel.
jest.mock("../../../src/config/variables", () => ({ adminRoleIds: ["900000000000000009"] }));

const rosterStore = require("../../../src/stores/rosterStore");
const { privilegedReason } = require("../../../src/services/addons/updateRole");

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
const role = (bitfield = 0n) => ({ id: ROLE, permissions: { bitfield } });

afterEach(() => jest.restoreAllMocks());

describe("updateRole privilegedReason", () => {
    it("lets a plain role pass, with or without the Discord role at hand", () => {
        expect(privilegedReason({}, ROLE)).toBe("");
        expect(privilegedReason({}, ROLE, role(0n), guild())).toBe("");
        expect(privilegedReason({ rolePermissions: { [ROLE]: { signup: { read: false } } } }, ROLE)).toBe("");
        expect(privilegedReason({ categoryRoles: { cat: [OTHER] }, roleSync: [{ eventRoleId: OTHER, talkRoleId: OTHER }] }, ROLE)).toBe("");
        expect(privilegedReason({}, "")).toBe("");
        expect(privilegedReason(null, ROLE, null)).toBe("");
    });

    it.each([
        ["a full-admin role of the config", { adminRoleIds: [ROLE] }, ROLE, "full-admin"],
        ["a full-admin role of ADMIN_ROLE_IDS", {}, "900000000000000009", "full-admin"],
        ["an orga role", { orgaRoleIds: [ROLE] }, ROLE, "orga role"],
        ["a role with area grants", { rolePermissions: { [ROLE]: { signup: { read: true } } } }, ROLE, "Berechtigungen"],
        ["a role a bot command allows", { botCommandAccess: { setup: { mode: "roles", roleIds: [OTHER, ROLE] } } }, ROLE, "botCommandAccess"],
        ["a raider role of a category", { categoryRoles: { "cat-1": [ROLE] } }, ROLE, "raider role"],
        ["the talk side of the role sync", { roleSync: [{ eventRoleId: OTHER, talkRoleId: ROLE, direction: "toTalk" }] }, ROLE, "role sync"],
        ["the event side of the role sync", { roleSync: [{ eventRoleId: ROLE, talkRoleId: OTHER, direction: "toEvent" }] }, ROLE, "role sync"],
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
