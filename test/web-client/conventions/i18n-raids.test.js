// The Raid-Events list, the raid table and their time bands speak both
// languages (#i18n, namespace `raids`): the German literals moved into
// locales/<lang>/raids.json, and nothing is translated at module load (#435:
// the source half of the former test/web-client/i18n-raids.test.js; the texts
// are tested in src/web-client/src/i18n/raids.test.ts, the time bands in
// lib/raids/raidTime.test.ts).
const { read } = require("../clientSource");

const FILES = [
    "pages/raids/RaidsPage.tsx",
    "pages/RaidCreatePage.tsx",
    "pages/raids/RaidList.tsx",
    "pages/history/RaidTable.tsx",
    "components/raid/RaidIcon.tsx",
    "lib/raids/raidTime.ts",
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
        for (const f of ["pages/raids/RaidsPage.tsx", "pages/raids/RaidList.tsx", "pages/history/RaidTable.tsx", "components/raid/RaidIcon.tsx"]) {
            expect({ f, useT: /import \{ useT \} from "(\.\.\/)+i18n";/.test(read(f)) }).toEqual({ f, useT: true });
        }
        expect(read("lib/raids/raidTime.ts")).toContain("import { locale, t } from \"../../i18n\";");
    });

    it("never translates at module top level", () => {
        for (const f of FILES) {
            const offenders = read(f).split("\n").filter((l) => /^(export )?const \w+[^=]*= [^(]*\bt\(/.test(l));
            expect({ f, offenders }).toEqual({ f, offenders: [] });
        }
    });
});
