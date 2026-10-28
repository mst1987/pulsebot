// Top-Items per server and version (#952), through the real router and the
// real config schema (an in-memory config): the page of the active server, a switch that
// saves one item at once, the settings right (read for the page, write for a
// save), 400 without a server and 409 for a tab that loaded another one.
let mockConfig = {};
jest.mock("../../../src/stores/settingsStore", () => {
    const actual = jest.requireActual("../../../src/stores/settingsStore");
    const { normalizeConfig, mergeServerSettings } = jest.requireActual("../../../src/stores/configSchema");
    return {
        ...actual,
        getConfig: jest.fn(() => normalizeConfig(mockConfig)),
        saveConfig: jest.fn((partial) => {
            const next = { ...mockConfig, ...partial };
            if (partial.serverSettings) next.serverSettings = mergeServerSettings(mockConfig.serverSettings, partial.serverSettings);
            mockConfig = next;
        }),
    };
});

const mockHome = "1400000000000000001";
let mockUser = null;
jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => mockUser),
    checkCsrf: jest.fn(() => true),
    getActiveGuild: jest.fn(() => mockHome),
}));
let mockActive = mockHome;
jest.mock("../../../src/web/http/activeGuild", () => ({
    activeGuildFor: jest.fn(() => mockActive),
    pickActiveGuild: jest.fn(async () => mockActive),
}));

const configStore = require("../../../src/stores/settingsStore");
const { emptyAccess } = require("../../../src/config/permissions");
const { topItemIds } = require("../../../src/services/loot/topItems");
const topItemsRoutes = require("../../../src/web/apiRoutes/topItems");
const { json, body, status, routerClient } = require("../../helpers/http");

const { get, request } = routerClient(topItemsRoutes);
const put = (payload) => request("PUT", "/api/settings/top-items", payload);
const G1 = "1400000000000000001";
const G2 = "1400000000000000002";
const servers = { servers: [{ guildId: G1, label: "" }, { guildId: G2, label: "" }] };

const access = (level) => ({ ...emptyAccess(), settings: { read: true, write: level === "write" } });
const orga = (level = "write") => ({ id: "7", name: "Orga", isAdmin: false, isOrga: true, access: access(level) });

// Warglaive of Azzinoth (Main Hand) drops from Illidan in the TBC loot table.
const WARGLAIVE = 32837;

beforeEach(() => {
    mockConfig = {
        guildId: G1, discordServers: servers,
        serverSettings: { [G2]: { topItems: { tbc: [{ id: 1, name: "Fremd", iconUrl: "", quality: 4 }] } } },
    };
    mockUser = orga();
    mockActive = G1;
});

describe("GET /api/settings/top-items (#952)", () => {
    it("answers the loot table of TBC raid by raid and boss by boss, with the picked items of the active server", async () => {
        const res = await get("/api/settings/top-items", { version: "tbc" });
        expect(status(res)).toBe(200);
        const data = body(res);
        expect(data.guildId).toBe(G1);
        expect(data.versionId).toBe("tbc");
        expect(data.items).toEqual([]);
        expect(data.wowheadPath).toBe("tbc");
        expect(data.versions.map((v) => v.id)).toEqual(["tbc", "classic", "forever"]);
        const bt = data.raids.find((r) => r.bosses.some((b) => b.name === "Illidan Stormrage"));
        expect(bt).toBeTruthy();
        const illidan = bt.bosses.find((b) => b.name === "Illidan Stormrage");
        expect(illidan.items.some((it) => it.id === WARGLAIVE && it.quality === 5 && /^https:/.test(it.iconUrl))).toBe(true);
    });

    it("has no loot table for Classic Era and Forever yet - the search alone", async () => {
        for (const version of ["classic", "forever"]) {
            const data = body(await get("/api/settings/top-items", { version }));
            expect(data.versionId).toBe(version);
            expect(data.raids).toEqual([]);
        }
    });

    it("falls back to the main version for an unknown one", async () => {
        const res = await get("/api/settings/top-items", { version: "mists" });
        const data = body(res);
        expect(data.versionId).toBe("tbc");
        expect(data.mainVersion).toBe("tbc");
    });

    it("lets a reader of the settings in", async () => {
        mockUser = orga("read");
        expect(status(await get("/api/settings/top-items", { version: "tbc" }))).toBe(200);
    });

    it("refuses a user without the settings area", async () => {
        mockUser = { id: "8", name: "Raider", isAdmin: false, isOrga: false, access: emptyAccess() };
        expect(status(await get("/api/settings/top-items", { version: "tbc" }))).toBe(403);
    });

    it("400 without an active server", async () => {
        mockActive = "";
        const res = await get("/api/settings/top-items", { version: "tbc" });
        expect(status(res)).toBe(400);
        expect(json(res).error.code).toBe("no_active_server");
    });
});

describe("PUT /api/settings/top-items (#952)", () => {
    it("switches a boss item on with the table's name, icon and quality, and off again", async () => {
        const res = await put({ versionId: "tbc", item: { id: WARGLAIVE, name: "falsch", iconUrl: "javascript:x", quality: 0 }, on: true, serverSettingsGuildId: G1 });
        expect(status(res)).toBe(200);
        const data = body(res);
        expect(data.items).toEqual([expect.objectContaining({ id: WARGLAIVE, name: "Warglaive of Azzinoth", quality: 5 })]);
        expect(data.items[0].iconUrl).toMatch(/^https:\/\//);
        const config = configStore.getConfig();
        expect([...topItemIds(G1, "tbc", { config })]).toEqual([WARGLAIVE]);
        // the other server keeps its own list
        expect([...topItemIds(G2, "tbc", { config })]).toEqual([1]);

        const off = await put({ versionId: "tbc", item: { id: WARGLAIVE }, on: false, serverSettingsGuildId: G1 });
        expect(body(off).items).toEqual([]);
        expect(topItemIds(G1, "tbc", { config: configStore.getConfig() }).size).toBe(0);
    });

    it("stores a searched item without a boss with its own data, per version", async () => {
        const item = { id: 29434, name: "Badge of Justice", iconUrl: "https://wow.zamimg.com/images/wow/icons/large/spell_holy_championsbond.jpg", quality: 4 };
        await put({ versionId: "forever", item, on: true, serverSettingsGuildId: G1 });
        const config = configStore.getConfig();
        expect(config.serverSettings[G1].topItems).toEqual({ forever: [item] });
        expect(topItemIds(G1, "tbc", { config }).size).toBe(0);
    });

    it("cuts the name of a searched item to 200 characters", async () => {
        const res = await put({ versionId: "forever", item: { id: 29434, name: "x".repeat(300), iconUrl: "", quality: 4 }, on: true, serverSettingsGuildId: G1 });
        expect(status(res)).toBe(200);
        expect(body(res).items[0].name).toHaveLength(200);
        expect(configStore.getConfig().serverSettings[G1].topItems.forever[0].name).toBe("x".repeat(200));
    });

    it("refuses a reader of the settings", async () => {
        mockUser = orga("read");
        const res = await put({ versionId: "tbc", item: { id: WARGLAIVE }, on: true, serverSettingsGuildId: G1 });
        expect(status(res)).toBe(403);
        expect(configStore.getConfig().serverSettings[G1]).toBeUndefined();
    });

    it("409 when the tab loaded another server, or names none", async () => {
        mockActive = G2;
        const res = await put({ versionId: "tbc", item: { id: WARGLAIVE }, on: true, serverSettingsGuildId: G1 });
        expect(status(res)).toBe(409);
        expect(json(res).error.code).toBe("server_switched");
        mockActive = G1;
        expect(status(await put({ versionId: "tbc", item: { id: WARGLAIVE }, on: true }))).toBe(409);
        expect([...topItemIds(G2, "tbc", { config: configStore.getConfig() })]).toEqual([1]);
    });

    it("400 for an unknown version or item", async () => {
        expect(json(await put({ versionId: "mists", item: { id: WARGLAIVE }, on: true, serverSettingsGuildId: G1 })).error.code).toBe("bad_version");
        expect(json(await put({ versionId: "tbc", item: { id: -3 }, on: true, serverSettingsGuildId: G1 })).error.code).toBe("bad_item");
        expect(json(await put({ versionId: "tbc", on: true, serverSettingsGuildId: G1 })).error.code).toBe("bad_item");
    });

    it("400 without an active server", async () => {
        mockActive = "";
        const res = await put({ versionId: "tbc", item: { id: WARGLAIVE }, on: true, serverSettingsGuildId: "" });
        expect(status(res)).toBe(400);
    });
});
