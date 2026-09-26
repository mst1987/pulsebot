// Characterisation tests for buildModel's fixed-slot phase (#431): the
// warnings and the fixed state it hands the search, pinned before the function
// was split into phases.

const { buildModel } = require("../../../src/utils/setup/model");
const { su } = require("./fixtures");

const event = (extra = {}) => ({ id: "e", title: "Kara", size: 10, composition: { tank: 1, healer: 2 }, ...extra });
const fixedOf = (model) => Object.fromEntries(model.cands.map((c) => [c.userId, c.fixed]));

describe("buildModel — fixed places", () => {
    it("warns about an unknown event and leaves the raider free", () => {
        const model = buildModel({
            events: [event(), event({ id: "f" })],
            signups: [su("a", "Mage-Fire", { eventId: "e" })],
            fixed: [{ userId: "a", eventId: "nope" }],
        });
        expect(model.warnings).toEqual(["Fixierung für a: unbekanntes Event."]);
        expect(fixedOf(model)).toEqual({ a: null });
    });

    it("takes the signup's option when the named character has none of its own", () => {
        const model = buildModel({
            events: [event()],
            signups: [su("a", "Mage-Fire")],
            fixed: [{ userId: "a", character: "Somebodyelse", group: 2 }],
        });
        expect(model.warnings).toEqual([]);
        expect(fixedOf(model)).toEqual({ a: { bench: false, option: 0, group: 1 } });
        expect(model.cands[0].options).toHaveLength(1);
    });

    it("adds an option for a fixed spec without a signup, and names the named character", () => {
        const model = buildModel({
            events: [event()],
            signups: [su("a", "Mage-Fire")],
            fixed: [{ userId: "a", spec: "Warlock-Destruction", character: "Twink", group: 1 }],
        });
        expect(model.warnings).toEqual([]);
        const o = model.cands[0].options[1];
        expect({ ...o, data: undefined }).toEqual({
            eventIdx: 0, status: "signed", character: "Twink", comment: "", spec: "Warlock-Destruction", role: "ranged",
            main: false, priority: 0, gear: "", fromFixed: true, idx: 1, roleIdx: 3, data: undefined, classId: "Warlock",
        });
        expect(fixedOf(model)).toEqual({ a: { bench: false, option: 1, group: 0 } });
    });

    it("warns when a fixed raider has neither a signup nor a spec", () => {
        const model = buildModel({ events: [event()], signups: [], fixed: [{ userId: "x", eventId: "e" }] });
        expect(model.warnings).toEqual(["Fixierung für x: keine Anmeldung und keine Spec angegeben."]);
        expect(fixedOf(model)).toEqual({ x: null });
    });

    it("refuses more fixed places than the raid holds", () => {
        const signups = ["a", "b", "c"].map((id) => su(id, "Mage-Fire"));
        const model = buildModel({
            events: [event({ size: 2 })],
            signups,
            fixed: signups.map((s) => ({ userId: s.userId })),
        });
        expect(model.warnings).toEqual(["Mehr fixierte Plätze als der Raid Kara fasst."]);
        expect(fixedOf(model)).toEqual({
            a: { bench: false, option: 0, group: -1 },
            b: { bench: false, option: 0, group: -1 },
            c: null,
        });
    });

    it("lets a sixth fixed raider of one group float, and ignores a group past the raid", () => {
        const signups = ["a", "b", "c", "d", "e", "f", "g"].map((id) => su(id, "Rogue-Combat"));
        const fixed = signups.slice(0, 6).map((s) => ({ userId: s.userId, group: 1 }));
        fixed.push({ userId: "g", group: 7 });
        const model = buildModel({ events: [event()], signups, fixed });
        expect(model.warnings).toEqual(["Gruppe 1 hat mehr als 5 fixierte Plätze."]);
        expect(model.cands.map((c) => c.fixed.group)).toEqual([0, 0, 0, 0, 0, -1, -1]);
    });

    it("widens a role's maximum for fixed raiders beyond it", () => {
        const signups = [su("t1", "Warrior-Protection"), su("t2", "Paladin-Protection"), su("m", "Mage-Fire")];
        const model = buildModel({
            events: [event({ composition: { tank: 1, healer: 0, ranged: { min: 0, max: 3 } } })],
            signups,
            fixed: [{ userId: "t1" }, { userId: "t2" }, { userId: "t2", bench: true }],
        });
        expect(model.events[0].hardMax).toEqual({ tank: 2, healer: 0, melee: Infinity, ranged: 3 });
    });

    it("keeps a bench fixation and warns about a required buff the version lacks", () => {
        const model = buildModel({
            events: [event({ requiredBuffs: ["kings", "notabuff"] })],
            signups: [su("a", "Mage-Fire")],
            fixed: [{ userId: "a", bench: true }],
        });
        expect(model.warnings).toEqual(["Pflicht-Buff „notabuff“ gibt es in TBC Anniversary nicht."]);
        expect(fixedOf(model)).toEqual({ a: { bench: true } });
    });
});
