// Wer ein Teil überhaupt anlegen kann. Gegen die echte Tabelle geprüft, nicht
// gegen erfundene Items: die Regel hängt an Feldern, die das Fetch-Skript aus
// WoWSims mitbringt (Klassenliste, Rüstungsart, Waffentyp, Distanztyp), und
// ein verrutschtes Feld dort würde hier auffallen.
const { wearCheck, canWear, CLASS_IDS } = require("../../src/config/wearable");
const wowsims = require("../../src/config/wowsims");

// Items, deren Art feststeht (Name → Typ aus der Tabelle, siehe items.json).
const CORRUPTOR_HOOD = 30212;      // Hexenmeister-T5, Stoff, classes [9]
const SKYSHATTER_COVER = 31015;    // Schamanen-T6, Kette, classes [7]
const THUNDERHEART_HELM = 31037;   // Druiden-T6, Leder, classes [11]
const SEVENTH_CIRCLE = 30734;      // Leggings of the Seventh Circle, Stoff, ohne Klassenbindung
const DETERMINATION = 32515;       // Wristguards of Determination, Platte, ohne Klassenbindung
const ZHARDOOM = 32374;            // Zweihandstab
const TORCH = 32332;               // Torch of the Damned, Zweihand-Streitkolben
const TALON = 30082;               // Talon of Azshara, Einhandschwert
const NETHERBANE = 29924;          // Einhandaxt
const BARRIER = 33661;             // Vengeful Gladiator's Barrier, Schild
const WAND = 28783;                // Eredar Wand of Obliteration
const IDOL = 28568;                // Idol of the Avian Heart
const TOTEM = 33505;               // Totem of Living Water
const SILVER_CRESCENT = 29370;     // Icon of the Silver Crescent — Schmuck, für alle

describe("config/wearable", () => {
    it("liest die Felder, an denen die Regeln hängen, aus der Tabelle", () => {
        // Sonst prüft der Rest nur, dass unbekannte Items durchgewunken werden.
        expect(wowsims.item(SKYSHATTER_COVER)).toMatchObject({ armorType: 3, classes: [CLASS_IDS.Shaman] });
        expect(wowsims.item(ZHARDOOM)).toMatchObject({ weaponType: 8, hand: "two" });
        expect(wowsims.item(BARRIER)).toMatchObject({ weaponType: 7 });
        expect(wowsims.item(WAND)).toMatchObject({ rangedType: 5 });
        expect(wowsims.item(TOTEM)).toMatchObject({ rangedType: 8 });
    });

    describe("Klassenbindung", () => {
        it("gibt ein Setteil nur seiner Klasse", () => {
            expect(canWear("Warlock", CORRUPTOR_HOOD)).toBe(true);
            const mage = wearCheck("Mage", CORRUPTOR_HOOD);
            expect(mage.ok).toBe(false);
            expect(mage.reason).toBe("class");
            expect(mage.note).toContain("Hexenmeister");
        });

        it("schlägt vor der Rüstungsart zu — der Grund ist die Klasse, nicht der Stoff", () => {
            // Ein Priester trägt Stoff, das Hexer-T5 trotzdem nicht.
            expect(wearCheck("Priest", CORRUPTOR_HOOD).reason).toBe("class");
        });
    });

    describe("Rüstungsart", () => {
        it("gibt Stoffklassen keine Kette und kein Leder", () => {
            for (const cls of ["Mage", "Priest", "Warlock"]) {
                expect(wearCheck(cls, DETERMINATION)).toMatchObject({ ok: false, reason: "armor" });
                expect(canWear(cls, SEVENTH_CIRCLE)).toBe(true);
            }
            expect(wearCheck("Mage", DETERMINATION).note).toMatch(/Platte/);
        });

        it("erlaubt jeder Klasse alles bis zu ihrer eigenen Rüstungsart", () => {
            // Ein Schamane darf Stoff tragen — ob er soll, sagt die Simulation.
            expect(canWear("Shaman", SEVENTH_CIRCLE)).toBe(true);
            expect(canWear("Druid", SEVENTH_CIRCLE)).toBe(true);
            expect(canWear("Warrior", DETERMINATION)).toBe(true);
            expect(canWear("Paladin", DETERMINATION)).toBe(true);
            // Kette für Leder-Klassen: nein.
            expect(wearCheck("Druid", DETERMINATION).reason).toBe("armor");
            expect(wearCheck("Rogue", DETERMINATION).reason).toBe("armor");
            // Platte für Kette-Klassen: nein.
            expect(wearCheck("Hunter", DETERMINATION).reason).toBe("armor");
            expect(wearCheck("Shaman", DETERMINATION).reason).toBe("armor");
        });

        it("lässt einen Umhang jedem — er zählt als Stoff, ohne Stoffkenntnis zu brauchen", () => {
            const cloak = Object.entries(require("../../src/config/wowsims/items.json").items)
                .find(([, it]) => it.slots.length === 1 && it.slots[0] === 14 && it.armorType === 1);
            expect(cloak).toBeTruthy();
            expect(canWear("Warrior", Number(cloak[0]))).toBe(true);
            expect(canWear("Rogue", Number(cloak[0]))).toBe(true);
        });
    });

    describe("Waffen", () => {
        it("gibt einen Zweihandstab den Zauberern und dem Druiden, nicht dem Schurken", () => {
            for (const cls of ["Priest", "Mage", "Warlock", "Druid", "Shaman", "Hunter", "Warrior"]) {
                expect(canWear(cls, ZHARDOOM)).toBe(true);
            }
            expect(wearCheck("Rogue", ZHARDOOM)).toMatchObject({ ok: false, reason: "weapon" });
            expect(wearCheck("Paladin", ZHARDOOM).reason).toBe("weapon");
        });

        it("unterscheidet eine Hand von zwei", () => {
            // Einhandschwert: Magier ja, Priester nein. Zweihand-Streitkolben:
            // Druide ja, Priester (der Einhand-Kolben führt) nein.
            expect(canWear("Mage", TALON)).toBe(true);
            expect(wearCheck("Priest", TALON).reason).toBe("weapon");
            expect(canWear("Druid", TORCH)).toBe(true);
            expect(canWear("Warrior", TORCH)).toBe(true);
            expect(wearCheck("Priest", TORCH).reason).toBe("weapon");
            expect(wearCheck("Rogue", TORCH).reason).toBe("weapon");
        });

        it("gibt eine Axt dem Schamanen und dem Schurken, keinem Magier", () => {
            expect(canWear("Shaman", NETHERBANE)).toBe(true);
            expect(canWear("Rogue", NETHERBANE)).toBe(true);
            expect(wearCheck("Mage", NETHERBANE).reason).toBe("weapon");
            expect(wearCheck("Priest", NETHERBANE).reason).toBe("weapon");
        });

        it("gibt ein Schild nur Krieger, Paladin und Schamane", () => {
            expect(canWear("Shaman", BARRIER)).toBe(true);
            expect(canWear("Paladin", BARRIER)).toBe(true);
            expect(wearCheck("Priest", BARRIER)).toMatchObject({ ok: false, reason: "weapon" });
            expect(wearCheck("Priest", BARRIER).note).toMatch(/Schild/);
        });

        it("lässt dem Schamanen eine Zweihandaxt nur als Verstärker", () => {
            const axe = Object.entries(require("../../src/config/wowsims/items.json").items)
                .find(([, it]) => it.weaponType === 1 && it.hand === "two" && it.quality >= 4);
            expect(axe).toBeTruthy();
            expect(wearCheck("Shaman", Number(axe[0]), { spec: "Elemental" }).ok).toBe(false);
            expect(wearCheck("Shaman", Number(axe[0]), { spec: "Elemental" }).note).toMatch(/Verstärker/);
            expect(canWear("Shaman", Number(axe[0]), { spec: "Enhancement" })).toBe(true);
        });
    });

    describe("Distanzslot", () => {
        it("gibt Zauberstäbe nur den drei Stoffklassen", () => {
            for (const cls of ["Priest", "Mage", "Warlock"]) expect(canWear(cls, WAND)).toBe(true);
            for (const cls of ["Druid", "Shaman", "Hunter", "Paladin"]) {
                expect(wearCheck(cls, WAND)).toMatchObject({ ok: false, reason: "ranged" });
            }
        });

        it("gibt Relikte genau einer Klasse", () => {
            expect(canWear("Druid", IDOL)).toBe(true);
            expect(canWear("Shaman", IDOL)).toBe(false);
            expect(canWear("Shaman", TOTEM)).toBe(true);
            expect(canWear("Druid", TOTEM)).toBe(false);
            expect(canWear("Paladin", TOTEM)).toBe(false);
        });
    });

    describe("wo es nichts zu prüfen gibt", () => {
        it("lässt Schmuck, Ringe und Hälse jedem", () => {
            expect(canWear("Warrior", SILVER_CRESCENT)).toBe(true);
            expect(canWear("Mage", SILVER_CRESCENT)).toBe(true);
        });

        it("winkt ein unbekanntes Item durch — nicht wissen heißt nicht 'kann nicht'", () => {
            expect(wearCheck("Mage", 999999)).toMatchObject({ ok: true, reason: "" });
        });

        it("winkt eine unbekannte Klasse durch, statt jeden Raider zu verlieren", () => {
            expect(canWear("", SKYSHATTER_COVER)).toBe(true);
            expect(canWear("DeathKnight", SKYSHATTER_COVER)).toBe(true);
        });
    });
});
