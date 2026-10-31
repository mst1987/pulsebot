// "Loot verteilen" (#1037): raiders who want the same item go into different
// parallel raids - below every minimum rule, and without any effect where it does
// not apply (one raid, no data, another version, weight 0).

const { buildSetupProposal, evaluateSetup } = require("../../../src/utils/setup/proposal");
const { lootWants, attachLoot, SOURCE_WEIGHT } = require("../../../src/utils/setup/lootWants");
const { lineupSignature } = require("../../../src/services/setup/setupEditor")._internal;
const { su, rng, randomInput } = require("./fixtures");

/** `n` Karazhan raids sharing `base` (every signup on every raid, like collectSetupInput). */
function group(n, base, extra = () => ({})) {
    const events = Array.from({ length: n }, (_, i) => ({
        id: `kara${i + 1}`,
        title: `Kara ${i + 1}`,
        size: 10,
        composition: { tank: 2, healer: 3 },
        instanceShort: "Kara",
        ...extra(i),
    }));
    const signups = [];
    for (const s of base) for (const e of events) signups.push({ ...s, eventId: e.id });
    return { versionId: "tbc", events, signups };
}

/** `perRaid` × 10 signups: 2 tanks, 3 healers, 5 dps per raid. */
function base(perRaid) {
    const out = [];
    for (let i = 0; i < 2 * perRaid; i++) out.push(su(`t${i}`, i % 2 ? "Paladin-Protection" : "Warrior-Protection", { at: i + 1 }));
    for (let i = 0; i < 3 * perRaid; i++) out.push(su(`h${i}`, ["Priest-Holy", "Paladin-Holy", "Druid-Restoration"][i % 3], { at: 100 + i }));
    for (let i = 0; i < 5 * perRaid; i++) out.push(su(`d${i}`, ["Mage-Fire", "Rogue-Combat", "Warlock-Destruction", "Hunter-BeastMastery", "Warrior-Fury"][i % 5], { at: 200 + i }));
    return out;
}

const softres = (...itemIds) => ({ items: itemIds.map((itemId) => ({ itemId, weight: 1 })), source: "softres" });
const loot = (wants, items = {}) => ({ versionId: "tbc", wants, items });
const raidOf = (out, userId) => {
    const ev = out.events.find((e) => e.groups.some((g) => g.slots.some((s) => s.userId === userId)));
    return ev ? ev.eventId : null;
};
const slotOf = (out, userId) => out.events.flatMap((e) => e.groups.flatMap((g) => g.slots)).find((s) => s.userId === userId);
const signatures = (out) => out.events.map((ev) => lineupSignature(ev)).join("#");

describe("lootWants (#1037)", () => {
    it("takes the Softres reserves first, before BiS and spec", () => {
        expect(lootWants("u", "Char", { reserves: [7, "8", 7], bis: [1, 2], worn: [], spec: "Warrior-Fury" }))
            .toEqual({ items: [{ itemId: 7, weight: 1 }, { itemId: 8, weight: 1 }], source: "softres" });
    });

    it("counts BiS minus the gear worn, each half", () => {
        expect(lootWants("u", "Char", { bis: [1, 2, 3], worn: [2], spec: "Warrior-Fury" }))
            .toEqual({ items: [{ itemId: 1, weight: 0.5 }, { itemId: 3, weight: 0.5 }], source: "bis" });
    });

    it("an item already worn does not count, all worn falls back to the spec", () => {
        expect(lootWants("u", "Char", { bis: [1, 2], worn: [1, 2], spec: "Mage-Fire" }))
            .toEqual({ items: [{ itemId: "spec:Mage-Fire", weight: SOURCE_WEIGHT.spec }], source: "spec" });
    });

    it("without known gear the BiS list is skipped: the spec fallback applies", () => {
        expect(lootWants("u", "Char", { bis: [1, 2], worn: null, spec: "Mage-Fire" }).source).toBe("spec");
        expect(lootWants("u", "Char", {})).toBeNull();
        expect(lootWants("", "Char", { spec: "Mage-Fire" })).toBeNull();
    });

    it("attachLoot scales a raider's wants to at most 1 and follows the option's spec", () => {
        const cands = [{ userId: "a", options: [{ character: "A", spec: "Paladin-Holy" }, { character: "A", spec: "Paladin-Retribution" }] },
            { userId: "b", options: [{ character: "B", spec: "Mage-Fire" }] }];
        const out = attachLoot(cands, loot({ a: { a: { items: [{ itemId: "spec:x", weight: 0.25 }], source: "spec" } }, b: { b: softres(1, 2, 3, 4) } }));
        expect(cands[0].options.map((o) => out.items[o.loot[0].i].itemId)).toEqual(["spec:Paladin-Holy", "spec:Paladin-Retribution"]);
        expect(cands[1].options[0].loot.reduce((s, w) => s + w.w, 0)).toBeCloseTo(1);
        expect(attachLoot(cands, loot({}))).toBeNull();
    });
});

describe("loot in the setup proposal (#1037)", () => {
    it("two raiders with the same Softres item end up in different raids", () => {
        const input = group(2, base(2));
        // two mages, same reserve: without loot they may sit together
        input.loot = loot({ d0: { d0: softres(900001) }, d5: { d5: softres(900001) } }, { 900001: { name: "Zwillingsklinge", icon: "inv_sword_1" } });
        const out = buildSetupProposal(input);
        expect(raidOf(out, "d0")).not.toBeNull();
        expect(raidOf(out, "d5")).not.toBeNull();
        expect(raidOf(out, "d0")).not.toBe(raidOf(out, "d5"));
        // the first raid: the only one there; the later raid names why it is not the first
        const [first, later] = raidOf(out, "d0") === "kara1" ? ["d0", "d5"] : ["d5", "d0"];
        expect(slotOf(out, first).reasons).toContain("Als Einziger im Raid an Zwillingsklinge interessiert");
        expect(slotOf(out, first).lootReason).toEqual({ kind: "only", text: "Als Einziger im Raid an Zwillingsklinge interessiert", item: "Zwillingsklinge" });
        const text = "In Kara 2, weil Zwillingsklinge in Kara 1 schon gewollt wird";
        expect(slotOf(out, later).reasons).toContain(text);
        expect(slotOf(out, later).reasons.some((r) => r.startsWith("Eingeteilt in"))).toBe(false);
        expect(slotOf(out, later).lootReason).toEqual({ kind: "raid", text, item: "Zwillingsklinge", raid: "Kara 2", other: "Kara 1" });
        // nothing is wanted twice in one raid: the list is empty and the count matches it
        expect(out.checks.loot).toEqual(expect.objectContaining({ on: true, conflicts: 0, items: [] }));
        expect(out.checks.loot.sources).toEqual({ softres: 2, bis: 0, spec: 0, none: 18 });
        expect(out.score.parts.loot).toBe(0);
    });

    it("the spec fallback separates two raiders of one spec, Softres goes first", () => {
        const input = group(2, base(2));
        // d4 and d9 are both Fury warriors without data beyond the spec
        input.loot = loot({
            d4: { d4: { items: [{ itemId: "spec:Warrior-Fury", weight: 0.25 }], source: "spec" } },
            d9: { d9: { items: [{ itemId: "spec:Warrior-Fury", weight: 0.25 }], source: "spec" } },
        });
        const out = buildSetupProposal(input);
        expect(raidOf(out, "d4")).not.toBe(raidOf(out, "d9"));
        const later = raidOf(out, "d4") === "kara1" ? "d9" : "d4";
        expect(slotOf(out, later).reasons).toContain("In Kara 2, weil in Kara 1 schon jemand mit derselben Spec Loot braucht");
        expect(slotOf(out, later).reasons.some((r) => r.startsWith("Eingeteilt in"))).toBe(false);
        // spec overlaps only weigh in the score: never listed, never counted
        expect(out.checks.loot.items).toEqual([]);
        expect(out.checks.loot.conflicts).toBe(0);
    });

    it("roles come first: four tanks wanting one item still fill both raids with two tanks", () => {
        const input = group(2, base(2));
        input.loot = loot(Object.fromEntries(["t0", "t1", "t2", "t3"].map((u) => [u, { [u]: softres(900002) }])));
        const out = buildSetupProposal(input);
        for (const ev of out.events) {
            expect(ev.checks.roles.tank.count).toBe(2);
            expect(ev.checks.size.count).toBe(10);
        }
        // one item, wanted twice in both raids: one list entry, the count matches the list
        expect(out.checks.loot.conflicts).toBe(1);
        expect(out.checks.loot.items).toHaveLength(1);
        expect(out.checks.loot.items[0].conflictIn.sort()).toEqual(["kara1", "kara2"]);
        expect(out.checks.loot.items[0].raids.map((r) => r.raiders.length)).toEqual([2, 2]);
        expect(out.score.parts.loot).toBeLessThan(0);
    });

    it("leaders come first: the two flag holders want the same item, each raid keeps one", () => {
        const input = group(2, base(2), () => ({ leaders: ["h0", "h1"] }));
        input.loot = loot({ h0: { h0: softres(900003) }, h1: { h1: softres(900003) }, h2: { h2: softres(900003) } });
        const out = buildSetupProposal(input);
        for (const ev of out.events) expect(ev.checks.leader.ok).toBe(true);
        expect(out.checks.ok).toBe(true);
    });

    it("never bundles a role shortage: tanks 1/2 + 1/4 stay so, not 2/2 + 0/4 (stress seed 69)", () => {
        // the review's stress case: random input plus second characters and their wants
        const random = rng(69);
        const input = randomInput(random, { events: 2 });
        const specs = ["Mage-Fire", "Priest-Holy", "Warrior-Protection", "Rogue-Combat"];
        for (const s of input.signups) {
            if (random() < 0.3) s.characters = [{ name: s.character, spec: s.spec }, { name: `${s.character}Alt`, spec: specs[Math.floor(random() * specs.length)] }];
        }
        for (const u of Object.keys(input.loot.wants)) {
            const k = Object.keys(input.loot.wants[u])[0];
            input.loot.wants[u][`${k}alt`] = input.loot.wants[u][k];
        }
        const tanks = (o) => o.events.map((ev) => `${ev.checks.roles.tank.count}/${ev.checks.roles.tank.min}`);
        expect(tanks(buildSetupProposal({ ...input, loot: null }))).toEqual(["1/2", "1/4"]);
        expect(tanks(buildSetupProposal(input))).toEqual(["1/2", "1/4"]);
    });

    it("never puts anybody on the bench and never locks anybody for loot", () => {
        const input = group(2, base(2));
        input.signups.push(...["kara1", "kara2"].map((eventId) => su("x0", "Mage-Fire", { eventId, at: 999 })));
        input.loot = loot(Object.fromEntries(input.signups.map((s) => [s.userId, { [s.userId]: softres(900004) }])));
        const out = buildSetupProposal(input);
        expect(out.bench).toEqual([]);
        for (const ev of out.events) for (const g of ev.groups) for (const s of g.slots) expect(s.locked).toBe(false);
        for (const p of out.pool) expect(p.locked).toBeFalsy();
    });

    it("never decides who gets a place: an overbooked group keeps the same pool with and without loot", () => {
        // 2 x 10 places, 21 signups - one raider must stay in the pool
        const input = group(2, base(2));
        input.signups.push(...["kara1", "kara2"].map((eventId) => su("x0", "Mage-Fire", { eventId, at: 999 })));
        const ids = (list) => list.map((p) => p.userId).sort();
        const plain = buildSetupProposal(input);
        expect(plain.pool).toHaveLength(1);
        // every dps but the pool raider wants something shared, the pool raider wants nothing
        const wants = {};
        input.signups.filter((s) => s.eventId === "kara1" && s.userId.startsWith("d")).forEach((s, i) => {
            wants[s.userId] = { [s.userId]: softres(900010 + (i % 3)) };
        });
        const withLoot = buildSetupProposal({ ...input, loot: loot(wants) });
        expect(ids(withLoot.pool)).toEqual(ids(plain.pool));
        expect(ids(withLoot.bench)).toEqual(ids(plain.bench));
        const placed = (out) => out.events.flatMap((e) => e.groups.flatMap((g) => g.slots.map((s) => s.userId))).sort();
        expect(placed(withLoot)).toEqual(placed(plain));
    });

    it("has no effect with one raid: same output, no checks.loot, no part", () => {
        const input = group(1, base(1));
        const plain = buildSetupProposal(input);
        const withLoot = buildSetupProposal({ ...input, loot: loot({ d0: { d0: softres(1) }, d1: { d1: softres(1) } }) });
        expect(withLoot).toEqual(plain);
        expect(withLoot.checks.loot).toBeUndefined();
        expect(withLoot.score.parts.loot).toBeUndefined();
    });

    it("has no effect with data of another version or with the weight at 0", () => {
        const input = group(2, base(2));
        const plain = buildSetupProposal(input);
        const wants = { d0: { d0: softres(900001) }, d5: { d5: softres(900001) } };
        const other = buildSetupProposal({ ...input, loot: { ...loot(wants), versionId: "forever" } });
        expect(other).toEqual(plain);
        const off = buildSetupProposal({ ...input, loot: loot(wants) }, { weights: { loot: 0 } });
        expect(signatures(off)).toBe(signatures(plain));
        expect(off.checks.loot).toBeUndefined();
        expect(off.score.parts.loot).toBeUndefined();
    });

    it("without loot data an approved lineup keeps byte-identical signatures", () => {
        const input = group(2, base(2));
        const before = buildSetupProposal(input);
        const again = buildSetupProposal({ ...input, loot: null });
        expect(signatures(again)).toBe(signatures(before));
        expect(JSON.stringify(again)).toBe(JSON.stringify(before));
        expect(before.weights.loot).toBe(0);
    });

    it("evaluateSetup values a hand-made lineup with loot only for parallel raids", () => {
        const input = group(1, base(1));
        input.loot = loot({ d0: { d0: softres(1) }, d1: { d1: softres(1) } });
        const out = buildSetupProposal(input);
        const placement = { groups: out.groups.map((g) => ({ index: g.index, slots: g.slots.map((s) => ({ userId: s.userId, spec: s.spec })) })), bench: [] };
        const valued = evaluateSetup(input, placement);
        expect(valued.checks.loot).toBeUndefined();
    });

    it("is deterministic and fast enough for 50 raiders in 5 raids", () => {
        const input = group(5, base(5));
        const wants = {};
        input.signups.filter((s) => s.eventId === "kara1").forEach((s, i) => {
            wants[s.userId] = { [s.userId]: i % 3 === 0 ? softres(900001 + (i % 4)) : { items: [{ itemId: `spec:${s.spec}`, weight: 0.25 }], source: "spec" } };
        });
        input.loot = loot(wants);
        const started = Date.now();
        const a = buildSetupProposal(input);
        const ms = Date.now() - started;
        const b = buildSetupProposal(JSON.parse(JSON.stringify(input)));
        expect(b).toEqual(a);
        expect(ms).toBeLessThan(8000);
        for (const ev of a.events) {
            expect(ev.checks.size.count).toBe(10);
            expect(ev.checks.roles.tank.count).toBe(2);
            expect(ev.checks.roles.healer.count).toBe(3);
        }
        expect(a.checks.loot.conflicts).toBeLessThanOrEqual(buildSetupProposal({ ...input, loot: null }).events.length * 4);
    });

    it("property: loot never breaks a minimum rule and does nothing without parallel raids", () => {
        const random = rng(1037);
        for (let i = 0; i < 30; i++) {
            const input = randomInput(random, { events: 1 + (i % 3) });
            const withLoot = buildSetupProposal(input);
            const without = buildSetupProposal({ ...input, loot: null });
            if (input.events.length === 1) {
                expect(withLoot).toEqual(without);
                continue;
            }
            const ok = (out) => out.events.map((ev) => [
                ev.checks.size.count,
                ...Object.values(ev.checks.roles).map((r) => r.ok),
                ev.checks.leader ? ev.checks.leader.ok : null,
            ]);
            // the minimum rules hold: loot only separates raiders, never empties a place
            const placed = (out) => out.events.reduce((n, ev) => n + ev.checks.size.count, 0);
            expect(placed(withLoot)).toBeGreaterThanOrEqual(placed(without));
            const rolesOk = (out) => out.events.every((ev) => Object.values(ev.checks.roles).every((r) => r.ok));
            if (rolesOk(without)) expect(rolesOk(withLoot)).toBe(true);
            // no raid lacks more of a role than without loot (no shortage moved between raids)
            const gaps = (out) => out.events.map((ev) => Object.values(ev.checks.roles).map((r) => Math.max(0, r.min - r.count)));
            gaps(withLoot).forEach((row, e) => row.forEach((v, k) => expect(v).toBeLessThanOrEqual(gaps(without)[e][k])));
            const leadersOk = (out) => out.events.filter((ev) => ev.checks.leader && ev.checks.leader.ok).length;
            expect(leadersOk(withLoot)).toBe(leadersOk(without));
            expect(ok(withLoot)).toHaveLength(input.events.length);
            expect(withLoot.bench).toEqual(without.bench);
            // loot never decides who gets a place: the same people in the pool and on the bench
            const ids = (list) => list.map((p) => p.userId).sort();
            expect(ids(withLoot.pool)).toEqual(ids(without.pool));
            expect(ids(withLoot.bench)).toEqual(ids(without.bench));
        }
    });
});
