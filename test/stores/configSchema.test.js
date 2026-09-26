// Golden master for the config split (#420): test/fixtures/configSchema/
// golden.json is what getConfig() and listRaidTemplates() returned for the
// states in cases.json BEFORE settingsStore.js was split and the upgrades left
// the read path. After the split a current file must read the same straight
// away, an old one after the one start-up migration.
//
// The defaults come from the env (GUILD_ID, BLIZZARD_*, ...); they are cleared
// before anything loads, exactly as when the fixture was frozen.
const ENV_KEYS = ["GUILD_ID", "RAIDHELPER_SERVER_ID", "OFFICER_ROLE_ID", "APPLICATION_CHANNEL_ID", "GOOGLE_SPREADSHEET_ID",
    "GOOGLE_SHEET_NAME", "GOOGLE_SHEET_GID", "BLIZZARD_CLIENT_ID", "BLIZZARD_CLIENT_SECRET", "BLIZZARD_REGION", "BLIZZARD_REALM",
    "BLIZZARD_NAMESPACE", "ADMIN_ROLE_IDS"];
for (const key of ENV_KEYS) delete process.env[key];

jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../src/config/paths");
const schema = require("../../src/stores/configSchema");
const { getConfig } = require("../../src/stores/configStore");
const { listRaidTemplates } = require("../../src/stores/raidTemplateStore");
const { migrateSettings } = require("../../src/stores/settingsMigration");
const cases = require("../fixtures/configSchema/cases.json");
const golden = require("../fixtures/configSchema/golden.json");

const CONFIG_FILE = settingsPath("config.json");
const TEMPLATES_FILE = settingsPath("raid-templates.json");

function load(c) {
    fs.__store.clear();
    if (c.config) fs.__store.set(CONFIG_FILE, JSON.stringify(c.config));
    if (c.raidTemplates) fs.__store.set(TEMPLATES_FILE, JSON.stringify(c.raidTemplates));
}

beforeEach(() => {
    // migrateLegacy stamps a template without timestamps with Date.now()
    jest.spyOn(Date, "now").mockReturnValue(1700000000000);
});

afterEach(() => {
    Date.now.mockRestore();
});

describe("stores/configSchema golden master (#420)", () => {
    it("has one frozen result per case", () => {
        expect(golden.map((g) => g.name)).toEqual(cases.map((c) => c.name));
    });

    describe.each(cases.map((c, i) => [c.name, c, golden[i]]))("%s", (_name, c, expected) => {
        it("reads the same as before the split once the start-up migration ran", () => {
            load(c);
            migrateSettings({ log: () => {} });
            expect(listRaidTemplates()).toEqual(expected.raidTemplates);
            expect(getConfig()).toEqual(expected.config);
        });

        if (!c.legacy) {
            it("needs no migration: the schema alone gives the frozen result", () => {
                load(c);
                const { changes } = migrateSettings({ log: () => {} });
                expect(changes).toEqual([]);
                expect(schema.normalizeConfig(c.config || {})).toEqual(expected.config);
            });
        }

        it("a second start migrates nothing and writes nothing", () => {
            load(c);
            migrateSettings({ log: () => {} });
            fs.writeFileSync.mockClear();
            expect(migrateSettings({ log: () => {} }).changes).toEqual([]);
            expect(fs.writeFileSync).not.toHaveBeenCalled();
            expect(getConfig()).toEqual(expected.config);
        });
    });
});

describe("stores/configSchema normalisers", () => {
    it("normalizeConfig treats anything but an object as an empty file", () => {
        const empty = schema.normalizeConfig({});
        expect(schema.normalizeConfig(null)).toEqual(empty);
        expect(schema.normalizeConfig([1, 2])).toEqual(empty);
        expect(schema.normalizeConfig("x")).toEqual(empty);
    });

    it("normalizeEventGuilds ignores everything but a list (no legacy fallback in the read path)", () => {
        expect(schema.normalizeEventGuilds(undefined)).toEqual([]);
        expect(schema.normalizeDiscordServers({ eventGuildId: "111111" }).eventGuilds).toEqual([]);
    });

    it("caps the event-server list", () => {
        const list = Array.from({ length: 12 }, (_, i) => ({ guildId: String(111111 + i) }));
        expect(schema.normalizeEventGuilds(list)).toHaveLength(10);
    });

    it("normalizeCategoryRaidTemplate keeps trimmed, non-empty entries only", () => {
        expect(schema.normalizeCategoryRaidTemplate({ " a ": " t1 ", b: "", c: null })).toEqual({ a: "t1" });
        expect(schema.normalizeCategoryRaidTemplate(["x"])).toEqual({});
        expect(schema.normalizeCategoryRaidTemplate(undefined)).toEqual({});
    });

    it("configuredCategoryIds collects every category an install configured anything for", () => {
        expect(schema.configuredCategoryIds({ categoryIds: ["1"], categoryRoles: { 2: [] }, categorySheets: { "": {} } }).sort()).toEqual(["1", "2"]);
    });

    it("signupSourcesOf pins the known categories of an install from before #291", () => {
        expect(schema.signupSourcesOf({ categoryIds: ["1"] })).toEqual({ categorySignupSource: { 1: "raidhelper" }, signupSourceDefault: "eventhelper" });
        expect(schema.signupSourcesOf({ categoryIds: [] })).toEqual({ categorySignupSource: {}, signupSourceDefault: "raidhelper" });
        expect(schema.signupSourcesOf({})).toEqual({ categorySignupSource: {}, signupSourceDefault: "eventhelper" });
    });
});
