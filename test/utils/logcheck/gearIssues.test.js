const {
    analyzePlayerGear, buildGearIssues, buildArmory, formatIssue,
    isEnchantBad, getBadEnchantName, metaGemActive, SLOT_NAMES,
} = require("../../../src/utils/logcheck/gearIssues");

// Slots that must be filled (mirrors REQUIRED_SLOTS in the source).
const REQUIRED_SLOTS = [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17];
// Slots that can carry an enchant.
const ENCHANTABLE = [0, 2, 4, 6, 7, 8, 9, 14, 15];

/**
 * Build a fully-equipped, issue-free player. Item ids (2000+slot) are deliberately
 * chosen to be absent from the SOCKETS / blacklist / no-enchant reference tables,
 * so a pristine set produces zero issues. Enchantable slots get a valid enchant id.
 */
function fullGear() {
    return REQUIRED_SLOTS.map((slot) => {
        const item = { id: String(2000 + slot), slot, name: `Item${slot}`, icon: `icon${slot}` };
        if (ENCHANTABLE.includes(slot)) item.permanentEnchant = "9999"; // valid, not blacklisted
        return item;
    });
}

function playerWith(gear, extra = {}) {
    return { name: "Tank", type: "Warrior", total: 5000, gear, ...extra };
}

describe("gearIssues metaGemActive", () => {
    test("blue-requirement metas", () => {
        expect(metaGemActive(25896, 0, 0, 3)).toBe(true);   // blue > 2
        expect(metaGemActive(25896, 0, 0, 2)).toBe(false);
        expect(metaGemActive(25898, 0, 0, 5)).toBe(true);   // blue > 4
    });

    test("relative-color metas", () => {
        expect(metaGemActive(25897, 2, 0, 1)).toBe(true);   // red > blue
        expect(metaGemActive(25897, 1, 0, 2)).toBe(false);
        expect(metaGemActive(25895, 2, 1, 0)).toBe(true);   // red > yellow
    });

    test("balanced-requirement meta needs >1 of each colour", () => {
        expect(metaGemActive(32409, 2, 2, 2)).toBe(true);
        expect(metaGemActive(32409, 1, 2, 2)).toBe(false);
    });

    test("unknown meta id is never active", () => {
        expect(metaGemActive(99999, 5, 5, 5)).toBe(false);
    });
});

describe("gearIssues isEnchantBad / getBadEnchantName", () => {
    test("slot-specific blacklist entry only matches its slot", () => {
        expect(isEnchantBad("248", 8)).toBe(true);   // Bracers - 1 Str
        expect(isEnchantBad("248", 9)).toBe(false);  // wrong slot
        expect(getBadEnchantName("248", 8)).toBe("Bracers - 1 Str");
    });

    test("null-slot blacklist entry matches any slot", () => {
        expect(isEnchantBad("2669", 15)).toBe(true); // Weapon - 40SP (slot: null)
        expect(getBadEnchantName("2669", 15)).toBe("Weapon - 40SP");
    });

    test("unknown enchant is fine", () => {
        expect(isEnchantBad("9999", 8)).toBe(false);
        expect(getBadEnchantName("9999", 8)).toBe("");
    });
});

describe("gearIssues analyzePlayerGear", () => {
    test("a pristine, fully-equipped player has no issues", () => {
        expect(analyzePlayerGear(playerWith(fullGear()))).toEqual([]);
    });

    test("empty gear flags every required slot as missing", () => {
        const issues = analyzePlayerGear(playerWith([]));
        expect(issues).toHaveLength(REQUIRED_SLOTS.length);
        expect(issues.every((i) => i.kind === "noItem" && i.severity === "high")).toBe(true);
        const beltIssue = issues.find((i) => i.itemName === SLOT_NAMES[5]);
        expect(beltIssue).toBeDefined();
    });

    test("missing enchant on an enchantable slot", () => {
        const gear = fullGear();
        delete gear.find((g) => g.slot === 9).permanentEnchant; // gloves lose their enchant
        const issues = analyzePlayerGear(playerWith(gear));
        expect(issues).toEqual([
            expect.objectContaining({ kind: "noEnchant", slot: 9, label: "keine Verzauberung", severity: "high" }),
        ]);
    });

    test("blacklisted (cheap) enchant is flagged as bad", () => {
        const gear = fullGear();
        gear.find((g) => g.slot === 8).permanentEnchant = "248"; // Bracers - 1 Str
        const issues = analyzePlayerGear(playerWith(gear));
        expect(issues).toEqual([
            expect.objectContaining({ kind: "badEnchant", slot: 8, label: "Bracers - 1 Str" }),
        ]);
    });

    test("spell-pen cloak enchant is tolerated for Priests but flagged otherwise", () => {
        const gear = fullGear();
        gear.find((g) => g.slot === 14).permanentEnchant = "2938"; // Cloak - Spell Pen
        expect(analyzePlayerGear(playerWith(gear, { type: "Priest" }))).toEqual([]);
        expect(analyzePlayerGear(playerWith(gear, { type: "Warrior" }))).toEqual([
            expect.objectContaining({ kind: "badEnchant", slot: 14 }),
        ]);
    });

    test("40SP weapon enchant is tolerated for Paladin/Shaman but flagged otherwise", () => {
        const gear = fullGear();
        gear.find((g) => g.slot === 15).permanentEnchant = "2669"; // Weapon - 40SP
        expect(analyzePlayerGear(playerWith(gear, { type: "Paladin" }))).toEqual([]);
        expect(analyzePlayerGear(playerWith(gear, { type: "Warrior" }))).toEqual([
            expect.objectContaining({ kind: "badEnchant", slot: 15 }),
        ]);
    });

    test("empty gem sockets are flagged once per missing gem", () => {
        const gear = fullGear();
        // item 28505 has 2 sockets per SOCKETS table; put it in the (enchanted) gloves slot
        const gloves = gear.find((g) => g.slot === 9);
        gloves.id = "28505";
        gloves.gems = []; // both sockets empty
        const issues = analyzePlayerGear(playerWith(gear));
        const empty = issues.filter((i) => i.kind === "emptySocket");
        expect(empty).toHaveLength(2);
    });

    test("an inactive meta gem is reported", () => {
        const gear = fullGear();
        // meta 25897 needs red > blue; supply neither -> inactive
        gear.find((g) => g.slot === 0).gems = [{ id: "25897", itemLevel: 70 }];
        const issues = analyzePlayerGear(playerWith(gear));
        expect(issues).toEqual([
            expect.objectContaining({ kind: "metaInactive", label: "Meta-Gem inaktiv" }),
        ]);
    });

    test("gemsToConsider:0 skips meta and gem checks", () => {
        const gear = fullGear();
        gear.find((g) => g.slot === 0).gems = [{ id: "25897", itemLevel: 70 }];
        expect(analyzePlayerGear(playerWith(gear), { gemsToConsider: 0 })).toEqual([]);
    });

    test("onlyGems skips missing-item and enchant checks", () => {
        // no gear at all, but onlyGems means required-slot check is skipped
        expect(analyzePlayerGear(playerWith([]), { onlyGems: true })).toEqual([]);
    });
});

describe("gearIssues formatIssue", () => {
    test("renders item name and label", () => {
        expect(formatIssue({ itemName: "Spellstrike Hood", label: "keine Verzauberung" }))
            .toBe("Spellstrike Hood [keine Verzauberung]");
    });
});

describe("gearIssues buildGearIssues", () => {
    function table() {
        return {
            entries: [
                { name: "Clean", type: "Warrior", total: 5000, gear: fullGear() },
                { name: "Dirty", type: "Mage", total: 5000, gear: [] }, // missing everything
                { name: "Afk", type: "Rogue", total: 5, gear: [] },     // filtered by selectPlayers
            ],
        };
    }

    test("only lists players that have issues by default", () => {
        const results = buildGearIssues(table());
        expect(results.map((r) => r.name)).toEqual(["Dirty"]);
        expect(results[0].issues.length).toBe(REQUIRED_SLOTS.length);
    });

    test("listPlayersWithNoIssues includes clean players with empty issue arrays", () => {
        const results = buildGearIssues(table(), { listPlayersWithNoIssues: true });
        const clean = results.find((r) => r.name === "Clean");
        expect(clean).toBeDefined();
        expect(clean.issues).toEqual([]);
    });
});

describe("gearIssues buildArmory", () => {
    test("reports enchant status and empty sockets per equipped item", () => {
        const gear = fullGear();
        // gloves: valid enchant + 1 of 2 sockets filled
        const gloves = gear.find((g) => g.slot === 9);
        gloves.id = "28505";
        gloves.gems = [{ id: "12345", itemLevel: 70, icon: "gem.jpg" }];
        // bracers: missing enchant
        delete gear.find((g) => g.slot === 8).permanentEnchant;

        const armory = buildArmory(playerWith(gear));
        const glovesRow = armory.find((r) => r.slot === 9);
        expect(glovesRow.enchant.status).toBe("ok");
        expect(glovesRow.emptySockets).toBe(1);
        expect(glovesRow.gems).toHaveLength(1);

        const bracersRow = armory.find((r) => r.slot === 8);
        expect(bracersRow.enchant.status).toBe("missing");

        // non-enchantable slot reports "na"
        const neckRow = armory.find((r) => r.slot === 1);
        expect(neckRow.enchant.status).toBe("na");
    });

    test("bad enchant surfaces its reason", () => {
        const gear = fullGear();
        gear.find((g) => g.slot === 8).permanentEnchant = "248";
        const armory = buildArmory(playerWith(gear));
        const bracers = armory.find((r) => r.slot === 8);
        expect(bracers.enchant.status).toBe("bad");
        expect(bracers.enchant.reason).toBe("Bracers - 1 Str");
    });

    test("skips empty (id 0) items", () => {
        const armory = buildArmory(playerWith([{ id: "0", slot: 0, name: "empty" }]));
        expect(armory).toEqual([]);
    });
});
