// Linked characters of guild bank requests: a request is linked when its
// raider's profile has its character (and realm, when both name one) and that
// character is confirmed (log, loot, armory, orga — characterEvidence) —
// checked now, so a character deleted from the profile unlinks it again. Plus
// the link dialog's character search, the import's suggestions and the pick
// it resolves. Real profile store on a temp file; the report and character
// stores are factory mocks (what the logs and the loot saw).
jest.mock("../../../src/stores/reportStore", () => ({
    listReports: jest.fn(() => []),
    getReportRoster: jest.fn(() => null),
}));
jest.mock("../../../src/stores/characterStore", () => ({ listCharacters: jest.fn(() => []) }));

const profiles = require("../../../src/stores/raiderProfileStore");
const stockStore = require("../../../src/stores/guildBankStockStore");
const characterStore = require("../../../src/stores/characterStore");
const { resetCache } = require("../../../src/services/characters/characterEvidence");
const linking = require("../../../src/services/guildbank/linking");
const { tempStoreFile } = require("../../helpers/tempStore");

beforeAll(() => profiles.useFile(tempStoreFile("profiles.json")));
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    resetCache();
    characterStore.listCharacters.mockReturnValue([]);
    profiles.reset();
    profiles.addCharacter("u1", { name: "Alîna", className: "Priest", realm: "Spineshatter", specs: [{ key: "Priest-Holy", gear: "ready" }], source: "log" }, { name: "Anna" });
    profiles.addCharacter("u1", { name: "Zibbowar", className: "Warrior", source: "log" });
    profiles.addCharacter("u1", { name: "Devi Res", className: "Mage", specs: [{ key: "Mage-Frost", gear: "ready" }], source: "log" }, { versionId: "forever" });
    profiles.addCharacter("u2", { name: "Zibbo", className: "Rogue", realm: "Thunderstrike", source: "log" }, { name: "Bert" });
});

/** The raider "Gentle": a typed "Gentle" nobody confirmed, the real "Gentleowl" and "Gentletwowl" from the logs. */
function addGentle() {
    profiles.addCharacter("u3", { name: "Gentle", className: "Druid" }, { name: "Gentle" });
    profiles.addCharacter("u3", { name: "Gentleowl", className: "Druid", source: "log" });
    profiles.addCharacter("u3", { name: "Gentletwowl", className: "Priest", source: "log" });
}

describe("services/guildbank/linking — linkedCharacter / isLinked", () => {
    it("finds the raider's own character by name, without case and accents", () => {
        expect(linking.linkedCharacter({ userId: "u1", characterName: "alina" })).toMatchObject({ name: "Alîna", className: "Priest" });
        expect(linking.isLinked({ userId: "u1", characterName: "ALINA", realm: "Spineshatter" })).toBe(true);
        expect(linking.isLinked({ userId: "u1", characterName: "Devi Res" })).toBe(true);
    });

    it("compares the realm only when both name one, without spaces and dashes", () => {
        expect(linking.isLinked({ userId: "u1", characterName: "Alina", realm: "Spine shatter" })).toBe(true);
        expect(linking.isLinked({ userId: "u1", characterName: "Alina", realm: "Thunderstrike" })).toBe(false);
        // the character has no realm of its own: the request's (the bank's) is fine
        expect(linking.isLinked({ userId: "u1", characterName: "Zibbowar", realm: "Anywhere" })).toBe(true);
    });

    it("is not linked without a raider, without a name, with another raider's character or a character gone", () => {
        expect(linking.isLinked({ userId: "", characterName: "Alina" })).toBe(false);
        expect(linking.isLinked({ userId: "u1", characterName: "" })).toBe(false);
        expect(linking.isLinked({ userId: "u1", characterName: "Zibbo" })).toBe(false);
        expect(linking.isLinked({ userId: "u9", characterName: "Alina" })).toBe(false);
        expect(linking.isLinked(null)).toBe(false);
        expect(linking.isLinked({ userId: "u2", characterName: "Zibbo" })).toBe(true);
        profiles.removeCharacter("u2", "zibbo");
        expect(linking.isLinked({ userId: "u2", characterName: "Zibbo" })).toBe(false);
    });

    it("takes a profile the caller has already and survives a broken store", () => {
        expect(linking.linkedCharacter({ userId: "u1", characterName: "X" }, { profile: { characters: [{ name: "X" }] } })).toEqual({ name: "X" });
        expect(linking.linkedCharacter({ userId: "u1", characterName: "X" }, { profile: null })).toBeNull();
        const spy = jest.spyOn(profiles, "getProfile").mockImplementation(() => { throw new Error("broken"); });
        expect(linking.isLinked({ userId: "u1", characterName: "Alina" })).toBe(false);
        spy.mockRestore();
    });

    it("adds `linked` and `linkProblem` to a request", () => {
        expect(linking.withLinked({ id: "a", userId: "u1", characterName: "Alina" })).toEqual({ id: "a", userId: "u1", characterName: "Alina", linked: true, linkProblem: "" });
        expect(linking.withLinked({ id: "b", userId: "", characterName: "Whapap" })).toMatchObject({ linked: false, linkProblem: "none" });
    });
});

describe("services/guildbank/linking — confirmed characters only", () => {
    it("does not link a profile character the raider only typed: linkProblem unverified", () => {
        addGentle();
        const state = linking.linkState({ userId: "u3", characterName: "Gentle" });
        expect(state).toMatchObject({ linked: false, linkProblem: "unverified", via: "" });
        expect(state.character).toMatchObject({ name: "Gentle" });
        expect(linking.isLinked({ userId: "u3", characterName: "Gentle" })).toBe(false);
        expect(linking.linkState({ userId: "u3", characterName: "Gentleowl" })).toMatchObject({ linked: true, linkProblem: "", via: "log" });
    });

    it("links the same character once the orga checked it in game or the armory answered", () => {
        addGentle();
        profiles.verifyCharacter("u3", "gentle", { by: "9", byName: "Orga" });
        expect(linking.linkState({ userId: "u3", characterName: "Gentle" })).toMatchObject({ linked: true, via: "orga" });
        profiles.addCharacter("u4", { name: "Armo", className: "Mage" }, { name: "Armo" });
        expect(linking.isLinked({ userId: "u4", characterName: "Armo" })).toBe(false);
        profiles.setCharacterArmory("u4", "armo", { level: 70, guild: "Gilde" });
        expect(linking.linkState({ userId: "u4", characterName: "Armo" })).toMatchObject({ linked: true, via: "armory" });
    });

    it("takes the loot export and the logs as evidence, never a manual class-cache entry", () => {
        profiles.addCharacter("u4", { name: "Lootie", className: "Mage" }, { name: "L" });
        profiles.addCharacter("u4", { name: "Handy", className: "Mage" });
        characterStore.listCharacters.mockReturnValue([
            { key: "lootie", character: "Lootie", source: "export" },
            { key: "handy", character: "Handy", source: "manual" },
        ]);
        resetCache();
        expect(linking.linkState({ userId: "u4", characterName: "Lootie" })).toMatchObject({ linked: true, via: "loot" });
        expect(linking.linkState({ userId: "u4", characterName: "Handy" })).toMatchObject({ linked: false, linkProblem: "unverified" });
    });

    it("needs evidence of the bank's version — taken from the request's bank, or as given", () => {
        // the TBC character has evidence, but a Forever bank's request finds no Forever one
        expect(linking.linkState({ userId: "u1", characterName: "Zibbowar" }, { gameVersion: "forever" })).toMatchObject({ linked: false, linkProblem: "unverified" });
        const spy = jest.spyOn(stockStore, "listBanks").mockReturnValue([{ key: "fb", gameVersion: "forever" }, { key: "tb", gameVersion: "tbc" }]);
        expect(linking.isLinked({ userId: "u1", characterName: "Zibbowar", bankKey: "fb" })).toBe(false);
        expect(linking.isLinked({ userId: "u1", characterName: "Zibbowar", bankKey: "tb" })).toBe(true);
        // an unknown bank keeps to no version
        expect(linking.isLinked({ userId: "u1", characterName: "Zibbowar", bankKey: "gone" })).toBe(true);
        spy.mockImplementation(() => { throw new Error("broken"); });
        expect(linking.isLinked({ userId: "u1", characterName: "Zibbowar", bankKey: "tb" })).toBe(true);
        spy.mockRestore();
    });

    it("of two characters of the name takes the one of the bank's version", () => {
        profiles.addCharacter("u5", { name: "Devi", className: "Mage" }, { name: "D" });
        profiles.addCharacter("u5", { name: "Devi", className: "Mage", source: "log" }, { versionId: "forever" });
        expect(linking.linkState({ userId: "u5", characterName: "Devi" }, { gameVersion: "forever" })).toMatchObject({ linked: true, via: "log" });
        expect(linking.linkState({ userId: "u5", characterName: "Devi" }, { gameVersion: "tbc" })).toMatchObject({ linked: false, linkProblem: "unverified" });
    });
});

describe("services/guildbank/linking — characterChoices / resolveChoice", () => {
    // #741: TBC bank = TBC characters, Forever bank = Forever characters
    it("lists only the bank's version's characters, with icon, class colour and evidence", () => {
        const all = linking.characterChoices({ gameVersion: "tbc" });
        expect(all.map((c) => c.characterName)).toEqual(["Alîna", "Zibbo", "Zibbowar"]);
        expect(all[0]).toEqual({
            userId: "u1", userName: "Anna", characterKey: "alîna", characterName: "Alîna", realm: "Spineshatter", className: "Priest",
            versionId: "tbc", icon: "spell_holy_guardianspirit", classColor: expect.stringMatching(/^#/), specKey: "Priest-Holy",
            verified: true, evidence: "log",
        });
        // no spec: the class icon
        expect(all.find((c) => c.characterName === "Zibbowar").icon).toBe("classicon_warrior");
        expect(linking.characterChoices({ gameVersion: "forever" }).map((c) => [c.characterName, c.versionId])).toEqual([["Devi Res", "forever"]]);
        expect(linking.characterChoices({ query: "devi", gameVersion: "tbc" })).toEqual([]);
        // a character stored without a version counts as TBC
        const legacy = { userId: "u5", name: "Old", characters: [{ key: "oldie", name: "Oldie", className: "Warrior" }] };
        expect(linking.characterChoices({ gameVersion: "tbc", list: [legacy] }).map((c) => [c.versionId, c.verified])).toEqual([["tbc", false]]);
        expect(linking.characterChoices({ gameVersion: "forever", list: [legacy] })).toEqual([]);
        // no version to keep to: every character
        expect(linking.characterChoices()).toHaveLength(4);
    });

    it("names a pick of another version than the bank's, nothing for a fitting or unknown one", () => {
        const devi = profiles.getProfile("u1").characters.find((c) => c.name === "Devi Res");
        expect(linking.versionError("u1", devi.key, "tbc")).toBe("Devi Res ist ein Forever-Charakter – diese Gildenbank ist für TBC. Bitte einen TBC-Charakter wählen.");
        expect(linking.versionError("u1", "zibbowar", "forever")).toBe("Zibbowar ist ein TBC-Charakter – diese Gildenbank ist für Forever. Bitte einen Forever-Charakter wählen.");
        expect(linking.versionError("u1", devi.key, "forever")).toBe("");
        expect(linking.versionError("u1", "zibbowar", "tbc")).toBe("");
        expect(linking.versionError("u1", "zibbowar", "")).toBe("");
        expect(linking.versionError("u1", "nobody", "tbc")).toBe("");
        expect(linking.versionError("", "", "tbc")).toBe("");
    });

    it("refuses a pick nobody has confirmed (pickError), after the version", () => {
        addGentle();
        expect(linking.pickError("u3", "gentle", "tbc")).toBe("Gentle ist nicht bestätigt – erst im Arsenal oder im Spiel prüfen, dann verknüpfen.");
        expect(linking.pickError("u3", "gentleowl", "tbc")).toBe("");
        expect(linking.pickError("u1", "zibbowar", "forever")).toMatch(/TBC-Charakter/);
        expect(linking.pickError("u3", "nobody", "tbc")).toBe("");
    });

    it("searches character and raider names without case and accents, the exact hit first", () => {
        expect(linking.characterChoices({ query: "zibbo", gameVersion: "tbc" }).map((c) => c.characterName)).toEqual(["Zibbo", "Zibbowar"]);
        expect(linking.characterChoices({ query: "alina" }).map((c) => c.characterName)).toEqual(["Alîna"]);
        expect(linking.characterChoices({ query: "bert" }).map((c) => c.characterName)).toEqual(["Zibbo"]);
        expect(linking.characterChoices({ query: "nobody" })).toEqual([]);
        // a typo or two in the name from the sheet: the near miss comes after the real hits
        expect(linking.characterChoices({ query: "Zibbowor" }).map((c) => c.characterName)).toEqual(["Zibbowar"]);
        expect(linking.characterChoices({ query: "Alinna" }).map((c) => c.characterName)).toEqual(["Alîna"]);
        expect(linking.characterChoices({ query: "Zibo" })).toEqual([]);
        expect(linking.characterChoices({ limit: 2 })).toHaveLength(2);
    });

    it("puts the confirmed characters first: the raider of an unconfirmed exact hit, then other names it starts", () => {
        addGentle();
        profiles.addCharacter("u6", { name: "Gentlebreeze", className: "Mage", source: "log" }, { name: "Breeze" });
        profiles.addCharacter("u6", { name: "Owlbert", className: "Mage", source: "log" });
        const hits = linking.characterChoices({ query: "Gentle", gameVersion: "tbc" });
        expect(hits.map((c) => [c.characterName, c.verified])).toEqual([
            ["Gentleowl", true], ["Gentletwowl", true], ["Gentlebreeze", true], ["Gentle", false],
        ]);
        expect(hits[3].evidence).toBe("");
        // the raider's other characters come along even without the name
        profiles.addCharacter("u3", { name: "Moonbark", className: "Druid", source: "log" });
        expect(linking.characterChoices({ query: "Gentle", gameVersion: "tbc" }).map((c) => c.characterName)).toContain("Moonbark");
    });

    it("suggests the confirmed characters a name may mean, never the unconfirmed ones", () => {
        addGentle();
        profiles.addCharacter("u6", { name: "Gentlebreeze", className: "Mage", source: "log" }, { name: "Breeze" });
        profiles.addCharacter("u6", { name: "Gentlestorm", className: "Mage" });
        profiles.addCharacter("u3", { name: "Moonbark", className: "Druid", source: "log" });
        expect(linking.suggestedCharacters("gentle", { gameVersion: "tbc" }).map((c) => c.characterName))
            .toEqual(["Gentleowl", "Gentletwowl", "Moonbark", "Gentlebreeze"]);
        expect(linking.suggestedCharacters("Gentle", { gameVersion: "tbc" })[0]).toEqual({
            userId: "u3", userName: "Gentle", characterKey: "gentleowl", characterName: "Gentleowl", realm: "", className: "Druid",
        });
        expect(linking.suggestedCharacters("Gentle", { gameVersion: "forever" })).toEqual([]);
        expect(linking.suggestedCharacters("", { gameVersion: "tbc" })).toEqual([]);
        expect(linking.suggestedCharacters("Gentle", { gameVersion: "tbc", max: 1 })).toHaveLength(1);
    });

    it("resolves a pick to the recipient fields, null for a character the profile does not have", () => {
        expect(linking.resolveChoice("u1", "alîna")).toEqual({ userId: "u1", userName: "Anna", characterName: "Alîna", realm: "Spineshatter" });
        expect(linking.resolveChoice("u1", "zibbowar")).toEqual({ userId: "u1", userName: "Anna", characterName: "Zibbowar", realm: "" });
        expect(linking.resolveChoice("u1", "zibbo")).toBeNull();
        expect(linking.resolveChoice("", "zibbo")).toBeNull();
        expect(linking.resolveChoice("u2", "")).toBeNull();
    });

    it("shows one pick as the dialog does (choiceFor)", () => {
        addGentle();
        expect(linking.choiceFor("u3", "gentle", "tbc")).toMatchObject({ characterName: "Gentle", verified: false, evidence: "" });
        expect(linking.choiceFor("u3", "gentleowl", "tbc")).toMatchObject({ characterName: "Gentleowl", verified: true, evidence: "log" });
        expect(linking.choiceFor("u3", "nobody", "tbc")).toBeNull();
    });

    it("folds names and realms", () => {
        expect(linking.foldName("  Alîna  Ölund ")).toBe("alina olund");
        expect(linking.foldRealm("Spine-shatter's Edge")).toBe("spineshattersedge");
    });
});
