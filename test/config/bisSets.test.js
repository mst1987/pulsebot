// Die zusammengeführte BiS-Quelle und die Wowhead-Heilerlisten dahinter.
// Nichts gemockt: beides ist erzeugte Konfiguration, und geprüft wird, was der
// Council daraus liest — vollständige Sets, das richtige Tier, und dass eine
// geschriebene Liste nie als simulierte durchgeht.
const bis = require("../../src/config/bisSets");
const wowsims = require("../../src/config/wowsims");
const wowhead = require("../../src/config/wowhead/bisSets.json");

const HEALERS = ["Priest-Holy", "Druid-Restoration", "Shaman-Restoration", "Paladin-Holy"];
const TIERS = ["t4", "t5", "t6", "t65"];

// Womit man rechnen darf, wenn ein Set beim richtigen Tier hängt — dieselbe
// Kontrolle wie bei den WoWSims-Sets, und aus demselben Grund: ein Tier daneben
// lässt jeden Raider fertig ausgerüstet aussehen.
const TIER_MIN_ILVL = { t4: 105, t5: 120, t6: 133, t65: 145 };

const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
};

describe("config/wowhead — die Heilerlisten", () => {
    it("führt jede Heil-Spec in jedem Tier", () => {
        for (const spec of HEALERS) {
            expect(Object.keys(wowhead.sets[spec] || {}).sort()).toEqual([...TIERS].sort());
        }
    });

    it("füllt jedes Set bis auf höchstens die Nebenhand", () => {
        // Eine Liste, die an der Hälfte der Slots nichts sagt, ist keine
        // BiS-Liste — sie lässt den Raider näher an BiS aussehen, als er ist.
        // 16 statt 17 heißt: eine Zweihandwaffe nimmt die Nebenhand mit.
        for (const [spec, tiers] of Object.entries(wowhead.sets)) {
            for (const [tier, set] of Object.entries(tiers)) {
                expect({ spec, tier, teile: set.length }).toMatchObject({ spec, tier });
                expect(set.length).toBeGreaterThanOrEqual(16);
            }
        }
    });

    it("nennt kein Item, das die Item-Tabelle nicht kennt", () => {
        const missing = [];
        for (const [spec, tiers] of Object.entries(wowhead.sets)) {
            for (const [tier, set] of Object.entries(tiers)) {
                for (const entry of set) {
                    if (!wowsims.item(entry.id)) missing.push(`${spec} ${tier}: ${entry.id}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it("belegt jeden Slot höchstens einmal", () => {
        // Zwei Ringe gehören in zwei Ringslots; zwei Waffen in eine Hand nicht.
        // Genau das ging einmal schief: die zweitbeste Waffe rutschte in die
        // Nebenhand und verdrängte das eigentliche Nebenhand-Teil.
        for (const [spec, tiers] of Object.entries(wowhead.sets)) {
            for (const [tier, set] of Object.entries(tiers)) {
                const used = new Set();
                for (const entry of set) {
                    const item = wowsims.item(entry.id);
                    const slots = item.hand === "off" ? [16] : (item.hand ? [15] : item.slots);
                    const free = slots.find((slot) => !used.has(slot));
                    expect({ spec, tier, item: item.name, frei: free }).toMatchObject({ spec, tier });
                    expect(free).not.toBeUndefined();
                    used.add(free);
                }
            }
        }
    });

    it("hängt jedes Set beim Tier, zu dem sein Itemlevel passt", () => {
        const wrong = [];
        for (const [spec, tiers] of Object.entries(wowhead.sets)) {
            for (const [tier, set] of Object.entries(tiers)) {
                const med = median(set.map((e) => (wowsims.item(e.id) || {}).ilvl || 0).filter(Boolean));
                if (med < (TIER_MIN_ILVL[tier] || 0)) wrong.push(`${spec} ${tier}: ilvl ${med}`);
            }
        }
        expect(wrong).toEqual([]);
    });

    it("trägt keine Sockel und keine Verzauberungen — Wowhead nennt keine", () => {
        // Der Preis dieser Quelle, und er gehört festgehalten: sollte hier je
        // etwas auftauchen, stimmt die Beschriftung auf der Seite nicht mehr.
        for (const tiers of Object.values(wowhead.sets)) {
            for (const set of Object.values(tiers)) {
                for (const entry of set) expect(Object.keys(entry)).toEqual(["id"]);
            }
        }
    });
});

describe("config/bisSets — beide Quellen zusammen", () => {
    it("nimmt WoWSims, wo es etwas hat", () => {
        const shadow = bis.bisFor("Priest-Shadow", "t6");
        expect(shadow.source).toBe("wowsims");
        expect(shadow.items.some((e) => e.gems || e.enchant)).toBe(true);
    });

    it("nimmt Wowhead, wo WoWSims nichts hat", () => {
        for (const spec of HEALERS) {
            const set = bis.bisFor(spec, "t6");
            expect(set.source).toBe("wowhead");
            expect(set.tier).toBe("t6");
            expect(set.exact).toBe(true);
            expect(set.items.length).toBeGreaterThanOrEqual(16);
        }
    });

    it("fällt auf ein früheres Tier zurück, nie auf ein späteres", () => {
        // Ein T6-Raider ist mit der T5-Liste besser bedient als mit gar keiner;
        // die Sunwell-Liste würde ihn an Gear messen, das noch nicht fällt.
        expect(bis.bisFor("Priest-Shadow", "t65")).toMatchObject({ tier: "t6", exact: false });
        expect(bis.bisFor("Priest-Holy", "t4").tier).toBe("t4");
    });

    it("sagt zu jeder Spec, woher ihre Listen kommen", () => {
        expect(bis.sourceFor("Priest-Shadow")).toBe("wowsims");
        expect(bis.sourceFor("Paladin-Holy")).toBe("wowhead");
        expect(bis.sourceFor("Gibt-Esnicht")).toBe("");
    });

    it("kennt jede Spec beider Quellen", () => {
        const specs = bis.specsWithBis();
        expect(specs).toEqual(expect.arrayContaining(["Priest-Shadow", "Warrior-Arms", ...HEALERS]));
        // Keine Dopplung, auch wenn eine Spec in beiden Quellen stünde.
        expect(specs.length).toBe(new Set(specs).size);
    });

    it("antwortet leer statt zu raten, wenn es nichts gibt", () => {
        expect(bis.bisFor("Gibt-Esnicht", "t6")).toMatchObject({ items: [], tier: "", source: "" });
        expect(bis.bisTiers("Gibt-Esnicht")).toEqual([]);
    });
});
