const fs = require("fs");
const { tempStoreFile } = require("../helpers/tempStore");
const store = require("../../src/web/raidTemplateStore");

let file;
const kara = () => ({
    name: "Karazhan PuG", versionId: "tbc", instanceIds: ["kara"], size: 10,
    composition: { tank: 2, healer: 3 },
});
const writeFile = (value) => fs.writeFileSync(file, JSON.stringify(value));
const readFile = () => JSON.parse(fs.readFileSync(file, "utf8"));

beforeEach(() => {
    file = tempStoreFile("raid-templates.json");
    store.useFile(file);
});

afterAll(() => store.useFile(null));

describe("web/raidTemplateStore", () => {
    it("is empty without a file and skips entries that are no object", () => {
        expect(store.listRaidTemplates()).toEqual([]);
        writeFile({ templates: [null, "x", { ...kara(), id: "a", versionId: "tbc" }] });
        expect(store.listRaidTemplates().map((t) => t.id)).toEqual(["a"]);
        writeFile({ templates: "x" });
        expect(store.listRaidTemplates()).toEqual([]);
    });

    it("creates, updates, sorts newest first and deletes", () => {
        const now = jest.spyOn(Date, "now").mockReturnValue(1000);
        const { template: a } = store.saveRaidTemplate(kara());
        now.mockReturnValue(2000);
        const { template: b } = store.saveRaidTemplate({ ...kara(), name: "Gruul" });
        expect(store.listRaidTemplates().map((t) => t.id)).toEqual([b.id, a.id]);
        now.mockReturnValue(3000);
        expect(store.saveRaidTemplate({ ...kara(), id: a.id, name: "Kara Do" }).template).toMatchObject({ id: a.id, name: "Kara Do", updatedAt: 3000 });
        expect(store.getRaidTemplate(a.id).name).toBe("Kara Do");
        expect(store.getRaidTemplate(undefined)).toBeNull();
        expect(store.saveRaidTemplate({ ...kara(), id: "gone" })).toMatchObject({ notFound: true });
        expect(store.saveRaidTemplate({ ...kara(), composition: { tank: 6, healer: 5 } }).error).toMatch(/passen nicht/);
        expect(store.deleteRaidTemplate(a.id)).toBe(true);
        expect(store.deleteRaidTemplate(a.id)).toBe(false);
        expect(readFile().templates.map((t) => t.id)).toEqual([b.id]);
        now.mockRestore();
    });

    it("imports Raid-Helper templates: new ones without size, a linked one only gets a missing name", () => {
        writeFile({ templates: [
            { ...kara(), id: "a", name: "", raidhelperTemplateId: "3" },
            { ...kara(), id: "b", raidhelperTemplateId: "4" },
        ] });
        expect(store.saveRaidTemplates([{ id: "3", name: "Kara" }, { id: "4", name: "Anders" }, { id: " 9 ", name: "Neu" }, { id: "" }]))
            .toEqual({ added: 1, updated: 2 });
        const byRh = Object.fromEntries(store.listRaidTemplates().map((t) => [t.raidhelperTemplateId, t]));
        expect(byRh["3"]).toMatchObject({ name: "Kara", size: 10 });
        expect(byRh["4"]).toMatchObject({ name: "Karazhan PuG" });
        expect(byRh["9"]).toMatchObject({ id: "rh-9", name: "Neu", size: null });
        expect(store.saveRaidTemplates(null)).toEqual({ added: 0, updated: 0 });
    });

    it("reads an old entry as it is - the upgrade is migrateLegacyTemplates(), once", () => {
        writeFile({ templates: [{ id: "3", name: "GDKP Kara", createdAt: 5, updatedAt: 6 }, { ...kara(), id: "a", updatedAt: 1 }] });
        expect(store.listRaidTemplates().map((t) => t.id)).toEqual(["3", "a"]);
        expect(readFile().templates[0]).toEqual({ id: "3", name: "GDKP Kara", createdAt: 5, updatedAt: 6 });

        expect(store.migrateLegacyTemplates()).toBe(1);
        const [old, current] = readFile().templates;
        expect(old).toMatchObject({ id: "rh-3", raidhelperTemplateId: "3", size: null, createdAt: 5, updatedAt: 6 });
        expect(current).toMatchObject({ id: "a", size: 10, createdAt: 0, updatedAt: 1 });

        const before = fs.readFileSync(file, "utf8");
        expect(store.migrateLegacyTemplates()).toBe(0);
        expect(fs.readFileSync(file, "utf8")).toBe(before);
    });

    it("migrates nothing without a file", () => {
        expect(store.migrateLegacyTemplates()).toBe(0);
        expect(fs.existsSync(file)).toBe(false);
    });
});
