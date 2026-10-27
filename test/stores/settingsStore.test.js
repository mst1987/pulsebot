// Mock fs with an in-memory store so tests never touch the repo's disk.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const {
    listRecruitment, getRecruitment, saveRecruitment, deleteRecruitment,
    listRecruitmentPosts, getRecruitmentPost, saveRecruitmentPost, deleteRecruitmentPost,
    listRaidTemplates, getRaidTemplate, saveRaidTemplate, saveRaidTemplates, deleteRaidTemplate,
    listNotify, getNotify, saveNotify, deleteNotify,
    listRaidsheets, getRaidsheet, saveRaidsheet, deleteRaidsheet,
    getConfig, saveConfig, resolveEventSheetLink, normalizeDiscordServers,
    normalizeRoleSync, normalizeCategoryReminders,
} = require("../../src/stores/settingsStore.js");
const { migrateSettings } = require("../../src/stores/settingsMigration");

beforeEach(() => {
    fs.__store.clear();
});

describe("stores/settingsStore", () => {
    describe("getConfig", () => {
        it("returns the defaults when nothing is stored", () => {
            const cfg = getConfig();
            expect(cfg.adminRoleIds).toEqual([]);
            // #924: the raid defaults are per server, there is no global field any more
            expect(cfg).not.toHaveProperty("raidDefaults");
            expect(cfg.serverSettings).toEqual({});
            expect(cfg.categoryRaidTemplate).toEqual({});
        });

        it("merges stored values over the defaults", () => {
            saveConfig({ guildId: "111111", adminRoleIds: ["111", "222"], serverSettings: { 111111: { raidDefaults: { channelId: "ch" } } } });
            const cfg = getConfig();
            expect(cfg.adminRoleIds).toEqual(["111", "222"]);
            // the default template is per category, the preset channel per server (#924)
            expect(cfg.serverSettings["111111"].raidDefaults).toEqual({ channelId: "ch" });
        });

        // config.baseAccess is what every logged-in account holds without any
        // role. Read back through the same normaliser the API saves with, so a
        // hand-edited config.json cannot smuggle in an area that does not exist.
        it("normalises baseAccess and defaults it to nothing granted", () => {
            expect(getConfig().baseAccess).toEqual({});
            saveConfig({ baseAccess: { loot: { read: true }, nonsense: { read: true, write: true } } });
            expect(getConfig().baseAccess).toEqual({ loot: { read: true, write: false } });
        });

        it("guards adminRoleIds to an array when the stored value is malformed", () => {
            // write a bad shape directly, then read through getConfig
            saveConfig({});
            fs.__store.set([...fs.__store.keys()].find((k) => k.endsWith("config.json")),
                JSON.stringify({ adminRoleIds: "not-an-array" }));
            expect(getConfig().adminRoleIds).toEqual([]);
        });

        // The bot's own server, hard-coded in config/variables.js: it drives the
        // admin-role check and is preselected in the menu's server switcher.
        describe("guildId", () => {
            const { guildId: defaultGuildId } = require("../../src/config/variables");

            it("falls back to the default when nothing is stored", () => {
                expect(getConfig().guildId).toBe(defaultGuildId);
            });

            it("keeps a stored guild id", () => {
                saveConfig({ guildId: "999" });
                expect(getConfig().guildId).toBe("999");
            });

            // The settings form writes this field on every save, so a blank one
            // must not shadow the default.
            it("falls back to the default when the stored value is blank", () => {
                saveConfig({ guildId: "999" });
                saveConfig({ guildId: "   " });
                expect(getConfig().guildId).toBe(defaultGuildId);
            });

            // What saveConfig() hands back is what the admin menu renders after
            // saving — it must already be the effective value.
            it("returns the effective guild id from saveConfig, not the raw blank", () => {
                expect(saveConfig({ guildId: "" }).guildId).toBe(defaultGuildId);
            });
        });

        // Several event servers, each with its own overview target (#251, #361).
        describe("discordServers", () => {
            const { guildId: defaultGuildId } = require("../../src/config/variables");

            it("defaults to no servers (= nothing configured yet)", () => {
                expect(getConfig().discordServers).toEqual({ servers: [], links: [] });
                expect(getConfig().guildId).toBe(defaultGuildId);
            });

            it("keeps snowflakes and drops anything that is not one", () => {
                const saved = saveConfig({
                    guildId: "111111",
                    discordServers: {
                        servers: [{ guildId: " 111111 ", label: "PvE" }, { guildId: "nope" }],
                        talkPingChannelId: 333333, signupNoteChannelId: "444444", guildBankChannelId: " 666666 ",
                    },
                });
                // #924: the two signup channels are per server now, the block drops them
                expect(saved.discordServers).toEqual({ servers: [{ guildId: "111111", label: "PvE" }], links: [] });
            });

            it("keeps the signup channels per server, not in the server block (#924)", () => {
                const saved = saveConfig({ guildId: "111111", serverSettings: { 111111: { signupNoteChannelId: "555555", guildBankChannelId: "777777" } } });
                expect(saved.serverSettings["111111"]).toEqual({ signupNoteChannelId: "555555", guildBankChannelId: "777777" });
                expect(normalizeDiscordServers({ guildBankChannelId: "777777" })).not.toHaveProperty("guildBankChannelId");
            });

            // #897: an old talk server is read as an ordinary server, the field is gone
            it("an old talk server becomes an ordinary server", () => {
                const out = normalizeDiscordServers({ eventGuilds: [{ guildId: "111111" }], talkGuildId: "111111" });
                expect(out).not.toHaveProperty("talkGuildId");
                expect(out.servers).toEqual([{ guildId: "111111", label: "" }]);
                expect(normalizeDiscordServers({ servers: [{ guildId: "111111" }], talkGuildId: "222222" }).servers.map((x) => x.guildId))
                    .toEqual(["111111", "222222"]);
                expect(normalizeDiscordServers(null)).toEqual({ servers: [], links: [] });
                expect(normalizeDiscordServers(["x"]).servers).toEqual([]);
            });

            it("caps the server list at 10 entries", () => {
                const many = Array.from({ length: 15 }, (_, i) => ({ guildId: String(100000 + i) }));
                expect(normalizeDiscordServers({ servers: many }).servers.length).toBe(10);
            });

            it("merges a partial update instead of replacing the block", () => {
                saveConfig({ guildId: "111111", discordServers: { servers: [{ guildId: "111111" }, { guildId: "222222" }] } });
                const saved = saveConfig({ discordServers: { links: [] } });
                expect(saved.discordServers).toMatchObject({
                    servers: [{ guildId: "111111" }, { guildId: "222222" }], links: [],
                });
                expect(saved.discordServers).not.toHaveProperty("talkGuildId");
                // #894: an old talk ping channel is dropped on save
                expect(saveConfig({ discordServers: { talkPingChannelId: "555555" } }).discordServers).not.toHaveProperty("talkPingChannelId");
            });

            // guildId stays the fallback: the first event server wins, and clearing
            // every event server falls back to the server that was last in use.
            // The first server added to an empty list keeps the fallback in front.
            it("reports the first event server as guildId and keeps it as the fallback", () => {
                saveConfig({ guildId: "999999" });
                const added = saveConfig({ discordServers: { servers: [{ guildId: "111111" }] } });
                expect(added.discordServers.servers.map((s) => s.guildId)).toEqual(["999999", "111111"]);
                expect(added.guildId).toBe("999999");
                expect(saveConfig({ discordServers: { servers: [{ guildId: "111111" }] } }).guildId).toBe("111111");
                expect(saveConfig({ discordServers: { servers: [] } }).guildId).toBe("111111");
            });
        });

        it("exposes the channel/role ids and persists overrides", () => {
            const def = getConfig();
            // #924: applications are per server, the global fields are gone
            expect(def).not.toHaveProperty("applicationChannelId");
            expect(def).not.toHaveProperty("officerRoleId");
            expect(Array.isArray(def.categoryIds)).toBe(true);
            // #921: the log channels live per server, no global list any more
            expect(def).not.toHaveProperty("logChannelIds");
            expect(def.serverSettings).toEqual({});

            saveConfig({
                guildId: "111111",
                serverSettings: { 111111: { applicationChannelId: "app-1", officerRoleId: "role-1" } },
                applicationChannelId: "ignored",
                categoryIds: ["c1", "c2"],
            });
            const cfg = getConfig();
            expect(cfg.serverSettings["111111"]).toEqual({ applicationChannelId: "app-1", officerRoleId: "role-1" });
            expect(cfg).not.toHaveProperty("applicationChannelId");
            expect(cfg.categoryIds).toEqual(["c1", "c2"]);
        });

        it("keeps an old stored logChannelIds readable until its migration, guarded to a clean id list (#921)", () => {
            saveConfig({});
            const file = [...fs.__store.keys()].find((k) => k.endsWith("config.json"));
            fs.__store.set(file, JSON.stringify({ logChannelIds: "nope" }));
            expect(getConfig().logChannelIds).toEqual([]);
            fs.__store.set(file, JSON.stringify({ logChannelIds: [" a ", "a", "", 7] }));
            expect(getConfig().logChannelIds).toEqual(["a", "7"]);
        });

        it("exposes blizzard defaults and a categoryLootTool map", () => {
            const cfg = getConfig();
            // only the credentials: the realm is per version since #542
            expect(cfg.blizzard).toEqual({ clientId: expect.any(String), clientSecret: expect.any(String) });
            expect(cfg.versionSettings.tbc).toMatchObject({ blizzardRegion: "eu", blizzardRealmSlug: "thunderstrike", blizzardNamespace: "profile-classicann-eu" });
            expect(cfg.categoryLootTool).toEqual({});
        });

        it("guards categoryLootTool to an object when the stored value is malformed", () => {
            saveConfig({});
            fs.__store.set([...fs.__store.keys()].find((k) => k.endsWith("config.json")),
                JSON.stringify({ categoryLootTool: "nope" }));
            expect(getConfig().categoryLootTool).toEqual({});
        });

        it("keeps both sources in categorySignupSource, merged per category, and drops anything else", () => {
            expect(getConfig().categorySignupSource).toEqual({});
            saveConfig({ categorySignupSource: { c1: "eventhelper", c2: "raidhelper", c3: "bogus" } });
            expect(getConfig().categorySignupSource).toEqual({ c1: "eventhelper", c2: "raidhelper" });
            saveConfig({ categorySignupSource: { c4: "eventhelper" } });
            expect(getConfig().categorySignupSource).toEqual({ c1: "eventhelper", c2: "raidhelper", c4: "eventhelper" });
            saveConfig({ categorySignupSource: { c1: "raidhelper" } });
            expect(getConfig().categorySignupSource).toEqual({ c1: "raidhelper", c2: "raidhelper", c4: "eventhelper" });
        });

        // #291: new categories default to EventHelper; an install from before
        // keeps Raid-Helper for the categories it already had — nothing flips silently.
        describe("signup source default (#291)", () => {
            const configKey = () => [...fs.__store.keys()].find((k) => k.endsWith("config.json"));
            const storeRaw = (obj) => {
                saveConfig({});
                fs.__store.set(configKey(), JSON.stringify(obj));
            };

            it("starts a fresh install on EventHelper", () => {
                expect(getConfig().signupSourceDefault).toBe("eventhelper");
                saveConfig({ categoryIds: ["c1"] });
                expect(getConfig().signupSourceDefault).toBe("eventhelper");
                expect(getConfig().categorySignupSource).toEqual({});
            });

            it("pins every category an older install configured to Raid-Helper, keeps switched ones", () => {
                storeRaw({ categoryIds: ["c1", "c2"], categoryRoles: { c3: ["r1"] }, categorySignupSource: { c2: "eventhelper" } });
                const cfg = getConfig();
                expect(cfg.signupSourceDefault).toBe("eventhelper");
                expect(cfg.categorySignupSource).toEqual({ c1: "raidhelper", c2: "eventhelper", c3: "raidhelper" });
            });

            it("writes the pins down with the next save, so a category added later is new", () => {
                storeRaw({ categoryIds: ["c1"] });
                saveConfig({ categoryIds: ["c1", "c9"] });
                const stored = JSON.parse(fs.__store.get(configKey()));
                expect(stored.signupSourceDefault).toBe("eventhelper");
                expect(stored.categorySignupSource).toEqual({ c1: "raidhelper" });
                expect(getConfig().categorySignupSource).toEqual({ c1: "raidhelper" });
            });

            it("keeps Raid-Helper as the default for an older install without any category", () => {
                storeRaw({ guildId: "123456789", categoryIds: [] });
                expect(getConfig().signupSourceDefault).toBe("raidhelper");
                expect(getConfig().categorySignupSource).toEqual({});
            });

            it("normalises the Raid-Helper switch-off block", () => {
                expect(getConfig().raidhelperRetirement).toEqual({ disabled: false, at: 0, byName: "" });
                saveConfig({ raidhelperRetirement: { disabled: true, at: 5, byName: "Zibbo", extra: 1 } });
                expect(getConfig().raidhelperRetirement).toEqual({ disabled: true, at: 5, byName: "Zibbo" });
                saveConfig({ raidhelperRetirement: { disabled: "yes" } });
                expect(getConfig().raidhelperRetirement.disabled).toBe(false);
            });
        });

        it("stores a language per category, merged, and drops one set back to the server language", () => {
            expect(getConfig().categoryLanguage).toEqual({});
            saveConfig({ categoryLanguage: { pug: "en", guild: "de", odd: "fr" } });
            expect(getConfig().categoryLanguage).toEqual({ pug: "en", guild: "de" });
            saveConfig({ categoryLanguage: { other: "en" } });
            expect(getConfig().categoryLanguage).toEqual({ pug: "en", guild: "de", other: "en" });
            saveConfig({ categoryLanguage: { guild: "" } });
            expect(getConfig().categoryLanguage).toEqual({ pug: "en", other: "en" });
        });

        it("stores attendance per category as a diff from the defaults, and drops one set back", () => {
            expect(getConfig().categoryAttendance).toEqual({});
            // any whole number from 1 to 50 is kept; zero, too many, a fraction or text fall back to the default (and drop out)
            saveConfig({ categoryAttendance: {
                pug: { show: false, window: 8 }, guild: { window: 16, absences: false }, odd: { window: 5 }, wide: { window: 50 },
                zero: { window: 0 }, many: { window: 51 }, half: { window: 7.5 }, text: { window: "x" },
            } });
            expect(getConfig().categoryAttendance).toEqual({ pug: { show: false, window: 8 }, guild: { window: 16, absences: false }, odd: { window: 5 }, wide: { window: 50 } });
            saveConfig({ categoryAttendance: { odd: { window: 11 }, wide: { window: 11 } } });
            saveConfig({ categoryAttendance: { pug: { show: true, window: 11, absences: true } } });
            expect(getConfig().categoryAttendance).toEqual({ guild: { window: 16, absences: false } });
        });

        it("keeps setup DMs off by default and stores only switched-on categories (#290)", () => {
            expect(getConfig().categorySetupDms).toEqual({});
            saveConfig({ categorySetupDms: { c1: true, c2: false, c3: "yes" } });
            expect(getConfig().categorySetupDms).toEqual({ c1: true });
            saveConfig({ categorySetupDms: { c4: true } });
            expect(getConfig().categorySetupDms).toEqual({ c1: true, c4: true });
            saveConfig({ categorySetupDms: { c1: false } });
            expect(getConfig().categorySetupDms).toEqual({ c4: true });
        });

        it("stores a loot system per category and drops it again on \"\" (automatisch)", () => {
            expect(getConfig().categoryLootSystem).toEqual({});
            saveConfig({ categoryLootSystem: { c1: "lootcouncil", c2: "dkp", c3: "gdkp" } });
            expect(getConfig().categoryLootSystem).toEqual({ c1: "lootcouncil", c3: "gdkp" });
            saveConfig({ categoryLootSystem: { c1: "" } });
            expect(getConfig().categoryLootSystem).toEqual({ c3: "gdkp" });
        });

        it("stores the message look per category and drops a category back at the defaults", () => {
            expect(getConfig().categoryMessageLook).toEqual({});
            saveConfig({ categoryMessageLook: { c1: { raidArt: false, titleSize: "large" }, c2: { raidArt: true, titleSize: "huge" } } });
            expect(getConfig().categoryMessageLook).toEqual({ c1: { raidArt: false }, c2: { titleSize: "huge" } });
            saveConfig({ categoryMessageLook: { c1: { raidArt: true, titleSize: "large" } } });
            expect(getConfig().categoryMessageLook).toEqual({ c2: { titleSize: "huge" } });
        });

        it("keeps the Discord event off by default and the voice channel only as a snowflake (#305)", () => {
            expect(getConfig().categoryDiscordEvent).toEqual({});
            expect(getConfig().categoryVoiceChannel).toEqual({});
            saveConfig({ categoryDiscordEvent: { c1: true, c2: false, c3: "yes" } });
            expect(getConfig().categoryDiscordEvent).toEqual({ c1: true });
            saveConfig({ categoryDiscordEvent: { c1: false, c4: true } });
            expect(getConfig().categoryDiscordEvent).toEqual({ c4: true });

            saveConfig({ categoryVoiceChannel: { c1: "123456789012345678", c2: "nope", c3: "" } });
            expect(getConfig().categoryVoiceChannel).toEqual({ c1: "123456789012345678" });
            // an empty value clears that category again
            saveConfig({ categoryVoiceChannel: { c1: "" } });
            expect(getConfig().categoryVoiceChannel).toEqual({});
        });

        it("keeps the create announcement off by default and stores only switched-on categories (#306)", () => {
            expect(getConfig().categoryAnnounce).toEqual({});
            saveConfig({ categoryAnnounce: { c1: { enabled: true, target: "both" }, c2: { enabled: false, target: "event" }, c3: { enabled: true, target: "nirgends" } } });
            // #894: always the raid's own channel, an old target is dropped
            expect(getConfig().categoryAnnounce).toEqual({ c1: { enabled: true }, c3: { enabled: true } });
            saveConfig({ categoryAnnounce: { c1: { enabled: false } } });
            expect(getConfig().categoryAnnounce).toEqual({ c3: { enabled: true } });
        });

        it("stores only the non-default message modes per category and merges them", () => {
            expect(getConfig().categorySignupNotes).toEqual({});
            saveConfig({ categorySignupNotes: { c1: "required", c2: "none", c3: "optional", c4: "sometimes" } });
            expect(getConfig().categorySignupNotes).toEqual({ c1: "required", c2: "none" });
            saveConfig({ categorySignupNotes: { c1: "optional" } });
            expect(getConfig().categorySignupNotes).toEqual({ c2: "none" });
        });

        it("stores a message channel per category as a snowflake and merges it, \"\" = back to the default (#335)", () => {
            expect(getConfig().categorySignupNoteChannel).toEqual({});
            saveConfig({ categorySignupNoteChannel: { c1: "123456789012345678", c2: "#abmeldungen", c3: "223456789012345678" } });
            expect(getConfig().categorySignupNoteChannel).toEqual({ c1: "123456789012345678", c3: "223456789012345678" });
            saveConfig({ categorySignupNoteChannel: { c1: "" } });
            expect(getConfig().categorySignupNoteChannel).toEqual({ c3: "223456789012345678" });
            // another save leaves it alone
            saveConfig({ categorySignupNotes: { c3: "required" } });
            expect(getConfig().categorySignupNoteChannel).toEqual({ c3: "223456789012345678" });
        });

        it("defaults categoryRoles to an empty object and round-trips a map", () => {
            expect(getConfig().categoryRoles).toEqual({});
            saveConfig({ categoryRoles: { c1: ["r1", "r2"], c2: ["r3"] } });
            expect(getConfig().categoryRoles).toEqual({ c1: ["r1", "r2"], c2: ["r3"] });
        });

        it("normalises categoryRoles: trims, dedupes, drops empties and non-arrays", () => {
            saveConfig({});
            fs.__store.set([...fs.__store.keys()].find((k) => k.endsWith("config.json")),
                JSON.stringify({ categoryRoles: { c1: [" r1 ", "r1", ""], c2: [], c3: "nope" } }));
            expect(getConfig().categoryRoles).toEqual({ c1: ["r1"] });
        });

        it("guards categoryRoles to an object when the stored value is malformed", () => {
            saveConfig({});
            fs.__store.set([...fs.__store.keys()].find((k) => k.endsWith("config.json")),
                JSON.stringify({ categoryRoles: "nope" }));
            expect(getConfig().categoryRoles).toEqual({});
        });
    });

    describe("saveConfig", () => {
        it("persists a partial update and merges the server blocks per key", () => {
            saveConfig({ guildId: "111111", serverSettings: { 111111: { raidDefaults: { channelId: "c1" }, botLanguage: "en" } }, adminRoleIds: ["1"] });
            saveConfig({ serverSettings: { 111111: { raidDefaults: { channelId: "c2" } } } });
            const cfg = getConfig();
            expect(cfg.adminRoleIds).toEqual(["1"]);
            expect(cfg.serverSettings["111111"]).toEqual({ raidDefaults: { channelId: "c2" }, botLanguage: "en" });
        });

        it("keeps the WCL v2 client empty by default and deep-merges it like the other credentials", () => {
            expect(getConfig().warcraftlogsV2).toEqual({ clientId: "", clientSecret: "" });
            saveConfig({ warcraftlogsV2: { clientId: "cid", clientSecret: "sec" } });
            saveConfig({ warcraftlogsV2: { clientSecret: "" } });
            expect(getConfig().warcraftlogsV2).toEqual({ clientId: "cid", clientSecret: "" });
            saveConfig({ warcraftlogsV2: { clientId: "cid2" } });
            expect(getConfig().warcraftlogsV2).toEqual({ clientId: "cid2", clientSecret: "" });
        });

        it("deep-merges blizzard credentials without dropping untouched fields", () => {
            saveConfig({ blizzard: { clientId: "cid", clientSecret: "sec" } });
            saveConfig({ blizzard: { clientSecret: "sec2" } });
            const cfg = getConfig();
            expect(cfg.blizzard.clientId).toBe("cid");
            expect(cfg.blizzard.clientSecret).toBe("sec2");
            expect(cfg.versionSettings.tbc.blizzardRealmSlug).toBe("thunderstrike");
        });

        it("merges categoryLootTool entries per category", () => {
            saveConfig({ categoryLootTool: { cat1: "gargul" } });
            saveConfig({ categoryLootTool: { cat2: "rclc" } });
            const cfg = getConfig();
            expect(cfg.categoryLootTool).toEqual({ cat1: "gargul", cat2: "rclc" });
        });

        it("merges categorySheets per category and trims the fields", () => {
            saveConfig({ categorySheets: { cat1: { url: " https://s/1 ", name: " Kara " } } });
            saveConfig({ categorySheets: { cat2: { url: "https://s/2" } } });
            expect(getConfig().categorySheets).toEqual({
                cat1: { url: "https://s/1", name: "Kara" },
                cat2: { url: "https://s/2", name: "" },
            });
        });

        // Emptying the url field in the admin menu is how an assignment is
        // removed — it must not survive as a link to nowhere.
        it("drops a category sheet whose url is cleared", () => {
            saveConfig({ categorySheets: { cat1: { url: "https://s/1", name: "Kara" } } });
            saveConfig({ categorySheets: { cat1: { url: "", name: "Kara" } } });
            expect(getConfig().categorySheets).toEqual({});
        });

        it("defaults topItems to an empty list", () => {
            expect(getConfig().topItems).toEqual([]);
        });

        it("normalises stored top items and drops the unusable ones", () => {
            saveConfig({
                topItems: [
                    { id: "30883", name: " Kalter Fels ", iconUrl: " https://x/i.jpg ", quality: 4 },
                    { id: 30883, name: "Duplikat" },            // same id: first wins
                    { id: 0, name: "kein Item" },               // no usable id
                    { id: 32235, name: "Ohne Icon", iconUrl: "javascript:alert(1)" },
                    "nonsense",
                ],
            });
            expect(getConfig().topItems).toEqual([
                { id: 30883, name: "Kalter Fels", iconUrl: "https://x/i.jpg", quality: 4 },
                { id: 32235, name: "Ohne Icon", iconUrl: "", quality: null },
            ]);
        });

        // Unlike the category maps, the list is replaced wholesale — that is how
        // the admin menu removes an item again.
        it("replaces the top-item list instead of merging it", () => {
            saveConfig({ topItems: [{ id: 30883, name: "A" }, { id: 32235, name: "B" }] });
            saveConfig({ topItems: [{ id: 32235, name: "B" }] });
            expect(getConfig().topItems.map((it) => it.id)).toEqual([32235]);
            saveConfig({ topItems: [] });
            expect(getConfig().topItems).toEqual([]);
        });

        it("guards a malformed stored topItems value", () => {
            saveConfig({});
            fs.__store.set([...fs.__store.keys()].find((k) => k.endsWith("config.json")),
                JSON.stringify({ topItems: { id: 1 } }));
            expect(getConfig().topItems).toEqual([]);
        });
    });

    // Which sheet a raid links: its own filled copy first, the category's fixed
    // sheet as the fallback.
    describe("resolveEventSheetLink", () => {
        beforeEach(() => {
            saveConfig({ categorySheets: { cat1: { url: "https://s/fix", name: "SSC/TK" } } });
        });

        it("prefers the raid's own filled copy over the category sheet", () => {
            const link = resolveEventSheetLink({ url: "https://s/copy", sheetName: "Kopie" }, "cat1");
            expect(link).toEqual({ url: "https://s/copy", name: "Kopie", source: "event" });
        });

        it("falls back to the category's fixed sheet when there is no copy", () => {
            expect(resolveEventSheetLink(null, "cat1")).toEqual({
                url: "https://s/fix", name: "SSC/TK", source: "category",
            });
        });

        it("treats a fill record without a url as no copy at all", () => {
            expect(resolveEventSheetLink({ url: "", sheetId: "s1" }, "cat1").source).toBe("category");
        });

        it("returns null when neither exists", () => {
            expect(resolveEventSheetLink(null, "cat-other")).toBeNull();
            expect(resolveEventSheetLink(null, "")).toBeNull();
        });
    });

    describe("recruitment templates", () => {
        it("creates a template with a generated id and trims fields", () => {
            const saved = saveRecruitment({ name: "  Heiler  ", title: " Titel ", body: "b", buttonLabel: " go " });
            expect(saved.id).toMatch(/^[0-9a-f]{12}$/);
            expect(saved.name).toBe("Heiler");
            expect(saved.title).toBe("Titel");
            expect(saved.buttonLabel).toBe("go");
            expect(getRecruitment(saved.id)).toMatchObject({ name: "Heiler" });
        });

        it("updates an existing template in place instead of creating a new one", () => {
            const a = saveRecruitment({ name: "A" });
            const b = saveRecruitment({ id: a.id, name: "A2", title: "T" });
            expect(b.id).toBe(a.id);
            expect(listRecruitment()).toHaveLength(1);
            expect(getRecruitment(a.id).name).toBe("A2");
        });

        it("getRecruitment returns null for an unknown id", () => {
            expect(getRecruitment("nope")).toBeNull();
        });

        it("deleteRecruitment removes by id and reports success", () => {
            const a = saveRecruitment({ name: "A" });
            expect(deleteRecruitment(a.id)).toBe(true);
            expect(deleteRecruitment(a.id)).toBe(false);
            expect(listRecruitment()).toHaveLength(0);
        });

        it("listRecruitment tolerates a missing/empty file", () => {
            expect(listRecruitment()).toEqual([]);
        });
    });

    describe("raid templates (#266)", () => {
        const TEMPLATES_FILE = require("../../src/config/paths").settingsPath("raid-templates.json");
        const CONFIG_FILE = require("../../src/config/paths").settingsPath("config.json");
        const kara = () => ({
            name: "Karazhan PuG", versionId: "tbc", instanceIds: ["kara"], size: 10,
            composition: { tank: 2, healer: 3 },
        });

        it("creates a template with a fresh id and the full shape", () => {
            const { template, error } = saveRaidTemplate(kara());
            expect(error).toBeUndefined();
            expect(template.id).toMatch(/^[0-9a-f]{12}$/);
            expect(template).toMatchObject({
                name: "Karazhan PuG", versionId: "tbc", instanceIds: ["kara"], size: 10,
                composition: { tank: 2, healer: 3, melee: null, ranged: null },
                requiredBuffs: [], signupDeadline: null, fairness: false, wishes: false, raidhelperTemplateId: "",
            });
            expect(listRaidTemplates()).toHaveLength(1);
            expect(getRaidTemplate(template.id).name).toBe("Karazhan PuG");
        });

        it("refuses what the validation refuses and stores nothing", () => {
            expect(saveRaidTemplate({ ...kara(), composition: { tank: 6, healer: 5 } }).error).toMatch(/passen nicht/);
            expect(saveRaidTemplate({ ...kara(), instanceIds: ["mc"] }).error).toMatch(/Instanz/);
            expect(listRaidTemplates()).toHaveLength(0);
        });

        it("updates by id and reports an unknown id as not found", () => {
            const { template } = saveRaidTemplate(kara());
            const again = saveRaidTemplate({ ...kara(), id: template.id, name: "Kara Donnerstag" });
            expect(again.template.id).toBe(template.id);
            expect(listRaidTemplates()).toHaveLength(1);
            expect(listRaidTemplates()[0].name).toBe("Kara Donnerstag");
            expect(saveRaidTemplate({ ...kara(), id: "gone" })).toMatchObject({ notFound: true });
        });

        it("deleteRaidTemplate removes by id and reports success", () => {
            const { template } = saveRaidTemplate(kara());
            expect(deleteRaidTemplate(template.id)).toBe(true);
            expect(deleteRaidTemplate(template.id)).toBe(false);
            expect(listRaidTemplates()).toHaveLength(0);
        });

        it("listRaidTemplates tolerates a missing file", () => {
            expect(listRaidTemplates()).toEqual([]);
        });

        // Since #420 the upgrade runs once at start (settingsMigration.js), not on a read.
        it("migrates the old Raid-Helper list into templates without size, and writes it back once", () => {
            fs.__store.set(TEMPLATES_FILE, JSON.stringify({ templates: [{ id: "3", name: "GDKP Kara", createdAt: 5, updatedAt: 6 }] }));
            migrateSettings({ log: () => {} });
            const [t] = listRaidTemplates();
            expect(t).toMatchObject({
                id: "rh-3", name: "GDKP Kara", versionId: "tbc", instanceIds: [], size: null,
                raidhelperTemplateId: "3", createdAt: 5, updatedAt: 6,
            });
            // written back in the new shape: a second read migrates nothing
            fs.writeFileSync.mockClear();
            expect(listRaidTemplates()[0].id).toBe("rh-3");
            expect(fs.writeFileSync).not.toHaveBeenCalled();
        });

        it("hands the old global default template to every raid category", () => {
            fs.__store.set(TEMPLATES_FILE, JSON.stringify({ templates: [{ id: "3", name: "GDKP Kara" }] }));
            fs.__store.set(CONFIG_FILE, JSON.stringify({ guildId: "111111", categoryIds: ["c1", "c2"], raidDefaults: { templateId: "3", channelId: "ch" } }));
            migrateSettings({ log: () => {} });
            const cfg = getConfig();
            expect(cfg.categoryRaidTemplate).toEqual({ c1: "rh-3", c2: "rh-3" });
            // the channel moved to the server (#924), the template id stayed behind
            expect(cfg.serverSettings["111111"].raidDefaults).toEqual({ channelId: "ch" });
            // a saved map ends the migration, even an emptied one
            saveConfig({ categoryRaidTemplate: { c1: "rh-3", c2: "" } });
            expect(getConfig().categoryRaidTemplate).toEqual({ c1: "rh-3" });
        });

        it("migrates no default for a Raid-Helper id no template links", () => {
            fs.__store.set(CONFIG_FILE, JSON.stringify({ categoryIds: ["c1"], raidDefaults: { templateId: "99" } }));
            expect(getConfig().categoryRaidTemplate).toEqual({});
        });

        describe("saveRaidTemplates (import from Raid-Helper)", () => {
            it("adds unknown Raid-Helper templates as templates without size, skipping blank ids", () => {
                const res = saveRaidTemplates([
                    { id: "3", name: "Kara" },
                    { id: "7", name: "MC" },
                    { id: "", name: "ignored" },
                ]);
                expect(res).toEqual({ added: 2, updated: 0 });
                expect(listRaidTemplates().map((t) => t.raidhelperTemplateId).sort()).toEqual(["3", "7"]);
                expect(listRaidTemplates().every((t) => t.size === null)).toBe(true);
            });

            it("leaves a template that already links the Raid-Helper template alone", () => {
                saveRaidTemplate({ ...kara(), raidhelperTemplateId: "3" });
                const res = saveRaidTemplates([{ id: "3", name: "Anders" }, { id: "9", name: "Neu" }]);
                expect(res).toEqual({ added: 1, updated: 1 });
                const byRh = Object.fromEntries(listRaidTemplates().map((t) => [t.raidhelperTemplateId, t]));
                expect(byRh["3"]).toMatchObject({ name: "Karazhan PuG", size: 10 });
                expect(byRh["9"]).toMatchObject({ name: "Neu", size: null });
            });

            it("writes nothing and returns zero counts for an empty list", () => {
                const res = saveRaidTemplates([]);
                expect(res).toEqual({ added: 0, updated: 0 });
                expect(fs.writeFileSync).not.toHaveBeenCalled();
            });
        });
    });

    describe("recruitment posts", () => {
        const post = () => ({ guildId: "g1", channelId: "c1", messageId: "m1", title: "Hi", source: "web" });

        it("creates a tracked post with an id", () => {
            const saved = saveRecruitmentPost(post());
            expect(saved.id).toMatch(/^[0-9a-f]{12}$/);
            expect(getRecruitmentPost(saved.id)).toMatchObject({ channelId: "c1", messageId: "m1" });
        });

        it("deduplicates by (channelId, messageId) on re-save", () => {
            saveRecruitmentPost(post());
            saveRecruitmentPost({ ...post(), title: "Updated", source: "scan" });
            const all = listRecruitmentPosts();
            expect(all).toHaveLength(1);
            expect(all[0].title).toBe("Updated");
        });

        it("keeps the template id and a posted source when a scan finds the message again", () => {
            saveRecruitmentPost({ ...post(), templateId: "t1" });
            saveRecruitmentPost({ ...post(), source: "scan" });
            const [only] = listRecruitmentPosts();
            expect(only).toMatchObject({ templateId: "t1", source: "web" });
        });

        it("records a scanned message without a template", () => {
            const saved = saveRecruitmentPost({ ...post(), source: "scan" });
            expect(saved).toMatchObject({ templateId: "", source: "scan" });
            expect(saved.updatedAt).toEqual(expect.any(Number));
        });

        it("updates by id (e.g. an edited embed)", () => {
            const saved = saveRecruitmentPost(post());
            saveRecruitmentPost({ id: saved.id, title: "Edited", body: "new" });
            expect(getRecruitmentPost(saved.id).title).toBe("Edited");
            expect(listRecruitmentPosts()).toHaveLength(1);
        });

        it("deleteRecruitmentPost removes by id and reports success", () => {
            const saved = saveRecruitmentPost(post());
            expect(deleteRecruitmentPost(saved.id)).toBe(true);
            expect(deleteRecruitmentPost(saved.id)).toBe(false);
            expect(listRecruitmentPosts()).toHaveLength(0);
        });
    });

    describe("notify (Anmelde-Aufruf) templates", () => {
        it("creates a template with an id and trims fields (no button)", () => {
            const saved = saveNotify({ name: "  Kara  ", title: " Anmeldung ", body: "b" });
            expect(saved.id).toMatch(/^[0-9a-f]{12}$/);
            expect(saved.name).toBe("Kara");
            expect(saved.title).toBe("Anmeldung");
            expect(saved).not.toHaveProperty("buttonLabel");
            expect(getNotify(saved.id)).toMatchObject({ name: "Kara" });
        });

        it("updates an existing template in place", () => {
            const a = saveNotify({ name: "A" });
            const b = saveNotify({ id: a.id, name: "A2", body: "x" });
            expect(b.id).toBe(a.id);
            expect(listNotify()).toHaveLength(1);
            expect(getNotify(a.id).name).toBe("A2");
        });

        it("deletes by id and tolerates a missing file", () => {
            expect(listNotify()).toEqual([]);
            const a = saveNotify({ name: "A" });
            expect(deleteNotify(a.id)).toBe(true);
            expect(deleteNotify(a.id)).toBe(false);
        });
    });

    describe("raidsheets", () => {
        it("seeds a default Tier 4/5 sheet when nothing is stored", () => {
            const sheets = listRaidsheets();
            expect(sheets).toHaveLength(1);
            expect(sheets[0].id).toBe("tier45");
            expect(sheets[0].name).toMatch(/Tier 4/);
            expect(Array.isArray(sheets[0].keywords)).toBe(true);
        });

        it("creates a new sheet and parses comma-separated keywords", () => {
            const saved = saveRaidsheet({ name: "Tier 6", spreadsheetId: "s6", sheetName: "SWP", keywords: "swp, sunwell" });
            expect(saved.id).toMatch(/^[0-9a-f]{12}$/);
            expect(saved.keywords).toEqual(["swp", "sunwell"]);
            const all = listRaidsheets();
            // default + new one are both now materialised
            expect(all.map((s) => s.name)).toEqual(expect.arrayContaining(["Tier 4 / Tier 5", "Tier 6"]));
            expect(getRaidsheet(saved.id)).toMatchObject({ spreadsheetId: "s6", sheetName: "SWP" });
        });

        it("updates the seeded default in place by id", () => {
            const updated = saveRaidsheet({ id: "tier45", name: "T45", keywords: ["kara"] });
            expect(updated.name).toBe("T45");
            expect(getRaidsheet("tier45").name).toBe("T45");
        });

        it("deletes a sheet by id and reports success", () => {
            const saved = saveRaidsheet({ name: "Tier 6", spreadsheetId: "s6" });
            expect(deleteRaidsheet(saved.id)).toBe(true);
            expect(deleteRaidsheet(saved.id)).toBe(false);
            expect(getRaidsheet(saved.id)).toBeNull();
        });

        it("does not clobber raidsheets when saving general config", () => {
            const saved = saveRaidsheet({ name: "Tier 6", spreadsheetId: "s6" });
            saveConfig({ categoryIds: ["c1"] });
            expect(getRaidsheet(saved.id)).not.toBeNull();
            expect(getConfig().categoryIds).toEqual(["c1"]);
        });
    });

});

// Role sync and reminders (#264).
describe("stores/settingsStore roleSync and categoryReminders", () => {
    it("default to nothing configured", () => {
        expect(getConfig().roleSync).toEqual([]);
        expect(getConfig().categoryReminders).toEqual({});
    });

    // #896: pairs of any two configured servers.
    const S1 = "900001";
    const S2 = "900002";
    const S3 = "900003";
    const ctx = { serverIds: [S1, S2, S3], talkGuildId: S2 };
    const pair = (from, fromRole, to, toRole, direction = "toTarget") => ({ fromGuildId: from, fromRoleId: fromRole, toGuildId: to, toRoleId: toRole, direction });

    it("keeps only complete role pairs with a known direction, once per pair", () => {
        expect(normalizeRoleSync([
            { ...pair(S1, " 111111 ", S3, "222222"), direction: "both" },
            pair(S1, "111111", S3, "222222", "toSource"),
            { ...pair(S2, "333333", S3, "444444"), direction: "sideways" },
            pair(S1, "555555", S3, ""),
            pair(S1, "@Raider", S3, "666666"),
            null,
        ], ctx)).toEqual([
            pair(S1, "111111", S3, "222222", "both"),
            pair(S2, "333333", S3, "444444", "toTarget"),
        ]);
        expect(normalizeRoleSync("x", ctx)).toEqual([]);
    });

    it("migrates the old event/talk pairs with their directions", () => {
        expect(normalizeRoleSync([
            { eventRoleId: "111111", talkRoleId: "222222", direction: "toTalk" },
            { eventRoleId: "333333", talkRoleId: "444444", direction: "toEvent" },
            { eventRoleId: "555555", talkRoleId: "666666", direction: "both" },
            { eventRoleId: "777777", talkRoleId: "888888" },
        ], ctx)).toEqual([
            pair(S1, "111111", S2, "222222", "toTarget"),
            pair(S1, "333333", S2, "444444", "toSource"),
            pair(S1, "555555", S2, "666666", "both"),
            pair(S1, "777777", S2, "888888", "toTarget"),
        ]);
    });

    it("drops old pairs without a talk server or with the talk server as the first one", () => {
        const old = [{ eventRoleId: "111111", talkRoleId: "222222", direction: "toTalk" }];
        expect(normalizeRoleSync(old, { serverIds: [S1], talkGuildId: "" })).toEqual([]);
        expect(normalizeRoleSync(old, { serverIds: [S1], talkGuildId: S1 })).toEqual([]);
    });

    it("drops a pair on one server and a pair with a server not in the list", () => {
        expect(normalizeRoleSync([
            pair(S1, "111111", S1, "222222"),
            pair(S1, "111111", "900009", "222222"),
            pair("900009", "111111", S2, "222222"),
        ], ctx)).toEqual([]);
        // without a server list only the shape is checked
        expect(normalizeRoleSync([pair(S1, "111111", "900009", "222222")])).toHaveLength(1);
    });

    it("checks pairs against the servers on save", () => {
        saveConfig({ discordServers: { servers: [{ guildId: S1 }, { guildId: S3 }], talkGuildId: S2 } });
        saveConfig({ roleSync: [pair(S1, "111111", S3, "222222"), pair(S2, "333333", S3, "444444", "both")] });
        expect(getConfig().roleSync).toHaveLength(2);
        // a server leaves the list: its pairs go with it
        const saved = saveConfig({ discordServers: { servers: [{ guildId: S1 }, { guildId: S3 }], talkGuildId: "" } });
        expect(saved.roleSync).toEqual([pair(S1, "111111", S3, "222222")]);
    });

    // A config.json from before #896: event/talk pairs and the old server block.
    const LEGACY_ROLE_SYNC = [
        { eventRoleId: "111111", talkRoleId: "222222", direction: "toTalk" },
        { eventRoleId: "333333", talkRoleId: "444444", direction: "toEvent" },
    ];
    const writeLegacy = (discordServers) => {
        saveConfig({});
        const key = [...fs.__store.keys()].find((k) => k.endsWith("config.json"));
        fs.__store.set(key, JSON.stringify({ discordServers, roleSync: LEGACY_ROLE_SYNC }));
        return key;
    };
    const MIGRATED = [pair(S1, "111111", S2, "222222", "toTarget"), pair(S1, "333333", S2, "444444", "toSource")];

    it("writes old pairs in the new form when a foreign key is saved", () => {
        const key = writeLegacy({ eventGuilds: [{ guildId: S1 }], talkGuildId: S2 });
        saveConfig({ eventLang: "en" });
        expect(JSON.parse(fs.__store.get(key)).roleSync).toEqual(MIGRATED);
        expect(getConfig().roleSync).toEqual(MIGRATED);
    });

    it("keeps old pairs when the old server dialog saves without servers", () => {
        const key = writeLegacy({ eventGuilds: [{ guildId: S1 }], talkGuildId: S2 });
        saveConfig({ discordServers: { eventGuilds: [{ guildId: S1 }], talkGuildId: S2 } });
        expect(JSON.parse(fs.__store.get(key)).roleSync).toEqual(MIGRATED);
    });

    it("keeps an old pair with ten servers and an own talk server", () => {
        const ten = Array.from({ length: 10 }, (_, i) => ({ guildId: String(910000 + i) }));
        const key = writeLegacy({ servers: ten, talkGuildId: S2 });
        saveConfig({ eventLang: "en" });
        const saved = JSON.parse(fs.__store.get(key)).roleSync;
        expect(saved).toHaveLength(2);
        expect(saved[0]).toMatchObject({ fromGuildId: "910000", toGuildId: S2, direction: "toTarget" });
    });

    it("clamps reminder hours, drops switched-off categories and an old target", () => {
        expect(normalizeCategoryReminders({
            123456: { missingHours: "24", signedHours: 1.4, target: "talk" },
            234567: { missingHours: 500, signedHours: -3 },
            345678: { missingHours: 0, signedHours: "" },
            nope: { missingHours: 5 },
        })).toEqual({
            123456: { missingHours: 24, signedHours: 1 },
            234567: { missingHours: 168, signedHours: 0 },
        });
        expect(normalizeCategoryReminders([])).toEqual({});
    });

    it("replaces both as a whole on save", () => {
        saveConfig({ roleSync: [pair(S1, "111111", S3, "222222")], categoryReminders: { 123456: { signedHours: 2 } } });
        const saved = saveConfig({ roleSync: [], categoryReminders: { 234567: { missingHours: 12, target: "both" } } });
        expect(saved.roleSync).toEqual([]);
        expect(saved.categoryReminders).toEqual({ 234567: { missingHours: 12, signedHours: 0 } });
    });
});
