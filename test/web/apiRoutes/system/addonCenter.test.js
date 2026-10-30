// The addon download centre's API (src/web/apiRoutes/system/addonCenter.js) through the real router:
// full admins only, the settings saved at once, post and remove.
let mockUser = null;
jest.mock("../../../../src/web/http/auth", () => ({ getUser: () => mockUser, checkCsrf: () => true }));
jest.mock("../../../../src/services/addons/addonCenter", () => ({ saveSettings: jest.fn(), postCenter: jest.fn(), removeCenter: jest.fn() }));
let mockRights = {};
jest.mock("../../../../src/stores/settings/configStore", () => ({ getConfig: () => ({ mainVersion: "forever", categoryVersion: { "cat-tbc": "tbc" }, ...mockRights }) }));
jest.mock("../../../../src/services/discord/roles/guildRoles", () => ({ configuredGuildIds: jest.fn(() => ["g1"]) }));
jest.mock("../../../../src/services/discord/discord", () => ({
    isOnline: () => true,
    listGuilds: () => [{ id: "g1", name: "Gilde" }, { id: "g2", name: "Talk" }],
    listRoles: jest.fn((guildId) => (guildId === "g1" ? [{ id: "r1", name: "Addon-Updates" }] : [])),
    getGuild: jest.fn(() => null),
    listTextChannels: jest.fn((guildId) => (guildId === "g1"
        ? [{ id: "111111111111111111", name: "addon-downloads", category: "Allgemein", parentId: "" }, { id: "222222222222222222", name: "tbc-chat", category: "TBC", parentId: "cat-tbc" }]
        : [{ id: "c9", name: "talk", category: "", parentId: "" }])),
}));

const addonCenter = require("../../../../src/services/addons/addonCenter");
const guildRoles = require("../../../../src/services/discord/roles/guildRoles");
const store = require("../../../../src/stores/settings/addonCenterStore");
const route = require("../../../../src/web/apiRoutes/system/addonCenter");
const { emptyAccess } = require("../../../../src/config/permissions");
const { tempStoreFile } = require("../../../helpers/tempStore");
const { routerClient, status, body } = require("../../../helpers/http");

const { get, post, request } = routerClient(route);
const ADMIN = { id: "1", name: "Admin", isAdmin: true };
const SETTINGS_USER = { id: "7", name: "Bob", isAdmin: false, access: { ...emptyAccess(), settings: { read: true, write: true } } };

beforeAll(() => store.useFile(tempStoreFile("addon-center.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    jest.clearAllMocks();
    store.useFile(tempStoreFile("addon-center.json"));
    mockUser = ADMIN;
    guildRoles.configuredGuildIds.mockReturnValue(["g1"]);
    mockRights = {};
});

describe("apiRoutes/addonCenter rolesOf", () => {
    const discord = require("../../../../src/services/discord/discord");

    it("flags a role with bot rights or Discord permissions as privileged (the card warns, the centre hides the button)", async () => {
        discord.listRoles.mockImplementation(() => [
            { id: "r1", name: "Gilde" }, { id: "r2", name: "Orga" }, { id: "r3", name: "Mod" }, { id: "r4", name: "Updates" },
            { id: "r5", name: "Offizier-Kanal" }, { id: "r6", name: "Bewerbungen" },
        ]);
        discord.getGuild.mockImplementation(() => ({
            roles: {
                cache: new Map(["r3", "r4", "r5", "r6"].map((id) => [id, { id, permissions: { bitfield: id === "r3" ? 0x408n : 0x400n } }])),
                everyone: { permissions: { bitfield: 0x400n } },
            },
            channels: { cache: new Map([["c1", { id: "c1", name: "offiziere", permissionOverwrites: { cache: new Map([["r5", { allow: { bitfield: 0x400n } }]]) } }]]) },
        }));
        mockRights = { rolePermissions: { r1: { signup: { read: true } } }, orgaRoleIds: ["r2"], serverSettings: { "900000000000000009": { officerRoleId: "r6" } } };
        const roles = body(await get("/api/addon-center")).roles.g1;
        // r6 is the officer role pinged on applications: whoever took it would read every application
        expect(roles.map((r) => [r.id, r.privileged])).toEqual([
            ["r1", true], ["r2", true], ["r3", true], ["r4", false], ["r5", true], ["r6", true],
        ]);
        discord.listRoles.mockImplementation((guildId) => (guildId === "g1" ? [{ id: "r1", name: "Addon-Updates" }] : []));
        discord.getGuild.mockImplementation(() => null);
    });
});

describe("apiRoutes/addonCenter", () => {
    it("shows the settings, the posted centre, the last check, the channels with their game version", async () => {
        store.setSettings({ channelId: "123456789012345678" });
        store.setCenter({ guildId: "g1", channelId: "123456789012345678", messageId: "m1", url: "https://discord.com/channels/g1/123456789012345678/m1" }, { now: 5 });
        store.setCheckedAt(9);
        const res = await get("/api/addon-center");
        expect(status(res)).toBe(200);
        expect(body(res)).toEqual({
            settings: { channelId: "123456789012345678", roleId: "", versionId: "" },
            center: { channelId: "123456789012345678", postedAt: 5, url: "https://discord.com/channels/g1/123456789012345678/m1" },
            checkedAt: 9,
            online: true,
            channels: [
                { id: "111111111111111111", name: "addon-downloads", guildId: "g1", category: "WoW Forever" },
                { id: "222222222222222222", name: "tbc-chat", guildId: "g1", category: "TBC Anniversary" },
            ],
            roles: { g1: [{ id: "r1", name: "Addon-Updates", privileged: false }] },
            versions: [{ id: "tbc", label: "TBC Anniversary" }, { id: "classic", label: "Classic Era" }, { id: "forever", label: "WoW Forever" }],
            autoVersion: null,
        });
    });

    it("names the version \"automatic\" means for the chosen channel (its category's), none without a channel", async () => {
        expect(body(await get("/api/addon-center")).autoVersion).toBeNull();
        store.setSettings({ channelId: "222222222222222222" });
        expect(body(await get("/api/addon-center")).autoVersion).toEqual({ id: "tbc", label: "TBC Anniversary" });
        store.setSettings({ channelId: "111111111111111111", versionId: "classic" });
        const view = body(await get("/api/addon-center"));
        expect(view.settings.versionId).toBe("classic");
        expect(view.autoVersion).toEqual({ id: "forever", label: "WoW Forever" });
    });

    it("hands the game version on and answers an unknown one with 400", async () => {
        addonCenter.saveSettings.mockResolvedValueOnce({ settings: {}, center: null });
        expect(status(await request("PUT", "/api/addon-center", { versionId: "tbc" }))).toBe(200);
        expect(addonCenter.saveSettings).toHaveBeenLastCalledWith({ versionId: "tbc" }, { by: "1" });
        addonCenter.saveSettings.mockResolvedValueOnce({ settings: {}, center: null });
        await request("PUT", "/api/addon-center", { versionId: null });
        expect(addonCenter.saveSettings).toHaveBeenLastCalledWith({ versionId: "" }, { by: "1" });
        addonCenter.saveSettings.mockResolvedValueOnce({ error: "Ungültige Spielversion." });
        expect(status(await request("PUT", "/api/addon-center", { versionId: "nope" }))).toBe(400);
    });

    it("names the server next to the version when there are two", async () => {
        guildRoles.configuredGuildIds.mockReturnValue(["g1", "g2"]);
        const res = await get("/api/addon-center");
        expect(body(res).channels.map((c) => c.category)).toEqual(["Gilde · WoW Forever", "Gilde · TBC Anniversary", "Talk · WoW Forever"]);
    });

    it("is for full admins only, even with write access to the settings", async () => {
        mockUser = SETTINGS_USER;
        expect(status(await get("/api/addon-center"))).toBe(403);
        expect(status(await request("PUT", "/api/addon-center", { channelId: "1" }))).toBe(403);
        expect(status(await post("/api/addon-center", {}))).toBe(403);
        expect(status(await request("DELETE", "/api/addon-center", {}))).toBe(403);
        expect(addonCenter.saveSettings).not.toHaveBeenCalled();
        mockUser = null;
        expect(status(await get("/api/addon-center"))).toBe(401);
    });

    it("saves the settings at once: only the fields sent (channel, role, version); the old announce is not passed on", async () => {
        addonCenter.saveSettings.mockResolvedValue({ settings: {}, center: null });
        const res = await request("PUT", "/api/addon-center", { channelId: "123456789012345678", roleId: "223456789012345678", announce: true, other: 1 });
        expect(status(res)).toBe(200);
        expect(addonCenter.saveSettings).toHaveBeenCalledWith({ channelId: "123456789012345678", roleId: "223456789012345678" }, { by: "1" });
        expect(body(res).roles).toEqual({ g1: [{ id: "r1", name: "Addon-Updates", privileged: false }] });
        expect(body(res).settings).toEqual({ channelId: "", roleId: "", versionId: "" });
    });

    it("answers a refused setting with 400 and a failed move as a warning next to the saved settings", async () => {
        addonCenter.saveSettings.mockResolvedValueOnce({ error: "Ungültiger Kanal." });
        const bad = await request("PUT", "/api/addon-center", { channelId: "x" });
        expect(status(bad)).toBe(400);
        addonCenter.saveSettings.mockResolvedValueOnce({ error: "Ungültige Rolle." });
        const badRole = await request("PUT", "/api/addon-center", { roleId: "abc" });
        expect(status(badRole)).toBe(400);
        expect(body(badRole).error.message || body(badRole).message || JSON.stringify(body(badRole))).toMatch(/Ungültige Rolle/);
        addonCenter.saveSettings.mockResolvedValueOnce({ settings: {}, center: null, error: "Die Downloadzentrale konnte nicht gepostet werden: Missing Access" });
        const moved = await request("PUT", "/api/addon-center", { channelId: "123456789012345678" });
        expect(status(moved)).toBe(200);
        expect(body(moved).warning).toMatch(/Missing Access/);
    });

    it("posts the centre and answers the new view; a refusal is 400", async () => {
        addonCenter.postCenter.mockResolvedValueOnce({ center: {} });
        const res = await post("/api/addon-center", {});
        expect(status(res)).toBe(200);
        expect(addonCenter.postCenter).toHaveBeenCalledWith({ by: "1" });
        addonCenter.postCenter.mockResolvedValueOnce({ error: "Kein Kanal gewählt." });
        const refused = await post("/api/addon-center", {});
        expect(status(refused)).toBe(400);
    });

    it("removes the centre, 404 when none is posted", async () => {
        addonCenter.removeCenter.mockResolvedValueOnce({ messageId: "m1" }).mockResolvedValueOnce(null);
        expect(status(await request("DELETE", "/api/addon-center", {}))).toBe(200);
        expect(status(await request("DELETE", "/api/addon-center", {}))).toBe(404);
    });

    it("an unreachable Discord leaves the lists empty instead of failing", async () => {
        guildRoles.configuredGuildIds.mockImplementation(() => { throw new Error("offline"); });
        const res = await get("/api/addon-center");
        expect(status(res)).toBe(200);
        expect(body(res).channels).toEqual([]);
    });
});
