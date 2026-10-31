// #809: the names the guild bank knows without a raider profile — earlier
// hand-outs of the bank, the logs and the loot of the bank's version — for the
// link dialog. Real request and profile stores on temp files; the report and
// class-cache stores are factory mocks.
jest.mock("../../../src/stores/loot/reportStore", () => ({ listReports: jest.fn(() => []), getReportRoster: jest.fn(() => null) }));
jest.mock("../../../src/stores/roster/characterStore", () => ({ listCharacters: jest.fn(() => []) }));

const store = require("../../../src/stores/loot/guildBankStore");
const profiles = require("../../../src/stores/roster/raiderProfileStore");
const reports = require("../../../src/stores/loot/reportStore");
const characterStore = require("../../../src/stores/roster/characterStore");
const { resetCache } = require("../../../src/services/characters/characterEvidence");
const linking = require("../../../src/services/guildbank/linking");
const { knownNames, nameOfKey, NAMES_MAX } = require("../../../src/services/guildbank/knownNames");
const { tempStoreFile } = require("../../helpers/tempStore");

const KEY = "tbc:thunderstrike:pulse";

/** A request of the bank handed out to `name`. */
function handedOut(name, { bankKey = KEY, realm = "Thunderstrike", at = 1 } = {}) {
    const w = store.addWaiting({ characterName: name, realm, item: "Spinel", amount: 1, bankKey, itemId: 5, addedBy: "o1" }).request;
    const open = store.promoteWaiting(w.id, 1).request;
    store.confirmRequest(open.id, { by: "o1" });
    return store.handOutRequest(open.id, { via: "mail" }, { now: at }).request;
}

beforeAll(() => {
    store.useFile(tempStoreFile("guild-bank.json"));
    profiles.useFile(tempStoreFile("profiles.json"));
});
afterAll(() => {
    store.useFile(null);
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    for (const r of store.listRequests()) store.removeRequest(r.id);
    profiles.reset();
    reports.listReports.mockReturnValue([]);
    reports.getReportRoster.mockReturnValue(null);
    characterStore.listCharacters.mockReturnValue([]);
    resetCache();
});

describe("services/guildbank/knownNames", () => {
    it("finds a name the bank handed something out to — the 'Gentle' → 'Gentletwowl' case", () => {
        handedOut("Gentletwowl");
        expect(knownNames(KEY, { query: "Gentle", gameVersion: "tbc" })).toEqual([{ name: "Gentletwowl", realm: "Thunderstrike", via: "bank" }]);
        // another bank's hand-outs are not this bank's history
        expect(knownNames("tbc:other:x", { query: "Gentle", gameVersion: "tbc" })).toEqual([]);
        expect(knownNames(KEY, { query: "", gameVersion: "tbc" })).toEqual([]);
    });

    it("adds the logs and the loot of the version, each name once with its strongest source, bank first", () => {
        handedOut("Skerra");
        reports.listReports.mockReturnValue([{ id: "r1", versionId: "tbc" }, { id: "r2", versionId: "forever" }]);
        reports.getReportRoster.mockImplementation((id) => (id === "r1" ? { roster: [{ name: "Skerra" }, { name: "Skerrina" }] } : { roster: [{ name: "Skerr Forever" }] }));
        characterStore.listCharacters.mockReturnValue([{ key: "skerrloot", character: "Skerrloot", source: "export" }]);
        resetCache();
        expect(knownNames(KEY, { query: "skerr", gameVersion: "tbc" })).toEqual([
            { name: "Skerra", realm: "Thunderstrike", via: "bank" },
            { name: "Skerrina", realm: "", via: "log" },
            { name: "Skerrloot", realm: "", via: "loot" },
        ]);
        expect(knownNames("", { query: "skerr", gameVersion: "forever" })).toEqual([{ name: "Skerr Forever", realm: "", via: "log" }]);
    });

    it("forgives a typo, leaves out profile characters (the dialog lists them with their raider) and keeps to the limit", () => {
        handedOut("Gentletwowl");
        expect(knownNames(KEY, { query: "Gentletwowk", gameVersion: "tbc" })).toEqual([expect.objectContaining({ name: "Gentletwowl" })]);
        profiles.addCharacter("u3", { name: "Gentletwowl", className: "Priest" }, { name: "Gentle" });
        expect(knownNames(KEY, { query: "Gentle", gameVersion: "tbc" })).toEqual([]);
        for (let i = 0; i < NAMES_MAX + 2; i++) handedOut(`Bulk${"abcdefghijkl"[i]}`);
        expect(knownNames(KEY, { query: "bulk", gameVersion: "tbc" })).toHaveLength(NAMES_MAX);
        expect(knownNames(KEY, { query: "bulk", gameVersion: "tbc", limit: 2 })).toHaveLength(2);
    });

    it("turns a key back into the game's spelling", () => {
        expect(nameOfKey("devi res")).toBe("Devi Res");
        expect(nameOfKey("skerra")).toBe("Skerra");
    });
});

describe("services/guildbank/linking — an earlier hand-out is evidence (#809)", () => {
    it("links a request whose name already got guild bank mail from this bank (same realm when both name one)", () => {
        const earlier = handedOut("Gentletwowl");
        const request = { id: "x", bankKey: KEY, userId: "u3", characterName: "gentletwowl", realm: "Thunderstrike" };
        expect(linking.linkState(request, { gameVersion: "tbc" })).toMatchObject({ linked: true, via: "bank" });
        expect(linking.receivedFromBank({ ...request, realm: "Elsewhere" })).toBe(false);
        expect(linking.receivedFromBank({ ...request, bankKey: "tbc:other:x" })).toBe(false);
        // the hand-out itself is no evidence for itself
        expect(linking.receivedFromBank(earlier)).toBe(false);
        expect(linking.receivedFromBank({ bankKey: KEY, characterName: "" })).toBe(false);
    });
});
