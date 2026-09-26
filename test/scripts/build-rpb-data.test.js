// Die Parser hinter scripts/build-rpb-data.js. Kein Netz, kein Schreiben ins
// Repo: geprüft wird an einem kleinen, handgebauten Ausschnitt des RPB-Config-
// Sheets (test/fixtures/scripts/rpb-config.csv) und an Zeilen, die hier inline
// stehen. Das echte Sheet ist horizontal aufgebaut: Zeile 2 trägt die
// Abschnittsköpfe, darunter je Abschnitt eine "[id]"-Spalte und eine DE-Spalte.
const fs = require("fs");
const path = require("path");
const { tempStoreFile } = require("../helpers/tempStore");
const {
    parseCsv,
    findColumn,
    columnValues,
    parseEntry,
    readSection,
    readNameSection,
    sectionHeading,
    addTrashRequirements,
    parseSpellHaste,
    iconCandidatesOf,
    render,
    MAX_ICON_TRIES,
} = require("../../scripts/build-rpb-data");

const FIXTURE = path.join(__dirname, "..", "fixtures", "scripts", "rpb-config.csv");
const rows = parseCsv(FIXTURE);

describe("scripts/build-rpb-data", () => {
    describe("parseCsv", () => {
        it("liest Zeilen und Zellen, auch gequotete mit Komma und doppeltem Anführungszeichen", () => {
            expect(rows).toHaveLength(7);
            expect(rows[2]).toEqual(["Fireball [133*,38692] {3.5}", "Feuerball", "Dodge outgoing", "Ausweichen", "", ""]);
            expect(rows[6]).toEqual(["Cone of Cold [120*,\"x\",27087]", "Kältekegel, Rang 6", "", "", "", ""]);
        });

        it("überspringt \\r außerhalb von Quotes und nimmt eine letzte Zeile ohne Zeilenumbruch mit", () => {
            const file = tempStoreFile("crlf.csv");
            fs.writeFileSync(file, "a,b\r\n\"c\r\nd\",e");
            // Innerhalb von Quotes bleibt der Zeilenumbruch, wie er in der Datei steht.
            expect(parseCsv(file)).toEqual([["a", "b"], ["c\r\nd", "e"]]);
        });
    });

    describe("findColumn / columnValues", () => {
        it("findet die Spalte über den Kopf in Zeile 2", () => {
            expect(findColumn((h) => h === "statsAndMisc tracked DE", rows)).toBe(3);
            expect(findColumn((h) => h.startsWith("singleTargetCasts tracked Mage ["), rows)).toBe(0);
            expect(findColumn((h) => h === "gibt es nicht", rows)).toBe(-1);
        });

        it("liefert die nicht-leeren Zellen unter dem Kopf, für -1 nichts", () => {
            expect(columnValues(3, rows)).toEqual(["Ausweichen"]);
            expect(columnValues(-1, rows)).toEqual([]);
        });
    });

    describe("parseEntry", () => {
        it("zerlegt Ids, niedrige Ränge und Zauberzeit", () => {
            expect(parseEntry("Fireball [133*,38692] {3.5}", "Feuerball")).toEqual({
                name: "Fireball",
                label: "Feuerball",
                ids: ["133", "38692"],
                lowerRankIds: ["133"],
                castTime: 3.5,
            });
        });

        it("liest Cooldown und gewährte Laufzeit, ohne Label gilt der Name", () => {
            expect(parseEntry("Bloodlust [2825] --600-- ++40++", "")).toEqual({
                name: "Bloodlust",
                label: "Bloodlust",
                ids: ["2825"],
                cooldown: 600,
                uptimeSeconds: 40,
            });
        });

        it("markiert Uptime- und Overheal-Einträge", () => {
            expect(parseEntry("Shield Wall (uptime%) [871]", "Schildwall")).toMatchObject({ isUptime: true });
            expect(parseEntry("Holy Light overheal [635]", "")).toMatchObject({ isOverheal: true, label: "Holy Light overheal" });
        });

        it("schneidet Ids und Zauberzeit aus dem Label", () => {
            expect(parseEntry("Fireball [133]", "Feuerball [133]").label).toBe("Feuerball");
            expect(parseEntry("Fireball [133]", "Feuerball {3.5}").label).toBe("Feuerball");
        });

        it("gibt null ohne gültige Id", () => {
            expect(parseEntry("Just a note", "Notiz")).toBeNull();
            expect(parseEntry("Broken [abc, ]", "")).toBeNull();
        });
    });

    describe("readSection", () => {
        it("liest einen Abschnitt samt zeilengleichem DE-Label und lässt Notizen weg", () => {
            const section = readSection(
                (h) => h.startsWith("singleTargetCasts tracked Mage ["),
                (h) => h === "singleTargetCasts tracked Mage DE",
                rows,
            );
            expect(section).toEqual([
                { name: "Fireball", label: "Feuerball", ids: ["133", "38692"], lowerRankIds: ["133"], castTime: 3.5 },
                { name: "Icy Veins", label: "Icy Veins", ids: ["12472"], cooldown: 180, uptimeSeconds: 20 },
                { name: "Cone of Cold", label: "Kältekegel, Rang 6", ids: ["120", "27087"], lowerRankIds: ["120"] },
            ]);
        });

        it("wirft, wenn es den Abschnitt nicht gibt", () => {
            expect(() => readSection((h) => h === "nope [", (h) => h === "nope DE", rows))
                .toThrow("section not found in configNew.csv");
        });
    });

    describe("readNameSection", () => {
        it("liest Name und Label ohne Ids, fehlendes Label fällt auf den Namen", () => {
            expect(readNameSection(
                (h) => h.startsWith("statsAndMisc tracked ["),
                (h) => h === "statsAndMisc tracked DE",
                rows,
            )).toEqual([
                { name: "Dodge outgoing", label: "Ausweichen" },
                { name: "Crushing Blow incoming", label: "Crushing Blow incoming" },
            ]);
        });
    });

    describe("sectionHeading", () => {
        it("nimmt den {}-Inhalt der '<abschnitt> DE'-Zelle", () => {
            expect(sectionHeading("damageTaken", rows)).toBe("Vermeidbarer Schaden");
            expect(sectionHeading("singleTargetCasts", rows)).toBe("Einzelziel-Zauber");
            expect(sectionHeading("absorbs", rows)).toBe("");
        });
    });

    describe("addTrashRequirements", () => {
        // Spalten wie in validate*Log: 0 Einzel-Id, 1 Zone, 2 Name EN, 3 Minimum,
        // 5 Name DE, 12 Anforderungstext mit "(ID: ...)".
        const row = (cells) => {
            const out = new Array(13).fill("");
            for (const [i, v] of Object.entries(cells)) out[i] = v;
            return out;
        };

        it("sammelt je Zone Name, Label, Minimum und Ids", () => {
            const target = addTrashRequirements([
                row({ 1: "Zone", 2: "Name", 3: "Min" }),
                row({ 1: "SSC", 2: "Tidewalker", 3: "20", 5: "Gezeitenwandler", 12: "- 20 Tidewalker (ID: 21224, 21225)" }),
                row({ 0: "17816", 1: "SSC", 2: "Serpentshrine Lurker", 3: "4" }),
                row({ 1: "SSC", 2: "Ohne Id", 3: "1" }),
            ], {});
            expect(target).toEqual({
                SSC: [
                    { name: "Tidewalker", label: "Gezeitenwandler", minimum: 20, ids: ["21224", "21225"] },
                    { name: "Serpentshrine Lurker", label: "Serpentshrine Lurker", minimum: 4, ids: ["17816"] },
                ],
            });
        });

        it("hängt an ein bestehendes Ziel an", () => {
            const target = { KZ: [{ name: "a", label: "a", minimum: 1, ids: ["1"] }] };
            addTrashRequirements([row({ 0: "2", 1: "KZ", 2: "b", 3: "3" })], target);
            expect(target.KZ.map((r) => r.name)).toEqual(["a", "b"]);
        });
    });

    describe("parseSpellHaste", () => {
        it("nimmt nur Zeilen mit numerischer Id und numerischem Wert", () => {
            expect(parseSpellHaste([
                ["itemId", "haste"],
                ["32089", " 20 "],
                ["abc", "5"],
                ["1", ""],
                [],
            ])).toEqual({ 32089: 20 });
        });
    });

    describe("iconCandidatesOf", () => {
        it("probiert höchste Ränge vor den niedrigen", () => {
            expect(iconCandidatesOf({ ids: ["1", "2", "3"], lowerRankIds: ["1"] })).toEqual(["2", "3", "1"]);
        });

        it("begrenzt auf MAX_ICON_TRIES Versuche", () => {
            const ids = Array.from({ length: 12 }, (_, i) => String(i + 1));
            expect(MAX_ICON_TRIES).toBe(10);
            expect(iconCandidatesOf({ ids })).toEqual(ids.slice(0, 10));
        });
    });

    describe("render", () => {
        it("trägt die festen Konstanten der RPB-Rechnung", () => {
            const out = render();
            expect(out.EXCLUDED_ENCOUNTER_ID).toBe(724);
            expect(out.HASTE_RATING_PER_PERCENT).toBe(15.77);
            expect(out.HASTE_BUFFS.find((b) => b.key === "bloodlust")).toEqual({
                key: "bloodlust", label: "Kampfrausch/Heldentum", ids: ["2825", "32182"], seconds: 9,
            });
        });
    });
});
