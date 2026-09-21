// The setup editor in two languages (#i18n): SetupEditor.tsx and
// lib/setupEditor.ts take every text from the "setup" namespace, never at load
// time, and the English texts read as they should.
const { read, makeT } = require("./i18nHelper");

const FILES = ["pages/raid-detail/SetupEditor.tsx", "lib/setupEditor.ts"];

describe("setup namespace", () => {
    const editor = read("pages/raid-detail/SetupEditor.tsx");
    const lib = read("lib/setupEditor.ts");

    it("moved the German literals out of the sources", () => {
        for (const text of ["Nahkampf", "Kommt später", "Pflicht-Buffs", "Trotzdem freigeben?", "Speichern fehlgeschlagen.", "Setup wird geladen", "Noch kein Setup", "Neu vorschlagen"]) {
            expect({ text, found: editor.includes(text) }).toEqual({ text, found: false });
        }
        for (const text of ["Raider nicht im Setup.", "den Event-Kanal", "Nicht angekommen", "ohne neue DM", "Setup im Kanal"]) {
            expect({ text, found: lib.includes(text) }).toEqual({ text, found: false });
        }
        expect(editor).not.toContain("\"de-DE\"");
    });

    it("imports the translation functions", () => {
        expect(editor).toMatch(/import \{[^}]*\buseT\b[^}]*\} from "\.\.\/\.\.\/i18n";/);
        expect(editor).toMatch(/import \{[^}]*\blocale\b[^}]*\} from "\.\.\/\.\.\/i18n";/);
        expect(lib).toContain("import { t } from \"../i18n\";");
    });

    it("never translates at module top level", () => {
        for (const file of FILES) {
            const lines = read(file).split("\n");
            const bad = lines.filter((l) => /^(export )?const \w+[^=]*= [^(]*\bt\(/.test(l));
            expect({ file, bad }).toEqual({ file, bad: [] });
        }
    });

    it("reads well in English", () => {
        const en = makeT("en");
        expect(en("setup.status.draft")).toBe("Draft");
        expect(en("setup.editor.placesBadge", { count: 24, size: 25 })).toBe("24/25 spots");
        expect(en("setup.summary.hints", { count: 1 })).toBe("1 note");
        expect(en("setup.summary.hints", { count: 3 })).toBe("3 notes");
        expect(en("setup.publish.dmsSent", { count: 2 })).toBe("2 DMs");
        expect(en("setup.editor.approveAnywayTitle")).toBe("Approve anyway?");
        expect(en.missing).toEqual([]);
    });

    it("keeps the German texts as they were", () => {
        const de = makeT("de");
        expect(de("setup.summary.hints", { count: 1 })).toBe("1 Hinweis");
        expect(de("setup.summary.hints", { count: 2 })).toBe("2 Hinweise");
        expect(de("setup.editor.placesSub", { count: 20, size: 25, bench: 3 })).toBe("20 von 25 Plätzen besetzt · 3 auf der Bank");
    });
});
