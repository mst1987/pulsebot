// Die erzeugten WoWSims-Daten. Nichts gemockt: geprüft wird, dass die Tabelle
// das trägt, was der Council daraus liest — und vor allem, dass die Sets beim
// richtigen Tier hängen. Genau daran ist es schon einmal gescheitert: die
// Sunwell-Liste zweier Caster zeigte auf die ZA-Phase.
const wowsims = require("../../src/config/wowsims");
const items = require("../../src/config/wowsims/items.json");
const bis = require("../../src/config/wowsims/bisSets.json");

// Womit man rechnen darf, wenn ein Set beim richtigen Tier hängt. Grob genug,
// dass ein schwaches Set nicht auffällt, eng genug für ein ganzes Tier daneben.
const TIER_MIN_ILVL = { t4: 108, t5: 126, t6: 136, t65: 152 };

const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
};

describe("config/wowsims — die erzeugten Daten", () => {
    describe("Item-Tabelle", () => {
        it("trägt Caster- und Nahkampfwerte, nicht nur die einen", () => {
            const all = Object.values(items.items);
            expect(all.length).toBeGreaterThan(4000);
            expect(all.filter((it) => it.stats.spellPower).length).toBeGreaterThan(500);
            expect(all.filter((it) => it.stats.attackPower || it.stats.strength || it.stats.agility).length)
                .toBeGreaterThan(1000);
            // Und Tankwerte, sonst wäre ein Schildträger nicht bewertbar.
            expect(all.filter((it) => it.stats.defense || it.stats.dodge || it.stats.blockValue).length)
                .toBeGreaterThan(100);
        });

        it("kennt Waffenschaden und -geschwindigkeit", () => {
            // Für einen Caster stand der Wert im Statblock; für jeden
            // Nahkämpfer ist die Waffe selbst die halbe Rechnung.
            const glaive = items.items["32837"];
            expect(glaive.name).toBe("Warglaive of Azzinoth");
            expect(glaive.weapon).toMatchObject({ min: 214, max: 398, speed: 2.8 });
        });

        it("liest die Werte an den richtigen Stellen aus", () => {
            // Die Zuordnung Zahl → Wert stammt aus WoWSims' eigenem Stat-Enum.
            // Ein verrutschter Index verrechnet stillschweigend jedes Item.
            expect(items.items["31064"].stats).toMatchObject({ intellect: expect.any(Number), spellPower: expect.any(Number) });
            expect(items.items["30902"].stats).toMatchObject({ strength: 75, armorPen: 335 });
        });
    });

    describe("BiS-Listen", () => {
        it("führt Caster, Nahkampf und Tanks", () => {
            const specs = Object.keys(bis.sets);
            expect(specs).toEqual(expect.arrayContaining([
                "Priest-Shadow", "Mage-Arcane", "Warlock-Destruction", "Druid-Balance", "Shaman-Elemental",
                "Warrior-Arms", "Warrior-Fury", "Rogue-Combat", "Druid-Feral",
                "Shaman-Enhancement", "Paladin-Retribution", "Hunter-BeastMastery", "Hunter-Survival",
                "Warrior-Protection", "Paladin-Protection", "Druid-Guardian",
            ]));
        });

        it("hängt jedes Set beim Tier, zu dem sein Itemlevel passt", () => {
            const wrong = [];
            for (const [specKey, tiers] of Object.entries(bis.sets)) {
                for (const [tier, set] of Object.entries(tiers)) {
                    const ilvls = set.filter(Boolean).map((e) => (wowsims.item(e.id) || {}).ilvl || 0).filter(Boolean);
                    const med = median(ilvls);
                    if (med < (TIER_MIN_ILVL[tier] || 0)) wrong.push(`${specKey} ${tier}: ilvl ${med}`);
                }
            }
            expect(wrong).toEqual([]);
        });

        it("führt die Sunwell-Liste der Caster nicht mehr auf der ZA-Phase", () => {
            // Der behobene Fehler: p4 (ilvl 141) stand als t65 drin, richtig ist
            // p5 (154). Ein T6-Set als Sunwell auszugeben lässt jeden Raider
            // fertig ausgerüstet aussehen.
            for (const spec of ["Druid-Balance", "Shaman-Elemental"]) {
                const set = bis.sets[spec].t65;
                expect(set).toBeTruthy();
                const med = median(set.filter(Boolean).map((e) => (wowsims.item(e.id) || {}).ilvl || 0));
                expect(med).toBeGreaterThanOrEqual(152);
            }
        });

        it("nennt kein Set, das die Item-Tabelle nicht kennt", () => {
            const missing = [];
            for (const [specKey, tiers] of Object.entries(bis.sets)) {
                for (const [tier, set] of Object.entries(tiers)) {
                    for (const entry of set.filter(Boolean)) {
                        if (!wowsims.item(entry.id)) missing.push(`${specKey} ${tier}: ${entry.id}`);
                    }
                }
            }
            expect(missing).toEqual([]);
        });

        it("hat keine leeren Listen — ein Platzhalter ist keine BiS-Liste", () => {
            // WoWSims liefert die Heiler-Sets als `{"items": []}`; die werden
            // beim Erzeugen verworfen, damit die Seite "keine Liste" sagen kann
            // statt "0 von 0 Teilen".
            for (const [specKey, tiers] of Object.entries(bis.sets)) {
                for (const [tier, set] of Object.entries(tiers)) {
                    expect({ specKey, tier, items: set.filter(Boolean).length })
                        .toMatchObject({ specKey, tier, items: expect.any(Number) });
                    expect(set.filter(Boolean).length).toBeGreaterThan(10);
                }
            }
        });

        it("führt weiterhin keine Heiler-Listen, weil es sie bei WoWSims nicht gibt", () => {
            // Geprüft gegen v0.0.127: alle Heil-Gear-Sets dort sind leer, und
            // für Priester-Heilung gibt es überhaupt keinen Sim. Sobald hier
            // etwas auftaucht, ist entweder WoWSims weiter — oder wir haben ein
            // DPS-Set als Heil-BiS eingehängt.
            for (const spec of ["Druid-Restoration", "Shaman-Restoration", "Paladin-Holy"]) {
                expect(bis.sets[spec]).toBeUndefined();
            }
        });
    });
});
