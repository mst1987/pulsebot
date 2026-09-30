// The Kaderplaner's rules (docs/kaderplaner.md): pure mutators over one
// server's planner state, refusals as AppErrors with their status.
const model = require("../../../src/services/kader/kaderModel");
const { AppError } = require("../../../src/web/http/apiResult");

const U1 = "111111111111111111";
const U2 = "222222222222222222";
const HAND = "444444444444444444";

const classes = new Map([
    ["Warrior", { key: "Warrior", canTank: true, canHeal: false, specs: [{ key: "Warrior-Protection" }, { key: "Warrior-Fury" }] }],
    ["Mage", { key: "Mage", canTank: false, canHeal: false, specs: [{ key: "Mage-Frost" }] }],
    ["Shaman", { key: "Shaman", canTank: false, canHeal: true, specs: [{ key: "Shaman-Restoration" }, { key: "Shaman-Enhancement" }] }],
]);
const ctx = {
    classes,
    instances: [
        { id: "forever-hyjal", name: "Hyjal", sizes: [20], defaultSize: 20 },
        { id: "forever-barrow", name: "Barrow", sizes: [10], defaultSize: 10 },
    ],
    memberIds: new Set([U1, U2]),
    poolIds: new Set([U1]),
    naturalRole: (id) => (id === U1 ? "tank" : null),
    playerInfo: (id) => ({ classKey: id === U1 ? "Warrior" : "Shaman", rate: 0.5 }),
};

/** Runs `fn` and returns the AppError it threw. */
function refusal(fn) {
    try {
        fn();
    } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        return e;
    }
    throw new Error("expected a refusal");
}

function withRoster() {
    const { planner, rosterId } = model.createRoster(model.emptyPlanner(), { instanceId: "forever-hyjal" }, ctx);
    return { planner, rosterId };
}

describe("services/kader/kaderModel", () => {
    describe("normalizePlanner", () => {
        it("repairs anything into a valid planner", () => {
            expect(model.normalizePlanner(null)).toEqual(model.emptyPlanner());
            expect(model.normalizePlanner("x")).toEqual(model.emptyPlanner());
            const out = model.normalizePlanner({
                accounts: [{ userId: HAND, displayName: "Hand" }, { nope: 1 }],
                assignments: { [U1]: { characters: [{ id: "c", name: "A B", className: "Mage", specs: [{ spec: "Mage-Frost", gear: "shiny" }] }], activeCharacterId: "gone" } },
                rosters: [{ id: "r", size: 10, members: [{ userId: U1, role: "tank" }, { userId: U1, role: "melee" }, { userId: U2, role: "boss" }], bench: [U1, HAND] }],
                setups: { r: { variants: [{ id: "v", name: "V", groups: [[U1, U1, HAND], "x"] }] } },
            });
            expect(out.accounts).toEqual([{ userId: HAND, displayName: "Hand", addedAt: "" }]);
            expect(out.assignments[U1].activeCharacterId).toBe("c");
            expect(out.assignments[U1].characters[0].specs).toEqual([{ spec: "Mage-Frost", main: false, gear: "none" }]);
            expect(out.rosters[0]).toMatchObject({ members: [{ userId: U1, role: "tank" }], bench: [HAND], targets: model.defaultTargets(10) });
            expect(out.setups.r.variants[0].groups).toEqual([[U1, null, null, null, null], [null, null, null, null, null]]);
        });

        it("gives a roster without a setup its first variant", () => {
            const out = model.normalizePlanner({ rosters: [{ id: "r", size: 20 }] });
            expect(out.setups.r.variants).toEqual([{ id: expect.any(String), name: "Variante A", groups: Array(4).fill([null, null, null, null, null]) }]);
        });
    });

    it("has role targets that add up to the size", () => {
        for (const size of [5, 10, 15, 20, 25, 30, 40]) {
            const t = model.defaultTargets(size);
            expect(t.tank + t.healer + t.melee + t.ranged).toBe(size);
        }
    });

    describe("accounts", () => {
        it("adds a member or a raw id, optionally with a first character", () => {
            let p = model.addAccount(model.emptyPlanner(), { userId: U2, displayName: " Bea ", character: { firstName: "rikka", lastName: "FELDMARK", className: "Shaman" } }, ctx);
            expect(p.accounts[0]).toMatchObject({ userId: U2, displayName: "Bea" });
            expect(p.assignments[U2].characters[0]).toMatchObject({ name: "Rikka Feldmark", className: "Shaman", specs: [] });
            p = model.addAccount(p, { userId: HAND, displayName: "Hand" }, ctx);
            expect(p.accounts.map((a) => a.userId)).toEqual([U2, HAND]);
            expect(p.assignments[HAND]).toBeUndefined();
        });

        it("refuses a bad id, a duplicate and a raider who is in the pool already", () => {
            expect(refusal(() => model.addAccount(model.emptyPlanner(), { userId: "12345", displayName: "x" }, ctx)).status).toBe(400);
            expect(refusal(() => model.addAccount(model.emptyPlanner(), { userId: U1, displayName: "x" }, ctx)).status).toBe(409);
            const p = model.addAccount(model.emptyPlanner(), { userId: HAND, displayName: "x" }, ctx);
            expect(refusal(() => model.addAccount(p, { userId: HAND, displayName: "x" }, ctx)).status).toBe(409);
            expect(refusal(() => model.addAccount(model.emptyPlanner(), { userId: HAND, displayName: "" }, ctx)).status).toBe(400);
        });

        it("removes only a hand-added account, with its places everywhere", () => {
            const start = withRoster();
            const { rosterId } = start;
            let { planner } = start;
            planner = model.addAccount(planner, { userId: HAND, displayName: "x" }, ctx);
            planner = model.placeInRoster(planner, rosterId, { userId: HAND, to: "role", role: "melee" }, ctx);
            planner = model.saveVariant(planner, rosterId, planner.setups[rosterId].variants[0].id, { groups: [[HAND]] });
            const out = model.removeAccount(planner, HAND);
            expect(out.accounts).toEqual([]);
            expect(out.rosters[0].members).toEqual([]);
            expect(out.setups[rosterId].variants[0].groups.flat().filter(Boolean)).toEqual([]);
            expect(refusal(() => model.removeAccount(planner, U1)).status).toBe(404);
        });
    });

    describe("assignments", () => {
        const char = (over = {}) => ({ id: "c1", name: "Aldric Sturmwind", className: "Warrior", specs: [{ spec: "Warrior-Fury", gear: "ready" }, { spec: "Warrior-Protection", main: true }], ...over });

        it("stores the planner's characters with exactly one main spec", () => {
            const p = model.setAssignment(model.emptyPlanner(), U1, { characters: [char({ canTank: true, canHeal: true })], activeCharacterId: "c1" }, ctx);
            const [c] = p.assignments[U1].characters;
            expect(c.specs).toEqual([{ spec: "Warrior-Fury", main: false, gear: "ready" }, { spec: "Warrior-Protection", main: true, gear: "none" }]);
            // a warrior cannot heal, whatever the switch says
            expect(c).toMatchObject({ canTank: true, canHeal: false });
            expect(p.assignments[U1].activeCharacterId).toBe("c1");
        });

        it("wants a first and a last name of 2 to 12 letters, a known class and its own specs", () => {
            expect(refusal(() => model.setAssignment(model.emptyPlanner(), U1, { characters: [char({ name: "Aldric" })] }, ctx)).message).toMatch(/Vorname und Nachname/);
            expect(refusal(() => model.setAssignment(model.emptyPlanner(), U1, { characters: [char({ name: "Aldric Sturmwindwindig" })] }, ctx)).message).toMatch(/12/);
            expect(refusal(() => model.setAssignment(model.emptyPlanner(), U1, { characters: [char({ className: "Monk" })] }, ctx)).message).toMatch(/Klasse/);
            expect(refusal(() => model.setAssignment(model.emptyPlanner(), U1, { characters: [char({ specs: [{ spec: "Mage-Frost" }] })] }, ctx)).message).toMatch(/Spec/);
            expect(refusal(() => model.setAssignment(model.emptyPlanner(), U1, { characters: [char(), char()] }, ctx)).message).toMatch(/Doppelte/);
            expect(refusal(() => model.setAssignment(model.emptyPlanner(), U2, { characters: [char()] }, ctx)).status).toBe(404);
        });

        it("resets back to the profile", () => {
            const p = model.setAssignment(model.emptyPlanner(), U1, { characters: [char()] }, ctx);
            expect(model.resetAssignment(p, U1).assignments).toEqual({});
            expect(refusal(() => model.resetAssignment(model.emptyPlanner(), U1)).status).toBe(404);
        });
    });

    describe("rosters", () => {
        it("creates a roster from an instance with its default size, name and targets", () => {
            const { planner, rosterId } = withRoster();
            expect(planner.rosters[0]).toEqual({
                id: rosterId, name: "Hyjal · 20er", instanceId: "forever-hyjal", size: 20,
                targets: { tank: 2, healer: 5, melee: 7, ranged: 6 }, members: [], bench: [],
            });
            expect(planner.setups[rosterId].variants[0].groups).toHaveLength(4);
            expect(refusal(() => model.createRoster(model.emptyPlanner(), { instanceId: "forever-hyjal", size: 25 }, ctx)).message).toMatch(/nicht als 25er/);
            expect(refusal(() => model.createRoster(model.emptyPlanner(), { instanceId: "x" }, ctx)).status).toBe(400);
        });

        it("places by the natural role, onto the bench and out again, and stops at the size", () => {
            const start = withRoster();
            const { rosterId } = start;
            let { planner } = start;
            planner = model.placeInRoster(planner, rosterId, { userId: U1, to: "role" }, ctx);
            expect(planner.rosters[0].members).toEqual([{ userId: U1, role: "tank" }]);
            planner = model.placeInRoster(planner, rosterId, { userId: U1, to: "role", role: "melee" }, ctx);
            expect(planner.rosters[0].members).toEqual([{ userId: U1, role: "melee" }]);
            planner = model.placeInRoster(planner, rosterId, { userId: U1, to: "bench" }, ctx);
            expect(planner.rosters[0]).toMatchObject({ members: [], bench: [U1] });
            planner = model.placeInRoster(planner, rosterId, { userId: U1, to: "free" }, ctx);
            expect(planner.rosters[0]).toMatchObject({ members: [], bench: [] });
            expect(refusal(() => model.placeInRoster(planner, rosterId, { userId: U1, to: "moon" }, ctx)).status).toBe(400);
            expect(refusal(() => model.placeInRoster(planner, rosterId, { userId: U2, to: "role" }, ctx)).status).toBe(404);

            const full = model.normalizePlanner({ rosters: [{ id: "r", size: 5, members: ["a", "b", "c", "d", "e"].map((userId) => ({ userId, role: "melee" })) }] });
            expect(refusal(() => model.placeInRoster(full, "r", { userId: U1, to: "role" }, ctx)).status).toBe(409);
        });

        it("updates name, instance, size and targets; a smaller size benches the overflow", () => {
            const start = withRoster();
            const { rosterId } = start;
            let { planner } = start;
            planner = model.placeInRoster(planner, rosterId, { userId: U1, to: "role" }, ctx);
            planner = model.updateRoster(planner, rosterId, { name: "Mo-Raid", targets: { tank: 3 } }, ctx);
            expect(planner.rosters[0]).toMatchObject({ name: "Mo-Raid", targets: { tank: 3, healer: 5, melee: 7, ranged: 6 } });
            planner = model.updateRoster(planner, rosterId, { instanceId: "forever-barrow" }, ctx);
            expect(planner.rosters[0]).toMatchObject({ instanceId: "forever-barrow", size: 10, targets: model.defaultTargets(10) });
            expect(planner.setups[rosterId].variants[0].groups).toHaveLength(2);
            expect(refusal(() => model.updateRoster(planner, rosterId, { size: 12 }, ctx)).status).toBe(400);
            expect(refusal(() => model.updateRoster(planner, "nope", {}, ctx)).status).toBe(404);

            const big = model.normalizePlanner({ rosters: [{ id: "r", size: 10, members: ["a", "b", "c", "d", "e", "f", "g"].map((userId) => ({ userId, role: "melee" })) }] });
            const small = model.updateRoster(big, "r", { size: 5 }, ctx);
            expect(small.rosters[0].members).toHaveLength(5);
            expect(small.rosters[0].bench).toEqual(["f", "g"]);
        });

        it("deletes a roster with its setup", () => {
            const { planner, rosterId } = withRoster();
            const out = model.deleteRoster(planner, rosterId);
            expect(out.rosters).toEqual([]);
            expect(out.setups).toEqual({});
        });
    });

    describe("setups", () => {
        function seeded() {
            const start = withRoster();
            const { rosterId } = start;
            let { planner } = start;
            planner = model.placeInRoster(planner, rosterId, { userId: U1, to: "role" }, ctx);
            return { planner, rosterId, variantId: planner.setups[rosterId].variants[0].id };
        }

        it("keeps only roster members in the groups, each once", () => {
            const { planner, rosterId, variantId } = seeded();
            const out = model.saveVariant(planner, rosterId, variantId, { name: "Plan", groups: [[U1, U1, U2]] });
            expect(out.setups[rosterId].variants[0]).toMatchObject({ name: "Plan", groups: [[U1, null, null, null, null], ...Array(3).fill([null, null, null, null, null])] });
        });

        it("adds (empty or as a copy) up to six variants, never deletes the last", () => {
            const { planner, rosterId, variantId } = seeded();
            let p = model.saveVariant(planner, rosterId, variantId, { groups: [[U1]] });
            const copy = model.addVariant(p, rosterId, { copyFrom: variantId, name: "Kopie" });
            expect(copy.planner.setups[rosterId].variants[1]).toMatchObject({ id: copy.variantId, name: "Kopie", groups: p.setups[rosterId].variants[0].groups });
            p = copy.planner;
            for (let i = 0; i < 4; i++) p = model.addVariant(p, rosterId).planner;
            expect(p.setups[rosterId].variants.map((v) => v.name)).toEqual(["Variante A", "Kopie", "Variante C", "Variante D", "Variante E", "Variante F"]);
            expect(refusal(() => model.addVariant(p, rosterId)).status).toBe(409);
            expect(refusal(() => model.deleteVariant(planner, rosterId, variantId)).status).toBe(409);
            expect(model.deleteVariant(p, rosterId, copy.variantId).setups[rosterId].variants).toHaveLength(5);
            expect(refusal(() => model.addVariant(planner, rosterId, { copyFrom: "gone" })).status).toBe(404);
        });

        it("spreads the roster automatically", () => {
            const { planner, rosterId, variantId } = seeded();
            const out = model.autoAssignVariant(planner, rosterId, variantId, ctx);
            expect(out.setups[rosterId].variants[0].groups[0][0]).toBe(U1);
            expect(refusal(() => model.autoAssignVariant(planner, rosterId, "gone", ctx)).status).toBe(404);
        });
    });
});
