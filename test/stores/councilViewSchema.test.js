// The shape of a council view, shared by the profiles (#676) and the old
// per-category views.
const { normalizeView, VIEW_DEFAULTS, VIEW_ROLES } = require("../../src/stores/councilViewSchema");

describe("stores/councilViewSchema normalizeView", () => {
    it("cleans a view: unknown role to the default, short plain ids, at most 32", () => {
        expect(normalizeView({ role: " tank ", tiers: ["t5", "t5", "<x>", 3], contents: Array.from({ length: 40 }, (_, i) => `c${i}`), bisTier: "t6!", version: "forever" }))
            .toEqual({ role: "tank", tiers: ["t5", "3"], contents: Array.from({ length: 32 }, (_, i) => `c${i}`), bisTier: "", version: "forever" });
        expect(normalizeView({ role: "boss" }).role).toBe(VIEW_DEFAULTS.role);
        expect(normalizeView(null)).toEqual({ ...VIEW_DEFAULTS, tiers: [], contents: [] });
        expect(normalizeView({ role: "" }).role).toBe("");
        expect(VIEW_ROLES).toEqual(["caster", "healer", "tank", "melee", "ranged", ""]);
    });
});
