// Linked characters of guild bank requests: a request is linked when its
// raider's profile has its character (and realm, when both name one) — checked
// now, so a character deleted from the profile unlinks it again. Plus the link
// dialog's character search and the pick it resolves. Real profile store on a
// temp file.
const profiles = require("../../../src/stores/raiderProfileStore");
const linking = require("../../../src/services/guildbank/linking");
const { tempStoreFile } = require("../../helpers/tempStore");

beforeAll(() => profiles.useFile(tempStoreFile("profiles.json")));
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    profiles.addCharacter("u1", { name: "Alîna", className: "Priest", realm: "Spineshatter", specs: [{ key: "Priest-Holy", gear: "ready" }] }, { name: "Anna" });
    profiles.addCharacter("u1", { name: "Zibbowar", className: "Warrior" });
    profiles.addCharacter("u1", { name: "Devi Res", className: "Mage", specs: [{ key: "Mage-Frost", gear: "ready" }] }, { versionId: "forever" });
    profiles.addCharacter("u2", { name: "Zibbo", className: "Rogue", realm: "Thunderstrike" }, { name: "Bert" });
});

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

    it("adds `linked` to a request", () => {
        expect(linking.withLinked({ id: "a", userId: "u1", characterName: "Alina" })).toEqual({ id: "a", userId: "u1", characterName: "Alina", linked: true });
        expect(linking.withLinked({ id: "b", userId: "", characterName: "Whapap" }).linked).toBe(false);
    });
});

describe("services/guildbank/linking — characterChoices / resolveChoice", () => {
    it("lists every profile character, the exact name first, then the bank's version, with icon and class colour", () => {
        const all = linking.characterChoices({ gameVersion: "tbc" });
        expect(all.map((c) => c.characterName)).toEqual(["Alîna", "Zibbo", "Zibbowar", "Devi Res"]);
        expect(all[0]).toEqual({
            userId: "u1", userName: "Anna", characterKey: "alîna", characterName: "Alîna", realm: "Spineshatter", className: "Priest",
            versionId: "tbc", ownVersion: true, icon: "spell_holy_guardianspirit", classColor: expect.stringMatching(/^#/), specKey: "Priest-Holy",
        });
        // no spec: the class icon
        expect(all.find((c) => c.characterName === "Zibbowar").icon).toBe("classicon_warrior");
        expect(all.find((c) => c.characterName === "Devi Res").ownVersion).toBe(false);
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

    it("resolves a pick to the recipient fields, null for a character the profile does not have", () => {
        expect(linking.resolveChoice("u1", "alîna")).toEqual({ userId: "u1", userName: "Anna", characterName: "Alîna", realm: "Spineshatter" });
        expect(linking.resolveChoice("u1", "zibbowar")).toEqual({ userId: "u1", userName: "Anna", characterName: "Zibbowar", realm: "" });
        expect(linking.resolveChoice("u1", "zibbo")).toBeNull();
        expect(linking.resolveChoice("", "zibbo")).toBeNull();
        expect(linking.resolveChoice("u2", "")).toBeNull();
    });

    it("folds names and realms", () => {
        expect(linking.foldName("  Alîna  Ölund ")).toBe("alina olund");
        expect(linking.foldRealm("Spine-shatter's Edge")).toBe("spineshattersedge");
    });
});
