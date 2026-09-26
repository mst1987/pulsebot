// A Raid-Helper event's raidplan / signups as the line-up the raid plan reads (src/web/raidhelperRoster.js), fed through the raid plan's
// own rosterFrom(). The input shapes are the ones the code base already reads from Raid-Helper (utils/setup/setupView.js,
// raidhelperHistoryImport.js, raidEventScan.js): raidplan slots { id, name, className, specName, groupNumber }, signups
// { userId, name, className, specName, status }. Tank specs come as className "Tank".
const { raidhelperLineup, characterFor } = require("../../src/web/raidhelperRoster");
const { rosterFrom } = require("../../src/web/raidplan");

const RH = [
    // [name, className, specName] — 25 raiders as Raid-Helper names them
    ["Tankwart", "Tank", "Protection"], ["Bollwerk", "Tank", "Protection1"], ["Baerchen", "Tank", "Guardian"],
    ["Heilbert", "Priest", "HolyPriest"], ["Disziplin", "Priest", "Discipline"], ["Lichtbringer", "Paladin", "Holy1"], ["Segenreich", "Paladin", "Holy1"],
    ["Flutwelle", "Shaman", "Restoration1"], ["Quellgeist", "Shaman", "Restoration1"], ["Baumbart", "Druid", "Restoration"],
    ["Klingentanz", "Warrior", "Arms"], ["Berserker", "Warrior", "Fury"], ["Schleich", "Rogue", "Combat"], ["Meuchler", "Rogue", "Assassination"],
    ["Schatten", "Rogue", "Sublety"], ["Richter", "Paladin", "Retribution"], ["Donnerfaust", "Shaman", "Enhancement"], ["Katzenauge", "Druid", "Feral"],
    ["Feuerfritz", "Mage", "Fire"], ["Arkanix", "Mage", "Arcane"], ["Zerstoerer", "Warlock", "Destro"], ["Leidbringer", "Warlock", "Affliction"],
    ["Pfeilchen", "Hunter", "Beastmastery"], ["Scharfschuss", "Hunter", "Marksmanship"], ["Dunkelpriester", "Priest", "Shadow"],
];
let n0 = 0;
const slot0 = (className) => { n0 += 1; return { id: `dk${n0}`, name: `Frosty${n0}`, className, specName: "Frost", groupNumber: 1 }; };
const slots = RH.map(([name, className, specName], i) => ({ id: String(201 + i), name, className, specName, groupNumber: Math.floor(i / 5) + 1 }));

describe("a Raid-Helper raidplan as the raid plan's line-up", () => {
    it("25 raiders in five groups, every TBC spec mapped, roles from the spec (tanks from className \"Tank\")", () => {
        const lineup = raidhelperLineup({ setupSlots: slots });
        expect(lineup.source).toBe("raidplan");
        expect(lineup.hasGroups).toBe(true);
        expect(lineup.unknown).toEqual([]);
        expect(lineup.groups.map((g) => [g.index, g.slots.length])).toEqual([[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]]);
        const roster = rosterFrom(lineup, "tbc");
        expect(roster).toHaveLength(25);
        const count = (r) => roster.filter((p) => p.role === r).length;
        expect({ tank: count("tank"), healer: count("healer"), melee: count("melee"), ranged: count("ranged") }).toEqual({ tank: 3, healer: 7, melee: 8, ranged: 7 });
        expect(roster.find((p) => p.character === "Bollwerk")).toMatchObject({ userId: "202", classId: "Paladin", spec: "Paladin-Protection", role: "tank", group: 1 });
        expect(roster.find((p) => p.character === "Zerstoerer")).toMatchObject({ classId: "Warlock", spec: "Warlock-Destruction", role: "ranged", group: 5 });
    });

    it("gaps: an empty slot is skipped, an unknown spec keeps its place without a role guess, a missing groupNumber counts by position, a doubled raider once", () => {
        const odd = [
            { id: "1", name: "Tanky", className: "Tank", specName: "Protection", groupNumber: 2 },
            { id: "", name: "", className: "", specName: "" },
            { id: "2", name: "Deathy", className: "DK", specName: "Unholy_DPS" },
            { id: "1", name: "Tanky", className: "Tank", specName: "Protection", groupNumber: 2 },
        ];
        const lineup = raidhelperLineup({ setupSlots: odd });
        expect(lineup.unknown).toEqual(["Unholy_DPS"]);
        // one slot without a group number: the groups are not Raid-Helper's
        expect(lineup.hasGroups).toBe(false);
        expect(lineup.groups).toEqual([
            { index: 1, slots: [{ userId: "2", character: "Deathy", spec: "", classId: "", role: "", rhName: "Deathy", nameFromRh: true }] },
            { index: 2, slots: [{ userId: "1", character: "Tanky", spec: "Warrior-Protection", classId: "Warrior", role: "", rhName: "Tanky", nameFromRh: true }] },
        ]);
        const roster = rosterFrom(lineup, "tbc");
        // never guessed: no class, the generic role
        expect(roster.find((p) => p.userId === "2")).toMatchObject({ role: "dps", classId: "", nameFromRh: true, rhName: "Deathy" });
    });

    it("a death knight's \"Frost\" is no mage: unknown, never guessed", () => {
        const lineup = raidhelperLineup({ setupSlots: [slot0("DeathKnight"), slot0("Death Knight"), slot0("DK"), slot0("Mage")] });
        expect(lineup.groups[0].slots.map((s) => s.spec)).toEqual(["", "", "", "Mage-Frost"]);
        expect(lineup.unknown).toEqual(["Frost", "Frost", "Frost"]);
    });

    it("without any group number the groups are blocks of five in order (hasGroups false)", () => {
        const lineup = raidhelperLineup({ setupSlots: slots.map((s) => ({ id: s.id, name: s.name, className: s.className, specName: s.specName })) });
        expect(lineup.hasGroups).toBe(false);
        expect(lineup.groups.map((g) => g.slots.length)).toEqual([5, 5, 5, 5, 5]);
    });
});

describe("without a raidplan: the signups", () => {
    it("the signed-up raiders in their order in blocks of five; bench apart, absence / tentative / late not placed", () => {
        const signUps = [
            ...slots.slice(0, 7).map((s) => ({ userId: s.id, name: s.name, className: s.className, specName: s.specName, status: "primary" })),
            { userId: "301", name: "Reserve", className: "Bench", specName: "Bench", status: "primary" },
            { userId: "302", name: "Weg", className: "Absence", specName: "Absence", status: "primary" },
            { userId: "303", name: "Spaet", className: "Mage", specName: "Fire", status: "primary", roleName: "Late" },
        ];
        const lineup = raidhelperLineup({ signUps });
        expect(lineup.source).toBe("signups");
        expect(lineup.hasGroups).toBe(false);
        expect(lineup.groups.map((g) => g.slots.map((s) => s.character))).toEqual([["Tankwart", "Bollwerk", "Baerchen", "Heilbert", "Disziplin"], ["Lichtbringer", "Segenreich"]]);
        expect(lineup.bench.map((s) => s.character)).toEqual(["Reserve"]);
        expect(rosterFrom(lineup, "tbc").map((p) => p.userId)).toEqual(["201", "202", "203", "204", "205", "206", "207", "301"]);
        expect(raidhelperLineup({}).source).toBe("none");
    });

    it("a raider who reacted twice counts with his first reaction only (also when that one is an absence)", () => {
        const signUps = [
            { userId: "1", name: "Erst", className: "Mage", specName: "Fire", status: "primary" },
            { userId: "1", name: "Zweit", className: "Warrior", specName: "Fury", status: "primary" },
            { userId: "2", name: "Weg", className: "Absence", specName: "Absence", status: "primary" },
            { userId: "2", name: "Doch", className: "Mage", specName: "Frost", status: "primary" },
        ];
        const lineup = raidhelperLineup({ signUps });
        expect(lineup.groups[0].slots.map((s) => [s.userId, s.character, s.spec])).toEqual([["1", "Erst", "Mage-Fire"]]);
    });
});

describe("characterFor: which character a Raid-Helper name stands for", () => {
    const profile = {
        characters: [
            { name: "Alt-Magier", className: "Mage", main: false },
            { name: "Heilbär", className: "Druid", main: false },
            { name: "Hauptmagier", className: "Mage", main: true },
            { name: "Zweitdruide", className: "Druid", main: false },
        ],
    };

    it("a) the profile's character of Raid-Helper's class, the main first", () => {
        expect(characterFor({ name: "Nickname", classId: "Mage" }, profile)).toEqual({ character: "Hauptmagier", fromRh: false, rhName: "Nickname" });
    });

    it("a) several alts of that class and no main among them: the first", () => {
        expect(characterFor({ name: "Nickname", classId: "Druid" }, profile).character).toBe("Heilbär");
    });

    it("b) no character of that class: one named like the Raid-Helper name (case and realm ignored)", () => {
        expect(characterFor({ name: "heilbär-thunderstrike", classId: "Warrior" }, profile)).toEqual({ character: "Heilbär", fromRh: false, rhName: "heilbär-thunderstrike" });
    });

    it("c) nothing fits / no profile: the Raid-Helper name, marked", () => {
        expect(characterFor({ name: "Nickname", classId: "Warrior" }, profile)).toEqual({ character: "Nickname", fromRh: true, rhName: "Nickname" });
        expect(characterFor({ name: "Nickname", classId: "Mage" }, null)).toEqual({ character: "Nickname", fromRh: true, rhName: "Nickname" });
        // an unknown class (a death knight) never picks a character by class
        expect(characterFor({ name: "Nickname", classId: "" }, profile).fromRh).toBe(true);
    });

    it("d) in the line-up: class and spec stay Raid-Helper's, only the shown name changes; unmatched names are counted", () => {
        const profiles = { 11: { characters: [{ name: "Hauptmagier", className: "Mage", main: true }, { name: "Kriegerin", className: "Warrior", main: false }] } };
        const lineup = raidhelperLineup({
            setupSlots: [
                { id: "11", name: "Discordname", className: "Mage", specName: "Frost", groupNumber: 1 },
                { id: "12", name: "Fremder", className: "Rogue", specName: "Combat", groupNumber: 1 },
            ],
            profileOf: (uid) => profiles[uid] || null,
        });
        expect(lineup.groups[0].slots[0]).toMatchObject({ userId: "11", character: "Hauptmagier", rhName: "Discordname", nameFromRh: false, spec: "Mage-Frost", classId: "Mage" });
        expect(lineup.groups[0].slots[1]).toMatchObject({ character: "Fremder", nameFromRh: true });
        expect(lineup.unmatchedNames).toBe(1);
    });

    it("a profile lookup that throws counts as no profile", () => {
        const lineup = raidhelperLineup({ setupSlots: [{ id: "1", name: "X", className: "Mage", specName: "Fire", groupNumber: 1 }], profileOf: () => { throw new Error("boom"); } });
        expect(lineup.groups[0].slots[0]).toMatchObject({ character: "X", nameFromRh: true });
    });
});
