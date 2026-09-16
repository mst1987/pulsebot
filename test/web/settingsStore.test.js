// Mock fs with an in-memory store so tests never touch the repo's disk.
jest.mock("fs", () => {
    const store = new Map();
    const enoent = (p) => {
        const e = new Error(`ENOENT: no such file '${p}'`);
        e.code = "ENOENT";
        return e;
    };
    return {
        __store: store,
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn((p, data) => {
            store.set(p, String(data));
        }),
        readFileSync: jest.fn((p) => {
            if (!store.has(p)) throw enoent(p);
            return store.get(p);
        }),
    };
});

const fs = require("fs");
const {
    listRecruitment, getRecruitment, saveRecruitment, deleteRecruitment,
    listRecruitmentPosts, getRecruitmentPost, saveRecruitmentPost, deleteRecruitmentPost,
    listRaidTemplates, getRaidTemplate, saveRaidTemplate, saveRaidTemplates, deleteRaidTemplate,
    listNotify, getNotify, saveNotify, deleteNotify,
    listRaidsheets, getRaidsheet, saveRaidsheet, deleteRaidsheet,
    getConfig, saveConfig, resolveEventSheetLink, normalizeDiscordServers,
} = require("../../src/web/settingsStore.js");

beforeEach(() => {
    fs.__store.clear();
});

describe("web/settingsStore", () => {
    describe("getConfig", () => {
        it("returns the defaults when nothing is stored", () => {
            const cfg = getConfig();
            expect(cfg.adminRoleIds).toEqual([]);
            expect(cfg.raidDefaults).toEqual({ channelId: "" });
            expect(cfg.categoryRaidTemplate).toEqual({});
        });

        it("merges stored values over the defaults", () => {
            saveConfig({ adminRoleIds: ["111", "222"], raidDefaults: { channelId: "ch" } });
            const cfg = getConfig();
            expect(cfg.adminRoleIds).toEqual(["111", "222"]);
            // the default template is per category now, raidDefaults keeps only the channel
            expect(cfg.raidDefaults).toEqual({ channelId: "ch" });
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

        // Two Discord servers (#251): the event server and the talk server.
        describe("discordServers", () => {
            const { guildId: defaultGuildId } = require("../../src/config/variables");

            it("defaults to four empty ids (= one server, as before)", () => {
                expect(getConfig().discordServers).toEqual({
                    eventGuildId: "", talkGuildId: "", talkOverviewChannelId: "", talkPingChannelId: "",
                });
                expect(getConfig().guildId).toBe(defaultGuildId);
            });

            it("keeps snowflakes and drops anything that is not one", () => {
                const saved = saveConfig({
                    discordServers: {
                        eventGuildId: " 111111 ", talkGuildId: "222222",
                        talkOverviewChannelId: "https://discord.com/channels/1/2", talkPingChannelId: 333333,
                    },
                });
                expect(saved.discordServers).toEqual({
                    eventGuildId: "111111", talkGuildId: "222222", talkOverviewChannelId: "", talkPingChannelId: "333333",
                });
            });

            it("clears a talk server that is the event server", () => {
                expect(normalizeDiscordServers({ eventGuildId: "111111", talkGuildId: "111111" }).talkGuildId).toBe("");
                expect(normalizeDiscordServers(null)).toEqual({
                    eventGuildId: "", talkGuildId: "", talkOverviewChannelId: "", talkPingChannelId: "",
                });
                expect(normalizeDiscordServers(["x"]).eventGuildId).toBe("");
            });

            it("merges a partial update instead of replacing the block", () => {
                saveConfig({ discordServers: { eventGuildId: "111111", talkGuildId: "222222" } });
                const saved = saveConfig({ discordServers: { talkPingChannelId: "444444" } });
                expect(saved.discordServers).toMatchObject({ eventGuildId: "111111", talkGuildId: "222222", talkPingChannelId: "444444" });
            });

            // guildId stays the fallback: the event server wins, and clearing it
            // falls back to the server that was last in use.
            it("reports the event server as guildId and keeps it as the fallback", () => {
                saveConfig({ guildId: "999999" });
                expect(saveConfig({ discordServers: { eventGuildId: "111111" } }).guildId).toBe("111111");
                expect(saveConfig({ discordServers: { eventGuildId: "" } }).guildId).toBe("111111");
            });
        });

        it("exposes the channel/role ids and persists overrides", () => {
            const def = getConfig();
            expect(def).toHaveProperty("applicationChannelId");
            expect(def).toHaveProperty("officerRoleId");
            expect(def).toHaveProperty("highestBidsChannelId");
            expect(def).toHaveProperty("highestBidsMessageId");
            expect(Array.isArray(def.categoryIds)).toBe(true);
            expect(Array.isArray(def.logChannelIds)).toBe(true);

            saveConfig({
                applicationChannelId: "app-1",
                officerRoleId: "role-1",
                highestBidsChannelId: "hb-1",
                highestBidsMessageId: "msg-1",
                categoryIds: ["c1", "c2"],
                logChannelIds: ["log-1", "log-2"],
            });
            const cfg = getConfig();
            expect(cfg.applicationChannelId).toBe("app-1");
            expect(cfg.officerRoleId).toBe("role-1");
            expect(cfg.highestBidsChannelId).toBe("hb-1");
            expect(cfg.highestBidsMessageId).toBe("msg-1");
            expect(cfg.categoryIds).toEqual(["c1", "c2"]);
            expect(cfg.logChannelIds).toEqual(["log-1", "log-2"]);
        });

        it("guards logChannelIds to an array when the stored value is malformed", () => {
            saveConfig({});
            fs.__store.set([...fs.__store.keys()].find((k) => k.endsWith("config.json")),
                JSON.stringify({ logChannelIds: "nope" }));
            expect(getConfig().logChannelIds).toEqual([]);
        });

        it("exposes blizzard defaults and a categoryLootTool map", () => {
            const cfg = getConfig();
            expect(cfg.blizzard).toEqual(expect.objectContaining({
                clientId: expect.any(String), clientSecret: expect.any(String),
                region: "eu", realmSlug: "thunderstrike", namespace: "",
            }));
            expect(cfg.categoryLootTool).toEqual({});
        });

        it("guards categoryLootTool to an object when the stored value is malformed", () => {
            saveConfig({});
            fs.__store.set([...fs.__store.keys()].find((k) => k.endsWith("config.json")),
                JSON.stringify({ categoryLootTool: "nope" }));
            expect(getConfig().categoryLootTool).toEqual({});
        });

        it("keeps only switched categories in categorySignupSource, and switching back removes one", () => {
            expect(getConfig().categorySignupSource).toEqual({});
            saveConfig({ categorySignupSource: { c1: "eventhelper", c2: "raidhelper", c3: "bogus" } });
            expect(getConfig().categorySignupSource).toEqual({ c1: "eventhelper" });
            saveConfig({ categorySignupSource: { c4: "eventhelper" } });
            expect(getConfig().categorySignupSource).toEqual({ c1: "eventhelper", c4: "eventhelper" });
            saveConfig({ categorySignupSource: { c1: "raidhelper" } });
            expect(getConfig().categorySignupSource).toEqual({ c4: "eventhelper" });
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
        it("persists a partial update and deep-merges raidDefaults", () => {
            saveConfig({ raidDefaults: { channelId: "c1" }, adminRoleIds: ["1"] });
            saveConfig({ raidDefaults: { channelId: "c2" } });
            const cfg = getConfig();
            expect(cfg.adminRoleIds).toEqual(["1"]);
            expect(cfg.raidDefaults.channelId).toBe("c2");
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
            expect(cfg.blizzard.realmSlug).toBe("thunderstrike");
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
        const TEMPLATES_FILE = require("path").join(__dirname, "..", "..", "data", "settings", "raid-templates.json");
        const CONFIG_FILE = require("path").join(__dirname, "..", "..", "data", "settings", "config.json");
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

        it("migrates the old Raid-Helper list into templates without size, and writes it back once", () => {
            fs.__store.set(TEMPLATES_FILE, JSON.stringify({ templates: [{ id: "3", name: "GDKP Kara", createdAt: 5, updatedAt: 6 }] }));
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
            fs.__store.set(CONFIG_FILE, JSON.stringify({ categoryIds: ["c1", "c2"], raidDefaults: { templateId: "3", channelId: "ch" } }));
            const cfg = getConfig();
            expect(cfg.categoryRaidTemplate).toEqual({ c1: "rh-3", c2: "rh-3" });
            expect(cfg.raidDefaults).toEqual({ channelId: "ch" });
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
            saveConfig({ officerRoleId: "role-1" });
            expect(getRaidsheet(saved.id)).not.toBeNull();
            expect(getConfig().officerRoleId).toBe("role-1");
        });
    });

});
