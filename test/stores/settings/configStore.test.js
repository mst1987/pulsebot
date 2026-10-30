jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
// Count the normalisations: the cache must not run them again for an unchanged file.
jest.mock("../../../src/stores/settings/configSchema", () => {
    const actual = jest.requireActual("../../../src/stores/settings/configSchema");
    return { ...actual, normalizeConfig: jest.fn(actual.normalizeConfig) };
});

const fs = require("fs");
const { settingsPath } = require("../../../src/config/paths");
const { normalizeConfig } = require("../../../src/stores/settings/configSchema");
const configStore = require("../../../src/stores/settings/configStore");

const FILE = settingsPath("config.json");
const writeFile = (value) => fs.__store.set(FILE, JSON.stringify(value));

beforeEach(() => {
    fs.__store.clear();
    configStore.useFile(null);
});

describe("stores/settings/configStore getConfig cache (#420)", () => {
    it("normalises a file once and hands every caller its own copy", () => {
        writeFile({ adminRoleIds: ["1"], categoryRoles: { c: ["r"] } });
        normalizeConfig.mockClear();
        const a = configStore.getConfig();
        const b = configStore.getConfig();
        expect(normalizeConfig).toHaveBeenCalledTimes(1);
        expect(a).toEqual(b);
        expect(a).not.toBe(b);
        a.adminRoleIds.push("evil");
        a.categoryRoles.c = [];
        a.guildId = "changed";
        expect(configStore.getConfig().adminRoleIds).toEqual(["1"]);
        expect(configStore.getConfig().categoryRoles).toEqual({ c: ["r"] });
        expect(normalizeConfig).toHaveBeenCalledTimes(1);
    });

    it("normalises again when the file changes on disk (an edit by hand)", () => {
        writeFile({ adminRoleIds: ["1"] });
        expect(configStore.getConfig().adminRoleIds).toEqual(["1"]);
        writeFile({ adminRoleIds: ["2"] });
        expect(configStore.getConfig().adminRoleIds).toEqual(["2"]);
    });

    it("a save drops the kept config", () => {
        writeFile({ adminRoleIds: ["1"] });
        configStore.getConfig();
        normalizeConfig.mockClear();
        expect(configStore.saveConfig({ adminRoleIds: ["3"] }).adminRoleIds).toEqual(["3"]);
        expect(configStore.getConfig().adminRoleIds).toEqual(["3"]);
        expect(normalizeConfig).toHaveBeenCalledTimes(1);
    });

    it("a missing file reads as the defaults, a copy each time", () => {
        const a = configStore.getConfig();
        a.adminRoleIds.push("x");
        expect(configStore.getConfig().adminRoleIds).toEqual([]);
        expect(configStore.getConfig()).toEqual(normalizeConfig({}));
    });

    it("an unreadable file reads as the defaults", () => {
        fs.__store.set(FILE, "{ not json");
        expect(configStore.getConfig()).toEqual(normalizeConfig({}));
    });
});

describe("stores/settings/configStore stored file", () => {
    it("readStored returns the file as it is, writeStored replaces it", () => {
        expect(configStore.readStored()).toEqual({});
        configStore.writeStored({ raidDefaults: { templateId: "3" }, extra: 1 });
        expect(configStore.readStored()).toEqual({ raidDefaults: { templateId: "3" }, extra: 1 });
        expect(configStore.getConfig().extra).toBe(1);
        fs.__store.set(FILE, "[1]");
        expect(configStore.readStored()).toEqual({});
    });

    it("useFile points both reads and writes at another file", () => {
        const other = settingsPath("other-config.json");
        configStore.useFile(other);
        configStore.saveConfig({ adminRoleIds: ["9"] });
        expect(JSON.parse(fs.__store.get(other)).adminRoleIds).toEqual(["9"]);
        expect(fs.__store.has(FILE)).toBe(false);
        expect(configStore.readStored().adminRoleIds).toEqual(["9"]);
        configStore.useFile(null);
        expect(configStore.getConfig().adminRoleIds).toEqual([]);
    });
});

describe("stores/settings/configStore saveConfig", () => {
    it("merges the nested blocks and normalises the category maps", () => {
        configStore.saveConfig({ blizzard: { clientId: "id" }, versionSettings: { tbc: { blizzardRegion: "us" } }, anthropic: { model: "m" }, warcraftlogsV2: { clientId: "w" }, categoryLootTool: { a: "rclc" } });
        const saved = configStore.saveConfig({
            serverSettings: { "1100000000000000001": { raidDefaults: { channelId: "ch" } } }, blizzard: { clientSecret: "s" }, versionSettings: { tbc: { blizzardRealmSlug: "x" }, forever: { wowheadPath: "forever" } }, categoryLootTool: { b: "gargul" },
            categoryLootSystem: { a: "gdkp" }, raidhelperRetirement: { disabled: true, at: 5, byName: "M" },
            categorySignupSource: { a: "raidhelper" }, categorySetupDms: { a: true }, categoryDiscordEvent: { a: true },
            categoryVoiceChannel: { a: "1300000000000000001" }, categoryMessageLook: { a: { titleSize: "huge" } },
            categoryAnnounce: { a: { enabled: true, target: "talk" } }, categorySignupNotes: { a: "none" },
            categorySignupNoteChannel: { a: "1300000000000000002" }, categoryRaidTemplate: { a: "t" },
            categorySheets: { a: { url: "https://x" } }, topItems: [{ id: 1 }], roleSync: [], categoryReminders: {},
            guildId: "1100000000000000001", discordServers: { servers: [{ guildId: "1100000000000000001" }] },
        });
        expect(saved.blizzard).toEqual({ clientId: "id", clientSecret: "s" });
        // per version and per field (#542): the TBC block keeps what it had, Forever gets its path
        expect(saved.versionSettings.tbc).toMatchObject({ blizzardRegion: "us", blizzardRealmSlug: "x", wowheadPath: "tbc" });
        expect(saved.versionSettings.forever).toMatchObject({ wowheadPath: "forever", blizzardRealmSlug: "" });
        expect(saved.anthropic.model).toBe("m");
        expect(saved.warcraftlogsV2.clientId).toBe("w");
        expect(saved.categoryLootTool).toEqual({ a: "rclc", b: "gargul" });
        expect(saved.serverSettings["1100000000000000001"].raidDefaults).toEqual({ channelId: "ch" });
        expect(saved.raidhelperRetirement).toEqual({ disabled: true, at: 5, byName: "M" });
        expect(saved.categoryRaidTemplate).toEqual({ a: "t" });
        expect(saved.guildId).toBe("1100000000000000001");
        expect(saved.categorySignupNoteChannel).toEqual({ a: "1300000000000000002" });
    });

    // #897: the block is merged field by field over the stored one and normalised once,
    // a link keeps its language and versions, no old dialog shape is read any more.
    it("keeps lang and versions of a link and the links when only the servers are sent (#897)", () => {
        const A = "1100000000000000011";
        const B = "1100000000000000012";
        const C = "1100000000000000013";
        configStore.saveConfig({ guildId: A, discordServers: {
            servers: [{ guildId: A }, { guildId: B }, { guildId: C }],
            links: [{ from: A, to: B, channelId: "1200000000000000001", lang: "en", versions: ["tbc", "nope"] }],
        } });
        expect(configStore.getConfig().discordServers.links).toEqual([
            { from: A, to: B, channelId: "1200000000000000001", lang: "en", versions: ["tbc"] },
        ]);
        const saved = configStore.saveConfig({ discordServers: { servers: [{ guildId: A }, { guildId: C }] } });
        expect(saved.discordServers.servers.map((s) => s.guildId)).toEqual([A, C]);
        expect(saved.discordServers.links).toEqual([
            { from: A, to: B, channelId: "1200000000000000001", lang: "en", versions: ["tbc"] },
        ]);
        expect(saved.discordServers).not.toHaveProperty("talkGuildId");
    });

    // The switch "PuG-Server" (#906): kept when on, no field when off.
    it("keeps the switch PuG-Server of a server through a save", () => {
        const A = "1100000000000000041";
        const C = "1100000000000000043";
        const saved = configStore.saveConfig({ guildId: A, discordServers: {
            servers: [{ guildId: A, pug: true }, { guildId: C, pug: false }],
        } });
        expect(saved.discordServers.servers).toEqual([
            { guildId: A, label: "", pug: true },
            { guildId: C, label: "" },
        ]);
    });

    // Prod, Oct 2026: the list was empty (main server only through guildId), adding a
    // second server saved just that one and the main server lost its rights and loops.
    it("keeps the implicit main server first when a server is added to an empty list", () => {
        const MAIN = "1100000000000000031";
        const NEW = "1100000000000000032";
        configStore.saveConfig({ guildId: MAIN, discordServers: { servers: [] } });
        expect(configStore.getConfig().discordServers.servers).toEqual([]);
        const saved = configStore.saveConfig({ discordServers: { servers: [{ guildId: NEW, label: "PuGs" }] } });
        expect(saved.discordServers.servers.map((s) => s.guildId)).toEqual([MAIN, NEW]);
        expect(saved.guildId).toBe(MAIN);
        // once listed, the main server can be removed like any other
        expect(configStore.saveConfig({ discordServers: { servers: [{ guildId: NEW }] } }).guildId).toBe(NEW);
    });

    // A pure link target is no server: it must not gain the rights of a
    // raid server (userAccess, reminders, category lifecycle ...).
    describe("link targets stay outside the servers (#890)", () => {
        const A = "1100000000000000021";
        const B = "1100000000000000022";
        const X = "1100000000000000023";
        const CH = "1200000000000000021";
        const ids = (cfg) => cfg.discordServers.servers.map((s) => s.guildId);
        // A is the main server, so it is not added in front of the first list
        beforeEach(() => configStore.saveConfig({ guildId: A }));

        it("a removed link target X stays gone, also after a second save", () => {
            configStore.saveConfig({ discordServers: { servers: [{ guildId: A }], links: [{ from: A, to: X, channelId: CH }] } });
            expect(ids(configStore.getConfig())).toEqual([A]);
            expect(configStore.getConfig().discordServers.links).toHaveLength(1);
            configStore.saveConfig({ discordServers: { links: [] } });
            configStore.saveConfig({ discordServers: { links: [] } });
            expect(ids(configStore.getConfig())).toEqual([A]);
            expect(configStore.getConfig().discordServers.links).toEqual([]);
        });

        it("a removed server B with a remaining link A -> B does not come back as a server", () => {
            configStore.saveConfig({ discordServers: { servers: [{ guildId: A }, { guildId: B }], links: [{ from: A, to: B, channelId: CH }] } });
            expect(ids(configStore.getConfig())).toEqual([A, B]);
            const saved = configStore.saveConfig({ discordServers: { servers: [{ guildId: A }] } });
            expect(ids(saved)).toEqual([A]);
            expect(saved.discordServers.links).toEqual([{ from: A, to: B, channelId: CH, lang: "", versions: [] }]);
        });

        // an old stored talk field is read as a server once and then gone (#897)
        it("an old stored talk server becomes an ordinary server and can be removed", () => {
            const T = "1100000000000000024";
            configStore.saveConfig({ discordServers: { servers: [{ guildId: A }], links: [], talkGuildId: T } });
            const first = configStore.getConfig().discordServers;
            expect(ids({ discordServers: first })).toEqual([A, T]);
            expect(first).not.toHaveProperty("talkGuildId");
            expect(ids(configStore.saveConfig({ discordServers: { servers: [{ guildId: A }] } }))).toEqual([A]);
        });
    });

    it("merges the characters per signup per category; 8 sets a category back to the default", () => {
        configStore.saveConfig({ categorySignupCharacters: { a: 3, b: 2 } });
        expect(configStore.saveConfig({ categorySignupCharacters: { a: 8, c: 5 } }).categorySignupCharacters).toEqual({ b: 2, c: 5 });
        expect(configStore.getConfig().categorySignupCharacters).toEqual({ b: 2, c: 5 });
    });
});

describe("stores/settings/configStore resolveEventSheetLink", () => {
    it("prefers the raid's own copy, then the category's sheet, else nothing", () => {
        configStore.saveConfig({ categorySheets: { cat: { url: "https://cat", name: "Kat" } } });
        expect(configStore.resolveEventSheetLink({ url: "https://own", sheetName: "Own" }, "cat")).toEqual({ url: "https://own", name: "Own", source: "event" });
        expect(configStore.resolveEventSheetLink(null, " cat ")).toEqual({ url: "https://cat", name: "Kat", source: "category" });
        expect(configStore.resolveEventSheetLink(null, "none")).toBeNull();
    });

    it("links nothing for a category that plans with the raid plan - not even a filled copy", () => {
        configStore.saveConfig({
            categorySheets: { cat: { url: "https://cat", name: "Kat" } },
            categoryPlanning: { cat: "raidplan", other: "sheet" },
        });
        expect(configStore.resolveEventSheetLink({ url: "https://own" }, "cat")).toBeNull();
        expect(configStore.resolveEventSheetLink(null, "cat")).toBeNull();
        // picked "sheet" without a fixed sheet: only a filled copy is linked
        expect(configStore.resolveEventSheetLink({ url: "https://own" }, "other")).toEqual({ url: "https://own", name: "", source: "event" });
        expect(configStore.resolveEventSheetLink(null, "other")).toBeNull();
        // no category at all has no fixed sheet, so it plans with the raid plan
        expect(configStore.resolveEventSheetLink({ url: "https://own" }, undefined)).toBeNull();
        // a category without a fixed sheet and without a pick: the raid plan
        expect(configStore.resolveEventSheetLink({ url: "https://own" }, "none")).toBeNull();
    });
});

describe("stores/settings/configStore categoryPlanning", () => {
    it("starts empty and merges per category, dropping unknown modes", () => {
        expect(configStore.getConfig().categoryPlanning).toEqual({});
        configStore.saveConfig({ categoryPlanning: { a: "sheet", b: "raidplan" } });
        configStore.saveConfig({ categoryPlanning: { b: "sheet", c: "both" } });
        expect(configStore.getConfig().categoryPlanning).toEqual({ a: "sheet", b: "sheet" });
    });

    it("normalises a stored map by hand", () => {
        writeFile({ categoryPlanning: { " x ": "raidplan", y: 1, z: "sheet", "": "sheet" } });
        expect(configStore.getConfig().categoryPlanning).toEqual({ x: "raidplan", z: "sheet" });
        writeFile({ categoryPlanning: ["sheet"] });
        expect(configStore.getConfig().categoryPlanning).toEqual({});
    });
});

describe("stores/settings/configStore main version (#541)", () => {
    it("reads tbc and no category override while nothing is stored", () => {
        const config = configStore.getConfig();
        expect(config.mainVersion).toBe("tbc");
        expect(config.categoryVersion).toEqual({});
    });

    it("keeps only version ids a rule set knows", () => {
        writeFile({ mainVersion: "wotlk", categoryVersion: { a: "forever", b: "cata", c: "", " ": "tbc" } });
        const config = configStore.getConfig();
        expect(config.mainVersion).toBe("tbc");
        expect(config.categoryVersion).toEqual({ a: "forever" });
        writeFile({ mainVersion: "forever", categoryVersion: ["forever"] });
        expect(configStore.getConfig()).toMatchObject({ mainVersion: "forever", categoryVersion: {} });
    });

    it("saves the main version and replaces the category map as a whole", () => {
        configStore.saveConfig({ mainVersion: "forever", categoryVersion: { a: "tbc", b: "classic" } });
        expect(configStore.getConfig()).toMatchObject({ mainVersion: "forever", categoryVersion: { a: "tbc", b: "classic" } });
        const saved = configStore.saveConfig({ categoryVersion: { b: "classic", x: "nope" } });
        expect(saved.mainVersion).toBe("forever");
        expect(saved.categoryVersion).toEqual({ b: "classic" });
        expect(configStore.saveConfig({ mainVersion: "bogus" }).mainVersion).toBe("tbc");
    });
});

describe("stores/settings/configStore backup settings (#691)", () => {
    it("reads the defaults while nothing is stored", () => {
        expect(configStore.getConfig().backup).toEqual({
            intervalMinutes: 60,
            retention: { hourlyHours: 48, dailyDays: 14, weeklyWeeks: 8, monthlyMonths: 12, deployKeep: 10, manualKeep: 10, preRestoreKeep: 10 },
            restoreTest: { weekday: 3, time: "04:30" },
        });
    });

    it("merges a save per field and per retention rule, within the bounds", () => {
        configStore.saveConfig({ backup: { retention: { dailyDays: 7 } } });
        const saved = configStore.saveConfig({ backup: { intervalMinutes: 5, retention: { deployKeep: 3 } } });
        expect(saved.backup).toEqual({
            intervalMinutes: 15,
            retention: { hourlyHours: 48, dailyDays: 7, weeklyWeeks: 8, monthlyMonths: 12, deployKeep: 3, manualKeep: 10, preRestoreKeep: 10 },
            restoreTest: { weekday: 3, time: "04:30" },
        });
    });

    it("merges the restore probe's slot per field (#694)", () => {
        configStore.saveConfig({ backup: { restoreTest: { weekday: 2 } } });
        expect(configStore.saveConfig({ backup: { restoreTest: { time: "5:15" } } }).backup.restoreTest).toEqual({ weekday: 2, time: "05:15" });
    });
});

describe("stores/settings/configStore dropCategoryEntries (#744)", () => {
    it("takes one category out of the active list and the named maps, and nothing else", () => {
        writeFile({
            categoryIds: ["700000000000000001", "700000000000000002"],
            categoryRoles: { "700000000000000001": ["r1"], "700000000000000002": ["r2"] },
            categoryLootSystem: { "700000000000000002": "lootcouncil" },
            categoryReminders: { "700000000000000002": { missingHours: 24, signedHours: 0, target: "event" } },
        });
        const { config, removed } = configStore.dropCategoryEntries("700000000000000002", ["categoryRoles", "categoryReminders", "categorySheets"]);
        expect(removed).toEqual(["categoryIds", "categoryRoles", "categoryReminders"]);
        expect(config.categoryIds).toEqual(["700000000000000001"]);
        expect(config.categoryRoles).toEqual({ "700000000000000001": ["r1"] });
        expect(config.categoryReminders).toEqual({});
        // a map not named stays as it is
        expect(config.categoryLootSystem["700000000000000002"]).toBeTruthy();
        expect(configStore.getConfig().categoryRoles).toEqual({ "700000000000000001": ["r1"] });
    });

    it("writes nothing for an unknown or empty id", () => {
        writeFile({ categoryIds: ["700000000000000001"] });
        expect(configStore.dropCategoryEntries("nope", ["categoryRoles"]).removed).toEqual([]);
        expect(configStore.dropCategoryEntries("", ["categoryRoles"]).removed).toEqual([]);
        expect(configStore.getConfig().categoryIds).toEqual(["700000000000000001"]);
    });
});

describe("stores/settings/configStore discordVisuals (drawn pictures, a test)", () => {
    it("has every picture on by default and keeps only booleans of the known switches", () => {
        expect(configStore.getConfig().discordVisuals).toEqual({ overviewWeekStrip: true, setupImage: true, eventCover: true });
        writeFile({ discordVisuals: { overviewWeekStrip: false, setupImage: "no", other: false } });
        expect(configStore.getConfig().discordVisuals).toEqual({ overviewWeekStrip: false, setupImage: true, eventCover: true });
    });

    it("merges a saved switch over the stored ones", () => {
        writeFile({ discordVisuals: { overviewWeekStrip: false } });
        const saved = configStore.saveConfig({ discordVisuals: { setupImage: false } });
        expect(saved.discordVisuals).toEqual({ overviewWeekStrip: false, setupImage: false, eventCover: true });
        expect(configStore.saveConfig({ discordVisuals: { overviewWeekStrip: true } }).discordVisuals)
            .toEqual({ overviewWeekStrip: true, setupImage: false, eventCover: true });
    });
});

describe("stores/settings/configStore dungeonRecords (Neue Gildenrekorde posten)", () => {
    it("is off by default and merges a saved field over the stored ones", () => {
        writeFile({});
        expect(configStore.getConfig().dungeonRecords).toEqual({ post: false, channelId: "" });
        configStore.saveConfig({ dungeonRecords: { channelId: "123456789012345678" } });
        expect(configStore.saveConfig({ dungeonRecords: { post: true } }).dungeonRecords).toEqual({ post: true, channelId: "123456789012345678" });
        expect(configStore.saveConfig({ dungeonRecords: { channelId: "nope" } }).dungeonRecords).toEqual({ post: true, channelId: "" });
    });
});

describe("stores/settings/configStore addon list (#818): never wiped by accident", () => {
    const { defaultAddons } = require("../../../src/services/addons/addonConfig");
    const ids = (config) => config.addonDownloads.map((a) => a.id);
    const DEFAULT_IDS = ["levelhelper", "professionkit", "aurakit", "macrohelper", "eventhelper-sync"];

    it("heals a stored empty list nobody emptied on purpose: the defaults again", () => {
        writeFile({ addonDownloads: [] });
        expect(ids(configStore.getConfig())).toEqual(DEFAULT_IDS);
        expect(configStore.getConfig().addonDownloadsCustomized).toBe(false);
    });

    it("keeps a list an admin emptied on purpose empty", () => {
        writeFile({ addonDownloads: [], addonDownloadsCustomized: true });
        expect(configStore.getConfig().addonDownloads).toEqual([]);
    });

    it("keeps the list through the GitHub token save and every other save", () => {
        writeFile({ addonDownloads: [{ id: "mine", name: "Mine", repo: "me/mine" }], addonDownloadsCustomized: true });
        configStore.saveConfig({ github: { token: "github_pat_NEW" } });
        configStore.saveConfig({ officerRoleId: "o" });
        expect(ids(configStore.getConfig())).toEqual(["mine"]);
        expect(configStore.getConfig().github.token).toBe("github_pat_NEW");
    });

    it("keeps the CurseForge link through save and load; a stored list from before the field gets the default one", () => {
        writeFile({ addonDownloads: [{ id: "aurakit", name: "AuraKit", repo: "mst1987/aurakit" }], addonDownloadsCustomized: true });
        expect(configStore.getConfig().addonDownloads[0].curseforge).toBe("https://www.curseforge.com/wow/addons/pulse-aurakit");
        configStore.saveConfig({ addonDownloads: [{ id: "aurakit", name: "AuraKit", repo: "mst1987/aurakit", curseforge: "" },
            { id: "mine", name: "Mine", repo: "me/mine", curseforge: "https://curseforge.com/wow/addons/mine/" }], addonDownloadsCustomized: true });
        expect(configStore.getConfig().addonDownloads.map((a) => a.curseforge)).toEqual(["", "https://www.curseforge.com/wow/addons/mine"]);
    });

    it("renames a stored list's former default names to the CurseForge names, a name the admin chose stays", () => {
        writeFile({ addonDownloads: [
            { id: "aurakit", name: "AuraKit", repo: "mst1987/aurakit" },
            { id: "macrohelper", name: "Makros", repo: "mst1987/macrohelper" },
            { id: "levelhelper", name: "LevelHelper", repo: "mst1987/levelhelper" },
        ], addonDownloadsCustomized: true });
        expect(configStore.getConfig().addonDownloads.map((a) => a.name)).toEqual(["Pulse AuraKit", "Makros", "LevelHelper"]);
    });

    it("ignores a list carried along without the edit mark - an unrelated save cannot wipe it", () => {
        configStore.saveConfig({ addonDownloads: [], categoryIds: ["c9"] });
        expect(ids(configStore.getConfig())).toEqual(DEFAULT_IDS);
        expect(configStore.getConfig().categoryIds).toEqual(["c9"]);
    });

    it("takes an edit (list with the mark), removing single addons and all of them", () => {
        const byId = (id) => defaultAddons().find((a) => a.id === id);
        const professionkit = byId("professionkit");
        const sync = byId("eventhelper-sync");
        configStore.saveConfig({ addonDownloads: [professionkit, sync], addonDownloadsCustomized: true });
        expect(ids(configStore.getConfig())).toEqual(["professionkit", "eventhelper-sync"]);
        configStore.saveConfig({ addonDownloads: [], addonDownloadsCustomized: true });
        expect(configStore.getConfig().addonDownloads).toEqual([]);
        // an unrelated save afterwards keeps the deliberate empty list
        configStore.saveConfig({ github: { token: "t" } });
        expect(configStore.getConfig().addonDownloads).toEqual([]);
    });

    it("restores the defaults and clears the mark", () => {
        configStore.saveConfig({ addonDownloads: [], addonDownloadsCustomized: true });
        configStore.saveConfig({ addonDownloads: defaultAddons(), addonDownloadsCustomized: false });
        expect(ids(configStore.getConfig())).toEqual(DEFAULT_IDS);
        expect(configStore.getConfig().addonDownloadsCustomized).toBe(false);
    });
});

describe("stores/settings/configStore serverSettings (#917)", () => {
    const A = "111111111111111111";
    const B = "222222222222222222";
    const servers = { servers: [{ guildId: A, label: "" }, { guildId: B, label: "" }], links: [] };
    const stored = () => JSON.parse(fs.__store.get(FILE)).serverSettings;

    it("a block sent for one server leaves the other servers' blocks alone", () => {
        writeFile({ guildId: A, discordServers: servers, serverSettings: { [A]: {} } });
        configStore.saveConfig({ serverSettings: { [B]: { lang: "en" } } });
        expect(stored()).toEqual({ [A]: {}, [B]: { lang: "en" } });
        // read back in its final shape: no part owns a key yet
        expect(configStore.getConfig().serverSettings).toEqual({ [A]: {}, [B]: {} });
    });

    it("a save without serverSettings keeps the stored blocks", () => {
        writeFile({ guildId: A, discordServers: servers, serverSettings: { [A]: {}, [B]: {} } });
        configStore.saveConfig({ adminRoleIds: ["1"] });
        expect(stored()).toEqual({ [A]: {}, [B]: {} });
    });

    // #921 + #923 + #927 each own a key of the same server block: a save of one
    // must not drop the others, neither stored nor read back.
    it("raidhelper, logChannels and versionOverrides of one server survive each other's saves", () => {
        const raidhelper = { enabled: true, serverId: "", apiKey: "k", envKey: false, at: 1, byName: "Orga" };
        const logChannels = [{ channelId: "333333333333333333", versionId: "tbc" }];
        writeFile({ guildId: A, discordServers: servers, serverSettings: { [A]: { raidhelper, logChannels } } });
        const versionOverrides = { tbc: { armoryUrlTemplate: "https://own.test/{char}" } };
        configStore.saveConfig({ serverSettings: { [A]: { versionOverrides } } });
        configStore.saveConfig({ serverSettings: { [A]: { raidhelper: { ...raidhelper, enabled: false } } } });
        configStore.saveConfig({ serverSettings: { [A]: { logChannels } } });
        expect(stored()[A]).toEqual({ raidhelper: { ...raidhelper, enabled: false }, logChannels, versionOverrides });
        expect(configStore.getConfig().serverSettings[A]).toMatchObject({ raidhelper: { enabled: false }, logChannels, versionOverrides });
    });
});
