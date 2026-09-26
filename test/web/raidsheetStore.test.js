const fs = require("fs");
const { tempStoreFile } = require("../helpers/tempStore");
const store = require("../../src/web/raidsheetStore");
const configStore = require("../../src/web/configStore");

let file;
const readFile = () => JSON.parse(fs.readFileSync(file, "utf8"));

beforeEach(() => {
    file = tempStoreFile("config.json");
    store.useFile(file);
});

afterAll(() => store.useFile(null));

describe("web/raidsheetStore", () => {
    it("lists the default Tier 4/5 sheet while nothing is saved", () => {
        expect(store.listRaidsheets()).toEqual([store.DEFAULT_RAIDSHEET]);
        expect(store.getRaidsheet("tier45").name).toBe("Tier 4 / Tier 5");
        expect(store.getRaidsheet("x")).toBeNull();
    });

    it("saving materialises the default next to the new sheet and keeps the rest of config.json", () => {
        configStore.writeStored({ adminRoleIds: ["1"], extra: true });
        const saved = store.saveRaidsheet({ name: " T6 ", spreadsheetId: " s ", keywords: "hyjal, bt ,", gid: 7 });
        expect(saved).toMatchObject({ name: "T6", spreadsheetId: "s", sheetName: "Setup", gid: "7", keywords: ["hyjal", "bt"] });
        const stored = readFile();
        expect(stored).toMatchObject({ adminRoleIds: ["1"], extra: true });
        expect(stored.raidsheets.map((s) => s.id)).toEqual(["tier45", saved.id]);
        expect(store.listRaidsheets()).toHaveLength(2);
    });

    it("updates by id, keeping what the update leaves out", () => {
        const saved = store.saveRaidsheet({ name: "T6", sheetName: "Plan", keywords: ["bt"] });
        const again = store.saveRaidsheet({ id: saved.id, name: "T6 neu", keywords: [" x ", ""] });
        expect(again).toMatchObject({ id: saved.id, name: "T6 neu", sheetName: "Plan", keywords: ["x"] });
        expect(store.getRaidsheet(saved.id).name).toBe("T6 neu");
    });

    it("deletes by id and reports an unknown id", () => {
        const saved = store.saveRaidsheet({ name: "T6" });
        expect(store.deleteRaidsheet(saved.id)).toBe(true);
        expect(store.deleteRaidsheet(saved.id)).toBe(false);
        expect(readFile().raidsheets.map((s) => s.id)).toEqual(["tier45"]);
    });
});
