// The setup editor in two languages (#i18n): pages/raid-detail/setup/ and
// lib/setupEditor.ts take every text from the "setup" namespace, never at load
// time (#435: the source half of the former test/web-client/i18n-setup.test.js;
// the texts are tested in src/web-client/src/i18n/setup.test.ts).
const { read, clientSources } = require("../clientSource");

// the editor and its parts (#438), and the moves behind it
const FILES = [...clientSources("pages/raid-detail/setup").map(([name]) => name), "lib/setupEditor.ts"];

describe("setup namespace", () => {
    const editor = read("pages/raid-detail/setup");
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
        expect(editor).toMatch(/import \{[^}]*\buseT\b[^}]*\} from "\.\.\/\.\.\/\.\.\/i18n";/);
        expect(editor).toMatch(/import \{[^}]*\blocale\b[^}]*\} from "\.\.\/\.\.\/\.\.\/i18n";/);
        expect(lib).toContain("import { t } from \"../i18n\";");
    });

    it("never translates at module top level", () => {
        for (const file of FILES) {
            const lines = read(file).split("\n");
            const bad = lines.filter((l) => /^(export )?const \w+[^=]*= [^(]*\bt\(/.test(l));
            expect({ file, bad }).toEqual({ file, bad: [] });
        }
    });
});
