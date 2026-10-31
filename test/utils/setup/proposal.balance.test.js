// "Raids gleich stark" (#1038): parallel raids get raiders of similar strength - only
// by swapping who goes where, never deciding who gets a place, below every minimum
// rule, and without any effect where it does not apply (one raid, weight 0).

const { buildSetupProposal, evaluateSetup } = require("../../../src/utils/setup/proposal");
const { characterKeyOf } = require("../../../src/utils/loot/lootImport");
const { lineupSignature } = require("../../../src/services/setup/setupEditor")._internal;
const { su, rng, randomInput, samePlaces } = require("./fixtures");

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

/** Staggered gear: the earlier a raider signed up, the better the gear (the worst case for raid 1). */
function staggered(input) {
    const gear = {};
    const firsts = input.signups.filter((s) => s.eventId === input.events[0].id);
    firsts.forEach((s, i) => {
        gear[s.userId] = { [characterKeyOf(s.character)]: 140 - Math.floor((i * 40) / firsts.length) };
    });
    return { versionId: "tbc", wants: {}, items: {}, gear };
}

/** Mean item level per raid from the output - also without `checks.balance` (weight 0). */
function spreadOf(out, gear) {
    const means = out.events.map((ev) => {
        const lv = ev.groups.flatMap((g) => g.slots).map((s) => Object.values(gear[s.userId] || {})[0]).filter(Boolean);
        return lv.reduce((a, b) => a + b, 0) / lv.length;
    });
    return Math.max(...means) - Math.min(...means);
}

const signatures = (out) => out.events.map((ev) => lineupSignature(ev)).join("#");

describe("raids of equal strength in the setup proposal (#1038)", () => {
    it("50 raiders with staggered gear in 5 raids: small spread, clearly larger without the weight", () => {
        const input = group(5, base(5));
        input.loot = staggered(input);
        const on = buildSetupProposal(input);
        const off = buildSetupProposal(input, { weights: { balance: 0 } });
        const spreadOn = spreadOf(on, input.loot.gear);
        const spreadOff = spreadOf(off, input.loot.gear);
        expect(spreadOn).toBeLessThan(3);
        expect(spreadOff).toBeGreaterThan(spreadOn * 3);
        expect(on.checks.balance.raids.map((r) => r.eventId)).toEqual(["kara1", "kara2", "kara3", "kara4", "kara5"]);
        expect(on.checks.balance.known).toBe(50);
        expect(on.checks.balance.spread).toBeLessThanOrEqual(10);
        expect(on.checks.balance.raids.every((r) => r.placed === 10 && r.size === 10)).toBe(true);
        // the weight 0 only stops the balancing: the strength is still shown, and it is uneven
        expect(off.checks.balance.spread).toBeGreaterThan(on.checks.balance.spread);
        expect(off.score.parts.balance).toBeUndefined();
        expect(on.score.parts.balance).toBeLessThanOrEqual(0);
        // every minimum still holds
        for (const ev of on.events) {
            expect(ev.checks.size.count).toBe(10);
            expect(ev.checks.roles.tank.count).toBe(2);
            expect(ev.checks.roles.healer.count).toBe(3);
        }
    });

    it("spreads the unknown raiders (attendance only, no gear) over the raids too", () => {
        const input = group(2, base(2));
        // half the raiders have a known attendance: the strong first half, the rest unknown
        input.attendance = {};
        input.signups.filter((s) => s.eventId === "kara1").forEach((s, i) => { if (i % 2 === 0) input.attendance[s.userId] = 100; });
        const out = buildSetupProposal(input);
        const known = out.events.map((ev) => ev.groups.flatMap((g) => g.slots).filter((s) => input.attendance[s.userId] !== undefined).length);
        expect(Math.abs(known[0] - known[1])).toBeLessThanOrEqual(2);
        expect(out.checks.balance.known).toBe(10);
    });

    it("balances tanks against tanks: the two strong tanks end up in different raids", () => {
        const input = group(2, base(2));
        input.loot = { versionId: "tbc", wants: {}, items: {}, gear: { t0: { t0: 150 }, t1: { t1: 148 }, t2: { t2: 100 }, t3: { t3: 100 } } };
        const out = buildSetupProposal(input);
        const raidOf = (u) => out.events.find((ev) => ev.groups.some((g) => g.slots.some((s) => s.userId === u))).eventId;
        expect(raidOf("t0")).not.toBe(raidOf("t1"));
    });

    it("never decides who gets a place: an overbooked group keeps pool, bench and places", () => {
        const input = group(2, base(2));
        input.signups.push(...["kara1", "kara2"].map((eventId) => su("x0", "Mage-Fire", { eventId, at: 999 })));
        input.loot = staggered(input);
        const plain = buildSetupProposal(input, { weights: { balance: 0 } });
        const balanced = buildSetupProposal(input);
        expect(plain.pool).toHaveLength(1);
        expect(samePlaces(balanced, plain)).toBe(true);
    });

    it("never opens a role gap: a shortage stays where it was, not bundled into one raid", () => {
        // 3 tanks for 2 × 2 places: one raid lacks one, never one raid both
        const signups = base(2).filter((s) => s.userId !== "t3");
        const input = group(2, signups);
        input.loot = { versionId: "tbc", wants: {}, items: {}, gear: { t0: { t0: 150 }, t1: { t1: 100 }, t2: { t2: 100 } } };
        const tanks = (o) => o.events.map((ev) => ev.checks.roles.tank.count).sort();
        expect(tanks(buildSetupProposal(input))).toEqual([1, 2]);
        expect(tanks(buildSetupProposal(input, { weights: { balance: 0 } }))).toEqual([1, 2]);
    });

    it("keeps the leaders: each raid with a leader rule keeps its leader", () => {
        const input = group(2, base(2), () => ({ leaders: ["h0", "h1"] }));
        input.loot = { versionId: "tbc", wants: {}, items: {}, gear: { h0: { h0: 150 }, h1: { h1: 149 } } };
        const out = buildSetupProposal(input);
        for (const ev of out.events) expect(ev.checks.leader.ok).toBe(true);
    });

    it("has no effect with one raid: same output, no checks.balance, no part", () => {
        const input = group(1, base(1));
        input.attendance = { t0: 100, d0: 0 };
        const off = buildSetupProposal(input, { weights: { balance: 0 } });
        const on = buildSetupProposal({ ...input, loot: { versionId: "tbc", wants: {}, items: {}, gear: { t0: { t0: 150 } } } });
        expect(JSON.stringify(on)).toBe(JSON.stringify(off));
        expect(on.checks.balance).toBeUndefined();
        expect(on.score.parts.balance).toBeUndefined();
        expect(on.weights.balance).toBe(0);
        // byte-identical output: lineupSignature, the DM signature and the approval follow
        expect(lineupSignature(on)).toBe(lineupSignature(off));
    });

    it("with the weight at 0 the lineup and signatures are those of a plain proposal, the display stays", () => {
        const input = group(2, base(2));
        const plain = buildSetupProposal(input);
        input.loot = staggered(input);
        const off = buildSetupProposal(input, { weights: { balance: 0 } });
        expect(signatures(off)).toBe(signatures(plain));
        expect(off.checks.balance.known).toBe(20);
        expect(off.score.parts.balance).toBeUndefined();
    });

    it("an approved group with the weight at 0 stays approved when proposed again (signatures without checks)", () => {
        const input = group(2, base(2));
        input.loot = staggered(input);
        const approved = buildSetupProposal(input, { weights: { balance: 0 } });
        // the next day the gear changed - the display moves, the lineup and its signature do not
        const again = buildSetupProposal({ ...input, loot: { ...input.loot, gear: { ...input.loot.gear, d0: { d0: 90 } } } }, { weights: { balance: 0 } });
        expect(again.checks.balance).not.toEqual(approved.checks.balance);
        expect(signatures(again)).toBe(signatures(approved));
    });

    it("without any strength data nobody moves and nothing is shown", () => {
        const input = group(3, base(3));
        const on = buildSetupProposal(input);
        const off = buildSetupProposal(input, { weights: { balance: 0 } });
        expect(signatures(on)).toBe(signatures(off));
        expect(on.checks.balance).toBeUndefined();
    });

    it("a small spread moves nobody: 20 raiders between 115.0 and 115.9, the same lineup with and without balance", () => {
        const input = group(2, base(2));
        const gear = {};
        input.signups.filter((s) => s.eventId === "kara1").forEach((s, i) => {
            gear[s.userId] = { [characterKeyOf(s.character)]: 115 + (i % 10) / 10 };
        });
        input.loot = { versionId: "tbc", wants: {}, items: {}, gear };
        const on = buildSetupProposal(input);
        const off = buildSetupProposal(input, { weights: { balance: 0 } });
        expect(signatures(on)).toBe(signatures(off));
        expect(on.checks.balance.spread).toBeLessThanOrEqual(2);
    });

    it("an outlier in the pool does not move the placed raiders", () => {
        const input = group(2, base(2));
        input.loot = staggered(input);
        const plain = buildSetupProposal(input);
        // a twink far below everybody, overbooked into the pool
        input.signups.push(...["kara1", "kara2"].map((eventId) => su("x0", "Mage-Fire", { eventId, at: 999 })));
        input.loot = { ...input.loot, gear: { ...input.loot.gear, x0: { [characterKeyOf("x0")]: 40 } } };
        const twink = buildSetupProposal(input);
        expect(twink.pool.map((p) => p.userId)).toEqual(["x0"]);
        expect(signatures(twink)).toBe(signatures(plain));
        expect(twink.checks.balance.raids.map((r) => r.strength)).toEqual(plain.checks.balance.raids.map((r) => r.strength));
    });

    it("strength over placed raiders only: an underfilled raid reports its places", () => {
        // 15 signups for 2 x 10: the second raid stays short
        const input = group(2, base(2).filter((s, i) => i % 4 !== 3));
        input.loot = staggered(input);
        const out = buildSetupProposal(input);
        const placed = out.checks.balance.raids.map((r) => r.placed);
        expect(placed.reduce((a, b) => a + b, 0)).toBe(out.events.reduce((n, ev) => n + ev.checks.size.count, 0));
        expect(out.checks.balance.raids.some((r) => r.placed < r.size)).toBe(true);
        for (const r of out.checks.balance.raids) expect(r.strength).toBeGreaterThanOrEqual(0);
    });

    it("never takes gear of another version (strict, #1038)", () => {
        const input = group(2, base(2));
        const plain = buildSetupProposal(input);
        const other = buildSetupProposal({ ...input, loot: { ...staggered(input), versionId: "forever" } });
        expect(JSON.stringify(other)).toBe(JSON.stringify(plain));
        expect(other.checks.balance).toBeUndefined();
    });

    it("evaluateSetup values the whole group with others, and no balance for one raid", () => {
        const input = group(2, base(2));
        input.loot = staggered(input);
        const out = buildSetupProposal(input);
        const [a, b] = out.events;
        const placement = (ev) => ev.groups.map((g) => ({ index: g.index, slots: g.slots.map((s) => ({ userId: s.userId, spec: s.spec })) }));
        const valued = evaluateSetup(input, { groups: placement(a), bench: [], others: [{ eventId: b.eventId, groups: placement(b) }] });
        expect(valued.checks.balance).toEqual(out.checks.balance);
        const single = group(1, base(1));
        const one = buildSetupProposal(single);
        expect(evaluateSetup(single, { groups: placement(one), bench: [] }).checks.balance).toBeUndefined();
    });

    it("balance and loot together: deterministic, terminating and fast for 50 raiders in 5 raids", () => {
        const input = group(5, base(5));
        input.loot = staggered(input);
        input.signups.filter((s) => s.eventId === "kara1").forEach((s, i) => {
            if (i % 3 === 0) input.loot.wants[s.userId] = { [s.userId]: { items: [{ itemId: 900001 + (i % 4), weight: 1 }], source: "softres" } };
        });
        const started = Date.now();
        const a = buildSetupProposal(input);
        const ms = Date.now() - started;
        const b = buildSetupProposal(JSON.parse(JSON.stringify(input)));
        expect(b).toEqual(a);
        expect(ms).toBeLessThan(8000);
        expect(a.checks.loot).toBeDefined();
        expect(a.checks.balance).toBeDefined();
        expect(a.score.parts.balance).toBeLessThanOrEqual(0);
    });

    it("property: balance never changes who gets a place or a minimum rule", () => {
        const random = rng(1038);
        for (let i = 0; i < 25; i++) {
            const input = randomInput(random, { events: 1 + (i % 3) });
            const on = buildSetupProposal(input);
            const off = buildSetupProposal(input, { weights: { balance: 0 } });
            if (input.events.length === 1) {
                expect(JSON.stringify(on)).toBe(JSON.stringify(off));
                continue;
            }
            expect(samePlaces(on, off)).toBe(true);
            const gaps = (out) => out.events.map((ev) => Object.values(ev.checks.roles).map((r) => Math.max(0, r.min - r.count)));
            gaps(on).forEach((row, e) => row.forEach((v, k) => expect(v).toBeLessThanOrEqual(gaps(off)[e][k])));
            const leadersOk = (out) => out.events.filter((ev) => ev.checks.leader && ev.checks.leader.ok).length;
            expect(leadersOk(on)).toBe(leadersOk(off));
        }
    });

    it("a swap between raids keeps the character of the first phase, even if another raid has a stronger one", () => {
        const input = group(2, base(2));
        input.loot = staggered(input);
        // the weaker half signed up on raid 2 with a far stronger alt - balance must not trade characters
        for (const s of input.signups.filter((x) => x.eventId === "kara2" && /^d[5-9]$/.test(x.userId))) {
            s.character = `${s.character}alt`;
            input.loot.gear[s.userId][characterKeyOf(s.character)] = 160;
        }
        const on = buildSetupProposal(input);
        const off = buildSetupProposal(input, { weights: { balance: 0 } });
        expect(samePlaces(on, off)).toBe(true);
    });
});
