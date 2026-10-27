// A signup with a character not in the profile yet (#907,
// src/services/signups/signupNewCharacter.js): class -> spec -> name like the
// bot, the character lands in the profile of the raid's version.
const profiles = require("../../../src/stores/raiderProfileStore");
const { tempStoreFile } = require("../../helpers/tempStore");
const { addSignupCharacter, planSignupCharacter } = require("../../../src/services/signups/signupNewCharacter");

const ANNA = "200000000000000001";
const tbcRaid = { id: "eh-kara", versionId: "tbc" };
const foreverRaid = { id: "eh-mc", versionId: "forever" };

beforeAll(() => profiles.useFile(tempStoreFile("eh-signup-new-character.json")));
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => profiles.reset());

describe("addSignupCharacter", () => {
    it("adds the character with its spec to the profile of the raid's version, by hand", () => {
        expect(addSignupCharacter(foreverRaid, ANNA, { name: " Bertholt ", spec: "Warrior-Protection" }, { accountName: "Anna" }))
            .toEqual({ character: "Bertholt", spec: "Warrior-Protection" });
        const [char] = profiles.getProfile(ANNA).characters;
        expect(char).toMatchObject({ name: "Bertholt", className: "Warrior", versionId: "forever", source: "manual" });
        expect(char.specs.map((s) => s.key)).toEqual(["Warrior-Protection"]);
    });

    it("refuses an unknown spec and an empty name", () => {
        expect(addSignupCharacter(tbcRaid, ANNA, { name: "Neu", spec: "Nope-Spec" }).code).toBe("spec");
        expect(addSignupCharacter(tbcRaid, ANNA, { name: "  ", spec: "Mage-Arcane" }).code).toBe("character");
        expect(addSignupCharacter(tbcRaid, ANNA).code).toBe("spec");
        expect(profiles.getProfile(ANNA).characters).toHaveLength(0);
    });

    it("refuses a name the profile has with another class, takes a new spec of the same class", () => {
        addSignupCharacter(tbcRaid, ANNA, { name: "Nerathil", spec: "Mage-Arcane" });
        const other = addSignupCharacter(tbcRaid, ANNA, { name: "nerathil", spec: "Warrior-Arms" });
        expect(other.code).toBe("character");
        expect(other.error).toMatch(/Nerathil steht schon mit einer anderen Klasse/);
        expect(addSignupCharacter(tbcRaid, ANNA, { name: "Nerathil", spec: "Mage-Fire" })).toEqual({ character: "Nerathil", spec: "Mage-Fire" });
        expect(profiles.getProfile(ANNA).characters).toHaveLength(1);
    });

    it("passes on the profile's own refusal (an invalid name)", () => {
        const res = addSignupCharacter(tbcRaid, ANNA, { name: "x1!", spec: "Mage-Arcane" });
        expect(res.code).toBe("character");
        expect(res.error).toEqual(expect.any(String));
    });
});

describe("planSignupCharacter", () => {
    it("checks without saving: the profile stays, the planned profile has the character", () => {
        const plan = planSignupCharacter(tbcRaid, ANNA, { name: "Bertholt", spec: "Warrior-Protection" });
        expect(plan).toMatchObject({ character: "Bertholt", spec: "Warrior-Protection" });
        expect(plan.profile.characters.map((c) => c.name)).toEqual(["Bertholt"]);
        expect(profiles.getProfile(ANNA).characters).toEqual([]);
    });

    it("plans a new spec of a known character without touching the stored one", () => {
        addSignupCharacter(tbcRaid, ANNA, { name: "Nerathil", spec: "Mage-Arcane" });
        const plan = planSignupCharacter(tbcRaid, ANNA, { name: "nerathil", spec: "Mage-Fire" });
        expect(plan.character).toBe("Nerathil");
        expect(plan.profile.characters[0].specs.map((s) => s.key)).toEqual(["Mage-Arcane", "Mage-Fire"]);
        expect(profiles.getProfile(ANNA).characters[0].specs.map((s) => s.key)).toEqual(["Mage-Arcane"]);
    });

    it("refuses an invalid name and a full version up front", () => {
        expect(planSignupCharacter(tbcRaid, ANNA, { name: "x1!", spec: "Mage-Arcane" }).code).toBe("character");
        for (let i = 0; i < profiles.MAX_CHARACTERS; i += 1) {
            addSignupCharacter(tbcRaid, ANNA, { name: `Mage${"abcdefghijklmnop"[i]}`, spec: "Mage-Arcane" });
        }
        expect(profiles.charactersOfVersion(profiles.getProfile(ANNA), "tbc")).toHaveLength(profiles.MAX_CHARACTERS);
        expect(planSignupCharacter(tbcRaid, ANNA, { name: "Zuviel", spec: "Mage-Arcane" }).error).toMatch(/Höchstens/);
    });
});
