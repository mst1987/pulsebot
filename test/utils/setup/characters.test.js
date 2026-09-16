// Several own characters per signup (#293): the proposal places a raider with
// exactly ONE of them — the first choice when it fits, an alternate when the
// raid needs that role — and says why.
const { buildSetupProposal, evaluateSetup } = require("../../../src/utils/setup/proposal");
const { validatePlacement } = require("../../../src/utils/setup/manual");
const { su } = require("./fixtures");

const event = (over = {}) => ({ id: "ev", title: "Kara", size: 10, composition: { tank: 2, healer: 3, melee: 0, ranged: 0 }, ...over });

/** Zibbo (holy priest) first, Zibbowar (prot warrior) as "kann auch mit". */
const zibbo = (extra = {}) => su("zibbo", "Priest-Holy", {
    character: "Zibbo",
    characters: [{ character: "Zibbo", spec: "Priest-Holy" }, { character: "Zibbowar", spec: "Warrior-Protection" }],
    ...extra,
});

const placed = (out) => out.groups.flatMap((g) => g.slots);
const everyone = (out) => [...placed(out), ...out.bench];

describe("setup proposal with several characters per raider (#293)", () => {
    it("takes the first choice when it fits, and says it", () => {
        const signups = [zibbo(), su("t1", "Warrior-Protection"), su("t2", "Paladin-Protection"), su("h1", "Paladin-Holy"), su("d1", "Mage-Fire")];
        const out = buildSetupProposal({ events: [event()], signups });
        const z = placed(out).filter((s) => s.userId === "zibbo");
        expect(z).toHaveLength(1);
        expect(z[0]).toMatchObject({ character: "Zibbo", spec: "Priest-Holy", role: "healer" });
        expect(z[0].reasons[0]).toBe("1. Wahl: Zibbo");
    });

    it("places the alternate when the raid lacks its role — one place per person, with the reason", () => {
        const signups = [zibbo(), su("t1", "Warrior-Protection"), su("h1", "Paladin-Holy"), su("h2", "Druid-Restoration"), su("h3", "Shaman-Restoration")];
        const out = buildSetupProposal({ events: [event()], signups });
        const z = everyone(out).filter((s) => s.userId === "zibbo");
        expect(z).toHaveLength(1);
        expect(z[0]).toMatchObject({ character: "Zibbowar", spec: "Warrior-Protection", role: "tank" });
        expect(z[0].reasons[0]).toBe("Mit Zibbowar als Tank statt Zibbo (Heiler voll (3/3))");
        expect(out.checks.roles.tank.count).toBe(2);
    });

    it("names a missing role as the reason when the first choice would still have fit", () => {
        // first choice a mage: damage has room, but a tank is missing
        const signups = [
            su("zibbo", "Mage-Fire", { character: "Zibbo", characters: [{ character: "Zibbo", spec: "Mage-Fire" }, { character: "Zibbowar", spec: "Warrior-Protection" }] }),
            su("t1", "Warrior-Protection"), su("h1", "Paladin-Holy"),
        ];
        const out = buildSetupProposal({ events: [event({ composition: { tank: 2, healer: 1 } })], signups });
        const z = placed(out).find((s) => s.userId === "zibbo");
        expect(z.character).toBe("Zibbowar");
        expect(z.reasons[0]).toBe("Mit Zibbowar als Tank statt Zibbo (Tanks fehlten)");
    });

    it("costs the alternate `preferredCharacter`, so a weight of 0 makes both equal", () => {
        const signups = [zibbo(), su("t1", "Warrior-Protection"), su("t2", "Paladin-Protection"), su("h1", "Paladin-Holy")];
        const out = buildSetupProposal({ events: [event()], signups });
        expect(out.weights.preferredCharacter).toBe(100);
        expect(out.score.parts.preferredCharacter).toBe(0);
    });

    it("keeps a raider with one character exactly as before (no choice reason)", () => {
        const out = buildSetupProposal({ events: [event()], signups: [su("t1", "Warrior-Protection"), su("h1", "Paladin-Holy")] });
        for (const s of placed(out)) expect(s.reasons.join(" ")).not.toMatch(/Wahl|statt/);
    });

    it("lets the orga place the alternate by hand and keeps who plays", () => {
        const signups = [zibbo({ eventId: "ev" }), su("h1", "Paladin-Holy", { eventId: "ev" })];
        const placement = validatePlacement({
            groups: [{ index: 1, slots: [{ userId: "zibbo", spec: "Warrior-Protection", role: "tank" }, { userId: "h1", spec: "Paladin-Holy" }] }],
            bench: [],
        }, { event: event(), signups });
        expect(placement.error).toBeUndefined();
        expect(placement.value.groups[0].slots[0]).toMatchObject({ userId: "zibbo", character: "Zibbowar", spec: "Warrior-Protection" });
        // a class none of the named characters has is refused
        expect(validatePlacement({ groups: [{ index: 1, slots: [{ userId: "zibbo", spec: "Mage-Fire" }] }], bench: [] }, { event: event(), signups }).error)
            .toBe("Zibbo ist als Priest/Warrior angemeldet, nicht als Mage.");
        const valued = evaluateSetup({ events: [event()], signups }, placement.value);
        expect(placed(valued).find((s) => s.userId === "zibbo")).toMatchObject({ character: "Zibbowar", role: "tank" });
    });
});
