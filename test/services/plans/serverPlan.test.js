// "May this server use this feature?": the real store, with a test plan that unlocks nothing.
jest.mock("../../../src/config/plans", () => {
    const actual = jest.requireActual("../../../src/config/plans");
    return {
        ...actual,
        FEATURES: ["test"],
        PLANS: { ...actual.PLANS, none: { id: "none", features: [] }, some: { id: "some", features: ["test"] } },
    };
});

const { DateTime } = require("luxon");
const { TIMEZONE } = require("../../../src/config/timezone");
const store = require("../../../src/stores/settings/serverPlanStore");
const { MAX_NOTE, isExpired, serverPlan, hasFeature, serverFeatures, setServerPlan, planRows } = require("../../../src/services/plans/serverPlan");
const { tempStoreFile } = require("../../helpers/tempStore");

const at = (iso) => DateTime.fromISO(iso, { zone: TIMEZONE }).toMillis();
const NOW = at("2026-11-03T12:00");

beforeEach(() => store.useFile(tempStoreFile("server-plans.json")));
afterAll(() => store.useFile(null));

describe("serverPlan", () => {
    it("puts a server without an entry on the free plan, which allows everything", () => {
        expect(serverPlan("g1").id).toBe("free");
        expect(hasFeature("g1", "test")).toBe(true);
        expect(hasFeature("", "test")).toBe(true);
        expect(hasFeature(null, "test")).toBe(true);
    });

    it("answers from the plan of the entry", () => {
        store.setEntry("g1", { plan: "none", until: "", note: "" });
        store.setEntry("g2", { plan: "some", until: "", note: "" });
        expect(hasFeature("g1", "test")).toBe(false);
        expect(hasFeature("g2", "test")).toBe(true);
        expect(hasFeature("g2", "other")).toBe(false);
    });

    it("falls back to free on a plan that no longer exists", () => {
        store.setEntry("g1", { plan: "gone", until: "", note: "" });
        expect(serverPlan("g1").id).toBe("free");
        expect(hasFeature("g1", "test")).toBe(true);
    });

    it("does not read a plan off the object prototype", () => {
        store.setEntry("g1", { plan: "constructor", until: "", note: "" });
        expect(serverPlan("g1").id).toBe("free");
    });

    it("falls back to free once `until` has passed", () => {
        store.setEntry("g1", { plan: "none", until: "2026-11-02", note: "" });
        expect(serverPlan("g1", NOW).id).toBe("free");
        expect(hasFeature("g1", "test", NOW)).toBe(true);
    });

    it("holds the plan through the whole last day, server time", () => {
        store.setEntry("g1", { plan: "none", until: "2026-11-03", note: "" });
        expect(hasFeature("g1", "test", at("2026-11-03T23:59"))).toBe(false);
        expect(hasFeature("g1", "test", at("2026-11-04T00:00"))).toBe(true);
    });

    it("lists the features of a server for the menu", () => {
        store.setEntry("g1", { plan: "none", until: "", note: "" });
        store.setEntry("g2", { plan: "some", until: "", note: "" });
        expect(serverFeatures("g1")).toEqual([]);
        expect(serverFeatures("g2")).toEqual(["test"]);
    });
});

describe("isExpired", () => {
    it("never expires without a date, and a date nobody can read counts as passed", () => {
        expect(isExpired("", NOW)).toBe(false);
        expect(isExpired("morgen", NOW)).toBe(true);
    });
});

describe("setServerPlan", () => {
    it("saves a checked entry", () => {
        expect(setServerPlan("g1", { plan: "none", until: "2027-01-31", note: "  Test  " })).toEqual({});
        expect(store.getEntry("g1")).toEqual({ plan: "none", until: "2027-01-31", note: "Test" });
    });

    it("refuses an unknown plan, a bad date and a long note, and saves nothing", () => {
        expect(setServerPlan("g1", { plan: "gone" }).code).toBe("unknown_plan");
        expect(setServerPlan("g1", { plan: "constructor" }).code).toBe("unknown_plan");
        expect(setServerPlan("g1", { plan: "none", until: "31.01.2027" }).code).toBe("bad_until");
        expect(setServerPlan("g1", { plan: "none", note: "x".repeat(MAX_NOTE + 1) }).code).toBe("note_too_long");
        expect(setServerPlan("g1", null).code).toBe("unknown_plan");
        expect(store.getEntry("g1")).toBeNull();
    });

    it("removes an entry that says nothing beyond the default", () => {
        setServerPlan("g1", { plan: "none" });
        setServerPlan("g1", { plan: "free", until: "", note: "" });
        expect(store.getEntry("g1")).toBeNull();
    });

    it("keeps the default plan when it has a note or a date", () => {
        setServerPlan("g1", { plan: "free", note: "Partner" });
        expect(store.getEntry("g1")).toEqual({ plan: "free", until: "", note: "Partner" });
    });
});

describe("planRows", () => {
    it("lists every server, with free where nothing is saved", () => {
        store.setEntry("g2", { plan: "none", until: "2026-11-02", note: "alt" });
        expect(planRows([{ id: "g1", name: "Eins" }, { id: "g2", name: "Zwei" }], NOW)).toEqual([
            { guildId: "g1", name: "Eins", plan: "free", until: "", note: "", expired: false },
            { guildId: "g2", name: "Zwei", plan: "none", until: "2026-11-02", note: "alt", expired: true },
        ]);
    });

    it("keeps the entry of a server the bot has left visible, without a name", () => {
        store.setEntry("g9", { plan: "none", until: "", note: "" });
        expect(planRows([], NOW)).toEqual([{ guildId: "g9", name: "", plan: "none", until: "", note: "", expired: false }]);
    });

    it("shows a plan that no longer exists as free", () => {
        store.setEntry("g1", { plan: "gone", until: "", note: "" });
        expect(planRows([{ id: "g1", name: "Eins" }], NOW)[0].plan).toBe("free");
    });
});
