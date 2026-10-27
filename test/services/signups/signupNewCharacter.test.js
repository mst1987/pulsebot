// A signup with a character not in the profile yet (#907,
// src/services/signups/signupNewCharacter.js): class -> spec -> name like the
// bot, the character lands in the profile of the raid's version.
const profiles = require("../../../src/stores/raiderProfileStore");
const { tempStoreFile } = require("../../helpers/tempStore");
const { addSignupCharacter } = require("../../../src/services/signups/signupNewCharacter");

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
