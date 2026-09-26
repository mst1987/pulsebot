const fs = require("fs");
const { tempStoreFile } = require("../helpers/tempStore");
const store = require("../../src/web/notifyTemplateStore");

let file;

beforeEach(() => {
    file = tempStoreFile("notify.json");
    store.useFile(file);
});

afterAll(() => store.useFile(null));

describe("web/notifyTemplateStore", () => {
    it("is empty without a file or without a list", () => {
        expect(store.listNotify()).toEqual([]);
        fs.writeFileSync(file, JSON.stringify({ templates: "x" }));
        expect(store.listNotify()).toEqual([]);
        expect(store.getNotify("x")).toBeNull();
    });

    it("creates, updates, sorts newest-edited first and deletes", () => {
        const now = jest.spyOn(Date, "now").mockReturnValue(1000);
        const a = store.saveNotify({ name: " Raid ", title: " Heute ", body: "Kommt alle" });
        expect(a).toMatchObject({ name: "Raid", title: "Heute", body: "Kommt alle", createdAt: 1000 });
        now.mockReturnValue(2000);
        const b = store.saveNotify({ name: "Zweiter" });
        expect(store.listNotify().map((t) => t.id)).toEqual([b.id, a.id]);
        now.mockReturnValue(3000);
        expect(store.saveNotify({ id: a.id, name: "Raid neu" })).toMatchObject({ id: a.id, name: "Raid neu", body: "", updatedAt: 3000 });
        expect(store.getNotify(a.id).name).toBe("Raid neu");
        expect(store.deleteNotify(a.id)).toBe(true);
        expect(store.deleteNotify(a.id)).toBe(false);
        expect(JSON.parse(fs.readFileSync(file, "utf8")).templates.map((t) => t.id)).toEqual([b.id]);
        now.mockRestore();
    });
});
