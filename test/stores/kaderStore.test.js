// The Kaderplaner's store (docs/kaderplaner.md): one planner per server, in
// data/settings/kader.json, normalised on the way in and out.
const fs = require("fs");
const { tempStoreFile } = require("../helpers/tempStore");
const kaderStore = require("../../src/stores/kaderStore");

let file;
beforeEach(() => {
    file = tempStoreFile("kader-store.json");
    if (fs.existsSync(file)) fs.unlinkSync(file);
    kaderStore.useFile(file);
});
afterAll(() => kaderStore.useFile(null));

describe("stores/kaderStore", () => {
    it("reads an empty planner when nothing is stored", () => {
        expect(kaderStore.readPlanner("g1")).toEqual({ accounts: [], assignments: {}, rosters: [], setups: {} });
    });

    it("keeps the planners of different servers apart", () => {
        kaderStore.writePlanner("g1", { rosters: [{ id: "r1", name: "Hyjal", size: 20 }] });
        kaderStore.writePlanner("g2", { accounts: [{ userId: "444444444444444444", displayName: "Hand" }] });
        expect(kaderStore.readPlanner("g1").rosters.map((r) => r.id)).toEqual(["r1"]);
        expect(kaderStore.readPlanner("g1").accounts).toEqual([]);
        expect(kaderStore.readPlanner("g2").accounts).toHaveLength(1);
        expect(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).guilds).sort()).toEqual(["g1", "g2"]);
    });

    it("normalises what it writes and survives a broken file", () => {
        const stored = kaderStore.writePlanner("g1", { rosters: [{ id: "r1", size: 10, members: [{ userId: "x", role: "boss" }] }] });
        expect(stored.rosters[0].members).toEqual([]);
        expect(stored.setups.r1.variants).toHaveLength(1);
        fs.writeFileSync(file, "{ nope");
        expect(kaderStore.readPlanner("g1").rosters).toEqual([]);
    });
});
