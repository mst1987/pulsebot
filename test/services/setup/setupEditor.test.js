// The setup editor's rules (src/services/setup/setupEditor.js, #263): a proposal is a
// draft, locked places survive a new proposal, a manual lineup is validated,
// only an approval makes the setup visible — and a change after the approval
// is a draft again while raiders keep seeing the approved lineup.
const mockEvents = new Map();
jest.mock("../../../src/stores/eventStore", () => ({
    getEvent: (id) => (mockEvents.has(id) ? JSON.parse(JSON.stringify(mockEvents.get(id))) : null),
    listEvents: () => [...mockEvents.values()],
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
    setEventSetup: (id, setup) => {
        if (!mockEvents.has(id)) return null;
        mockEvents.set(id, { ...mockEvents.get(id), setup: JSON.parse(JSON.stringify(setup)) });
        return JSON.parse(JSON.stringify(mockEvents.get(id)));
    },
}));
let mockSignups = [];
jest.mock("../../../src/stores/signupStore", () => ({ listSignups: () => mockSignups }));
jest.mock("../../../src/stores/raiderProfileStore", () => ({ listProfiles: () => [] }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => ({}), getRaidTemplate: () => null }));
jest.mock("../../../src/services/characters/rosterAttendance", () => ({ buildAttendanceContext: () => ({}), attendanceFor: () => ({ pct: null }) }));
jest.mock("../../../src/services/events/eventSources", () => ({
    listStoredEvents: () => [],
    specNameFor: jest.requireActual("../../../src/services/events/eventSources").specNameFor,
}));

const editor = require("../../../src/services/setup/setupEditor");
const { approvedSetupOf } = require("../../../src/services/setup/setupCore");
const { _internal: { buildEventMessage } } = require("../../../src/services/events/eventMessage");
const { su } = require("../../utils/setup/fixtures");

const ID = "eh-kara";

function seed() {
    mockEvents.clear();
    mockEvents.set(ID, {
        id: ID, source: "eventhelper", guildId: "g1", categoryId: "cat", title: "Kara", startTime: 2000000000,
        versionId: "tbc", size: 10, composition: { tank: 1, healer: 2, melee: 0, ranged: 0 }, fairness: false, wishes: false, setup: null,
    });
    mockSignups = [
        su("tank", "Warrior-Protection"), su("heal1", "Priest-Holy"), su("heal2", "Paladin-Holy"),
        su("mage", "Mage-Fire"), su("rogue", "Rogue-Combat"), su("lock", "Warlock-Destruction"),
        su("hunter", "Hunter-BeastMastery"), su("sham", "Shaman-Enhancement"), su("feral", "Druid-Feral"),
        su("spriest", "Priest-Shadow"), su("frost", "Mage-Frost"), su("arms", "Warrior-Arms"),
        su("gone", "Rogue-Combat", { status: "absence" }),
    ];
}

/** The stored lineup as the editor sends it back. */
function placementOf(setup) {
    return {
        version: setup.version,
        groups: setup.groups.map((g) => ({ index: g.index, slots: g.slots.map((s) => ({ userId: s.userId, spec: s.spec, role: s.role, locked: s.locked })) })),
        bench: setup.bench.map((b) => ({ userId: b.userId, locked: b.locked })),
    };
}

const where = (setup, userId) => {
    const g = setup.groups.find((x) => x.slots.some((s) => s.userId === userId));
    return g ? g.index : (setup.bench.some((b) => b.userId === userId) ? "bench" : null);
};

beforeEach(seed);

describe("proposeEventSetup", () => {
    it("stores a draft with groups, bench, checks and version 1", () => {
        const { setup } = editor.proposeEventSetup(ID, {}, { userId: "orga", now: 5 });
        expect(setup).toMatchObject({ status: "draft", version: 1, origin: "proposal", updatedBy: "orga", approved: null, changedSinceApproval: false });
        expect(setup.groups.flatMap((g) => g.slots)).toHaveLength(10);
        expect(setup.bench.length).toBe(2);
        expect(setup.checks.roles.healer).toMatchObject({ count: 2, ok: true });
        expect(setup.events).toBeUndefined();
    });

    it("keeps locked places — in their group and on the bench — when proposing again", () => {
        const first = editor.proposeEventSetup(ID).setup;
        const moved = placementOf(first);
        // lock the frost mage into group 2 and the tank onto the bench
        for (const g of moved.groups) g.slots = g.slots.filter((s) => !["frost", "tank"].includes(s.userId));
        moved.bench = moved.bench.filter((b) => !["frost", "tank"].includes(b.userId));
        const g2 = moved.groups.find((g) => g.index === 2);
        if (g2.slots.length >= 5) moved.bench.push({ userId: g2.slots.pop().userId });
        g2.slots.push({ userId: "frost", spec: "Mage-Frost", role: "ranged", locked: true });
        moved.bench.push({ userId: "tank", locked: true });
        const saved = editor.saveEventSetup(ID, moved);
        expect(saved.error).toBeUndefined();

        const again = editor.proposeEventSetup(ID).setup;
        expect(where(again, "frost")).toBe(2);
        expect(again.groups[1].slots.find((s) => s.userId === "frost").locked).toBe(true);
        expect(where(again, "tank")).toBe("bench");
        expect(again.bench.find((b) => b.userId === "tank").locked).toBe(true);
    });

    it("remembers the weights and switches it was run with", () => {
        const { setup } = editor.proposeEventSetup(ID, { weights: { fairness: 999, bogus: 3, gear: "12" }, fairness: true });
        expect(setup.options).toEqual({ weights: { fairness: 500, gear: 12 }, fairness: true, wishes: null, avoid: null });
        const again = editor.proposeEventSetup(ID, {}).setup;
        expect(again.options).toEqual(setup.options);
    });

    it("keeps „nicht zusammen“ off (undecided) until the orga says yes, then remembers it", () => {
        const first = editor.proposeEventSetup(ID, {}).setup;
        expect(first.options.avoid).toBeNull();
        expect(first.checks.avoid.on).toBe(false);
        const { setup } = editor.proposeEventSetup(ID, { avoid: true });
        expect(setup.options.avoid).toBe(true);
        expect(setup.checks.avoid).toEqual({ on: true, together: 0, total: 0 });
        expect(editor.proposeEventSetup(ID, {}).setup.options.avoid).toBe(true);
        expect(editor.proposeEventSetup(ID, { avoid: false }).setup.options.avoid).toBe(false);
    });

    it("refuses a Raid-Helper id and an unknown event", () => {
        expect(editor.proposeEventSetup("12345")).toMatchObject({ code: "raidhelper" });
        expect(editor.proposeEventSetup("eh-nope")).toMatchObject({ code: "not_found" });
    });
});

describe("avoidPairCount", () => {
    const P = (userId, avoid, avoidEnabled = true) => ({ userId, avoid, avoidEnabled });
    it("counts each pair among the signups once, only with the list switched on", () => {
        const signups = [su("a", "Mage-Fire"), su("b", "Mage-Frost"), su("c", "Rogue-Combat"), su("d", "Rogue-Combat", { status: "absence" })];
        const list = [P("a", ["b", "d", "x"]), P("b", ["a"]), P("c", ["a"], false)];
        // a↔b once (both ways), d is absent, x not signed up, c has it off
        expect(editor.avoidPairCount(signups, list)).toBe(1);
        expect(editor.avoidPairCount([], list)).toBe(0);
    });
});

describe("saveEventSetup", () => {
    it("stores the orga's lineup as a manual draft with fresh checks", () => {
        const first = editor.proposeEventSetup(ID).setup;
        const p = placementOf(first);
        const healerSlot = p.groups.flatMap((g) => g.slots).find((s) => s.userId === "heal1");
        for (const g of p.groups) g.slots = g.slots.filter((s) => s !== healerSlot);
        p.bench.push({ userId: "heal1" });
        const { setup, error } = editor.saveEventSetup(ID, p, { userId: "orga2" });
        expect(error).toBeUndefined();
        expect(setup).toMatchObject({ origin: "manual", version: 2, status: "draft", updatedBy: "orga2" });
        expect(where(setup, "heal1")).toBe("bench");
        expect(setup.checks.roles.healer).toMatchObject({ count: 1, ok: false });
    });

    it("refuses what breaks a hard rule and leaves the stored setup alone", () => {
        const first = editor.proposeEventSetup(ID).setup;
        const p = placementOf(first);
        p.groups[0].slots.push({ userId: p.groups[1].slots[0].userId });
        const out = editor.saveEventSetup(ID, p);
        expect(out).toMatchObject({ code: "invalid" });
        expect(out.error).toMatch(/zweimal|mehr als 5/);
        expect(mockEvents.get(ID).setup.version).toBe(1);
        expect(editor.saveEventSetup(ID, { version: 1, groups: [{ index: 1, slots: [{ userId: "gone" }] }] }).error).toMatch(/abgemeldet/);
    });

    it("keeps the order the orga gave a group — and a reorder is a change of the lineup", () => {
        const { setup } = editor.proposeEventSetup(ID);
        editor.approveEventSetup(ID, { version: setup.version });
        const p = placementOf(mockEvents.get(ID).setup);
        const group = p.groups.find((g) => g.slots.length >= 3);
        const reversed = group.slots.map((s) => s.userId).reverse();
        group.slots.reverse();
        const saved = editor.saveEventSetup(ID, p).setup;
        expect(saved.groups.find((g) => g.index === group.index).slots.map((s) => s.userId)).toEqual(reversed);
        expect(saved).toMatchObject({ status: "draft", changedSinceApproval: true, version: 2 });
    });

    it("keeps the place a raider was put on — a group of two on places 1 and 5 — through save, view and approval", () => {
        const first = editor.proposeEventSetup(ID).setup;
        const p = placementOf(first);
        const group = p.groups.find((g) => g.slots.length >= 2);
        group.slots = group.slots.slice(0, 2);
        group.slots[0].pos = 1;
        group.slots[1].pos = 5;
        const saved = editor.saveEventSetup(ID, p).setup;
        const stored = (setup) => setup.groups.find((g) => g.index === group.index).slots.map((s) => s.pos);
        expect(stored(saved)).toEqual([1, 5]);
        expect(stored(editor.editorView(mockEvents.get(ID), { canWrite: true, signups: mockSignups }).setup)).toEqual([1, 5]);
        editor.approveEventSetup(ID, { version: saved.version });
        expect(stored(mockEvents.get(ID).setup.approved)).toEqual([1, 5]);
    });

    it("shows a proposal — which has no places yet — on places 1, 2, 3 …", () => {
        editor.proposeEventSetup(ID);
        const view = editor.editorView(mockEvents.get(ID), { canWrite: true, signups: mockSignups });
        for (const g of view.setup.groups) expect(g.slots.map((s) => s.pos)).toEqual(g.slots.map((_, i) => i + 1));
    });

    it("counts a raider put in as another spec of their class — a retribution paladin as the third tank", () => {
        mockSignups = [...mockSignups, su("palret", "Paladin-Retribution")];
        const { setup: first } = editor.proposeEventSetup(ID);
        const asRet = editor.saveEventSetup(ID, { version: first.version, groups: [{ index: 1, slots: [{ userId: "palret", spec: "Paladin-Retribution", role: "melee", locked: true }] }], bench: [] }).setup;
        expect(asRet.checks.roles.tank.count).toBe(0);
        const asProt = editor.saveEventSetup(ID, { version: asRet.version, groups: [{ index: 1, slots: [{ userId: "palret", spec: "Paladin-Protection", role: "tank", locked: true }] }], bench: [] }).setup;
        expect(asProt.groups[0].slots[0]).toMatchObject({ userId: "palret", spec: "Paladin-Protection", role: "tank", locked: true, main: false });
        expect(asProt.checks.roles.tank.count).toBe(1);
        expect(asProt.groups[0].slots[0].reasons).toContain("Zweitspec als Tank");
    });

    it("sends every raider the specs of their class, so the panel can offer them", () => {
        editor.proposeEventSetup(ID);
        const view = editor.editorView(mockEvents.get(ID), { canWrite: true, signups: mockSignups });
        const mage = view.setup.groups.flatMap((g) => g.slots).find((s) => s.spec.startsWith("Mage-"));
        expect(mage.classSpecs.map((x) => x.key)).toEqual(expect.arrayContaining(["Mage-Fire", "Mage-Frost", "Mage-Arcane"]));
        expect(mage.classSpecs[0]).toEqual({ key: expect.any(String), label: expect.any(String), icon: expect.any(String), role: "ranged" });
    });

    it("refuses a lineup built on an outdated version", () => {
        editor.proposeEventSetup(ID);
        editor.proposeEventSetup(ID, { weights: { mainSpec: 0, status: 0 } });
        const out = editor.saveEventSetup(ID, { version: 0, groups: [], bench: [] });
        expect(out).toMatchObject({ code: "conflict" });
    });
});

describe("approval", () => {
    it("approves the shown version and freezes a raider-facing snapshot", () => {
        const { setup } = editor.proposeEventSetup(ID);
        const out = editor.approveEventSetup(ID, { version: setup.version, userId: "lead", now: 99 });
        expect(out.setup).toMatchObject({ status: "approved", approvedBy: "lead", approvedAt: 99, approvedVersion: 1, changedSinceApproval: false });
        expect(out.setup.approved.groups.flatMap((g) => g.slots)).toHaveLength(10);
        // no reasons, no locks in what raiders get to see
        expect(JSON.stringify(out.setup.approved)).not.toMatch(/reasons|locked/);
        expect(editor.approveEventSetup(ID, { version: 1 })).toMatchObject({ already: true });
    });

    it("refuses an outdated version and an empty setup", () => {
        expect(editor.approveEventSetup(ID, { version: 1 })).toMatchObject({ code: "no_setup" });
        editor.proposeEventSetup(ID);
        expect(editor.approveEventSetup(ID, { version: 7 })).toMatchObject({ code: "conflict" });
    });

    it("turns a changed lineup back into a draft — raiders keep the approved one", () => {
        const { setup } = editor.proposeEventSetup(ID);
        editor.approveEventSetup(ID, { version: setup.version, userId: "lead", now: 50 });
        const approvedBefore = mockEvents.get(ID).setup.approved;
        const p = placementOf(mockEvents.get(ID).setup);
        const benched = p.bench[0].userId;
        const out = p.groups.find((g) => g.slots.some((s) => s.role !== "tank" && s.role !== "healer"));
        const dropped = out.slots.find((s) => s.role !== "tank" && s.role !== "healer");
        out.slots = out.slots.filter((s) => s !== dropped);
        p.bench = p.bench.filter((b) => b.userId !== benched).concat({ userId: dropped.userId });
        const signup = mockSignups.find((s) => s.userId === benched);
        out.slots.push({ userId: benched, spec: signup.spec });

        const saved = editor.saveEventSetup(ID, p).setup;
        expect(saved).toMatchObject({ status: "draft", changedSinceApproval: true, version: 2 });
        expect(saved.approved).toEqual(approvedBefore);
        const event = mockEvents.get(ID);
        expect(editor.approvedPlacementFor(event, benched)).toMatchObject({ bench: true });
        expect(editor.setupSummary(event)).toMatchObject({ status: "draft", changedSinceApproval: true });
    });

    it("keeps the approval when only a lock changes", () => {
        const { setup } = editor.proposeEventSetup(ID);
        editor.approveEventSetup(ID, { version: setup.version });
        const p = placementOf(mockEvents.get(ID).setup);
        p.groups[0].slots[0].locked = true;
        const saved = editor.saveEventSetup(ID, p).setup;
        expect(saved).toMatchObject({ status: "approved", version: 1, changedSinceApproval: false });
        expect(saved.groups[0].slots[0].locked).toBe(true);
    });
});

describe("what raiders see", () => {
    it("shows nothing of a draft anywhere", () => {
        editor.proposeEventSetup(ID);
        const event = mockEvents.get(ID);
        const someone = event.setup.groups[0].slots[0].userId;
        expect(approvedSetupOf(event)).toBeNull();
        expect(editor.approvedPlacementFor(event, someone)).toBeNull();
        expect(editor.raidHelperSlots(event)).toEqual([]);
        const reader = editor.editorView(event, { canWrite: false });
        expect(reader).not.toHaveProperty("setup");
        expect(reader.approved).toBeNull();
        expect(JSON.stringify(reader)).not.toContain(someone);
        const msg = buildEventMessage(event, []);
        expect(JSON.stringify(msg.embeds[0])).not.toContain("Setup");
    });

    it("shows the approved lineup — in the event message, as a placement and as raidplan slots", () => {
        const { setup } = editor.proposeEventSetup(ID);
        editor.approveEventSetup(ID, { version: setup.version });
        const event = mockEvents.get(ID);
        const first = event.setup.approved.groups[0].slots[0];
        expect(editor.approvedPlacementFor(event, first.userId)).toMatchObject({ group: 1, spec: first.spec });
        const slots = editor.raidHelperSlots(event);
        expect(slots).toHaveLength(10);
        expect(slots[0]).toMatchObject({ id: first.userId, name: first.character, groupNumber: 1, slotNumber: 1 });
        expect(slots.every((s) => s.specName)).toBe(true);
        // The event message only links the approved setup (#352) — the groups
        // themselves are the dedicated setup message's job (setupMessage.js).
        expect(msg(event)).toContain("[Setup]");
        const reader = editor.editorView(event, { canWrite: false });
        expect(reader.approved.groups[0].slots[0]).toMatchObject({ classColor: expect.stringMatching(/^#/), specLabel: expect.any(String) });
    });

    function msg(event) {
        const fields = buildEventMessage(event, []).embeds[0].fields;
        return fields[fields.length - 1].value;
    }

    it("gives the orga the draft with names, defaults and the key flag", () => {
        editor.proposeEventSetup(ID);
        const event = mockEvents.get(ID);
        const uid = event.setup.groups[0].slots[0].userId;
        const view = editor.editorView(event, { canWrite: true, names: { [uid]: "discordname" }, signups: mockSignups, hasApiKey: true });
        expect(view.setup.groups[0].slots[0]).toMatchObject({ name: "discordname", specIcon: expect.any(String) });
        expect(view).toMatchObject({ canWrite: true, groupCount: 2, signupCount: 12, absent: 1, hasApiKey: true });
        expect(view.defaults.weights.fairness).toBe(150);
    });
});

describe("editorView's bench pool (#354)", () => {
    it("adds a signup nobody placed yet to the draft's bench, by their first signed character", () => {
        const { setup } = editor.proposeEventSetup(ID);
        editor.approveEventSetup(ID, { version: setup.version });
        mockSignups = [...mockSignups, su("late1", "Priest-Holy")];
        const event = mockEvents.get(ID);
        const view = editor.editorView(event, { canWrite: true, signups: mockSignups });
        expect(view.setup.bench.filter((b) => b.userId === "late1")).toHaveLength(1);
        expect(view.setup.bench.find((b) => b.userId === "late1")).toMatchObject({
            character: "Late1", spec: "Priest-Holy", role: "healer", locked: false, classColor: expect.stringMatching(/^#/),
        });
        // never into what raiders see — the approved snapshot stays exactly what was approved
        expect(view.approved.bench.some((b) => b.userId === "late1")).toBe(false);
    });

    it("never adds someone already placed or signed off, and asking twice changes nothing", () => {
        editor.proposeEventSetup(ID);
        const event = mockEvents.get(ID);
        const first = editor.editorView(event, { canWrite: true, signups: mockSignups });
        const again = editor.editorView(event, { canWrite: true, signups: mockSignups });
        expect(again.setup.bench.map((b) => b.userId).sort()).toEqual(first.setup.bench.map((b) => b.userId).sort());
        expect(first.setup.bench.some((b) => b.userId === "gone")).toBe(false);
    });
});

describe("editorView's buff info and attendance", () => {
    const slot = (userId, spec, role) => ({ userId, character: userId, spec, role, main: true, status: "signed", locked: false, reasons: [] });
    const draft = () => ({
        ...mockEvents.get(ID),
        setup: {
            status: "draft", version: 1, checks: {}, warnings: [],
            groups: [
                { index: 1, slots: [slot("sham", "Shaman-Enhancement", "melee"), slot("arms", "Warrior-Arms", "melee")] },
                { index: 2, slots: [slot("rogue", "Rogue-Combat", "melee"), slot("fury", "Warrior-Fury", "melee")] },
            ],
            bench: [slot("priest", "Priest-Holy", "healer")],
        },
    });

    it("says what a raider brings to their own group (party buffs with how many profit) and to the raid", () => {
        const view = editor.editorView(draft(), { canWrite: true, signups: [] });
        const sham = view.setup.groups[0].slots[0];
        const party = sham.brings.filter((b) => b.scope === "party");
        expect(party.length).toBeGreaterThan(0);
        expect(party.every((b) => b.count >= 1 && typeof b.icon === "string" && b.label)).toBe(true);
        // a priest brings a raid buff to everyone
        expect(view.setup.bench[0].brings.some((b) => b.scope === "raid")).toBe(true);
    });

    it("gives every raider the groups where they would help more — the drag glow — but never their own", () => {
        const view = editor.editorView(draft(), { canWrite: true, signups: [] });
        const sham = view.setup.groups[0].slots[0];
        // group 2 holds two melee that profit from the shaman's melee totems
        expect(sham.fit["2"]).toBeGreaterThanOrEqual(2);
        expect(sham.fit["1"]).toBeUndefined();
    });

    it("passes attendance through, and leaves it out when not asked", () => {
        const attendance = { sham: { pct: 90, attended: 9, total: 10, link: "manual", inferred: 0, missed: [] } };
        expect(editor.editorView(draft(), { canWrite: true, signups: [], attendance }).attendance).toEqual(attendance);
        expect(editor.editorView(draft(), { canWrite: true, signups: [] })).not.toHaveProperty("attendance");
        expect(editor.editorView(draft(), { canWrite: false })).not.toHaveProperty("setup");
    });
});

describe("addUnplacedSignups", () => {
    const table = {
        specs: new Map([["Priest-Holy", { classId: "Priest", label: "Heilig", icon: "spell_holy_guardianspirit" }]]),
        classes: new Map([["Priest", { color: "#ffffff", label: "Priester", icon: "" }]]),
    };

    it("decorates every unplaced signup and appends it to the bench", () => {
        const decorated = { groups: [{ index: 1, slots: [{ userId: "a" }] }], bench: [{ userId: "b" }] };
        const signups = [
            { userId: "a", character: "A", spec: "Priest-Holy", role: "healer" },
            { userId: "c", character: "C", spec: "Priest-Holy", role: "healer", status: "late" },
            { userId: "d", character: "D", spec: "Priest-Holy", role: "healer", status: "absence" },
        ];
        const out = editor._internal.addUnplacedSignups(decorated, signups, table, { c: "Zibbo" });
        expect(out.bench.map((b) => b.userId)).toEqual(["b", "c"]);
        expect(out.bench[1]).toMatchObject({
            character: "C", spec: "Priest-Holy", role: "healer", status: "late", locked: false, name: "Zibbo", classColor: "#ffffff",
        });
    });

    it("changes nothing without a lineup, or once the bench already has everyone", () => {
        expect(editor._internal.addUnplacedSignups(null, [], table, {})).toBeNull();
        const decorated = { groups: [], bench: [{ userId: "x" }] };
        expect(editor._internal.addUnplacedSignups(decorated, [{ userId: "x", spec: "Priest-Holy" }], table, {})).toBe(decorated);
    });
});
