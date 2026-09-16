const { buildSetupProposal, SETUP_PROPOSAL_VERSION } = require("../../../src/utils/setup/proposal");
const { su, rng, roster, randomInput } = require("./fixtures");

const specClass = (spec) => String(spec).split("-")[0];

/** Every hard rule of the issue, checked against the input. */
function expectHardRules(input, out) {
    const seen = new Set();
    const fixedByUser = new Map((input.fixed || []).map((f) => [f.userId, f]));
    const profiles = new Map((input.profiles || []).map((p) => [p.userId, p]));
    for (const ev of out.events) {
        const event = input.events.find((e) => e.id === ev.eventId);
        const counts = { tank: 0, healer: 0, melee: 0, ranged: 0 };
        const lockedCounts = { tank: 0, healer: 0, melee: 0, ranged: 0 };
        let total = 0;
        expect(ev.groups.length).toBe(Math.ceil(event.size / 5));
        for (const g of ev.groups) {
            expect(g.slots.length).toBeLessThanOrEqual(5);
            for (const s of g.slots) {
                // each raider at most once, across every event of the run
                expect(seen.has(s.userId)).toBe(false);
                seen.add(s.userId);
                total++;
                counts[s.role]++;
                if (s.locked) lockedCounts[s.role]++;
                expect(Array.isArray(s.reasons) && s.reasons.length > 0).toBe(true);
                const signup = input.signups.find((x) => x.userId === s.userId && (x.eventId || input.events[0].id) === ev.eventId);
                // signed off: never
                if (signup) expect(signup.status).not.toBe("absence");
                if (s.locked) continue;
                expect(signup).toBeTruthy();
                expect(specClass(s.spec)).toBe(specClass(signup.spec));
                // no spec the profile calls ungeared
                const profile = profiles.get(s.userId);
                const char = profile && (profile.characters || []).find((c) => c.name.toLowerCase() === String(signup.character).toLowerCase());
                const gear = char && char.specs.find((x) => x.key === s.spec);
                if (gear) expect(gear.gear).not.toBe("none");
            }
        }
        expect(total).toBeLessThanOrEqual(event.size);
        const comp = event.composition;
        expect(counts.tank).toBeLessThanOrEqual(Math.max(comp.tank, lockedCounts.tank));
        expect(counts.healer).toBeLessThanOrEqual(Math.max(comp.healer, lockedCounts.healer));
        for (const r of ["melee", "ranged"]) {
            if (comp[r] && typeof comp[r] === "object" && comp[r].max !== null) {
                expect(counts[r]).toBeLessThanOrEqual(Math.max(comp[r].max, lockedCounts[r]));
            }
        }
    }
    // fixed places stay
    for (const [userId, f] of fixedByUser) {
        if (f.bench) {
            expect(placedIds(out)).not.toContain(userId);
            continue;
        }
        const signup = input.signups.find((x) => x.userId === userId && (x.eventId || input.events[0].id) === f.eventId);
        if (signup && signup.status === "absence") continue;
        const ev = out.events.find((e) => e.eventId === f.eventId);
        const group = ev.groups.find((g) => g.slots.some((s) => s.userId === userId));
        expect(group).toBeTruthy();
        if (f.group) expect(group.index).toBe(f.group);
        expect(group.slots.find((s) => s.userId === userId).locked).toBe(true);
    }
    // the output is plain JSON
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
}

const placedIds = (out) => out.events.flatMap((e) => e.groups.flatMap((g) => g.slots.map((s) => s.userId)));
const slotOf = (out, userId) => {
    for (const g of out.groups) {
        const s = g.slots.find((x) => x.userId === userId);
        if (s) return { ...s, group: g.index };
    }
    return null;
};

describe("buildSetupProposal", () => {
    describe("fixtures", () => {
        it("fills a TBC 10-man with the planned tanks and healers", () => {
            const input = {
                events: [{ id: "kara", size: 10, composition: { tank: 2, healer: 3 } }],
                signups: roster(14),
            };
            input.signups.push(su("tank2", "Warrior-Protection", { at: 100 }), su("heal3", "Priest-Holy", { at: 101 }), su("heal4", "Druid-Restoration", { at: 102 }));
            const out = buildSetupProposal(input);
            expect(out.version).toBe(SETUP_PROPOSAL_VERSION);
            expect(out.groups.map((g) => g.index)).toEqual([1, 2]);
            expect(out.checks.size).toEqual({ count: 10, size: 10, ok: true });
            expect(out.checks.roles.tank).toMatchObject({ count: 2, ok: true });
            expect(out.checks.roles.healer).toMatchObject({ count: 3, ok: true });
            expect(out.checks.ok).toBe(true);
            expect(out.bench.length).toBe(input.signups.length - 10);
            expectHardRules(input, out);
        });

        it("fills a TBC 25-man", () => {
            const signups = roster(30);
            for (let i = 0; i < 4; i++) signups.push(su(`h${i}`, "Paladin-Holy", { at: 50 + i }));
            signups.push(su("t1", "Druid-Guardian", { at: 60 }));
            const input = { events: [{ id: "ssc", size: 25, composition: { tank: 3, healer: 7 } }], signups };
            const out = buildSetupProposal(input);
            expect(out.checks.size.count).toBe(25);
            expect(out.checks.roles.tank.count).toBe(3);
            expect(out.checks.roles.healer.count).toBe(7);
            expect(out.groups).toHaveLength(5);
            expectHardRules(input, out);
        });

        it("fills a Classic 40-man without TBC-only buffs", () => {
            const signups = roster(50);
            for (let i = 0; i < 6; i++) signups.push(su(`ch${i}`, i % 2 ? "Priest-Holy" : "Druid-Restoration", { at: 100 + i }));
            const input = { versionId: "classic", events: [{ id: "mc", size: 40, composition: { tank: 3, healer: 10 } }], signups };
            const out = buildSetupProposal(input);
            expect(out.versionId).toBe("classic");
            expect(out.groups).toHaveLength(8);
            expect(out.checks.size.count).toBe(40);
            expect(out.checks.roles.healer.count).toBe(10);
            const partyKeys = out.checks.buffs.party.map((b) => b.key);
            expect(partyKeys).not.toContain("wrathOfAir");
            expect(partyKeys).not.toContain("vampiricTouch");
            expectHardRules(input, out);
        });
    });

    it("is deterministic, also when the signups come in another order", () => {
        const input = { events: [{ id: "e", size: 25, composition: { tank: 3, healer: 6 }, fairness: true, wishes: true }], signups: roster(40) };
        const a = buildSetupProposal(input);
        const b = buildSetupProposal(JSON.parse(JSON.stringify(input)));
        const c = buildSetupProposal({ ...input, signups: input.signups.slice().reverse() });
        expect(b).toEqual(a);
        expect(c).toEqual(a);
    });

    it("never breaks a hard rule on random inputs", () => {
        const random = rng(262);
        for (let i = 0; i < 40; i++) {
            const input = randomInput(random, { events: 1 + (i % 3 === 2 ? 1 : 0) });
            const out = buildSetupProposal(input);
            expectHardRules(input, out);
        }
    });

    it("says so instead of crashing when healers are missing", () => {
        const signups = [
            su("t1", "Warrior-Protection"), su("t2", "Paladin-Protection"), su("h1", "Priest-Holy"),
            ...["a", "b", "c", "d", "e", "f", "g"].map((x) => su(`d${x}`, "Mage-Fire")),
        ];
        const out = buildSetupProposal({ events: [{ id: "e", size: 10, composition: { tank: 2, healer: 3 } }], signups });
        expect(out.checks.roles.healer).toEqual({ count: 1, min: 3, max: 3, ok: false });
        expect(out.checks.ok).toBe(false);
        expect(out.checks.size.count).toBe(10);
    });

    it("handles an empty input", () => {
        const out = buildSetupProposal({ events: [{ id: "e", size: 10, composition: { tank: 2, healer: 3 } }], signups: [] });
        expect(out.groups).toHaveLength(2);
        expect(out.bench).toEqual([]);
        expect(out.checks.ok).toBe(false);
        expect(buildSetupProposal({}).groups).toEqual([]);
    });

    describe("party buffs", () => {
        const signups = () => [
            su("prot", "Warrior-Protection"), su("hpriest", "Priest-Holy"), su("hpala", "Paladin-Holy"),
            su("enh", "Shaman-Enhancement"), su("rogue1", "Rogue-Combat"), su("mage", "Mage-Fire"),
            su("rogue2", "Rogue-Combat"), su("lock", "Warlock-Destruction"), su("fury", "Warrior-Fury"),
            su("spriest", "Priest-Shadow"),
        ];

        it("puts the Windfury shaman with the melee and the shadow priest with the casters", () => {
            const out = buildSetupProposal({ events: [{ id: "e", size: 10, composition: { tank: 1, healer: 2 } }], signups: signups() });
            const enh = slotOf(out, "enh");
            const sp = slotOf(out, "spriest");
            expect(enh.group).not.toBe(sp.group);
            for (const melee of ["rogue1", "rogue2", "fury"]) expect(slotOf(out, melee).group).toBe(enh.group);
            for (const caster of ["mage", "lock"]) expect(slotOf(out, caster).group).toBe(sp.group);
            expect(enh.reasons.join(" ")).toMatch(/wegen Totem des Windzorns/);
            expect(sp.reasons.join(" ")).toMatch(/wegen Vampirberührung/);
            const wf = out.checks.buffs.party.find((b) => b.key === "windfury");
            expect(wf.groups).toEqual([enh.group]);
        });

        it("counts a required buff and turns the check red without it", () => {
            const withShaman = buildSetupProposal({ events: [{ id: "e", size: 10, composition: { tank: 1, healer: 2 }, requiredBuffs: ["windfury"] }], signups: signups() });
            expect(withShaman.checks.buffs.required).toEqual([expect.objectContaining({ key: "windfury", present: true })]);
            const without = buildSetupProposal({
                events: [{ id: "e", size: 10, composition: { tank: 1, healer: 2 }, requiredBuffs: ["windfury", "nope"] }],
                signups: signups().filter((s) => s.userId !== "enh"),
            });
            expect(without.checks.buffs.ok).toBe(false);
            expect(without.checks.ok).toBe(false);
            expect(without.warnings.join(" ")).toMatch(/nope/);
        });

        it("prefers the raider who brings a required buff", () => {
            const base = [su("t", "Warrior-Protection"), su("m1", "Mage-Fire"), su("m2", "Mage-Fire"), su("m3", "Mage-Fire"), su("m4", "Mage-Fire"), su("sham", "Shaman-Elemental")];
            const out = buildSetupProposal({ events: [{ id: "e", size: 5, composition: { tank: 1, healer: 0 }, requiredBuffs: ["totemOfWrath"] }], signups: base });
            expect(placedIds(out)).toContain("sham");
            expect(out.checks.buffs.ok).toBe(true);
        });
    });

    describe("who gets a place", () => {
        const event = { id: "e", size: 5, composition: { tank: 0, healer: 0 } };

        it("never places a raider who signed off", () => {
            const signups = [su("a", "Mage-Fire", { status: "absence" }), su("b", "Mage-Fire"), su("c", "Mage-Fire")];
            const out = buildSetupProposal({ events: [event], signups });
            expect(placedIds(out)).toEqual(expect.not.arrayContaining(["a"]));
            expect(out.bench.map((b) => b.userId)).not.toContain("a");
            expect(out.checks.size).toEqual({ count: 2, size: 5, ok: false });
        });

        it("places signed raiders before tentative and late ones", () => {
            const signups = [
                su("t", "Mage-Fire", { status: "tentative" }), su("l", "Mage-Fire", { status: "late" }),
                ...["a", "b", "c", "d"].map((x) => su(x, "Mage-Fire")),
            ];
            const out = buildSetupProposal({ events: [event], signups });
            expect(placedIds(out).sort()).toEqual(["a", "b", "c", "d", "l"]);
            expect(out.bench[0]).toMatchObject({ userId: "t", reasons: expect.arrayContaining(["Nur „Vielleicht“ angemeldet"]) });
            expect(slotOf(out, "l").reasons).toContain("Kommt später");
        });

        it("uses a bench signup only as a fallback", () => {
            const five = ["a", "b", "c", "d", "e"].map((x) => su(x, "Mage-Fire"));
            const full = buildSetupProposal({ events: [event], signups: [su("x", "Mage-Fire", { status: "bench" }), ...five] });
            expect(placedIds(full)).not.toContain("x");
            const short = buildSetupProposal({ events: [event], signups: [su("x", "Mage-Fire", { status: "bench" }), ...five.slice(1)] });
            expect(placedIds(short)).toContain("x");
            expect(slotOf(short, "x").reasons.join(" ")).toMatch(/Ersatz/);
        });

        it("prefers the main spec over somebody's off spec", () => {
            const signups = [
                su("druid", "Druid-Feral", { canAlso: ["healer"] }),
                su("priest", "Priest-Holy"),
                su("rogue", "Rogue-Combat"),
            ];
            const out = buildSetupProposal({ events: [{ id: "e", size: 2, composition: { tank: 0, healer: 1 } }], signups });
            expect(slotOf(out, "priest")).toMatchObject({ role: "healer", main: true });
            expect(slotOf(out, "druid")).toMatchObject({ role: "melee", main: true });
        });

        it("takes an off spec when the role is short, and says so", () => {
            const signups = [su("druid", "Druid-Balance", { canAlso: ["healer"] }), su("mage", "Mage-Fire")];
            const out = buildSetupProposal({ events: [{ id: "e", size: 2, composition: { tank: 0, healer: 1 } }], signups });
            expect(slotOf(out, "druid")).toMatchObject({ role: "healer", spec: "Druid-Restoration", main: false });
            expect(slotOf(out, "druid").reasons).toContain("Zweitspec als Heiler");
            expect(out.checks.roles.healer.ok).toBe(true);
        });

        it("never uses a spec the profile calls ungeared, and plays the geared one instead", () => {
            const signups = [su("druid", "Druid-Restoration", { character: "Bär", canAlso: ["tank"] }), su("mage", "Mage-Fire")];
            const profiles = [{
                userId: "druid",
                characters: [{ key: "bär", name: "Bär", className: "Druid", main: true, specs: [{ key: "Druid-Restoration", gear: "none" }, { key: "Druid-Guardian", gear: "ready" }] }],
            }];
            const input = { events: [{ id: "e", size: 2, composition: { tank: 1, healer: 1 } }], signups, profiles };
            const out = buildSetupProposal(input);
            expect(slotOf(out, "druid")).toMatchObject({ spec: "Druid-Guardian", role: "tank" });
            expect(out.checks.roles.healer.ok).toBe(false);
            expectHardRules(input, out);
            const noOther = buildSetupProposal({ ...input, signups: [su("druid", "Druid-Restoration", { character: "Bär" })] });
            expect(noOther.bench[0].reasons).toEqual(["Keine Spec mit brauchbarem Gear"]);
        });

        it("reads can-offtank from the profile", () => {
            const signups = [su("feral", "Druid-Feral"), su("rogue", "Rogue-Combat")];
            const profiles = [{ userId: "feral", canOfftank: true, characters: [] }];
            const out = buildSetupProposal({ events: [{ id: "e", size: 2, composition: { tank: 1, healer: 0 } }], signups, profiles });
            expect(slotOf(out, "feral")).toMatchObject({ role: "tank", spec: "Druid-Guardian" });
        });
    });

    describe("fixed places", () => {
        it("keeps the orga's places, group and bench", () => {
            const signups = roster(14);
            const fixed = [
                { userId: "r09", eventId: "e", group: 2 },
                { userId: "r03", bench: true },
                { userId: "outsider", eventId: "e", group: 1, spec: "Hunter-Marksmanship" },
            ];
            const input = { events: [{ id: "e", size: 10, composition: { tank: 1, healer: 2 } }], signups, fixed };
            const out = buildSetupProposal(input);
            expect(slotOf(out, "r09")).toMatchObject({ group: 2, locked: true, reasons: expect.arrayContaining(["Von der Orga fixiert"]) });
            expect(slotOf(out, "outsider")).toMatchObject({ group: 1, locked: true, spec: "Hunter-Marksmanship" });
            expect(slotOf(out, "r03")).toBeNull();
            expect(out.bench.find((b) => b.userId === "r03")).toMatchObject({ locked: true, reasons: ["Von der Orga auf die Bank gesetzt"] });
            expectHardRules(input, out);
        });

        it("ignores a fixed place of a raider who signed off, with a warning", () => {
            const signups = [su("a", "Mage-Fire", { status: "absence" }), su("b", "Mage-Fire")];
            const out = buildSetupProposal({ events: [{ id: "e", size: 5, composition: {} }], signups, fixed: [{ userId: "a", eventId: "e", group: 1 }] });
            expect(placedIds(out)).toEqual(["b"]);
            expect(out.warnings.join(" ")).toMatch(/abgemeldet/);
        });

        it("keeps a fixed tank beyond the plan and turns the check red", () => {
            const signups = [su("t1", "Warrior-Protection"), su("t2", "Paladin-Protection"), su("m", "Mage-Fire")];
            const fixed = [{ userId: "t1", eventId: "e" }, { userId: "t2", eventId: "e" }];
            const out = buildSetupProposal({ events: [{ id: "e", size: 5, composition: { tank: 1, healer: 0 } }], signups, fixed });
            expect(out.checks.roles.tank).toMatchObject({ count: 2, ok: false });
        });
    });

    describe("fairness", () => {
        const signups = () => [
            su("tank", "Warrior-Protection", { at: 1 }),
            ...["a", "b", "c", "d", "e", "f", "g"].map((x, i) => su(x, "Mage-Fire", { at: 10 + i })),
        ];
        const event = (id, fairness) => ({ id, size: 5, composition: { tank: 1, healer: 0 }, fairness });

        function evenings(n, fairness) {
            const history = [];
            const benched = [];
            for (let night = 0; night < n; night++) {
                const id = `night${night}`;
                const out = buildSetupProposal({ events: [event(id, fairness)], signups: signups().map((s) => ({ ...s, eventId: id })), history });
                const bench = out.bench.map((b) => b.userId);
                benched.push(bench);
                history.push({ eventId: id, startTime: night, placed: placedIds(out), bench });
            }
            return benched;
        }

        it("rotates the bench over several evenings", () => {
            const benched = evenings(7, true);
            for (let i = 1; i < benched.length; i++) {
                for (const u of benched[i]) expect(benched[i - 1]).not.toContain(u);
            }
            const counts = {};
            for (const b of benched.flat()) counts[b] = (counts[b] || 0) + 1;
            const values = ["a", "b", "c", "d", "e", "f", "g"].map((u) => counts[u] || 0);
            expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
        });

        it("leaves the same raiders on the bench when fairness is off", () => {
            const benched = evenings(3, false);
            expect(benched[1]).toEqual(benched[0]);
            expect(benched[2]).toEqual(benched[0]);
        });

        it("names the reason on both sides", () => {
            const history = [{ eventId: "old", startTime: 1, placed: ["tank", "a", "b", "c", "d"], bench: ["e", "f", "g"] }];
            const out = buildSetupProposal({ events: [event("new", true)], signups: signups(), history });
            expect(slotOf(out, "e").reasons).toContain("War zuletzt auf der Bank – hat Vorrang");
            expect(out.bench.map((b) => b.userId)).toEqual(["b", "c", "d"]);
            expect(out.bench[0].reasons).toContain("War zuletzt dabei");
            expect(out.weights.fairness).toBeGreaterThan(0);
            const off = buildSetupProposal({ events: [event("new", true)], signups: signups(), history }, { fairness: false });
            expect(off.weights.fairness).toBe(0);
        });
    });

    describe("wishes", () => {
        it("puts wish partners into one group", () => {
            const signups = roster(10);
            const profiles = [{ userId: "r03", wishes: ["r07"] }, { userId: "r07", wishes: ["r03"] }];
            const event = { id: "e", size: 10, composition: { tank: 1, healer: 2 }, wishes: true };
            const out = buildSetupProposal({ events: [event], signups, profiles });
            expect(slotOf(out, "r03").group).toBe(slotOf(out, "r07").group);
            expect(out.checks.wishes).toEqual({ met: 1, total: 1, pairs: [{ a: "r03", b: "r07", mutual: true, met: true }] });
            expect(slotOf(out, "r03").reasons.join(" ")).toMatch(/Wunsch erfüllt: mit R07 \(gegenseitig\)/);
        });

        it("prefers a mutual wish over a one-sided one", () => {
            const signups = [su("a", "Mage-Fire"), su("b", "Mage-Fire"), su("c", "Mage-Fire")];
            const profiles = [{ userId: "a", wishes: ["b", "c"] }, { userId: "c", wishes: ["a"] }];
            const event = { id: "e", size: 2, composition: {}, wishes: true };
            const out = buildSetupProposal({ events: [event], signups, profiles });
            expect(placedIds(out).sort()).toEqual(["a", "c"]);
            expect(out.checks.wishes).toMatchObject({ met: 1, total: 2 });
        });

        it("ignores wishes when the event does not use them", () => {
            const signups = [su("a", "Mage-Fire"), su("b", "Mage-Fire"), su("c", "Mage-Fire")];
            const profiles = [{ userId: "a", wishes: ["c"] }, { userId: "c", wishes: ["a"] }];
            const out = buildSetupProposal({ events: [{ id: "e", size: 2, composition: {} }], signups, profiles });
            expect(placedIds(out).sort()).toEqual(["a", "b"]);
            expect(out.weights.wishes).toBe(0);
        });
    });

    describe("parallel events", () => {
        it("distributes the raiders over both raids, nobody twice", () => {
            const events = [
                { id: "pug1", title: "PuG 1", size: 10, composition: { tank: 2, healer: 3 }, wishes: true },
                { id: "pug2", title: "PuG 2", size: 10, composition: { tank: 2, healer: 3 }, wishes: true },
            ];
            const base = roster(24);
            base.push(su("t9", "Paladin-Protection", { at: 90 }), su("t8", "Druid-Guardian", { at: 91 }), su("h9", "Priest-Holy", { at: 92 }), su("h8", "Paladin-Holy", { at: 93 }));
            const signups = [];
            for (const s of base) for (const e of events) signups.push({ ...s, eventId: e.id });
            const profiles = [{ userId: "r05", wishes: ["r15"] }, { userId: "r15", wishes: ["r05"] }];
            const input = { events, signups, profiles };
            const out = buildSetupProposal(input);
            expect(out.events).toHaveLength(2);
            expect(out.events.map((e) => e.checks.size.count)).toEqual([10, 10]);
            expect(out.events.every((e) => e.checks.roles.tank.ok && e.checks.roles.healer.ok)).toBe(true);
            expect(out.bench).toHaveLength(base.length - 20);
            const r05 = out.events.findIndex((e) => e.groups.some((g) => g.slots.some((s) => s.userId === "r05")));
            const r15 = out.events.findIndex((e) => e.groups.some((g) => g.slots.some((s) => s.userId === "r15")));
            expect(r05).toBe(r15);
            expect(out.checks.wishes.met).toBe(1);
            expect(out.events[0].groups[0].slots[0].reasons.join(" ")).toMatch(/Eingeteilt in PuG 1/);
            expectHardRules(input, out);
            expect(buildSetupProposal({ ...input, signups: signups.slice().reverse() })).toEqual(out);
        });
    });

    describe("runtime", () => {
        it("proposes a 25-man from 60 signups in under a second", () => {
            const signups = roster(60);
            const profiles = signups.filter((_, i) => i % 3 === 0).map((s, i) => ({ userId: s.userId, wishes: [signups[(i * 7) % 60].userId] }));
            const history = [{ eventId: "old", startTime: 1, placed: signups.slice(0, 25).map((s) => s.userId), bench: signups.slice(25).map((s) => s.userId) }];
            const input = { events: [{ id: "e", size: 25, composition: { tank: 3, healer: 6 }, fairness: true, wishes: true, requiredBuffs: ["windfury", "kings"] }], signups, profiles, history };
            const start = Date.now();
            const out = buildSetupProposal(input);
            expect(Date.now() - start).toBeLessThan(1000);
            expect(out.checks.size.count).toBe(25);
        });

        it("proposes a 40-man from 60 signups in under a second", () => {
            const input = { versionId: "classic", events: [{ id: "e", size: 40, composition: { tank: 4, healer: 10 }, fairness: true, wishes: true }], signups: roster(60) };
            const start = Date.now();
            buildSetupProposal(input);
            expect(Date.now() - start).toBeLessThan(1000);
        });
    });
});
