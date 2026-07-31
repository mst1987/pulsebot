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
    listRaidTemplates, saveRaidTemplate, saveRaidTemplates, deleteRaidTemplate,
    listNotify, getNotify, saveNotify, deleteNotify,
    listRaidsheets, getRaidsheet, saveRaidsheet, deleteRaidsheet,
    getConfig, saveConfig, resolveEventSheetLink,
} = require("../../src/web/settingsStore.js");

beforeEach(() => {
    fs.__store.clear();
});

describe("web/settingsStore", () => {
    describe("getConfig", () => {
        it("returns the defaults when nothing is stored", () => {
            const cfg = getConfig();
            expect(cfg.adminRoleIds).toEqual([]);
            expect(cfg.raidDefaults).toEqual({ templateId: "", channelId: "" });
        });

        it("merges stored values over the defaults", () => {
            saveConfig({ adminRoleIds: ["111", "222"], raidDefaults: { templateId: "tpl" } });
            const cfg = getConfig();
            expect(cfg.adminRoleIds).toEqual(["111", "222"]);
            // raidDefaults is deep-merged: channelId keeps its default
            expect(cfg.raidDefaults).toEqual({ templateId: "tpl", channelId: "" });
        });

        it("guards adminRoleIds to an array when the stored value is malformed", () => {
            // write a bad shape directly, then read through getConfig
            saveConfig({});
            fs.__store.set([...fs.__store.keys()].find((k) => k.endsWith("config.json")),
                JSON.stringify({ adminRoleIds: "not-an-array" }));
            expect(getConfig().adminRoleIds).toEqual([]);
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
            saveConfig({ raidDefaults: { templateId: "a", channelId: "c1" } });
            saveConfig({ raidDefaults: { channelId: "c2" } });
            const cfg = getConfig();
            expect(cfg.raidDefaults.templateId).toBe("a");
            expect(cfg.raidDefaults.channelId).toBe("c2");
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

    describe("raid templates", () => {
        it("creates a template keyed by its Raid-Helper templateId and trims fields", () => {
            const saved = saveRaidTemplate({ id: "  3 ", name: "  GDKP Kara  " });
            expect(saved).toMatchObject({ id: "3", name: "GDKP Kara" });
            expect(listRaidTemplates()).toHaveLength(1);
        });

        it("rejects a blank templateId", () => {
            expect(saveRaidTemplate({ id: "  ", name: "x" })).toBeNull();
            expect(listRaidTemplates()).toHaveLength(0);
        });

        it("updates the name in place for an existing id instead of duplicating", () => {
            saveRaidTemplate({ id: "7", name: "Old" });
            const again = saveRaidTemplate({ id: "7", name: "New" });
            expect(again.id).toBe("7");
            expect(listRaidTemplates()).toHaveLength(1);
            expect(listRaidTemplates()[0].name).toBe("New");
        });

        it("keeps the existing name when an update carries a blank name", () => {
            saveRaidTemplate({ id: "7", name: "Keep" });
            saveRaidTemplate({ id: "7", name: "" });
            expect(listRaidTemplates()[0].name).toBe("Keep");
        });

        it("deleteRaidTemplate removes by id and reports success", () => {
            saveRaidTemplate({ id: "3", name: "A" });
            expect(deleteRaidTemplate("3")).toBe(true);
            expect(deleteRaidTemplate("3")).toBe(false);
            expect(listRaidTemplates()).toHaveLength(0);
        });

        it("listRaidTemplates tolerates a missing file", () => {
            expect(listRaidTemplates()).toEqual([]);
        });

        describe("saveRaidTemplates (bulk import)", () => {
            it("adds new templates and reports counts, skipping blank ids", () => {
                const res = saveRaidTemplates([
                    { id: "3", name: "Kara" },
                    { id: "7", name: "MC" },
                    { id: "", name: "ignored" },
                ]);
                expect(res).toEqual({ added: 2, updated: 0 });
                expect(listRaidTemplates()).toHaveLength(2);
            });

            it("updates existing templates and only overwrites the name when provided", () => {
                saveRaidTemplate({ id: "3", name: "Original" });
                const res = saveRaidTemplates([
                    { id: "3", name: "" },
                    { id: "9", name: "Neu" },
                ]);
                expect(res).toEqual({ added: 1, updated: 1 });
                const byId = Object.fromEntries(listRaidTemplates().map((t) => [t.id, t.name]));
                expect(byId["3"]).toBe("Original");
                expect(byId["9"]).toBe("Neu");
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
