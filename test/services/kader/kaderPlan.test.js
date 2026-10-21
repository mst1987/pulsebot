// The composition draft of a Kader ("Planspiel", docs/kaderplaner.md): one
// shared draft, a player per change, specs only from decision and wishes,
// left-out players, "Verwerfen" and "Als Entscheidung übernehmen" — which sets
// decisions and never a state.
const model = require("../../../src/services/kader/kaderModel");
const players = require("../../../src/services/kader/kaderPlayers");
const plan = require("../../../src/services/kader/kaderPlan");
const { U, kaderCtx, refusal } = require("../../helpers/kaderFixtures");

const WISH = {
    [U.a]: { className: "Warrior", spec: "Warrior-Protection" },
    [U.b]: { className: "Priest", spec: "Priest-Holy" },
    [U.c]: { className: "Mage", spec: "Mage-Frost" },
    [U.d]: { className: "Shaman", spec: "Shaman-Enhancement" },
};
const ctx = kaderCtx({ prefillOf: (id) => WISH[id] || null });
const later = kaderCtx({ now: "2026-10-02T19:00:00.000Z", actor: U.lead2 });

/** a in the roster (decision Warrior-Protection), b and c provisional, d in the pool; a and b have a second wish. */
function setup() {
    const { planner, kaderId } = model.createKader(model.emptyPlanner(), { name: "K" }, ctx);
    let p = players.addPlayers(planner, { kaderId, players: [U.a, U.b, U.c, U.d].map((userId) => ({ userId })) }, ctx).planner;
    const to = (ids, state) => { p = players.setState(p, { kaderId, userIds: ids, to: state }, ctx).planner; };
    to([U.a, U.b, U.c], "selected");
    to([U.a, U.b, U.c], "provisional");
    to([U.a], "roster");
    p = players.saveInterview(p, { kaderId, userId: U.a, wishes: [WISH[U.a], { className: "Warrior", spec: "Warrior-Fury" }] }, ctx);
    p = players.saveInterview(p, { kaderId, userId: U.b, wishes: [WISH[U.b], { className: "Priest", spec: "Priest-Shadow" }] }, ctx);
    return { planner: model.normalizePlanner(p), kaderId };
}
const kader = (p) => model.normalizePlanner(p).kaders[0];

describe("services/kader/kaderPlan savePlan", () => {
    it("starts the draft with the first change and remembers who changed it last", () => {
        const { planner, kaderId } = setup();
        expect(kader(planner).plan).toBeNull();
        let p = plan.savePlan(planner, { kaderId, userId: U.b, spec: { className: "Priest", spec: "Priest-Shadow" } }, ctx);
        expect(kader(p).plan).toEqual({ specs: { [U.b]: { className: "Priest", spec: "Priest-Shadow" } }, excluded: [], by: U.lead, at: ctx.now });
        p = plan.savePlan(p, { kaderId, userId: U.c, excluded: true }, later);
        expect(kader(p).plan).toMatchObject({ excluded: [U.c], by: U.lead2, at: later.now });
        expect(kader(p).plan.specs[U.b].spec).toBe("Priest-Shadow");
    });

    it("takes a planned spec back and a player in again — a draft left empty is gone, marked as emptied", () => {
        const { planner, kaderId } = setup();
        let p = plan.savePlan(planner, { kaderId, userId: U.a, spec: { className: "Warrior", spec: "Warrior-Fury" }, excluded: true }, ctx);
        p = plan.savePlan(p, { kaderId, userId: U.a, excluded: false }, later);
        expect(kader(p).plan).toMatchObject({ specs: { [U.a]: { spec: "Warrior-Fury" } }, excluded: [] });
        const step = kaderCtx({ now: "2026-10-02T19:05:00.000Z", actor: U.lead2 });
        p = plan.savePlan(p, { kaderId, userId: U.a, spec: null }, step);
        expect(kader(p).plan).toBeNull();
        expect(step.planEmptied).toBe(kaderId);
    });

    it("does nothing without a draft when the change leaves it empty", () => {
        const { planner, kaderId } = setup();
        const fresh = kaderCtx();
        expect(plan.savePlan(planner, { kaderId, userId: U.c, excluded: false }, fresh)).toEqual(planner);
        expect(plan.savePlan(planner, { kaderId, userId: U.a, spec: null }, fresh)).toEqual(planner);
        expect(fresh.planEmptied).toBeUndefined();
    });

    it("leaves the planner as it was for a change that changes nothing", () => {
        const { planner, kaderId } = setup();
        const p = plan.savePlan(planner, { kaderId, userId: U.c, excluded: true }, ctx);
        const again = plan.savePlan(p, { kaderId, userId: U.c, excluded: true }, later);
        expect(kader(again).plan.at).toBe(ctx.now);
    });

    it("never touches a state, a decision or the wishes", () => {
        const { planner, kaderId } = setup();
        const p = plan.savePlan(planner, { kaderId, userId: U.a, spec: { className: "Warrior", spec: "Warrior-Fury" } }, ctx);
        const a = kader(p).players[U.a];
        expect(a.state).toBe("roster");
        expect(a.decision).toEqual(WISH[U.a]);
        expect(a.wishes).toHaveLength(2);
    });

    it("refuses specs that are none of the player's decision and wishes, players outside the composition and empty changes", () => {
        const { planner, kaderId } = setup();
        expect(refusal(() => plan.savePlan(planner, { kaderId, userId: U.c, spec: { className: "Mage", spec: "Mage-Fire" } }, ctx)).status).toBe(400);
        expect(refusal(() => plan.savePlan(planner, { kaderId, userId: U.c, spec: { className: "Mage", spec: "Nope" } }, ctx)).status).toBe(400);
        expect(refusal(() => plan.savePlan(planner, { kaderId, userId: U.d, excluded: true }, ctx)).status).toBe(400);
        expect(refusal(() => plan.savePlan(planner, { kaderId, userId: "999", excluded: true }, ctx)).status).toBe(404);
        expect(refusal(() => plan.savePlan(planner, { kaderId, userId: U.c }, ctx)).status).toBe(400);
        expect(refusal(() => plan.savePlan(planner, { kaderId, excluded: true }, ctx)).status).toBe(400);
        expect(refusal(() => plan.savePlan(planner, { kaderId: "nope", userId: U.c, excluded: true }, ctx)).status).toBe(404);
    });

    it("drops a player from the draft when they leave the composition", () => {
        const { planner, kaderId } = setup();
        let p = plan.savePlan(planner, { kaderId, userId: U.b, spec: { className: "Priest", spec: "Priest-Shadow" }, excluded: true }, ctx);
        p = players.setState(p, { kaderId, userIds: [U.b], to: "selected" }, ctx).planner;
        expect(kader(p).plan).toMatchObject({ specs: {}, excluded: [] });
    });
});

describe("services/kader/kaderPlan discardPlan", () => {
    it("throws the draft away and refuses when there is none", () => {
        const { planner, kaderId } = setup();
        const p = plan.savePlan(planner, { kaderId, userId: U.c, excluded: true }, ctx);
        expect(kader(plan.discardPlan(p, { kaderId })).plan).toBeNull();
        expect(refusal(() => plan.discardPlan(planner, { kaderId })).status).toBe(409);
    });

    it("refuses a draft that moved on since the confirmation was shown (409 stale), unless forced", () => {
        const { planner, kaderId } = setup();
        const p = model.normalizePlanner(plan.savePlan(planner, { kaderId, userId: U.c, excluded: true }, ctx));
        p.kaders[0].plan.rev = 7;
        const stale = refusal(() => plan.discardPlan(p, { kaderId, baseRev: 6 }));
        expect(stale).toMatchObject({ status: 409, code: "stale" });
        expect(kader(plan.discardPlan(p, { kaderId, baseRev: 7 })).plan).toBeNull();
        expect(kader(plan.discardPlan(p, { kaderId, baseRev: 6, force: true })).plan).toBeNull();
    });
});

describe("services/kader/kaderPlan applyPlan", () => {
    it("makes the planned specs decisions — for Vorläufige too — without a state change, and empties the draft", () => {
        const { planner, kaderId } = setup();
        let p = plan.savePlan(planner, { kaderId, userId: U.a, spec: { className: "Warrior", spec: "Warrior-Fury" } }, ctx);
        p = plan.savePlan(p, { kaderId, userId: U.b, spec: { className: "Priest", spec: "Priest-Shadow" } }, ctx);
        const out = plan.applyPlan(p, { kaderId }, later);
        expect(out.applied).toBe(2);
        const k = kader(out.planner);
        expect(k.plan).toBeNull();
        expect(k.players[U.a]).toMatchObject({ state: "roster", decision: { className: "Warrior", spec: "Warrior-Fury" } });
        expect(k.players[U.b]).toMatchObject({ state: "provisional", decision: { className: "Priest", spec: "Priest-Shadow" } });
        expect(k.players[U.b].history.at(-1)).toEqual({ at: later.now, by: U.lead2, type: "decision", className: "Priest", spec: "Priest-Shadow" });
        expect(k.players[U.c].decision).toBeNull();
    });

    it("leaves left-out players as they are", () => {
        const { planner, kaderId } = setup();
        let p = plan.savePlan(planner, { kaderId, userId: U.a, spec: { className: "Warrior", spec: "Warrior-Fury" }, excluded: true }, ctx);
        p = plan.savePlan(p, { kaderId, userId: U.b, spec: { className: "Priest", spec: "Priest-Shadow" } }, ctx);
        const k = kader(plan.applyPlan(p, { kaderId }, later).planner);
        expect(k.players[U.a]).toMatchObject({ state: "roster", decision: WISH[U.a] });
        expect(k.players[U.b].decision.spec).toBe("Priest-Shadow");
    });

    it("refuses a draft that changes no decision, a missing draft and a draft that moved on", () => {
        const { planner, kaderId } = setup();
        expect(refusal(() => plan.applyPlan(planner, { kaderId }, ctx)).status).toBe(409);
        const onlyOut = plan.savePlan(planner, { kaderId, userId: U.c, excluded: true }, ctx);
        expect(refusal(() => plan.applyPlan(onlyOut, { kaderId }, ctx)).message).toMatch(/keine Entscheidung/);
        const p = plan.savePlan(planner, { kaderId, userId: U.b, spec: { className: "Priest", spec: "Priest-Shadow" } }, ctx);
        p.kaders[0].plan.rev = 5;
        const stale = refusal(() => plan.applyPlan(p, { kaderId, baseRev: 4 }, ctx));
        expect(stale.status).toBe(409);
        expect(stale.code).toBe("stale");
        expect(plan.applyPlan(p, { kaderId, baseRev: 5 }, ctx).applied).toBe(1);
        expect(plan.applyPlan(p, { kaderId, baseRev: 4, force: true }, ctx).applied).toBe(1);
    });
});
