const fs = require("fs");
const { tempStoreFile } = require("../helpers/tempStore");

jest.mock("../../src/web/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../src/web/eventSoftresStore", () => ({ getEventSoftres: jest.fn(() => null) }));

const store = require("../../src/web/eventLootSystemStore");
const { getConfig } = require("../../src/web/settingsStore");
const { getEventSoftres } = require("../../src/web/eventSoftresStore");

describe("eventLootSystemStore", () => {
    let file;
    beforeEach(() => {
        file = tempStoreFile("event-loot-system.json");
        store.useFile(file);
    });
    afterAll(() => store.useFile(null));

    it("has no override for an unknown raid", () => {
        expect(store.getEventLootSystem("e1")).toBeNull();
        expect(store.getEventLootSystem("")).toBeNull();
    });

    it("stores a raid's own system and the extra softres switch, with who did it", () => {
        const saved = store.setEventLootSystem("e1", { system: "gdkp", softres: true, by: "u1", byName: "Orga" });
        expect(saved).toMatchObject({ system: "gdkp", softres: true, by: "u1", byName: "Orga" });
        expect(store.getEventLootSystem("e1")).toMatchObject({ system: "gdkp", softres: true });
        expect(JSON.parse(fs.readFileSync(file, "utf8")).events.e1.system).toBe("gdkp");
    });

    it("drops an unknown system and removes an entry that says nothing", () => {
        expect(store.setEventLootSystem("e1", { system: "dkp", softres: true })).toMatchObject({ system: "", softres: true });
        expect(store.setEventLootSystem("e1", { system: "", softres: false })).toBeNull();
        expect(store.getEventLootSystem("e1")).toBeNull();
        expect(store.setEventLootSystem("", { system: "gdkp" })).toBeNull();
    });

    it("forgets a deleted raid", () => {
        store.setEventLootSystem("e1", { system: "other" });
        expect(store.deleteEventLootSystem("e1")).toBe(true);
        expect(store.deleteEventLootSystem("e1")).toBe(false);
        expect(store.getEventLootSystem("e1")).toBeNull();
    });

    it("resolves a raid from config, override and softres list", () => {
        getConfig.mockReturnValue({ categoryLootTool: { c1: "rclc" } });
        expect(store.lootSystemOf("e1", "c1")).toMatchObject({ system: "lootcouncil", softres: false });
        store.setEventLootSystem("e1", { softres: true });
        expect(store.lootSystemOf("e1", "c1")).toMatchObject({ system: "lootcouncil", softresExtra: true, softres: true });
        store.setEventLootSystem("e1", {});
        getEventSoftres.mockReturnValue({ url: "https://softres.it/raid/x" });
        expect(store.lootSystemOf("e1", "c1").softres).toBe(true);
    });
});
