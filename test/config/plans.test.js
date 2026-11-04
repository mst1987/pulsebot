// The plans and the features (src/config/plans.js), and the guard that holds routes and
// menu to the feature list: a feature missing there would hide its entry on every plan.
const { ALL_FEATURES, FEATURES, DEFAULT_PLAN, PLANS, planAllows, planFeatureList } = require("../../src/config/plans");
const { ROUTES } = require("../../src/web/http/routeTable");
const MENU = require("../../src/config/menu.json");

/** Every `feature` value anywhere in a JSON tree. */
function featuresIn(node) {
    if (!node || typeof node !== "object") return [];
    const own = typeof node.feature === "string" ? [node.feature] : [];
    return [...own, ...Object.values(node).flatMap(featuresIn)];
}

describe("config/plans", () => {
    it("has the default plan, and it unlocks everything today", () => {
        expect(PLANS[DEFAULT_PLAN].features).toBe(ALL_FEATURES);
        expect(planAllows(PLANS[DEFAULT_PLAN], "anything")).toBe(true);
    });

    it("names each plan under its own id", () => {
        for (const [id, plan] of Object.entries(PLANS)) expect(plan.id).toBe(id);
    });

    it("allows only the listed features on a plan that lists them", () => {
        const plan = { id: "t", features: ["a"] };
        expect(planAllows(plan, "a")).toBe(true);
        expect(planAllows(plan, "b")).toBe(false);
    });

    it("spells a plan's features out as a list the caller may keep", () => {
        expect(planFeatureList({ id: "t", features: ["a"] })).toEqual(["a"]);
        expect(planFeatureList(PLANS[DEFAULT_PLAN])).toEqual([...FEATURES]);
        expect(planFeatureList(PLANS[DEFAULT_PLAN])).not.toBe(FEATURES);
    });

    it("only knows features the routes and the menu may ask for", () => {
        const asked = [...ROUTES.map((r) => r.feature).filter(Boolean), ...featuresIn(MENU)];
        expect(asked.filter((feature) => !FEATURES.includes(feature))).toEqual([]);
    });

    it("has no real route and no menu entry behind a plan yet (#1080)", () => {
        expect(ROUTES.filter((r) => r.feature).map((r) => r.path)).toEqual([]);
        expect(featuresIn(MENU)).toEqual([]);
    });
});
