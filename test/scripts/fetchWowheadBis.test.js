// Der Wowhead-Parser. Kein Netz: geprüft wird an Markup-Ausschnitten, die den
// echten Guides nachgebildet sind, denn genau dort steckt die Arbeit — welche
// Zeile als BiS zählt, was ein [toggler] verbirgt und in welchen Slot ein Teil
// gehört.
const { guideBody, phaseLinks, slotSections, buildSet, rankScore } = require("../../scripts/fetch-wowhead-bis");

// Echte Ids, damit die Slots aus der Item-Tabelle kommen wie im Ernstfall.
const HELM = 32089;          // Mana-Binder's Cowl, Kopf
const RING_A = 32528;        // Blessed Band of Karabor
const RING_B = 29309;        // Band of the Eternal Restorer
const MACE = 32500;          // Crystal Spire of Karabor, Einhand
const MACE_2 = 30918;        // Hammer of Atonement, Einhand
const OFFHAND = 34206;       // Book of Highborne Hymns, Nebenhand
const STAFF = 30908;         // Apostle of Argus, Zweihandstab
// Ein grünes Item, das die Tabelle bewusst nicht führt: Wowhead nennt es als
// Notlösung, Raid-Gear ist es nicht.
const UNKNOWN = 25634;       // Oshu'gun Relic

const table = (rows) => `[table class=grid width=70%]
[tr]
[td background=c5 width=10%][b]Rank[/b][/td]
[td background=c5 width=25%][b]Item[/b][/td]
[/tr]
${rows.map(([rank, id]) => `[tr][td]${rank}[/td]\n[td][item=${id}][/td]\n[td]Drop[/td][/tr]`).join("\n\n")}
[/table]`;

const section = (name, rows) => `[h3 toc="${name}"]Best in Slot ${name}[/h3]\nProsa.\n${table(rows)}`;

describe("scripts/fetch-wowhead-bis", () => {
    describe("guideBody", () => {
        it("liest den Guide aus dem printHtml-Aufruf", () => {
            const html = "<html><script>markup.printHtml(\"[h3 toc=\\\"Head\\\"]Hut[/h3]\", 1);</script>";
            expect(guideBody(html)).toBe("[h3 toc=\"Head\"]Hut[/h3]");
        });

        it("sagt es, statt eine leere Seite zurückzugeben", () => {
            expect(() => guideBody("<html>nichts</html>")).toThrow(/kein Guide-Text/);
        });
    });

    describe("phaseLinks", () => {
        it("findet die Phasen am Hub", () => {
            const hub = `
[cta-button=https://x/pre border=strong]Pre-Raid Priester BiS[/cta-button]
[cta-button=https://x/p1 border=strong]Phase 1 Priester BiS[/cta-button]
[cta-button=https://x/p5 class=c5]Phase 5 Priester BiS[/cta-button]
[cta-button guide=12332 border=strong]Karazhan Loot Guide[/cta-button]`;
            // Pre-Raid und die Loot-Guides gehören nicht dazu: das erste hat kein
            // Tier, das zweite ist gar keine BiS-Liste.
            expect(phaseLinks(hub)).toEqual({ 1: "https://x/p1", 5: "https://x/p5" });
        });
    });

    describe("rankScore", () => {
        it("erkennt BiS in jeder Schreibweise, die die Guides benutzen", () => {
            expect(rankScore("BiS")).toBe(3);
            expect(rankScore("Throughput BiS")).toBe(3);
            expect(rankScore("Regen BiS (CoH)")).toBe(3);
            expect(rankScore("Great")).toBe(2);
            expect(rankScore("Viable")).toBe(1);
        });
    });

    describe("slotSections", () => {
        it("nimmt eine Zeile je Item, mit ihrem Rang", () => {
            const [head] = slotSections(section("Head", [["BiS", HELM], ["Option", RING_A]]));
            expect(head.name).toBe("Head");
            expect(head.rows).toEqual([{ rank: "BiS", id: HELM }, { rank: "Option", id: RING_A }]);
        });

        it("lässt weg, was hinter einem [toggler] steht", () => {
            // Das sind ausdrücklich die Notlösungen — sie als BiS zu zählen
            // hieße, die Liste gegen ihre eigene Aussage zu lesen.
            const body = `${section("Head", [["BiS", HELM]])}
[toggler name="Other Head Armor Recommendations" closed=true]
${table([["Viable", RING_A]])}
[/toggler]`;
            expect(slotSections(body)[0].rows.map((r) => r.id)).toEqual([HELM]);
        });

        it("überspringt Abschnitte ohne Tabelle", () => {
            const body = `[h3 toc="Aldor vs Scryer"]Nur Text[/h3]\nProsa.\n${section("Head", [["BiS", HELM]])}`;
            expect(slotSections(body).map((s) => s.name)).toEqual(["Head"]);
        });
    });

    describe("buildSet", () => {
        it("legt die beiden besten Ringe in beide Ringslots", () => {
            // Die Guides zeichnen nur einen Ring als BiS aus und erwarten den
            // nächstbesten daneben — ohne das bliebe ein Ringslot leer.
            const { items } = buildSet(slotSections(
                section("Rings", [["BiS", RING_A], ["Great", RING_B]])
            ));
            expect(items.map((e) => e.id)).toEqual([RING_A, RING_B]);
        });

        it("stellt die zweitbeste Waffe nicht in die Nebenhand", () => {
            // Der Fehler, der einmal drin war: die Item-Tabelle nennt für jede
            // Waffe beide Hände, also nahm die zweite Waffe die Nebenhand — und
            // das eigentliche Nebenhand-Teil fand keinen Platz mehr.
            const { items } = buildSet(slotSections(
                `${section("Weapons", [["BiS", MACE], ["Great", MACE_2]])}\n${section("Offhands", [["BiS", OFFHAND]])}`
            ));
            expect(items.map((e) => e.id)).toEqual([MACE, OFFHAND]);
        });

        it("nimmt den Rang vor der Reihenfolge", () => {
            const { items } = buildSet(slotSections(
                section("Rings", [["Viable", RING_B], ["BiS", RING_A]])
            ));
            expect(items[0].id).toBe(RING_A);
        });

        it("meldet offene Slots statt sie stillschweigend zu lassen", () => {
            const { items, open } = buildSet(slotSections(section("Head", [["BiS", HELM]])));
            expect(items).toHaveLength(1);
            // 16 Pflichtslots, einer belegt.
            expect(open).toHaveLength(15);
            expect(open).not.toContain(16);
        });

        it("merkt sich, was die Item-Tabelle nicht kennt", () => {
            // Genau so kamen Idole, Totems und Libramme überhaupt erst in die
            // Tabelle: sie tragen keine Werte, fallen deshalb aus dem
            // WoWSims-Filter und werden über diese Liste nachgeholt.
            const { pending } = buildSet(slotSections(section("Idols", [["BiS", UNKNOWN]])));
            expect(pending).toEqual([UNKNOWN]);
        });

        it("hängt eine bloße Alternative nicht an, wenn ihr Slot besetzt ist", () => {
            // Sonst zöge jede grüne Notlösung aus jedem Guide in die Tabelle ein.
            const { pending } = buildSet(slotSections(
                section("Head", [["BiS", HELM], ["Great", UNKNOWN]])
            ));
            expect(pending).toEqual([]);
        });
    });

    it("lässt neben einem Zweihänder keine Nebenhand zu", () => {
        // Ein Stab nimmt beide Hände. Stünde das Nebenhand-Teil daneben, wäre
        // das Set nicht tragbar — und der Raider sähe näher an BiS aus, als er
        // je sein kann.
        expect(require("../../src/config/wowsims").item(STAFF).hand).toBe("two");
        const { items } = buildSet(slotSections(
            `${section("Weapons", [["BiS", STAFF]])}\n${section("Offhands", [["BiS", OFFHAND]])}`
        ));
        expect(items.map((e) => e.id)).toEqual([STAFF]);
    });
});
