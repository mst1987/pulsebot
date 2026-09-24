// A setup the orga changed by hand (#263): validatePlacement() refuses what
// breaks a hard rule, evaluateSetup() values the rest without moving anybody.
const { validatePlacement, placeSlots } = require("../../../src/utils/setup/manual");
const { buildSetupProposal, evaluateSetup } = require("../../../src/utils/setup/proposal");
const { su, roster } = require("./fixtures");

const event = { id: "e", title: "Kara", size: 10, versionId: "tbc", composition: { tank: 1, healer: 2 } };

function signups() {
    return [
        su("tank", "Warrior-Protection"),
        su("heal1", "Priest-Holy"),
        su("heal2", "Paladin-Holy"),
        su("mage", "Mage-Fire"),
        su("rogue", "Rogue-Combat"),
        su("lock", "Warlock-Destruction"),
        su("hunter", "Hunter-BeastMastery"),
        su("sham", "Shaman-Enhancement"),
        su("feral", "Druid-Feral"),
        su("spriest", "Priest-Shadow"),
        su("extra", "Mage-Frost"),
        su("gone", "Rogue-Combat", { status: "absence" }),
    ];
}

const slot = (userId, extra = {}) => ({ userId, ...extra });

describe("validatePlacement", () => {
    const ctx = { event, signups: signups() };

    it("accepts a valid lineup, fills the signed spec and sorts the groups", () => {
        const out = validatePlacement({
            groups: [{ index: 2, slots: [slot("mage")] }, { index: 1, slots: [slot("tank", { locked: true }), slot("heal1")] }],
            bench: [{ userId: "extra", locked: true }],
        }, ctx);
        expect(out.error).toBeUndefined();
        expect(out.value.groups.map((g) => g.index)).toEqual([1, 2]);
        expect(out.value.groups[0].slots[0]).toEqual({ userId: "tank", character: "Tank", spec: "Warrior-Protection", role: "tank", locked: true, pos: 1 });
        expect(out.value.bench).toEqual([{ userId: "extra", locked: true }]);
    });

    it("keeps the place (1–5) a raider was put on — a group of two may stand on 1 and 5 — and sorts by it", () => {
        const out = validatePlacement({
            groups: [{ index: 1, slots: [slot("sham", { pos: 5 }), slot("tank", { pos: 1 })] }],
            bench: [],
        }, ctx);
        expect(out.error).toBeUndefined();
        expect(out.value.groups[0].slots.map((s) => `${s.userId}@${s.pos}`)).toEqual(["tank@1", "sham@5"]);
    });

    it("fills places that are missing, taken twice or out of range with the lowest free ones", () => {
        const out = validatePlacement({
            groups: [{ index: 1, slots: [slot("tank"), slot("heal1", { pos: 1 }), slot("mage", { pos: 7 }), slot("rogue", { pos: 4 })] }],
            bench: [],
        }, ctx);
        // heal1 keeps 1, rogue 4; tank and mage take the lowest free ones in their order
        expect(out.value.groups[0].slots.map((s) => `${s.userId}@${s.pos}`)).toEqual(["heal1@1", "tank@2", "mage@3", "rogue@4"]);
    });

    it("gives a lineup without places (an old draft, a proposal) the places 1, 2, 3 …", () => {
        expect(placeSlots([{ userId: "a" }, { userId: "b" }, { userId: "c" }]).map((s) => s.pos)).toEqual([1, 2, 3]);
        expect(placeSlots(undefined)).toEqual([]);
    });

    it.each([
        ["a raider twice", { groups: [{ index: 1, slots: [slot("mage")] }, { index: 2, slots: [slot("mage")] }] }, /zweimal/],
        ["a raider in a group and on the bench", { groups: [{ index: 1, slots: [slot("mage")] }], bench: [{ userId: "mage" }] }, /zweimal/],
        ["six in a group", { groups: [{ index: 1, slots: ["tank", "heal1", "heal2", "mage", "rogue", "lock"].map((u) => slot(u)) }] }, /mehr als 5/],
        ["a group the raid does not have", { groups: [{ index: 3, slots: [slot("mage")] }] }, /Gruppe 3/],
        ["a raider who signed off", { groups: [{ index: 1, slots: [slot("gone")] }] }, /abgemeldet/],
        ["somebody without a signup", { groups: [{ index: 1, slots: [slot("stranger")] }] }, /nicht angemeldet/],
        ["a spec of another class", { groups: [{ index: 1, slots: [slot("mage", { spec: "Priest-Holy" })] }] }, /Mage/],
        ["an unknown spec", { groups: [{ index: 1, slots: [slot("mage", { spec: "Mage-Nope" })] }] }, /unbekannte Spezialisierung/],
    ])("refuses %s", (_, raw, message) => {
        const out = validatePlacement(raw, ctx);
        expect(out.value).toBeUndefined();
        expect(out.error).toMatch(message);
    });

    it("refuses more raiders than the raid holds", () => {
        const all = roster(12, "x");
        const small = { ...event, size: 5 };
        const out = validatePlacement({
            groups: [{ index: 1, slots: all.slice(0, 5).map((s) => slot(s.userId)) }, { index: 2, slots: all.slice(5, 6).map((s) => slot(s.userId)) }],
        }, { event: small, signups: all });
        // a 5-man has one group, so the second one is refused first
        expect(out.error).toMatch(/Gruppe 2/);
    });

    it("keeps an off-role only where the spec can play it", () => {
        const withFeral = validatePlacement({ groups: [{ index: 1, slots: [slot("feral", { spec: "Druid-Guardian", role: "tank" }), slot("mage", { role: "tank" })] }] }, ctx);
        expect(withFeral.value.groups[0].slots.map((s) => s.role)).toEqual(["tank", "ranged"]);
    });
});

describe("evaluateSetup", () => {
    const input = () => ({ versionId: "tbc", events: [event], signups: signups() });

    it("keeps everybody exactly where the orga put them and recomputes the checks", () => {
        const placement = {
            groups: [
                { index: 1, slots: [{ userId: "tank", spec: "Warrior-Protection", role: "tank" }, { userId: "mage", spec: "Mage-Fire", role: "ranged", locked: true }] },
                { index: 2, slots: [{ userId: "heal1", spec: "Priest-Holy", role: "healer" }] },
            ],
            bench: [],
        };
        const out = evaluateSetup(input(), placement);
        expect(out.groups.map((g) => g.slots.map((s) => s.userId))).toEqual([["tank", "mage"], ["heal1"]]);
        expect(out.checks.roles.healer).toMatchObject({ count: 1, min: 2, ok: false });
        expect(out.checks.size).toMatchObject({ count: 3, size: 10, ok: false });
        expect(out.checks.ok).toBe(false);
        // the lock is the orga's, the rest is not
        expect(out.groups[0].slots.find((s) => s.userId === "mage")).toMatchObject({ locked: true, reasons: expect.arrayContaining(["Von der Orga fixiert"]) });
        expect(out.groups[0].slots.find((s) => s.userId === "tank").locked).toBe(false);
        // everybody signed up and not placed is on the bench
        expect(out.bench.map((b) => b.userId)).toEqual(expect.arrayContaining(["heal2", "rogue", "extra"]));
        expect(out.bench.map((b) => b.userId)).not.toContain("gone");
    });

    it("values the lineup a proposal built like the proposal did", () => {
        const proposal = buildSetupProposal(input());
        const placement = {
            groups: proposal.groups.map((g) => ({ index: g.index, slots: g.slots.map((s) => ({ userId: s.userId, spec: s.spec, role: s.role })) })),
            bench: [],
        };
        const out = evaluateSetup(input(), placement);
        expect(out.checks).toEqual(proposal.checks);
        expect(out.score.total).toBeCloseTo(proposal.score.total, 4);
    });

    it("keeps a raider the orga locked onto the bench there", () => {
        const out = evaluateSetup(input(), { groups: [{ index: 1, slots: [{ userId: "tank", spec: "Warrior-Protection" }] }], bench: [{ userId: "extra", locked: true }] });
        expect(out.bench.find((b) => b.userId === "extra")).toMatchObject({ locked: true, reasons: ["Von der Orga auf die Bank gesetzt"] });
    });
});
