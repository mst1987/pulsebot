// The example setups of a Kader (docs/kaderplaner.md): 10er/20er without losing
// anybody, specs from the wishes, only players who may stand in a setup, and
// "Automatisch verteilen" — never a change of state.
const model = require("../../../src/services/kader/kaderModel");
const players = require("../../../src/services/kader/kaderPlayers");
const setups = require("../../../src/services/kader/kaderSetups");
const { U, kaderCtx, refusal } = require("../../helpers/kaderFixtures");

const WISH = {
    [U.a]: { className: "Warrior", spec: "Warrior-Protection" },
    [U.b]: { className: "Priest", spec: "Priest-Holy" },
    [U.c]: { className: "Mage", spec: "Mage-Frost" },
    [U.d]: { className: "Shaman", spec: "Shaman-Enhancement" },
};
const ctx = kaderCtx({ prefillOf: (id) => WISH[id] || null });

/** A Kader: a in the roster, b and c provisional, d on the bench. */
function setup() {
    const { planner, kaderId } = model.createKader(model.emptyPlanner(), { name: "K" }, ctx);
    let p = players.addPlayers(planner, { kaderId, players: [U.a, U.b, U.c, U.d].map((userId) => ({ userId })) }, ctx).planner;
    const to = (ids, state) => { p = players.setState(p, { kaderId, userIds: ids, to: state }, ctx).planner; };
    to([U.a, U.b, U.c, U.d], "selected");
    to([U.a, U.b, U.c, U.d], "provisional");
    to([U.a], "roster");
    to([U.d], "bench");
    // a has a second wish
    p = players.saveInterview(p, { kaderId, userId: U.a, wishes: [WISH[U.a], { className: "Warrior", spec: "Warrior-Fury" }] }, ctx);
    return { planner: model.normalizePlanner(p), kaderId, variantId: p.kaders[0].setups[0].id };
}
const variant = (p, i = 0) => p.kaders[0].setups[i];

describe("services/kader/kaderSetups", () => {
    it("saves groups with a spec from each player's wishes; anything else falls back to the default one", () => {
        const { planner, kaderId, variantId } = setup();
        const p = setups.saveVariant(planner, { kaderId, variantId, groups: [[
            { userId: U.a, spec: "Warrior-Fury" },
            { userId: U.b, spec: "Mage-Fire" },
            { userId: "nobody", spec: "x" },
        ]] });
        expect(variant(p).groups[0]).toEqual([{ userId: U.a, spec: "Warrior-Fury" }, { userId: U.b, spec: "Priest-Holy" }, null, null, null]);
        expect(variant(p).groups).toHaveLength(4);
    });

    it("switches between 10er and 20er without throwing anybody out", () => {
        const { planner, kaderId, variantId } = setup();
        let p = setups.saveVariant(planner, { kaderId, variantId, groups: [[{ userId: U.a, spec: "" }], [], [{ userId: U.c, spec: "" }]] });
        p = setups.saveVariant(p, { kaderId, variantId, size: 10 });
        expect(variant(p).size).toBe(10);
        expect(variant(p).groups[2][0]).toEqual({ userId: U.c, spec: "Mage-Frost" });
        p = setups.saveVariant(p, { kaderId, variantId, size: 20 });
        expect(variant(p).groups[2][0].userId).toBe(U.c);
        expect(refusal(() => setups.saveVariant(p, { kaderId, variantId, size: 25 })).status).toBe(400);
    });

    it("never changes a state, and drops players whose state leaves the setup", () => {
        const { planner, kaderId, variantId } = setup();
        let p = setups.saveVariant(planner, { kaderId, variantId, groups: [[{ userId: U.a }, { userId: U.b }]] });
        expect(p.kaders[0].players[U.b].state).toBe("provisional");
        p = players.setState(p, { kaderId, userIds: [U.b], to: "selected" }, ctx).planner;
        expect(variant(model.normalizePlanner(p)).groups[0].slice(0, 2)).toEqual([{ userId: U.a, spec: "Warrior-Protection" }, null]);
    });

    it("adds (empty or as a copy) up to six variants and never deletes the last", () => {
        const { planner, kaderId, variantId } = setup();
        let p = setups.saveVariant(planner, { kaderId, variantId, size: 10, groups: [[{ userId: U.a }]] });
        const copy = setups.addVariant(p, { kaderId, copyFrom: variantId, name: "Kopie" });
        expect(variant(copy.planner, 1)).toMatchObject({ id: copy.variantId, name: "Kopie", size: 10 });
        expect(variant(copy.planner, 1).groups[0][0].userId).toBe(U.a);
        p = copy.planner;
        for (let i = 0; i < 4; i++) p = setups.addVariant(p, { kaderId }).planner;
        expect(p.kaders[0].setups.map((v) => v.name)).toEqual(["Variante A", "Kopie", "Variante C", "Variante D", "Variante E", "Variante F"]);
        expect(refusal(() => setups.addVariant(p, { kaderId })).status).toBe(409);
        expect(refusal(() => setups.deleteVariant(planner, { kaderId, variantId })).status).toBe(409);
        expect(setups.deleteVariant(p, { kaderId, variantId: copy.variantId }).kaders[0].setups).toHaveLength(5);
        expect(refusal(() => setups.addVariant(planner, { kaderId, copyFrom: "gone" })).status).toBe(404);
    });

    it("spreads roster and Vorläufig over the groups the size shows, bench only when asked for", () => {
        const { planner, kaderId, variantId } = setup();
        let p = setups.autoVariant(planner, { kaderId, variantId }, ctx);
        const placed = () => variant(p).groups.flat().filter(Boolean);
        expect(placed().map((s) => s.userId).sort()).toEqual([U.a, U.b, U.c].sort());
        expect(placed().find((s) => s.userId === U.a).spec).toBe("Warrior-Protection");
        p = setups.saveVariant(p, { kaderId, variantId, size: 10 });
        p = setups.autoVariant(p, { kaderId, variantId, sources: ["roster", "provisional", "bench"] }, ctx);
        expect(variant(p).groups.slice(2).flat().filter(Boolean)).toEqual([]);
        expect(placed().map((s) => s.userId).sort()).toEqual([U.a, U.b, U.c, U.d].sort());
        expect(p.kaders[0].players[U.d].state).toBe("bench");
        expect(refusal(() => setups.autoVariant(p, { kaderId, variantId, sources: ["pool"] }, ctx)).status).toBe(400);
    });

    it("asks for attendance over the Kader's own raid categories", () => {
        const { planner, kaderId, variantId } = setup();
        planner.kaders[0].attendanceCategories = ["c-mo", "c-do"];
        const asked = [];
        setups.autoVariant(planner, { kaderId, variantId }, { ...ctx, rateOf: (userId, categoryIds) => { asked.push([userId, categoryIds]); return 0.5; } });
        expect(asked.length).toBeGreaterThan(0);
        for (const [, ids] of asked) expect(ids).toEqual(["c-mo", "c-do"]);
    });

    it("knows the specs a player can stand for", () => {
        const { planner } = setup();
        const a = planner.kaders[0].players[U.a];
        expect(setups.specsOf(a)).toEqual(["Warrior-Protection", "Warrior-Fury"]);
        expect(setups.defaultSpec(a)).toBe("Warrior-Protection");
    });
});
