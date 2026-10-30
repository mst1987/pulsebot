// kaderCategories (#744): a closed raid category leaves every Kader's attendance
// categories, on every server - and nothing of a Kader's players leaves through here.
const fs = require("fs");
const { tempStoreFile } = require("../../helpers/tempStore");
const kaderStore = require("../../../src/stores/roster/kaderStore");
const { kadersCountingCategory, dropAttendanceCategory } = require("../../../src/services/kader/kaderCategories");

const kader = (id, name, attendanceCategories) => ({
    id, name, leads: ["100000000000000001"], createdAt: "", createdBy: "", attendanceCategories, questions: [], players: {}, setups: [],
});

let file;
beforeEach(() => {
    file = tempStoreFile("kader-categories.json");
    fs.writeFileSync(file, JSON.stringify({ guilds: {
        g1: { kaders: [kader("k1", "Forever-Kader", ["mon", "thu"]), kader("k2", "PuG", ["fri"])] },
        g2: { kaders: [kader("k3", "Zweitserver", ["mon"])] },
    } }));
    kaderStore.useFile(file);
});
afterAll(() => kaderStore.useFile(null));

describe("services/kader/kaderCategories", () => {
    it("names every Kader that counts a category, on every server", () => {
        expect(kadersCountingCategory("mon")).toEqual([
            { guildId: "g1", kaderId: "k1", name: "Forever-Kader" },
            { guildId: "g2", kaderId: "k3", name: "Zweitserver" },
        ]);
        expect(kadersCountingCategory("nope")).toEqual([]);
        expect(kadersCountingCategory("")).toEqual([]);
    });

    it("takes the category out of every Kader and leaves the rest alone", () => {
        expect(dropAttendanceCategory("mon")).toBe(2);
        expect(kaderStore.readPlanner("g1").kaders.map((k) => [k.id, k.attendanceCategories])).toEqual([["k1", ["thu"]], ["k2", ["fri"]]]);
        expect(kaderStore.readPlanner("g2").kaders[0].attendanceCategories).toEqual([]);
        expect(dropAttendanceCategory("mon")).toBe(0);
        expect(dropAttendanceCategory("")).toBe(0);
    });

    it("lists the servers the file holds", () => {
        expect(kaderStore.plannerGuildKeys().sort()).toEqual(["g1", "g2"]);
    });
});
