// The Raid-Events list, the raid table and their time bands speak both
// languages (#i18n, namespace `raids`): the German literals moved into
// locales/<lang>/raids.json, and nothing is translated at module load (#435:
// the source half of the former test/web-client/i18n-raids.test.js; the texts
// are tested in src/web-client/src/i18n/raids.test.ts, the time bands in
// lib/raidTime.test.ts).
const { read } = require("../clientSource");

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
});
