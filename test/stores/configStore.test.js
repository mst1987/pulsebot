jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());
// Count the normalisations: the cache must not run them again for an unchanged file.
jest.mock("../../src/stores/configSchema", () => {
    const actual = jest.requireActual("../../src/stores/configSchema");
    return { ...actual, normalizeConfig: jest.fn(actual.normalizeConfig) };
});

const fs = require("fs");
const { settingsPath } = require("../../src/config/paths");
const { normalizeConfig } = require("../../src/stores/configSchema");
const configStore = require("../../src/stores/configStore");

const FILE = settingsPath("config.json");
const writeFile = (value) => fs.__store.set(FILE, JSON.stringify(value));

beforeEach(() => {
    fs.__store.clear();
    configStore.useFile(null);
});

describe("stores/configStore getConfig cache (#420)", () => {
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

describe("stores/configStore stored file", () => {
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

describe("stores/configStore saveConfig", () => {
    it("merges the nested blocks and normalises the category maps", () => {
        configStore.saveConfig({ blizzard: { region: "us" }, anthropic: { model: "m" }, warcraftlogsV2: { clientId: "w" }, categoryLootTool: { a: "rclc" } });
        const saved = configStore.saveConfig({
            raidDefaults: { channelId: "ch" }, blizzard: { realmSlug: "x" }, categoryLootTool: { b: "gargul" },
            categoryLootSystem: { a: "gdkp" }, raidhelperRetirement: { disabled: true, at: 5, byName: "M" },
            categorySignupSource: { a: "raidhelper" }, categorySetupDms: { a: true }, categoryDiscordEvent: { a: true },
            categoryVoiceChannel: { a: "1300000000000000001" }, categoryMessageLook: { a: { titleSize: "huge" } },
            categoryAnnounce: { a: { enabled: true, target: "talk" } }, categorySignupNotes: { a: "none" },
            categorySignupNoteChannel: { a: "1300000000000000002" }, categoryRaidTemplate: { a: "t" },
            categorySheets: { a: { url: "https://x" } }, topItems: [{ id: 1 }], roleSync: [], categoryReminders: {},
            discordServers: { eventGuilds: [{ guildId: "1100000000000000001" }] },
        });
        expect(saved.blizzard).toMatchObject({ region: "us", realmSlug: "x" });
        expect(saved.anthropic.model).toBe("m");
        expect(saved.warcraftlogsV2.clientId).toBe("w");
        expect(saved.categoryLootTool).toEqual({ a: "rclc", b: "gargul" });
        expect(saved.raidDefaults).toEqual({ channelId: "ch" });
        expect(saved.raidhelperRetirement).toEqual({ disabled: true, at: 5, byName: "M" });
        expect(saved.categoryRaidTemplate).toEqual({ a: "t" });
        expect(saved.guildId).toBe("1100000000000000001");
        expect(saved.categorySignupNoteChannel).toEqual({ a: "1300000000000000002" });
    });
});

describe("stores/configStore resolveEventSheetLink", () => {
    it("prefers the raid's own copy, then the category's sheet, else nothing", () => {
        configStore.saveConfig({ categorySheets: { cat: { url: "https://cat", name: "Kat" } } });
        expect(configStore.resolveEventSheetLink({ url: "https://own", sheetName: "Own" }, "cat")).toEqual({ url: "https://own", name: "Own", source: "event" });
        expect(configStore.resolveEventSheetLink(null, " cat ")).toEqual({ url: "https://cat", name: "Kat", source: "category" });
        expect(configStore.resolveEventSheetLink(null, "none")).toBeNull();
        expect(configStore.resolveEventSheetLink({ url: "https://own" }, undefined)).toEqual({ url: "https://own", name: "", source: "event" });
    });
});
