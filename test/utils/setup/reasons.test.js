// The proposal as the editor reads it (#263): the reasons per raider, the
// fulfilment checks and the serialisable output. The model, the scorer facts
// and the search state are built by hand here, so every reason is reached
// directly instead of through a whole proposal run (proposal.test.js does that).
const { buildOutput, slotReasons, benchReasons, eventChecks } = require("../../../src/utils/setup/reasons");

const ROLE_IDX = { tank: 0, healer: 1, melee: 2, ranged: 3 };
const RAID_BUFFS = [
    { idx: 0, key: "fort", label: "Seelenstärke", icon: "fort" },
    { idx: 1, key: "motw", label: "Mal der Wildnis", icon: "motw" },
];
const PARTY_BUFFS = [
    { idx: 0, key: "wf", label: "Totem des Windzorns", icon: "wf" },
    { idx: 1, key: "bs", label: "Kampfrausch", icon: "bs" },
];

/** One option (a character in a spec for one raid). */
function opt(over = {}) {
    const role = over.role || "healer";
    return {
        eventIdx: 0, role, roleIdx: ROLE_IDX[role], character: "Alpha", classId: "Shaman", spec: "Restoration",
        main: true, status: "signed", priority: 0, data: { raid: [] }, ...over,
    };
}

/** A candidate; `options` default to one main healer option named after the user. */
function cand(idx, over = {}) {
    return {
        idx,
        userId: `u${idx}`,
        name: `Name${idx}`,
        options: [opt({ character: `Char${idx}` })],
        fixed: null,
        noGear: [],
        absentIn: new Set(),
        signedIn: new Set([0]),
        fairness: { last: "", benchCount: 0 },
        attendance: null,
        ...over,
    };
}

function event(over = {}) {
    return {
        id: "ev1",
        title: "Karazhan",
        size: 10,
        hardMax: { tank: 2, healer: 3, melee: 4, ranged: 5 },
        limits: { tank: { min: 1, max: 2 }, healer: { min: 2, max: 3 }, melee: { min: 0, max: null }, ranged: { min: 0, max: null } },
        requiredRaid: [],
        requiredBuffs: [],
        ...over,
    };
}

function model(over = {}) {
    return {
        versionId: "tbc",
        cands: [],
        events: [event()],
        raidBuffs: RAID_BUFFS,
        partyBuffs: PARTY_BUFFS,
        pairs: [],
        avoidPairs: [],
        weightsEffective: { fairness: 0, wishes: 0, attendance: 0 },
        warnings: [],
        ...over,
    };
}

/** The scorer's facts for one raid. */
function evFacts(over = {}) {
    return { roles: [0, 0, 0, 0], count: 0, groups: [[]], credits: [], raid: [], party: [], ...over };
}

const member = (c, o) => ({ cand: c, opt: o || c.options[0] });

/** A world with the given candidates, all placed in group 1 of the one raid unless `state` says otherwise. */
function world(cands, { m = {}, ev = {}, state = {} } = {}) {
    const mod = model({ cands, ...m });
    const st = {
        opt: cands.map(() => 0),
        grp: cands.map(() => 0),
        lockOpt: [],
        ...state,
    };
    const placed = cands.filter((c) => st.opt[c.idx] >= 0);
    const facts = { events: [evFacts({ groups: [placed.map((c) => member(c, c.options[st.opt[c.idx]]))], ...ev })] };
    return { model: mod, facts, state: st };
}

const reasonsOf = (w, c, credits = []) => slotReasons(w.model, w.facts, w.state, c, credits);

describe("slotReasons", () => {
    it("names the main spec when nothing else stands out", () => {
        const w = world([cand(0)]);
        expect(reasonsOf(w, 0)).toEqual(["Angemeldet mit Hauptspec"]);
    });

    it("lists lock, offspec, bench signup, group buff and a raid buff only they bring - one more line when locked", () => {
        const c0 = cand(0, {
            options: [opt({ role: "melee", main: false, status: "bench", data: { raid: [1] } })],
            fairness: { last: "bench", benchCount: 0 },
        });
        const c1 = cand(1, { options: [opt({ data: { raid: [0] } })] });
        const w = world([c0, c1], { m: { weightsEffective: { fairness: 1, wishes: 0, attendance: 0 } }, state: { grp: [1, 1], lockOpt: [true] } });
        const credits = [
            { member: { cand: c0 }, buff: { idx: 1, label: "Kampfrausch" }, count: 4 },
            { member: { cand: c0 }, buff: { idx: 0, label: "Totem des Windzorns" }, count: 4 },
            { member: { cand: c0 }, buff: { idx: 2, label: "Universal", universal: true }, count: 9 },
            { member: { cand: c1 }, buff: { idx: 3, label: "Fremd" }, count: 9 },
        ];
        expect(reasonsOf(w, 0, credits)).toEqual([
            "Von der Orga fixiert",
            "Zweitspec als Nahkampf",
            "Als Ersatz angemeldet – aufgestellt, weil sonst ein Platz frei bliebe",
            "Gr. 2 wegen Totem des Windzorns (4 profitieren)",
            "Bringt als Einziger Mal der Wildnis",
        ]);
    });

    it("names a late signup and a required raid buff, skipping buffs somebody else brings too", () => {
        const c0 = cand(0, { options: [opt({ status: "late", data: { raid: [1, 0] } })] });
        const c1 = cand(1, { options: [opt({ data: { raid: [1] } })] });
        const w = world([c0, c1], { m: { events: [event({ requiredRaid: [0] })] } });
        expect(reasonsOf(w, 0)).toEqual(["Kommt später", "Bringt Seelenstärke (Pflicht-Buff)"]);
    });

    it("names a tentative signup", () => {
        const w = world([cand(0, { options: [opt({ status: "tentative" })] })]);
        expect(reasonsOf(w, 0)).toEqual(["Nur „Vielleicht“ angemeldet"]);
    });

    it("counts bench history and attendance only when their weights are on", () => {
        const c0 = cand(0, { fairness: { last: "placed", benchCount: 2 }, attendance: 84.6 });
        const on = world([c0], { m: { weightsEffective: { fairness: 1, wishes: 0, attendance: 1 } } });
        expect(reasonsOf(on, 0)).toEqual(["2× auf der Bank in den letzten Raids", "Anwesenheit 85 %"]);
        const off = world([c0]);
        expect(reasonsOf(off, 0)).toEqual(["Angemeldet mit Hauptspec"]);
        const low = world([cand(0, { attendance: 79 })], { m: { weightsEffective: { fairness: 0, wishes: 0, attendance: 1 } } });
        expect(reasonsOf(low, 0)).toEqual(["Angemeldet mit Hauptspec"]);
    });

    it("names a fulfilled wish in the same group, marked mutual", () => {
        const cands = [cand(0), cand(1, { options: [opt({ character: "Beta" })] }), cand(2)];
        const pairs = [{ a: 1, b: 2, mutual: false }, { a: 1, b: 0, mutual: true }];
        const w = world(cands, { m: { pairs, weightsEffective: { fairness: 0, wishes: 1, attendance: 0 } } });
        expect(reasonsOf(w, 0)).toEqual(["Wunsch erfüllt: mit Beta (gegenseitig)"]);
    });

    it("does not count a wish partner in another group, on the bench or in another raid", () => {
        const weights = { fairness: 0, wishes: 1, attendance: 0 };
        const cands = [cand(0), cand(1)];
        const pairs = [{ a: 0, b: 1, mutual: false }];
        expect(reasonsOf(world(cands, { m: { pairs, weightsEffective: weights }, state: { grp: [0, 1] } }), 0)).toEqual(["Angemeldet mit Hauptspec"]);
        expect(reasonsOf(world(cands, { m: { pairs, weightsEffective: weights }, state: { opt: [0, -1] } }), 0)).toEqual(["Angemeldet mit Hauptspec"]);

        const twoRaids = [cand(0), cand(1, { options: [opt({ eventIdx: 1 })] })];
        const w = world(twoRaids, { m: { pairs, weightsEffective: weights, events: [event(), event({ id: "ev2", title: "" })] } });
        expect(reasonsOf(w, 0)).toEqual(["Eingeteilt in Karazhan"]);
    });

    it("counts a one-sided wish across groups when raids run in parallel, and names the raid by id without a title", () => {
        const weights = { fairness: 0, wishes: 1, attendance: 0 };
        const cands = [cand(0, { options: [opt({ eventIdx: 1 })] }), cand(1, { options: [opt({ eventIdx: 1, character: "" })], name: "" })];
        const events = [event(), event({ id: "ev2", title: "" })];
        const w = world(cands, { m: { pairs: [{ a: 0, b: 1, mutual: false }], weightsEffective: weights, events }, state: { grp: [0, 1] } });
        w.facts.events.push(evFacts({ groups: [[member(cands[0])], [member(cands[1])]] }));
        expect(reasonsOf(w, 0)).toEqual(["Wunsch erfüllt: mit u1", "Eingeteilt in ev2"]);
    });
});

describe("slotReasons: which of several characters", () => {
    const pick = (optOver, pref, evOver = {}) => {
        const c0 = cand(0, {
            options: [opt({ character: "Alphadk", priority: 1, ...optOver })],
            preferred: new Map([[0, { role: "healer", character: "Alpha", status: "signed", ...pref }]]),
        });
        return reasonsOf(world([c0], { ev: evOver }), 0)[0];
    };

    it("names the first choice when it is played", () => {
        expect(pick({ priority: 0, character: "Alpha" }, {})).toBe("1. Wahl: Alpha");
    });

    it("explains the switch with the first choice being less available", () => {
        expect(pick({}, { status: "late" })).toBe("Mit Alphadk als Heiler statt Alpha (kommt später)");
        expect(pick({}, { status: "bench" })).toBe("Mit Alphadk als Heiler statt Alpha (als Ersatz angemeldet)");
    });

    it("explains the switch with a full role of the first choice", () => {
        expect(pick({}, { role: "tank" }, { roles: [2, 0, 0, 0] })).toBe("Mit Alphadk als Heiler statt Alpha (Tanks voll (2/2))");
    });

    it("explains the switch with a role that was missing", () => {
        expect(pick({}, { role: "tank" }, { roles: [1, 2, 0, 0] })).toBe("Mit Alphadk als Heiler statt Alpha (Heiler fehlten)");
    });

    it("falls back to the fit of the whole setup, and says 1. Wahl for the same character in another role", () => {
        expect(pick({}, {}, { roles: [0, 3, 0, 0] })).toBe("Mit Alphadk als Heiler statt Alpha (passte besser in die Aufstellung)");
        expect(pick({ character: "alpha", role: "ranged" }, { role: "healer", character: "Alpha" }, { roles: [0, 0, 0, 3] }))
            .toBe("Als Fernkampf statt 1. Wahl (passte besser in die Aufstellung)");
    });

    it("says nothing without a preference for this raid", () => {
        const c0 = cand(0, { preferred: new Map([[1, { role: "healer", character: "X", status: "signed" }]]) });
        expect(reasonsOf(world([c0]), 0)).toEqual(["Angemeldet mit Hauptspec"]);
    });
});

describe("benchReasons", () => {
    const bench = (c, { m = {}, ev = {} } = {}) => {
        const w = world([c], { m, ev, state: { opt: [-1] } });
        return benchReasons(w.model, w.facts, w.state, 0);
    };

    it("names an orga decision first", () => {
        expect(bench(cand(0, { fixed: { bench: true } }))).toEqual(["Von der Orga auf die Bank gesetzt"]);
    });

    it("explains a raider without a usable option", () => {
        expect(bench(cand(0, { options: [], noGear: ["Priest-Holy"] }))).toEqual(["Keine Spec mit brauchbarem Gear"]);
        expect(bench(cand(0, { options: [], absentIn: new Set([0]) }))).toEqual(["Abgemeldet"]);
        expect(bench(cand(0, { options: [] }))).toEqual(["Keine Spezialisierung angegeben"]);
    });

    it("lists full roles, a full raid, the status, the last raid and low attendance - at most four", () => {
        const c0 = cand(0, {
            options: [
                opt({ role: "healer", status: "tentative" }),
                opt({ role: "healer", main: false }),
                opt({ role: "melee" }),
            ],
            fairness: { last: "placed", benchCount: 0 },
            attendance: 40,
        });
        const weights = { fairness: 1, wishes: 0, attendance: 1 };
        expect(bench(c0, { m: { weightsEffective: weights }, ev: { roles: [0, 3, 1, 0], count: 10 } })).toEqual([
            "Heiler voll (3/3)",
            "Raid voll (10/10)",
            "Nur „Vielleicht“ angemeldet",
            "War zuletzt dabei",
        ]);
        const late = cand(0, { options: [opt({ status: "late" })], attendance: 40 });
        expect(bench(late, { m: { weightsEffective: weights } })).toEqual(["Kommt später", "Anwesenheit 40 %"]);
    });

    it("says others fit better when nothing else applies", () => {
        const c0 = cand(0, { fairness: { last: "placed", benchCount: 0 }, attendance: 20 });
        expect(bench(c0)).toEqual(["Andere passten besser in die Aufstellung"]);
    });
});

describe("eventChecks", () => {
    it("checks roles, size and required buffs and lists the party buffs by group", () => {
        const c0 = cand(0);
        const c1 = cand(1);
        const m = model({ cands: [c0, c1], events: [event({ requiredBuffs: ["fort", "wf", "nope"] })] });
        const facts = {
            events: [evFacts({
                roles: [1, 3, 2, 4],
                count: 10,
                raid: [true, false],
                party: [true, false],
                credits: [
                    { member: { cand: c0 }, buff: PARTY_BUFFS[0] },
                    { member: { cand: c1 }, buff: PARTY_BUFFS[0] },
                    { member: { cand: c1 }, buff: PARTY_BUFFS[0] },
                ],
            })],
        };
        const state = { opt: [0, 0], grp: [1, 0], lockOpt: [] };
        expect(eventChecks(m, facts, state, 0)).toEqual({
            ok: false,
            size: { count: 10, size: 10, ok: true },
            roles: {
                tank: { count: 1, min: 1, max: 2, ok: true },
                healer: { count: 3, min: 2, max: 3, ok: true },
                melee: { count: 2, min: 0, max: null, ok: true },
                ranged: { count: 4, min: 0, max: null, ok: true },
            },
            buffs: {
                ok: false,
                required: [
                    { key: "fort", label: "Seelenstärke", icon: "fort", present: true },
                    { key: "wf", label: "Totem des Windzorns", icon: "wf", present: true },
                    { key: "nope", label: "nope", present: false },
                ],
                raid: [
                    { key: "fort", label: "Seelenstärke", icon: "fort", present: true },
                    { key: "motw", label: "Mal der Wildnis", icon: "motw", present: false },
                ],
                party: [{ key: "wf", label: "Totem des Windzorns", icon: "wf", groups: [1, 2] }],
            },
            wishes: { met: 0, total: 0, pairs: [] },
        });
    });

    it("fails on a role out of bounds or a raid that is not full", () => {
        const m = model({ events: [event({ requiredBuffs: ["motw"] })] });
        const facts = { events: [evFacts({ roles: [3, 2, 0, 0], count: 5, raid: [false, true] })] };
        const out = eventChecks(m, facts, { opt: [], grp: [] }, 0);
        expect(out.roles.tank).toEqual({ count: 3, min: 1, max: 2, ok: false });
        expect(out.size).toEqual({ count: 5, size: 10, ok: false });
        expect(out.buffs.ok).toBe(true);
        expect(out.buffs.required).toEqual([{ key: "motw", label: "Mal der Wildnis", icon: "motw", present: true }]);
        expect(out.ok).toBe(false);
    });

    it("passes when every role, the size and the buffs are there", () => {
        const facts = { events: [evFacts({ roles: [2, 3, 3, 2], count: 10 })] };
        expect(eventChecks(model(), facts, { opt: [], grp: [] }, 0).ok).toBe(true);
    });

    it("counts the wish pairs signed into this raid, met in the same group", () => {
        const cands = [
            cand(0), cand(1), cand(2), cand(3, { signedIn: new Set([1]) }), cand(4),
        ];
        const pairs = [
            { a: 0, b: 1, mutual: true },
            { a: 0, b: 2, mutual: false },
            { a: 0, b: 3, mutual: false },
            { a: 0, b: 4, mutual: false },
        ];
        const m = model({ cands, pairs });
        const state = { opt: [0, 0, 0, 0, -1], grp: [0, 0, 1, 0, 0] };
        expect(eventChecks(m, { events: [evFacts()] }, state, 0).wishes).toEqual({
            met: 1,
            total: 3,
            pairs: [
                { a: "u0", b: "u1", mutual: true, met: true },
                { a: "u0", b: "u2", mutual: false, met: false },
                { a: "u0", b: "u4", mutual: false, met: false },
            ],
        });
    });
});

describe("buildOutput", () => {
    const WEIGHTS = { fairness: 1, wishes: 1, attendance: 0 };

    it("serialises groups sorted by role, the bench, the checks and the rounded score", () => {
        const healer = cand(0, { options: [opt({ character: "Heal" })] });
        const tank = cand(1, { options: [opt({ role: "tank", character: "Tank", classId: "Warrior", spec: "Protection" })] });
        const benched = cand(2, { options: [opt({ main: false, character: "Off" }), opt({ character: "Main", eventIdx: 0 })] });
        const absent = cand(3, { options: [], absentIn: new Set([0]) });
        const noGear = cand(4, { options: [], noGear: ["Priest-Holy"], name: "" });
        const fixedOut = cand(5, { options: [], fixed: { bench: true }, signedIn: new Set() });
        const cands = [healer, tank, benched, absent, noGear, fixedOut];
        const m = model({ cands, avoidPairs: [{ a: 0, b: 1 }], avoidOverride: true, warnings: ["w1"] });
        const state = { opt: [0, 0, -1, -1, -1, -1], grp: [0, 0, 0, 0, 0, 0], lockOpt: [false, true] };
        const facts = {
            events: [evFacts({ roles: [1, 1, 0, 0], count: 2, groups: [[member(healer), member(tank)]] })],
            total: 12.3456,
            parts: { buffs: 1.234, status: 2 },
        };
        const scorer = { breakdown: jest.fn(() => facts) };

        const out = buildOutput(m, scorer, state, { version: 3, weights: WEIGHTS });
        expect(scorer.breakdown).toHaveBeenCalledWith(state.opt, state.grp);
        expect(m.weightsEffective).toBe(WEIGHTS);
        expect(out.groups).toEqual([{
            index: 1,
            slots: [
                { userId: "u1", character: "Tank", classId: "Warrior", spec: "Protection", role: "tank", main: true, status: "signed", locked: true, reasons: ["Von der Orga fixiert"] },
                { userId: "u0", character: "Heal", classId: "Shaman", spec: "Restoration", role: "healer", main: true, status: "signed", locked: false, reasons: ["Angemeldet mit Hauptspec"] },
            ],
        }]);
        const benchEntry = {
            userId: "u2", character: "Main", classId: "Shaman", spec: "Restoration", role: "healer", status: "signed",
            eventIds: ["ev1"], locked: false, reasons: ["Andere passten besser in die Aufstellung"],
        };
        const noGearEntry = {
            userId: "u4", character: "u4", classId: "", spec: "", role: "", status: "",
            eventIds: [], locked: false, reasons: ["Keine Spec mit brauchbarem Gear"],
        };
        const fixedEntry = {
            userId: "u5", character: "Name5", classId: "", spec: "", role: "", status: "",
            eventIds: [], locked: true, reasons: ["Von der Orga auf die Bank gesetzt"],
        };
        expect(out.events[0].bench).toEqual([benchEntry, noGearEntry]);
        expect(out.bench).toEqual([benchEntry, noGearEntry, fixedEntry]);
        expect(out).toMatchObject({
            version: 3,
            versionId: "tbc",
            weights: WEIGHTS,
            score: { total: 12.35, parts: { buffs: 1.23, status: 2 } },
            warnings: ["w1"],
        });
        expect(out.events).toHaveLength(1);
        expect(out.events[0]).toMatchObject({ eventId: "ev1", title: "Karazhan" });
        expect(out.checks).toMatchObject({
            ok: false,
            size: { count: 2, size: 10, ok: false },
            wishes: { met: 0, total: 0, pairs: [] },
            avoid: { on: true, together: 1, total: 1 },
        });
    });

    it("checks wishes and avoid pairs across parallel raids", () => {
        const a = cand(0, { signedIn: new Set([0, 1]) });
        const b = cand(1, { signedIn: new Set([0, 1]) });
        const c = cand(2, { options: [opt({ eventIdx: 1 })], signedIn: new Set([1]) });
        const d = cand(3, { signedIn: new Set([0]) });
        const m = model({
            cands: [a, b, c, d],
            events: [event(), event({ id: "ev2", title: "Gruul" })],
            pairs: [{ a: 0, b: 1, mutual: true }, { a: 0, b: 2, mutual: false }, { a: 0, b: 3, mutual: false }],
            avoidPairs: [{ a: 0, b: 1 }, { a: 0, b: 2 }, { a: 0, b: 3 }],
        });
        const state = { opt: [0, 0, 0, -1], grp: [0, 1, 0, 0], lockOpt: [] };
        const full = { roles: [2, 3, 3, 2], count: 10 };
        const facts = {
            events: [
                evFacts({ ...full, groups: [[member(a)], [member(b)]] }),
                evFacts({ ...full, groups: [[member(c)]] }),
            ],
            total: 1,
            parts: {},
        };
        const out = buildOutput(m, { breakdown: () => facts }, state, { version: 1, weights: WEIGHTS });
        expect(out.events.map((e) => e.eventId)).toEqual(["ev1", "ev2"]);
        expect(out.checks.ok).toBe(true);
        // Across raids a pair counts as met in the same raid, whatever the group.
        expect(out.checks.wishes).toEqual({
            met: 1,
            total: 3,
            pairs: [
                { a: "u0", b: "u1", mutual: true, met: true },
                { a: "u0", b: "u2", mutual: false, met: false },
                { a: "u0", b: "u3", mutual: false, met: false },
            ],
        });
        expect(out.checks.avoid).toEqual({ on: false, together: 1, total: 3 });
        expect(out.bench.map((e) => e.userId)).toEqual(["u3"]);
        expect(out.events[0].bench.map((e) => e.userId)).toEqual(["u3"]);
    });

    it("keeps apart a pair in different groups of one raid", () => {
        const a = cand(0);
        const b = cand(1);
        const m = model({ cands: [a, b], avoidPairs: [{ a: 0, b: 1 }] });
        const facts = { events: [evFacts({ groups: [[member(a)], [member(b)]] })], total: 0, parts: {} };
        const out = buildOutput(m, { breakdown: () => facts }, { opt: [0, 0], grp: [0, 1], lockOpt: [] }, { version: 1, weights: WEIGHTS });
        expect(out.checks.avoid).toEqual({ on: false, together: 0, total: 1 });
    });

    it("answers an empty proposal without raids or facts", () => {
        const m = model({ events: [], avoidPairs: undefined });
        const out = buildOutput(m, { breakdown: () => null }, { opt: [], grp: [] }, { version: 0, weights: WEIGHTS });
        expect(out).toEqual({
            version: 0,
            versionId: "tbc",
            groups: [],
            bench: [],
            checks: {
                ok: true,
                size: { count: 0, size: 0, ok: false },
                roles: {},
                buffs: { ok: true, required: [], raid: [], party: [] },
                wishes: { met: 0, total: 0, pairs: [] },
                avoid: { on: false, together: 0, total: 0 },
            },
            events: [],
            weights: WEIGHTS,
            score: { total: 0, parts: {} },
            warnings: [],
        });
    });
});
