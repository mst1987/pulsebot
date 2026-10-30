// One leader per raid (#1036): the minimum rule, the spread over a raid group,
// the orga's choice, and that no weight outweighs a missing leader.

const { buildSetupProposal, evaluateSetup } = require("../../../src/utils/setup/proposal");
const { LEADER_MIN, MAX_WEIGHT, ROLE_MIN } = require("../../../src/utils/setup/score");
const { su, roster } = require("./fixtures");

/** A raid group of `n` Karazhan raids sharing `base` (every signup on every raid, like collectSetupInput). */
function group(n, base, leadersOf = () => []) {
    const events = Array.from({ length: n }, (_, i) => ({
        id: `kara${i + 1}`,
        title: `Kara ${i + 1}`,
        size: 10,
        composition: { tank: 2, healer: 3 },
        instanceShort: "Kara",
        leaders: leadersOf(i),
    }));
    const signups = [];
    for (const s of base) for (const e of events) signups.push({ ...s, eventId: e.id });
    return { events, signups };
}

/** Fifty signups that fill five 10-man raids (2 tanks, 3 healers, 5 dps each). */
function fifty() {
    const base = [];
    for (let i = 0; i < 10; i++) base.push(su(`t${i}`, i % 2 ? "Paladin-Protection" : "Warrior-Protection", { at: i + 1 }));
    for (let i = 0; i < 15; i++) base.push(su(`h${i}`, ["Priest-Holy", "Paladin-Holy", "Druid-Restoration"][i % 3], { at: 20 + i }));
    for (let i = 0; i < 25; i++) base.push(su(`d${i}`, ["Mage-Fire", "Rogue-Combat", "Warlock-Destruction", "Hunter-BeastMastery", "Warrior-Fury"][i % 5], { at: 40 + i }));
    return base;
}

const leaderSlots = (ev) => ev.groups.flatMap((g) => g.slots.filter((s) => s.leader));
const placedIn = (ev) => ev.groups.flatMap((g) => g.slots.map((s) => s.userId));

describe("one leader per raid (#1036)", () => {
    it("keeps the minimum rules above every weight", () => {
        expect(LEADER_MIN).toBe(ROLE_MIN);
        expect(LEADER_MIN).toBeGreaterThan(MAX_WEIGHT * 50);
    });

    it("5 raids, 5 leaders, 50 signups: exactly one leader in every raid", () => {
        const leaders = ["d3", "h7", "d11", "d19", "h12"];
        const input = group(5, fifty(), () => leaders);
        const out = buildSetupProposal(input);
        const seen = new Set();
        for (const ev of out.events) {
            const marked = leaderSlots(ev);
            expect(marked).toHaveLength(1);
            expect(leaders).toContain(marked[0].userId);
            expect(seen.has(marked[0].userId)).toBe(false);
            seen.add(marked[0].userId);
            expect(ev.checks.leader).toEqual({ count: 1, ok: true, candidates: leaders.slice().sort((a, b) => input.signups.findIndex((s) => s.userId === a) - input.signups.findIndex((s) => s.userId === b)) });
            expect(marked[0].reasons).toContain("Leitet diesen Raid (Kara)");
            expect(ev.checks.size.count).toBe(10);
        }
        expect(out.checks.ok).toBe(true);
        expect(leaderSlots(out)).toEqual(leaderSlots(out.events[0]));
    });

    it("5 raids, 3 leaders: two raids red, nothing thrown, nobody twice", () => {
        const leaders = ["d3", "h7", "d11"];
        const input = group(5, fifty(), () => leaders);
        let out;
        expect(() => { out = buildSetupProposal(input); }).not.toThrow();
        const red = out.events.filter((e) => !e.checks.leader.ok);
        expect(red).toHaveLength(2);
        expect(red.every((e) => leaderSlots(e).length === 0 && !e.checks.ok)).toBe(true);
        expect(out.checks.ok).toBe(false);
        const marked = out.events.flatMap(leaderSlots).map((s) => s.userId);
        expect(marked.sort()).toEqual(leaders.slice().sort());
        // the leaders sit in three different raids, never two in one
        for (const ev of out.events) expect(placedIn(ev).filter((u) => leaders.includes(u)).length).toBeLessThanOrEqual(1);
    });

    it("5 raids, 4 leaders: the first raid gets its leader first, the last one stays red", () => {
        const leaders = ["d3", "h7", "d11", "d19"];
        const input = group(5, fifty(), () => leaders);
        const out = buildSetupProposal(input);
        expect(out.events.map((e) => e.checks.leader.ok)).toEqual([true, true, true, true, false]);
        expect(leaderSlots(out.events[0])).toHaveLength(1);
        expect(leaderSlots(out.events[4])).toHaveLength(0);
        // the same every time, also with the signups in another order
        const again = buildSetupProposal({ ...input, signups: input.signups.slice().reverse() });
        expect(again.events.map((e) => e.checks.leader.ok)).toEqual([true, true, true, true, false]);
    });

    it("5 raids, 3 leaders: the last two raids are the red ones", () => {
        const out = buildSetupProposal(group(5, fifty(), () => ["d3", "h7", "d11"]));
        expect(out.events.map((e) => e.checks.leader.ok)).toEqual([true, true, true, false, false]);
    });

    it("the raid lead (raidLeadId) leads its raid once placed - before a flag holder, after the orga's choice", () => {
        const input = group(1, fifty().slice(0, 30), () => ["d0"]);
        input.events[0].raidLeadId = "h1";
        expect(leaderSlots(buildSetupProposal(input).events[0]).map((s) => s.userId)).toEqual(["h1"]);
        input.events[0].leaderUserId = "d2";
        input.fixed = [{ userId: "d2", eventId: "kara1", group: null, spec: "Warlock-Destruction" }];
        expect(leaderSlots(buildSetupProposal(input).events[0]).map((s) => s.userId)).toEqual(["d2"]);
    });

    it("without a leader rule the placed raid lead still wears the crown, with no check and no score part", () => {
        const input = group(1, fifty().slice(0, 30));
        delete input.events[0].leaders;
        input.events[0].raidLeadId = "h1";
        const out = buildSetupProposal(input);
        expect(leaderSlots(out.events[0]).map((s) => s.userId)).toEqual(["h1"]);
        expect(out.events[0].checks.leader).toBeUndefined();
        expect(out.score.parts.leader).toBeUndefined();
        // a raid lead who is not placed: no crown at all
        input.events[0].raidLeadId = "nobody";
        expect(leaderSlots(buildSetupProposal(input).events[0])).toHaveLength(0);
    });

    it("a flag for another instance does not count (the input lists only who covers the raid)", () => {
        // collectSetupInput hands in only those whose flag covers the raid's instances; d3 leads Gruul only
        const input = group(1, fifty().slice(0, 30), () => []);
        const out = buildSetupProposal(input);
        expect(out.events[0].checks.leader).toEqual({ count: 0, ok: false, candidates: [] });
        expect(leaderSlots(out.events[0])).toHaveLength(0);
        expect(out.checks.ok).toBe(false);
    });

    it("an input without a leader list knows no leader rule (old inputs keep their shape)", () => {
        const input = group(1, fifty().slice(0, 30));
        delete input.events[0].leaders;
        const out = buildSetupProposal(input);
        expect(out.events[0].checks.leader).toBeUndefined();
        expect(out.score.parts.leader).toBeUndefined();
        expect(out.checks.ok).toBe(true);
    });

    it("no weight outweighs a missing leader: the leader beats a better-geared raider on the last dps seat", () => {
        // ten dps for five seats; the only leader is the last signup on "Vielleicht" without gear
        const base = [
            su("t1", "Warrior-Protection"), su("t2", "Paladin-Protection"),
            su("h1", "Priest-Holy"), su("h2", "Paladin-Holy"), su("h3", "Druid-Restoration"),
            ...["a", "b", "c", "e", "f", "g", "i", "j", "k"].map((x) => su(`dps${x}`, "Mage-Fire")),
            su("lead", "Rogue-Combat", { status: "tentative" }),
        ];
        const input = {
            ...group(1, base, () => ["lead"]),
            profiles: base.filter((s) => s.userId.startsWith("dps")).map((s) => ({ userId: s.userId, wishes: [] })),
            attendance: Object.fromEntries(base.map((s) => [s.userId, s.userId === "lead" ? 0 : 100])),
            history: [{ eventId: "old", startTime: 1, placed: ["lead"], bench: base.filter((s) => s.userId.startsWith("dps")).map((s) => s.userId) }],
        };
        input.events[0].fairness = true;
        const out = buildSetupProposal(input);
        expect(placedIn(out.events[0])).toContain("lead");
        expect(leaderSlots(out.events[0]).map((s) => s.userId)).toEqual(["lead"]);
        expect(out.checks.ok).toBe(true);
    });

    it("the orga's choice leads, even without a flag, and keeps a fixed place", () => {
        const input = group(1, fifty().slice(0, 30), () => ["d3"]);
        input.events[0].leaderUserId = "d7";
        input.fixed = [{ userId: "d7", eventId: "kara1", group: null, spec: "Warlock-Destruction" }];
        const out = buildSetupProposal(input);
        const marked = leaderSlots(out.events[0]);
        expect(marked.map((s) => s.userId)).toEqual(["d7"]);
        expect(marked[0].locked).toBe(true);
        expect(marked[0].reasons.slice(0, 2)).toEqual(["Von der Orga fixiert", "Leitet diesen Raid (Kara)"]);
        expect(out.events[0].checks.leader.ok).toBe(true);
    });

    it("evaluates a hand-made setup with its leader", () => {
        const base = fifty().slice(0, 30);
        const input = group(1, base, () => ["d3"]);
        const placement = { groups: [{ index: 1, slots: ["t0", "t1", "h0", "h1", "h2"].map((userId) => ({ userId, spec: base.find((s) => s.userId === userId).spec })) }, { index: 2, slots: ["d0", "d1", "d2", "d3", "d4"].map((userId) => ({ userId, spec: base.find((s) => s.userId === userId).spec })) }] };
        const out = evaluateSetup(input, placement);
        expect(leaderSlots(out.events[0]).map((s) => s.userId)).toEqual(["d3"]);
        const without = evaluateSetup(input, { groups: [placement.groups[0], { index: 2, slots: placement.groups[1].slots.filter((s) => s.userId !== "d3") }] });
        expect(without.checks.leader).toEqual({ count: 0, ok: false, candidates: ["d3"] });
        expect(without.checks.ok).toBe(false);
    });

    it("is deterministic, also with the signups in another order", () => {
        const input = group(5, fifty(), () => ["d3", "h7", "d11", "d19", "h12"]);
        const a = buildSetupProposal(input);
        expect(buildSetupProposal(JSON.parse(JSON.stringify(input)))).toEqual(a);
        expect(buildSetupProposal({ ...input, signups: input.signups.slice().reverse() })).toEqual(a);
    });

    it("stays bounded with 50 signups over 5 raids", () => {
        let calls = 0;
        let out;
        jest.isolateModules(() => {
            const score = require("../../../src/utils/setup/score");
            const real = score.makeScorer;
            score.makeScorer = (model) => {
                const scorer = real(model);
                return { ...scorer, evaluate: (opt, grp) => { calls++; return scorer.evaluate(opt, grp); } };
            };
            out = require("../../../src/utils/setup/proposal").buildSetupProposal(group(5, fifty(), () => ["d3", "h7", "d11", "d19", "h12"]));
        });
        expect(out.events.every((e) => e.checks.leader.ok)).toBe(true);
        // counted scoring runs, not wall-clock (see proposal.test.js "effort on a full evening")
        expect(calls).toBeLessThan(400000);
    });

    it("a raider who leads gets no extra for a second leader in the raid", () => {
        const input = group(1, fifty().slice(0, 30), () => ["d0", "d1", "d2", "d3", "d4"]);
        const out = buildSetupProposal(input);
        expect(leaderSlots(out.events[0])).toHaveLength(1);
        expect(out.events[0].checks.leader.count).toBeGreaterThanOrEqual(1);
        expect(out.score.parts.leader).toBe(0);
    });

    it("roster() raids still fill without a leader rule", () => {
        const out = buildSetupProposal({ events: [{ id: "x", size: 10, composition: { tank: 2, healer: 3 } }], signups: roster(14) });
        expect(out.groups.flatMap((g) => g.slots).some((s) => "leader" in s)).toBe(false);
    });
});
