const fs = require("fs");
const store = require("../../../src/stores/settings/serverPlanStore");
const { tempStoreFile } = require("../../helpers/tempStore");

let file;

beforeEach(() => {
    file = tempStoreFile("server-plans.json");
    store.useFile(file);
});
afterAll(() => store.useFile(null));

describe("serverPlanStore", () => {
    it("is empty without a file", () => {
        expect(store.readAll()).toEqual({});
        expect(store.getEntry("g1")).toBeNull();
    });

    it("saves one entry per server and removes it again", () => {
        store.setEntry("g1", { plan: "free", until: "2027-01-31", note: "Test" });
        store.setEntry("g2", { plan: "free", until: "", note: "" });
        expect(store.getEntry("g1")).toEqual({ plan: "free", until: "2027-01-31", note: "Test" });
        expect(JSON.parse(fs.readFileSync(file, "utf8"))).toHaveProperty("g2");
        store.setEntry("g1", null);
        expect(store.getEntry("g1")).toBeNull();
        expect(Object.keys(store.readAll())).toEqual(["g2"]);
    });

    it("mends a file edited by hand", () => {
        fs.mkdirSync(require("path").dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ g1: { plan: "free", until: 5 }, g2: "free", g3: null, g4: [] }));
        expect(store.readAll()).toEqual({ g1: { plan: "free", until: "", note: "" } });
    });

    it("does not read an entry off the object prototype", () => {
        expect(store.getEntry("constructor")).toBeNull();
    });
});
