// The dungeon run store: normalising what is read, the cap, the record mark.
const fs = require("fs");
const store = require("../../src/stores/dungeonRunStore");
const { tempStoreFile } = require("../helpers/tempStore");

let file;
beforeAll(() => {
    file = tempStoreFile("dungeon-runs.json");
    store.useFile(file);
});
afterAll(() => store.useFile(null));

describe("dungeonRunStore", () => {
    it("reads an empty store without a file", () => {
        expect(store.listRuns()).toEqual([]);
        expect(store.listCharacters()).toEqual([]);
    });

    it("normalises what it reads and drops entries without id or version", () => {
        fs.writeFileSync(file, JSON.stringify({
            runs: [
                { id: "dr_1", versionId: "forever", dungeon: "X", seconds: "100", medal: "platinum", members: [{ name: "A" }, { guid: "1" }], instance: "7" },
                { id: "dr_2" },
                null,
            ],
            characters: [{ key: "forever:n:a", versionId: "forever", name: "A", points: -5 }, { name: "nokey" }],
        }));
        const [r] = store.listRuns();
        expect(store.listRuns()).toHaveLength(1);
        expect(r).toMatchObject({ seconds: 100, medal: null, instance: 7, members: [{ guid: "", name: "A", class: "" }], addonIds: [], recordPostedAt: 0 });
        expect(store.listCharacters()).toEqual([expect.objectContaining({ key: "forever:n:a", points: 0 })]);
        expect(store.listRuns("tbc")).toEqual([]);
    });

    it("marks the runs whose record post went out", () => {
        store.update(() => ({ runs: [{ id: "dr_1", versionId: "forever" }, { id: "dr_2", versionId: "forever" }], characters: [] }));
        store.markRecordPosted(["dr_2"], 777);
        store.markRecordPosted([]);
        expect(store.listRuns().map((r) => r.recordPostedAt)).toEqual([0, 777]);
    });

    it("keeps the newest runs when the cap is passed", () => {
        const runs = Array.from({ length: store.MAX_STORED_RUNS + 2 }, (_, i) => ({ id: `dr_${i}`, versionId: "forever", at: i }));
        store.update((doc) => ({ ...doc, runs }));
        const kept = store.listRuns();
        expect(kept).toHaveLength(store.MAX_STORED_RUNS);
        expect(kept.some((r) => r.id === "dr_0")).toBe(false);
    });
});
