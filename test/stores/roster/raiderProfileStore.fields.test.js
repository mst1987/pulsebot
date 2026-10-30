// "Mein Profil", part 2: what the store keeps of the new fields - the hours per
// weekday, the professions and the wish items of a character - and what it
// refuses (raiderProfileStore normalizeProfile / saveProfile).
const gameVersions = require("../../../src/config/gameVersions");
const profiles = require("../../../src/stores/roster/raiderProfileStore");
const { tempStoreFile } = require("../../helpers/tempStore");

const ME = "100000000000000001";
const PROFESSIONS = {
    professions: [{ id: "alpha", label: "Alpha", labelEn: "Alpha", icon: "" }, { id: "beta", label: "Beta", labelEn: "Beta", icon: "" }, { id: "gamma", label: "Gamma", labelEn: "Gamma", icon: "" }],
    skillMax: 300,
};

beforeAll(() => profiles.useFile(tempStoreFile("pf-fields.json")));
afterAll(() => profiles.useFile(null));
beforeEach(() => {
    profiles.reset();
    jest.restoreAllMocks();
    profiles.addCharacter(ME, { name: "Borka", className: "Druid", source: "log", versionId: "tbc" });
});

describe("availabilityFrom - ab HH:MM per chosen weekday", () => {
    it("keeps quarter hours of chosen days only and drops anything else", () => {
        const p = profiles.normalizeProfile({
            availability: ["mi", "do"],
            availabilityFrom: { mi: "19:30", do: "19:10", fr: "20:00", so: "x" },
        }, ME);
        expect(p.availabilityFrom).toEqual({ mi: "19:30" });
        expect(profiles.normalizeTime("7:45")).toBe("07:45");
        expect(profiles.normalizeTime("24:00")).toBe("");
        expect(profiles.normalizeTime("23:45")).toBe("23:45");
    });

    it("is saved with the profile and forgotten when the day is taken out", () => {
        profiles.saveProfile(ME, { availability: ["mo"], availabilityFrom: { mo: "18:15" } });
        expect(profiles.getProfile(ME).availabilityFrom).toEqual({ mo: "18:15" });
        profiles.saveProfile(ME, { availability: [] });
        expect(profiles.getProfile(ME).availabilityFrom).toEqual({});
    });
});

describe("professions - at most two of the version's list", () => {
    it("keeps none where the rule set has no list (Forever), and only the version's own (no Jewelcrafting in Classic)", () => {
        expect(profiles.normalizeProfessions([{ id: "alchemy", skill: 300 }], "forever")).toEqual([]);
        expect(profiles.normalizeProfessions([{ id: "jewelcrafting", skill: 300 }, { id: "alchemy", skill: 400 }], "classic")).toEqual([{ id: "alchemy", skill: 300 }]);
    });

    it("keeps known ones, two at most, each once, the skill within 0..skillMax", () => {
        jest.spyOn(gameVersions, "professionsOf").mockReturnValue(PROFESSIONS);
        expect(profiles.normalizeProfessions([
            { id: "beta", skill: 999 }, { id: "beta", skill: 1 }, { id: "unknown", skill: 5 }, { id: "alpha", skill: -4 }, { id: "gamma", skill: 10 },
        ], "tbc")).toEqual([{ id: "beta", skill: 300 }, { id: "alpha", skill: 0 }]);
        expect(profiles.normalizeProfessions([{ id: "gamma" }], "tbc")).toEqual([{ id: "gamma", skill: null }]);
    });

    it("keeps no skill where the rule set names no highest one", () => {
        jest.spyOn(gameVersions, "professionsOf").mockReturnValue({ ...PROFESSIONS, skillMax: null });
        expect(profiles.normalizeProfessions([{ id: "alpha", skill: 120 }], "forever")).toEqual([{ id: "alpha", skill: null }]);
    });

    it("is saved per character through saveProfile", () => {
        jest.spyOn(gameVersions, "professionsOf").mockReturnValue(PROFESSIONS);
        profiles.saveProfile(ME, { characters: [{ key: "borka", professions: [{ id: "alpha", skill: 150 }] }] });
        expect(profiles.getProfile(ME).characters[0].professions).toEqual([{ id: "alpha", skill: 150 }]);
    });
});

describe("wishItems - at most ten items per character", () => {
    const item = (itemId, over = {}) => ({ itemId, name: `Item ${itemId}`, icon: "inv_helmet_01", quality: 4, ...over });

    it("keeps ten valid items, each once, and cleans the rest", () => {
        const list = [item(1), item(1), item(0), item("x"), ...Array.from({ length: 12 }, (_, i) => item(i + 2))];
        const kept = profiles.normalizeWishItems(list);
        expect(kept).toHaveLength(10);
        expect(kept.map((w) => w.itemId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect(profiles.normalizeWishItems([item(5, { icon: "<script>", quality: 99 })])).toEqual([{ itemId: 5, name: "Item 5", icon: "", quality: null }]);
    });

    it("is saved per character, other characters untouched", () => {
        profiles.addCharacter(ME, { name: "Frosti", className: "Mage", source: "log", versionId: "tbc" });
        profiles.saveProfile(ME, { characters: [{ key: "borka", wishItems: [item(30236)] }] });
        const [borka, frosti] = profiles.getProfile(ME).characters;
        expect(borka.wishItems).toEqual([item(30236)]);
        expect(frosti.wishItems).toEqual([]);
    });
});
