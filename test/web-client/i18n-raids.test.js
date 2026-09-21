// The Raid-Events list, the raid table and their time bands speak both
// languages (#i18n, namespace `raids`): the German literals moved into
// locales/<lang>/raids.json, and nothing is translated at module load.
const { read, makeT } = require("./i18nHelper");

const FILES = [
    "pages/RaidsPage.tsx",
    "pages/RaidCreatePage.tsx",
    "components/RaidList.tsx",
    "components/RaidTable.tsx",
    "components/RaidIcon.tsx",
    "lib/raidTime.ts",
];

describe("raids namespace", () => {
    it("moved the German literals out of the sources", () => {
        const src = FILES.map(read).join("\n");
        for (const literal of [
            "Keine anstehenden Events gefunden.",
            "Raids werden geladen",
            "Wähle oben einen Server",
            "Nach Termin sortieren",
            "zugeordnet, nicht ausgewertet",
            "Kein Loot importiert",
            "Inhalt nicht erkannt",
            "Letzte Woche",
            ">Termin<",
            "\"de-DE\"",
        ]) {
            expect({ literal, found: src.includes(literal) }).toEqual({ literal, found: false });
        }
    });

    it("imports the translation helpers", () => {
        for (const f of ["pages/RaidsPage.tsx", "components/RaidList.tsx", "components/RaidTable.tsx", "components/RaidIcon.tsx"]) {
            expect({ f, useT: read(f).includes("import { useT } from \"../i18n\";") }).toEqual({ f, useT: true });
        }
        expect(read("lib/raidTime.ts")).toContain("import { locale, t } from \"../i18n\";");
    });

    it("never translates at module top level", () => {
        for (const f of FILES) {
            const offenders = read(f).split("\n").filter((l) => /^(export )?const \w+[^=]*= [^(]*\bt\(/.test(l));
            expect({ f, offenders }).toEqual({ f, offenders: [] });
        }
    });

    it("reads the key texts in both languages", () => {
        const de = makeT("de");
        const en = makeT("en");
        expect(de("raids.page.noneUpcoming")).toBe("Keine anstehenden Events gefunden.");
        expect(en("raids.page.noneUpcoming")).toBe("No upcoming events found.");
        expect(de("raids.list.pendingTip", { count: 1 })).toBe("1 Log nicht zugeordnet");
        expect(en("raids.list.pendingTip", { count: 2 })).toBe("2 logs not assigned");
        expect(de("raids.table.pendingLogs", { count: 3 })).toBe("3 Logs offen");
        expect(en("raids.list.seatsOf", { count: 12, size: 25 })).toBe("12 of 25 spots");
        expect(de.missing).toEqual([]);
        expect(en.missing).toEqual([]);
    });

    it("labels the week bands and dates in the active language", () => {
        // raidTime.ts has typed consts the helper's loader cannot strip, so
        // the wiring is checked in the source and the texts in the dictionaries.
        const time = read("lib/raidTime.ts");
        for (const key of ["thisWeek", "nextWeek", "lastWeek"]) expect(time).toContain(`t("raids.time.${key}")`);
        expect(time).toContain("t(\"raids.time.week\", { week: isoWeek(monday) })");
        expect((time.match(/toLocale(Date|Time)String\(locale\(\)/g) || []).length).toBe(4);
        const de = makeT("de");
        const en = makeT("en");
        expect([de("raids.time.thisWeek"), de("raids.time.nextWeek"), de("raids.time.week", { week: 40 })]).toEqual(["Diese Woche", "Nächste Woche", "KW 40"]);
        expect([en("raids.time.thisWeek"), en("raids.time.nextWeek"), en("raids.time.week", { week: 40 })]).toEqual(["This week", "Next week", "Week 40"]);
    });
});
