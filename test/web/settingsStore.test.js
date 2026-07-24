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
    getConfig, saveConfig,
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

            saveConfig({
                applicationChannelId: "app-1",
                officerRoleId: "role-1",
                highestBidsChannelId: "hb-1",
                highestBidsMessageId: "msg-1",
                categoryIds: ["c1", "c2"],
            });
            const cfg = getConfig();
            expect(cfg.applicationChannelId).toBe("app-1");
            expect(cfg.officerRoleId).toBe("role-1");
            expect(cfg.highestBidsChannelId).toBe("hb-1");
            expect(cfg.highestBidsMessageId).toBe("msg-1");
            expect(cfg.categoryIds).toEqual(["c1", "c2"]);
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
});
